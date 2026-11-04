-- ============================================================================
-- 9918_customer_balance_ledger_authority.sql
--
-- المصدر الوحيد لرصيد العميل: دفتر العميل (customer_ledger).
-- الرصيد المخزَّن في customers.balance يصير قيمة مشتقة تُحدَّث آليًا من الدفتر
-- بواسطة مُشغّل، ويُعاد احتسابه من دالة مركزية واحدة.
--
-- يعالج هذا الملف الأسباب الجذرية الخمسة:
--   (1) المرتجعات: كانت تحدّد مبلغ المرتجع من قيمة البضاعة في دائما، بلا ربط
--       بين ما خصمه الدفتر وما أعاده القيد للأستاذ (نقداً أو ذمة). الآن يُشتق
--       المبلغ المقاصّ من ذمة الفاتورة أولاً، وما يبقى يخرج نقدًا.
--   (2) التسويات والأرصدة الافتتاحية: كانت تكتب في الدفتر ولا تمسّ الرصيد
--       المخزَّن، فيظهر الفرق في كشف الحساب. الآن المُشغّل يقفل الفجوة.
--   (3) التحصيل كان يستخدم greatest(balance - amount, 0) فيبتلع أي فرق بالصمت
--       ويخفي عدم التطابق الذي يجب أن يظهر.
--   (4) تحصيل غير مرتبط بفاتورة كان يوزّع على الفواتير ثم يزيد paid بالمبلغ
--       كاملًا مما يفسد ذمة الفواتير عند وجود فائض غير مخصَّص.
--   (5) لا حماية تكرار/تزامن موحّدة: أصبح كل مسار كتابة محميًا بقفل صف
--       العميل، وبسجل تدقيق تصحيحات المطابقة.
-- ============================================================================
BEGIN;

-- ── (0) مراسي مسارات كتابة دفتر العميل القائمة في هذه القاعدة ──────────────
-- الترحيلات التالية تُعيد تعريف create_sales_return؛ نتحقق فقط من وجود
-- الدالة بالتوقيع المطلوب قبل سحب المنحة عنها وإعادة منحها.
DO $$
BEGIN
  IF to_regprocedure(
       'public.create_sales_return(uuid,uuid,uuid,text,text,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'create_sales_return(uuid,uuid,uuid,text,text,jsonb) غير موجودة — راجع ترتيب الترحيلات';
  END IF;
  IF to_regprocedure('public.customer_ledger_balance(uuid)') IS NULL THEN
    RAISE EXCEPTION 'customer_ledger_balance(uuid) غير موجودة — راجع ترتيب الترحيلات';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) سجل تصحيحات أرصدة العملاء — أثر تدقيقي كامل وقابل للمراجعة
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_balance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  previous_balance numeric(14,2) NOT NULL,
  new_balance numeric(14,2) NOT NULL,
  ledger_balance numeric(14,2) NOT NULL,
  difference numeric(14,2) NOT NULL,
  reason text NOT NULL,
  correction_type text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_balance_adjustments_type_check
    CHECK (correction_type IN ('recalculation', 'document_repost'))
);

CREATE INDEX IF NOT EXISTS idx_customer_balance_adjustments_customer
  ON public.customer_balance_adjustments (customer_id, created_at DESC);

COMMENT ON TABLE public.customer_balance_adjustments IS
  'سجل تصحيحات الرصيد المخزَّن للعميل: من كم إلى كم، وما كان رصيد الدفتر، والسبب، ومن نفّذه ومتى. لا يُحذف ولا يُعدَّل.';
COMMENT ON COLUMN public.customer_balance_adjustments.correction_type IS
  'recalculation = إعادة احتساب من الدفتر؛ document_repost = استدراك مستند مالي مفقود (حركة في الدفتر، لا تعديل رقم).';

ALTER TABLE public.customer_balance_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_balance_adjustments_read ON public.customer_balance_adjustments;
CREATE POLICY customer_balance_adjustments_read ON public.customer_balance_adjustments
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

