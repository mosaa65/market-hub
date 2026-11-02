-- ═══════════════════════════════════════════════════════════════════════════
-- 9910 — طرق الدفع: أربع فقط، ومربوطة بالدليل افتراضيًا
--
--  لماذا
--  ─────
--  بقيت ثماني طرق متقاعدة داخل `payment_methods` (البطاقة، الشيك، بنك
--  الكريمي، بنك اليمن الدولي، جوالي، جيب، فلوسك، ون كاش) «لأن مستندات قديمة
--  تشير إليها». العبارة صحيحة عن المستندات لكنها خاطئة عن الجدول:
--
--    • كل مستند يخزّن قيمة ENUM (`payment_method` / `refund_method`)، لا حقلًا
--      مرجعيًا إلى `payment_methods.id`. فلا حاجة لبقاء الصف ليُقرأ مستند قديم.
--    • القيم `card` و`cheque` تبقى **داخل التعداد** للقراءة التاريخية، وهذا كل
--      ما يحتاجه تقرير على فاتورة 2024.
--    • الأسطر المرجعية الحقيقية هي `sales_invoices.payment_method_id` وأخواتها،
--      وتُعالَج قبل الحذف: تُفرَّغ إن كانت المتقاعدة وحدها، وإن وُجدت مع طريقة
--      معتمدة كانت الأسطر ملك تقرير `payment_splits` ولا تُمسّ.
--
--  النتيجة: الكتالوج يحوي الثلاث المعتمدة للتحصيل، وآجل، و`split` (حالة مستند
--  لا خيار يختاره أحد). ولا قبول لطريقة جديدة.
--
--  وأما «لا يوجد حساب في الدليل»: السبب أنها لم تُضبط قط. الملف يضبطها الآن
--  بترتيب أسبقية واضح، ويرفض الطرق التي لا حساب لها في الدليل.
--
--  التراجع
--  ───────
--  الصفوف المتقاعدة تُستعاد من `payment_methods_catalog_archive` بـ INSERT …
--  SELECT، ومعها `rows_deleted` أدناه. لا تُستعاد إعداداتها فلن تُقبل من الحارس
--  أصلًا. أما قائمة `update_payment_method` المتقاعدة فتعود من الترحيل 16.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. حارس الكتالوج: أربعة وعنصر تجزئة، لا أكثر ───────────────────────────
CREATE OR REPLACE FUNCTION public.guard_four_payment_method_catalogue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active AND NEW.id NOT IN (
    'cash', 'credit', 'bank_transfer', 'mobile_money', 'split'
  ) THEN
    RAISE EXCEPTION 'Only four payment methods and the split document state may remain active: %', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_four_payment_method_catalogue() FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. أرشيف الصفوف المحذوفة ───────────────────────────────────────────────
-- حذف صف بلا نسخة يعني أن إعادة الحالة السابقة تصبح إعادة كتابة يدوية. هذا
-- الجدول هو ما يجعل الحذف قابلًا للتراجع، ويوثّق لماذا وقع ومتى.
CREATE TABLE IF NOT EXISTS public.payment_methods_catalog_archive (
  id                 text PRIMARY KEY,
  row_snapshot       jsonb NOT NULL,
  rows_deleted       bigint NOT NULL DEFAULT 0,
  rows_retargeted    bigint NOT NULL DEFAULT 0,
  archived_at        timestamptz NOT NULL DEFAULT now(),
  archived_by        uuid DEFAULT auth.uid()
);

COMMENT ON TABLE public.payment_methods_catalog_archive IS
  'نسخ صفوف طرق الدفع المتقاعدة قبل حذفها، مع عدد المستندات التي كانت تشير إليها.';

ALTER TABLE public.payment_methods_catalog_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_methods_catalog_archive_finance_read
  ON public.payment_methods_catalog_archive;
CREATE POLICY payment_methods_catalog_archive_finance_read
  ON public.payment_methods_catalog_archive
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner') OR
    public.has_role(auth.uid(), 'manager') OR
    public.has_role(auth.uid(), 'accountant')
  );

REVOKE ALL ON public.payment_methods_catalog_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_methods_catalog_archive TO authenticated;
GRANT ALL ON public.payment_methods_catalog_archive TO service_role;

-- ── 3. الحذف ────────────────────────────────────────────────────────────────
--
-- الخطوات بالترتيب، ولا يجوز خلافها:
--   أ. تفريغ `payment_method_id` من كل مستند حيث كانت الإشارة الوحيدة إلى صف
--      سنحذفه. أما المستندات المسجّلة كتجزئة (`split`) فتحمل صفوفًا في جدول
--      التجزئة تشير إلى طريقة معتمدة، فتبقى إشارتها ولا تُمسّ.
--   ب. حذف صفوف التجزئة التي تشير إلى متقاعد — لا معنى لتوزيع على طريقة لم تعد
--      موجودة، وهي ما يمنع الحذف بقيد المفتاح الأجنبي.
--   جـ. أرشفة الإعدادات والصفوف، ثم الحذف.
--
-- كل جملة UPDATE/DELETE أدناه محصورة بالأسماء المتقاعدة، فالترحيل لا يلمس أي
-- مستند مسجّل بأحد الخيارات الأربعة.
DO $$
DECLARE
  v_retired text[] := ARRAY[
    'card', 'cheque', 'kuraimi_bank', 'yemen_kuwait_bank',
    'jawali', 'jaib', 'floosak', 'one_cash'
  ];
  v_refs      record;
  v_affected  bigint;
  v_cleared   bigint := 0;
  v_split_del bigint := 0;
BEGIN
  -- (أ) تفريغ الإشارة إلى الطريقة المتقاعدة من كل مستند.
  --
  -- في المستندات المسجّلة كـ`split` تكون الإشارة إلى طريقة معتمدة، فتبقى؛
  -- وإلا فُرّغت ليتمكّن الحذف. الأثر الوحيد على مستند حقيقي هو أن حقل المعرّف
  -- يفرغ؛ وقيمة التعداد (`payment_method`) تبقى كما هي، وهي ما تقرأه التقارير.
  FOR v_refs IN
    SELECT * FROM (VALUES
      ('sales_invoices',          'payment_splits',          'document_id'),
      ('purchase_invoices',       'payment_splits',          'document_id'),
      ('customer_payments',       'customer_payment_splits', 'payment_id'),
      ('expenses',                'expense_payments',        'entry_id'),
      ('expense_payments',        NULL,                      NULL),
      ('supplier_payments',       NULL,                      NULL),
      ('sales_returns',           NULL,                      NULL),
      ('purchase_returns',        NULL,                      NULL)
    ) AS r(relname, split_table, split_fk)
  LOOP
    -- These names cover both the current schema and legacy installations.
    -- Some legacy tables retain the payment enum but never had a catalogue FK.
    -- Skip those tables instead of issuing an UPDATE against a missing column.
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name = v_refs.relname
         AND c.column_name = 'payment_method_id'
    ) THEN
      CONTINUE;
    END IF;

    IF v_refs.split_table IS NULL THEN
      EXECUTE format(
        'UPDATE public.%I SET payment_method_id = NULL WHERE payment_method_id = ANY($1)',
        v_refs.relname
      ) USING v_retired;
    ELSE
      -- يُفشل الاستعلام إن غاب العمود الذي يفترضه هذا الملف، بدل أن يمرّ
      -- بصمت ويُخفي مرجعًا يمنع الحذف. قاعدة حديثة يجب أن تطابق هذا الشكل.
      EXECUTE format(
        'UPDATE public.%I t SET payment_method_id = NULL '
        ' WHERE t.payment_method_id = ANY($1) '
        '   AND NOT EXISTS (SELECT 1 FROM public.%I s WHERE s.%I = t.id)',
        v_refs.relname, v_refs.split_table, v_refs.split_fk
      ) USING v_retired;
    END IF;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    v_cleared := v_cleared + v_affected;
  END LOOP;

  -- (ب) صفوف التجزئة نفسها.
  DELETE FROM public.payment_splits
   WHERE payment_method_id = ANY (v_retired)
      OR method::text = ANY (ARRAY['card', 'cheque']);
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  v_split_del := v_split_del + v_affected;

  DELETE FROM public.customer_payment_splits
   WHERE payment_method_id = ANY (v_retired)
      OR method::text = ANY (ARRAY['card', 'cheque']);
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  v_split_del := v_split_del + v_affected;

  -- (جـ) الإعدادات ثم الكتالوج.
  IF to_regclass('public.payment_method_settings_archive') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO public.payment_method_settings_archive (payment_method_id, settings_snapshot)
      SELECT s.payment_method_id, to_jsonb(s)
        FROM public.payment_method_settings s
       WHERE s.payment_method_id = ANY ($1)
      ON CONFLICT (payment_method_id) DO UPDATE
        SET settings_snapshot = EXCLUDED.settings_snapshot,
            archived_at = now(), archived_by = auth.uid()
    $q$ USING v_retired;
  END IF;

  DELETE FROM public.payment_method_settings
   WHERE payment_method_id = ANY (v_retired);

  INSERT INTO public.payment_methods_catalog_archive (
    id, row_snapshot, rows_deleted, rows_retargeted
  )
  SELECT m.id, to_jsonb(m), v_cleared, v_split_del
    FROM public.payment_methods m
   WHERE m.id = ANY (v_retired)
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM public.payment_methods WHERE id = ANY (v_retired);
END $$;