-- القراءة فقط: الكتابة تمرّ عبر دوال SECURITY DEFINER (لا INSERT/UPDATE/DELETE مباشر).
REVOKE INSERT, UPDATE, DELETE ON public.customer_balance_adjustments FROM anon, authenticated;
GRANT SELECT ON public.customer_balance_adjustments TO authenticated;
GRANT ALL ON public.customer_balance_adjustments TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) قفل العميل: نداء واحد موحّد يُسلسل كل كتابة على رصيده
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_balance_lock(p_customer_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_balance numeric;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT c.balance INTO v_balance
    FROM public.customers c
   WHERE c.id = p_customer_id
   FOR UPDATE;
  RETURN v_balance;
END;
$function$;

COMMENT ON FUNCTION public.customer_balance_lock(uuid) IS
  'يقفل صف العميل (FOR UPDATE) ويعيد رصيده المخزَّن — يُستدعى في أول كل مسار مالي قبل أي فحص ذمة.';

-- ════════════════════════════════════════════════════════════════════════════
-- (3) الدالة المركزية: إعادة احتساب رصيد العميل من دفتره
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recalculate_customer_balance(
  p_customer_id uuid,
  p_reason text DEFAULT NULL,
  p_type text DEFAULT 'recalculation'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user        uuid := auth.uid();
  v_customer    record;
  v_ledger      numeric;
  v_previous    numeric;
  v_difference  numeric;
  v_entry_count integer;
  v_unposted    integer;
  v_orphans     integer;
  v_type        text := coalesce(nullif(btrim(coalesce(p_type, '')), ''), 'recalculation');
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required';
  END IF;
  IF v_type NOT IN ('recalculation', 'document_repost') THEN
    RAISE EXCEPTION 'Unknown correction type: %', v_type;
  END IF;

  -- قفل الصف: لا إعادة احتساب متوازية على نفس العميل.
  SELECT id, name, balance, updated_at
    INTO v_customer
    FROM public.customers
   WHERE id = p_customer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % does not exist', p_customer_id;
  END IF;

  -- 1) الرصيد المحاسبي = Σ(debit − credit). عمود الاسم debit/credit هو مصدر
  --    الحقيقة في هذا المخطط، ولا يُعتمد على entry_type في الحساب.
  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2),
         count(*)
    INTO v_ledger, v_entry_count
    FROM public.customer_ledger l
   WHERE l.customer_id = p_customer_id;

  v_previous := round(coalesce(v_customer.balance, 0), 2);
  v_difference := round(v_previous - v_ledger, 2);

  -- 2) فحوص تشخيصية تُكشف في RETURN ولا تُصلَح عشوائيًا:
  --    حركات معلّقة تحت مستند مالي غير مرحلة/غير موجودة.
  SELECT count(*) INTO v_unposted
    FROM public.customer_ledger l
   WHERE l.customer_id = p_customer_id
     AND l.reference_type = 'customer_payment'
     AND NOT EXISTS (SELECT 1 FROM public.customer_payments p WHERE p.id = l.reference_id);

  SELECT count(*) INTO v_orphans
    FROM public.customer_ledger l
   WHERE l.customer_id = p_customer_id
     AND l.reference_type = 'sales_invoice'
     AND NOT EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.id = l.reference_id);

  -- 3) الكتابة — فقط عند وجود فرق فعلي، وبتسجيل من/إلى.
  IF abs(v_difference) >= 0.005 THEN
    UPDATE public.customers
       SET balance = v_ledger,
           updated_at = now()
     WHERE id = p_customer_id;

    INSERT INTO public.customer_balance_adjustments (
      customer_id, previous_balance, new_balance, ledger_balance,
      difference, reason, correction_type, actor_id, document_payload
    ) VALUES (
      p_customer_id, v_previous, v_ledger, v_ledger, v_difference,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
               'إعادة احتساب الرصيد المخزَّن من دفتر العميل'),
      v_type, v_user,
      jsonb_build_object('entry_count', v_entry_count,
                         'orphan_documents', v_orphans,
                         'missing_payment_documents', v_unposted)
    );
  END IF;

  RETURN jsonb_build_object(
    'customer_id',        p_customer_id,
    'customer_name',      v_customer.name,
    'ledger_balance',     v_ledger,
    'stored_balance',     v_previous,
    'corrected_balance',  CASE WHEN abs(v_difference) >= 0.005 THEN v_ledger ELSE v_previous END,
    'difference',         v_difference,
    'changed',            abs(v_difference) >= 0.005,
    'entry_count',        v_entry_count,
    'orphan_documents',   v_orphans,
    'missing_documents',  v_unposted,
    'status',
      CASE
        WHEN v_entry_count = 0 AND abs(v_previous) >= 0.005 THEN 'ledger_empty'
        WHEN v_entry_count > 0 AND abs(v_previous) < 0.005 AND abs(v_ledger) >= 0.005 THEN 'ledger_only'
        WHEN v_orphans > 0 OR v_unposted > 0 THEN 'broken_documents'
        WHEN abs(v_difference) >= 0.005 THEN 'mismatch'
        ELSE 'matched'
      END
  );