-- ── 4. الإعدادات: لكل طريقة معتمدة صف صريح ─────────────────────────────────
--
-- `payment_method_settings_guard` يقصر الإعدادات على الأربع، ويشترط أن تكون
-- `enabled_contexts` مجموعة جزئية من `allowed_contexts`. فالبذر هنا ينسخ
-- الأقسام من الكتالوج نفسه.
INSERT INTO public.payment_method_settings (
  payment_method_id, enabled, sort_order, enabled_contexts
)
SELECT m.id, true, m.sort_order, m.allowed_contexts
  FROM public.payment_methods m
 WHERE m.id IN ('cash', 'credit', 'bank_transfer', 'mobile_money')
   AND m.id NOT IN (SELECT s.payment_method_id FROM public.payment_method_settings s)
ON CONFLICT (payment_method_id) DO NOTHING;

-- ── 5. الأقسام: المصفوفة الفارغة حقًّا = «لا أقسام» ──────────────────────────
--
-- كانت الواجهة تقرأ `enabled_contexts = '{}'` كـ«ورث أقسام الكتالوج»، بينما
-- القاعدية تحفظها كـ«طريقة لا تظهر في أي قسم». تناقض يُبقي طريقة مطفأة في
-- الصندوق. القاعدة هنا: NULL = لم تُضبط (تُورَّث)، '{}' = مُطفأة عمدًا.
-- وكل صف جاء من البذر السابق يحمل الأقسام الكاملة، فلا منشأة تفقد اختيارها.
COMMENT ON COLUMN public.payment_method_settings.enabled_contexts IS
  'أقسام ظهور هذه الطريقة لهذه المنشأة. NULL أو صف غائب = ترث أقسام الكتالوج. '
  'مصفوفة فارغة = مُعطَّلة في كل الأقسام عن قصد.';