END;
$function$;

COMMENT ON FUNCTION public.recalculate_customer_balance(uuid, text, text) IS
  'الدالة المركزية الوحيدة لتحديث الرصيد المخزَّن: تقرأ الدفتر، تحسب الصافي، تكتب customers.balance، وتُسجّل التصحيح في customer_balance_adjustments. لا تحذف أي حركة.';

REVOKE ALL ON FUNCTION public.recalculate_customer_balance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_customer_balance(uuid, text, text) TO authenticated, service_role;

-- غلاف بسيط بعقد الاسم المطلوب في المواصفات: recalculate_customer_balance(customer_id)
CREATE OR REPLACE FUNCTION public.recalculate_customer_balance(p_customer_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.recalculate_customer_balance(p_customer_id, NULL, 'recalculation');
$function$;

REVOKE ALL ON FUNCTION public.recalculate_customer_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_customer_balance(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) المطابقة الجماعية — تقرير بلا أي تعديل تلقائي
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_balance_reconciliation_report()
RETURNS TABLE (
  customer_id uuid,
  customer_name text,
  stored_balance numeric,
  ledger_balance numeric,
  difference numeric,
  entry_count bigint,
  broken_documents bigint,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Only finance roles may read the customer balance reconciliation'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH totals AS (
    SELECT l.customer_id,
           round(coalesce(sum(l.debit - l.credit), 0), 2) AS ledger,
           count(*) AS entries
      FROM public.customer_ledger l
     GROUP BY l.customer_id
  ), broken AS (
    SELECT l.customer_id, count(*) AS n
      FROM public.customer_ledger l
     WHERE (l.reference_type = 'customer_payment'
            AND NOT EXISTS (SELECT 1 FROM public.customer_payments p WHERE p.id = l.reference_id))
        OR (l.reference_type = 'sales_invoice'
            AND NOT EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.id = l.reference_id))
     GROUP BY l.customer_id
  )
  SELECT c.id,
         c.name,
         round(coalesce(c.balance, 0), 2),
         coalesce(t.ledger, 0),
         round(coalesce(c.balance, 0) - coalesce(t.ledger, 0), 2),
         coalesce(t.entries, 0),
         coalesce(b.n, 0),
         CASE
           WHEN coalesce(b.n, 0) > 0 THEN 'broken_documents'
           WHEN coalesce(t.entries, 0) = 0 AND abs(coalesce(c.balance, 0)) >= 0.005 THEN 'ledger_empty'
           WHEN coalesce(t.entries, 0) > 0 AND abs(coalesce(c.balance, 0)) < 0.005
                AND abs(coalesce(t.ledger, 0)) >= 0.005 THEN 'ledger_only'
           WHEN abs(coalesce(c.balance, 0) - coalesce(t.ledger, 0)) >= 0.005 THEN 'mismatch'
           ELSE 'matched'
         END
    FROM public.customers c
    LEFT JOIN totals t ON t.customer_id = c.id
    LEFT JOIN broken b ON b.customer_id = c.id
   ORDER BY abs(coalesce(c.balance, 0) - coalesce(t.ledger, 0)) DESC, c.name;
END;
$function$;

COMMENT ON FUNCTION public.customer_balance_reconciliation_report() IS
  'تقرير مطابقة: الرصيد المخزَّن مقابل رصيد الدفتر لكل عميل مع تصنيف الحالة. قراءة فقط — لا تعدّل أي رصيد.';

REVOKE ALL ON FUNCTION public.customer_balance_reconciliation_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_balance_reconciliation_report() TO authenticated, service_role;

-- إعادة احتساب جماعية اختيارية — لا تُشغَّل تلقائيًا أبدًا، وتتطلب سببًا صريحًا.
CREATE OR REPLACE FUNCTION public.recalculate_all_customer_balances(p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_cust    record;
  v_result  jsonb;
  v_changed integer := 0;
  v_total   integer := 0;
  v_details jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner')
      OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may recalculate customer balances'
      USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required before recalculating every customer balance';
  END IF;

  FOR v_cust IN SELECT id FROM public.customers ORDER BY id
  LOOP
    v_result := public.recalculate_customer_balance(v_cust.id, btrim(p_reason), 'recalculation');
    v_total := v_total + 1;
    IF (v_result->>'changed')::boolean THEN
      v_changed := v_changed + 1;
      v_details := v_details || jsonb_build_object(
        'customer_id', v_cust.id,
        'previous', (v_result->>'stored_balance')::numeric,
        'corrected', (v_result->>'corrected_balance')::numeric
      );
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'customer_balance.bulk_recalculated', 'customer', NULL,
          jsonb_build_object('customers', v_total, 'changed', v_changed,
                             'reason', btrim(p_reason), 'details', v_details));

  RETURN jsonb_build_object('customers', v_total, 'changed', v_changed, 'details', v_details);
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_all_customer_balances(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_all_customer_balances(text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) المُشغّل: الرصيد المخزَّن يتغيّر مع الدفتر، لا بجهد من ينادي
-- ════════════════════════════════════════════════════════════════════════════
-- لماذا AFTER وليس BEFORE: الرصيد يجب أن يُحسب من الدفتر بعد الالتزام بالسطر
-- الجديد، لا أن يُخمَّن من NEW. هذا يجعل إعادة احتساب الأرصدة الافتتاحية أو
-- الاستيراد أو الاستدراك اليدوي مضمونة بحكم البنية، لا بحكم انتباه كل دالة.
CREATE OR REPLACE FUNCTION public.tg_customer_ledger_sync_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recalculate_customer_balance(
      NEW.customer_id, 'مزامنة تلقائية من دفتر العميل', 'recalculation');
    IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
      PERFORM public.recalculate_customer_balance(
        OLD.customer_id, 'مزامنة تلقائية من دفتر العميل', 'recalculation');
    END IF;
    RETURN NULL;
  END IF;

  -- حذف حركة محاسبية: نُعيد الاحتساب بعده، لا نترك الرصيد معلّقًا على حركة رحلت.
  PERFORM public.recalculate_customer_balance(
    OLD.customer_id, 'إعادة احتساب بعد حذف حركة من الدفتر', 'recalculation');
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_customer_ledger_sync_balance ON public.customer_ledger;
CREATE TRIGGER tg_customer_ledger_sync_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_ledger_sync_balance();

COMMENT ON TRIGGER tg_customer_ledger_sync_balance ON public.customer_ledger IS
  'مصدر الحقيقة: كل حركة في دفتر العميل تُعيد احتساب الرصيد المخزَّن ذريًا في نفس المعاملة.';

COMMIT;

-- ============================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS tg_customer_ledger_sync_balance ON public.customer_ledger;
--   DROP FUNCTION IF EXISTS public.tg_customer_ledger_sync_balance();
--   DROP FUNCTION IF EXISTS public.recalculate_all_customer_balances(text);
--   DROP FUNCTION IF EXISTS public.customer_balance_reconciliation_report();
--   DROP FUNCTION IF EXISTS public.recalculate_customer_balance(uuid);
--   DROP FUNCTION IF EXISTS public.recalculate_customer_balance(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.customer_balance_lock(uuid);
--   -- لا تُسقط customer_balance_adjustments: هو سجل تدقيق لتصحيحات قد تكون وقعت.
-- ============================================================================