-- وتُطبّق القاعدة نفسها على العرض، لأن الواجهة تقرأه وقد تقرأه تقارير مستقبلًا:
-- `coalesce(cardinality(x), 0) > 0 ? x : allowed` كان يعيد المصفوفة الفارغة إلى
-- الأقسام الكاملة.
CREATE OR REPLACE FUNCTION public.payment_method_catalog_view()
RETURNS TABLE(
  id text, name_ar text, name_en text, icon_key text, ledger_kind text,
  default_account_code text, is_credit_term boolean, is_active boolean,
  sort_order integer, allowed_contexts text[], legacy_id text, is_system boolean,
  requires_reference boolean, enabled boolean, effective_sort_order integer,
  effective_contexts text[], is_configured boolean, is_renamed boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.name_ar,
    m.name_en,
    m.icon_key,
    m.ledger_kind,
    m.default_account_code,
    m.is_credit_term,
    m.is_active,
    m.sort_order,
    m.allowed_contexts,
    m.legacy_id,
    m.is_system,
    m.requires_reference,
    coalesce(s.enabled, true),
    coalesce(s.sort_order, m.sort_order),
    -- null = وراثة، '{}' = مطفأة عمدًا.
    CASE
      WHEN s.enabled_contexts IS NULL THEN m.allowed_contexts
      ELSE s.enabled_contexts
    END,
    (s.payment_method_id IS NOT NULL),
    (m.is_system AND m.shipped_name_ar IS NOT NULL
     AND m.name_ar IS DISTINCT FROM m.shipped_name_ar)
  FROM public.payment_methods m
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  ORDER BY coalesce(s.sort_order, m.sort_order), m.id;
$$;

REVOKE ALL ON FUNCTION public.payment_method_catalog_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_catalog_view() TO authenticated, service_role;

-- ── 6. الحساب الافتراضي لكل طريقة: مُضبوط لا مفقود ─────────────────────────
--
-- أسبقية الاختيار، بالترتيب:
--   1. الحساب الحالي إن كان موجودًا وقابلًا للترحيل وينتمي إلى العائلة.
--   2. الصندوق الافتراضي لِنقد، والبنك الافتراضي للتحويل، والمحفظة الافتراضية
--      للمحفظة — أي «ما اختاره المشغّل فعلًا في الخزينة».
--   3. الحساب التجميعي 1101 / 1111 / 1131.
-- آجل لا حساب له عن قصد.
DO $$
DECLARE
  v_method   record;
  v_pick     uuid;
  v_code     text;
BEGIN
  FOR v_method IN
    SELECT m.id, m.ledger_kind, s.default_account_id AS current_account
      FROM public.payment_methods m
      LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
     WHERE m.id IN ('cash', 'credit', 'bank_transfer', 'mobile_money')
  LOOP
    IF v_method.ledger_kind = 'CREDIT' THEN
      UPDATE public.payment_method_settings
         SET default_account_id = NULL, updated_at = now()
       WHERE payment_method_id = v_method.id
         AND default_account_id IS NOT NULL;
      CONTINUE;
    END IF;

    v_code := CASE v_method.ledger_kind
                WHEN 'CASH'   THEN '1101'
                WHEN 'BANK'   THEN '1111'
                ELSE '1131'
              END;

    -- 1. الحساب الحالي، إن كان سليمًا.
    SELECT a.id INTO v_pick
      FROM public.accounts a
     WHERE a.id = v_method.current_account
       AND a.is_active AND a.is_postable
       AND (a.code = v_code OR a.code LIKE v_code || '%');

    -- 2. ما اختاره المشغّل في الخزينة.
    IF v_pick IS NULL AND v_method.ledger_kind = 'CASH' THEN
      SELECT a.id INTO v_pick
        FROM public.cashboxes c
        JOIN public.accounts a ON a.id = c.account_id
       WHERE c.is_active AND a.is_active AND a.is_postable
       ORDER BY c.is_default DESC, c.created_at
       LIMIT 1;
    ELSIF v_pick IS NULL AND v_method.ledger_kind IN ('BANK', 'WALLET') THEN
      SELECT a.id INTO v_pick
        FROM public.company_bank_accounts b
        JOIN public.accounts a ON a.id = b.account_id
       WHERE b.is_active AND a.is_active AND a.is_postable
         AND b.kind = CASE v_method.ledger_kind WHEN 'BANK' THEN 'BANK' ELSE 'WALLET' END
       ORDER BY b.is_default DESC, b.created_at
       LIMIT 1;
    END IF;

    -- 3. الحساب التجميعي.
    IF v_pick IS NULL THEN
      SELECT a.id INTO v_pick
        FROM public.accounts a
       WHERE a.code = v_code AND a.is_active AND a.is_postable;
    END IF;

    IF v_pick IS NULL THEN
      RAISE EXCEPTION
        'لا يوجد حساب في دليل الحسابات لِـ «%» (المتوقع % أو أحد فروعه). أنشئه أولًا ثم أعد الترحيل.',
        v_method.id, v_code
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    UPDATE public.payment_method_settings
       SET default_account_id = v_pick,
           updated_at         = now()
     WHERE payment_method_id = v_method.id;
  END LOOP;
END $$;

-- ── 7. دالة الربط تتبع الإعداد لا العائلة ──────────────────────────────────
--
-- كانت تُبلغ عن الحساب **العام** لكل طريقة، فتظهر Fang «لا يوجد حساب» رغم أن
-- المنشأة ربطت بنكًا بعينه. وصارت تقرأ `payment_method_settings.default_account_id`
-- أولًا، ثم تسقط إلى الكود العام — وهو ترتيب محرّك الترحيل نفسه في
-- `resolve_document_settlement_account`.
CREATE OR REPLACE FUNCTION public.payment_method_account_linkage()
RETURNS TABLE (
  method_id            text,
  method_name          text,
  ledger_kind          text,
  is_active            boolean,
  account_code         text,
  account_name         text,
  account_exists       boolean,
  account_postable     boolean,
  is_healthy           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id                        AS method_id,
    m.name_ar                   AS method_name,
    m.ledger_kind               AS ledger_kind,
    m.is_active                 AS is_active,
    coalesce(sa.code, l.account_code)                       AS account_code,
    coalesce(sa.name_ar, ga.name_ar)                        AS account_name,
    (coalesce(sa.id, ga.id) IS NOT NULL)                    AS account_exists,
    coalesce(sa.is_postable, ga.is_postable, false)         AS account_postable,
    CASE
      WHEN m.ledger_kind = 'CREDIT' THEN l.account_code IS NULL
      ELSE coalesce(
        coalesce(sa.id, ga.id) IS NOT NULL
        AND coalesce(sa.is_postable, ga.is_postable, false)
        AND coalesce(sa.is_active, ga.is_active, false),
        false)
    END                         AS is_healthy
  FROM public.payment_methods m
  CROSS JOIN LATERAL (
    SELECT public.payment_method_ledger_account(m.id) AS account_code
  ) AS l
  -- الحساب الذي ربطته المنشأة
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  LEFT JOIN public.accounts sa ON sa.id = s.default_account_id
  -- الحساب العام للعائلة (1099-safe fallback)
  LEFT JOIN public.accounts ga ON ga.code = l.account_code
  ORDER BY m.sort_order, m.id;
$$;

COMMENT ON FUNCTION public.payment_method_account_linkage() IS
  'لكل طريقة: الحساب الذي ربطته المنشأة أو الحساب العام لعائلتها، وهل هو موجود وقابل للترحيل.';

REVOKE ALL ON FUNCTION public.payment_method_account_linkage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_account_linkage() TO authenticated, service_role;

-- ── 8. عقد الـ RPC: الدالة الجديدة تُضاف إلى القائمة ─────────────────────────
--
-- القاعدة RPC-allowlist: أي RPC تستدعيه `src/` يجب أن يكون في `rpc_allowlist()`
-- وإلا رُفض من الواجهة بـ 401. الإضافة تتم بإعادة تعريف جسم الدالة الحالي
-- نفسه مع إلحاق الاسم — لا باستدعائها داخله، فذلك ارتداد لا نهائي.
DO $$
DECLARE
  v_current text[];
BEGIN
  IF to_regprocedure('public.rpc_allowlist()') IS NULL THEN
    RETURN;
  END IF;

  -- نقرأ القائمة الفعلية وقت الترحيل ونعيد تعريفها كاملة. لا تحليل نصي ولا
  -- استدعاء ذاتي داخل الجسم: مصدر الحقيقة هو ما تُرجعه الدالة الآن.
  EXECUTE 'SELECT public.rpc_allowlist()' INTO v_current;

  IF 'set_payment_method_default_account' = ANY (coalesce(v_current, ARRAY[]::text[])) THEN
    RETURN;
  END IF;

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.rpc_allowlist() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $body$
      SELECT %L::text[]
    $body$
  $fn$, array_append(coalesce(v_current, ARRAY[]::text[]), 'set_payment_method_default_account'));
END $$;

COMMIT;
