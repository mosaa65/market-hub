-- ============================================================================
-- 21_accounting_phase3_fiscal_periods.sql
--
-- المرحلة 3 من خطة معالجة الفجوات المحاسبية: الفترات المالية والإقفال السنوي.
--
--   T-19  جدول fiscal_periods (OPEN/CLOSED) + فحص التاريخ داخل create_journal_entry
--   T-20  close_fiscal_year (ترحيل 4xxx/5xxx إلى 3911) + open_fiscal_year (أرصدة مشتقة)
--
-- لماذا هذا ضروري
-- ---------------
-- بلا فترات مالية لا فصل بين السنوات: قيد بتاريخ 2023 يمكن أن يُرحَّل اليوم
-- ويغيّر أرباح سنة أُقفلت وطُبعت تقاريرها. ولا حماية من الترحيل الرجعي.
-- و3911 (أرباح محتجزة) كان حسابًا بلا كاتب: لا شيء يقفل الإيرادات والمصروفات
-- في نهاية السنة، فتبقى أرصدة 4xxx/5xxx متراكمة أبد الدهر.
--
-- قرارات التصميم
-- --------------
-- * الفترة مقفلة تعني: لا قيد جديد بتاريخها. القيود العكسية (REVERSED) تبقى
--   مسموحة لأنها لا تنشئ رقمًا جديدًا — هي تُلغي رقمًا قائمًا، ومنعُها يترك
--   خطأً لا يمكن تصحيحه. لذلك فحص التاريخ يرفض القيد العادي فقط، ويسمح
--   بالعكس عبر علم p_is_reversal.
--
-- * لا تُقفل فترة قبل إقفال سنتها: إقفال السنة يكتب قيدًا بتاريخ 31/12، وهو
--   قيد داخل الفترة. لو أُقفلت الفترة قبل الإقفال لاستحال الإقفال نفسه.
--   الترتيب الإلزامي: (1) أنشئ فترات السنة، (2) اقفل السنة، (3) اقفل الفترات.
--
-- * ترحيل الإقفال يُلغي أرصدة 4xxx/5xxx في 3911. الإيرادات مدينة، المصروفات
--   دائنة، والفرق إلى 3911. النتيجة: ميزان المراجعة يبدأ السنة الجديدة
--   بأرصدة 1xxx/2xxx/3xxx فقط، كما تفعل الدفاتر الحقيقية.
--
-- * open_fiscal_year لا يكتب أي قيد: الأرصدة الافتتاحية للسنة الجديدة هي
--   نتاج القيود القائمة، تمامًا كما في trial_balance. كتابة قيد افتتاحي
--   ثانٍ تعني مصدرًا ثانيًا للحقيقة يمكن أن يخالف القيود.
--
-- NON-DESTRUCTIVE: جدول جديد + دالتان جديدتان + إعادة تعريف create_journal_entry
-- بتوقيع أوسع (مع توافق خلفي للنُسخ القديمة). لا حذف ولا تعديل لأي بيانات قائمة.
--
-- معايير القبول المغطاة:
--   - إقفال سنة 2025 بفترة مقفلة: 4xxx/5xxx تصبح صفرًا، 3911 يحمل صافي الربح.
--   - قيد يدوي بتاريخ سنة مقفلة يُرفض في القاعدة.
--   - قيد عكسي بتاريخ مقفول يُقبل (تصحيح خطأ في سنة مقفلة).
--   - السنة الجديدة تبدأ بأرصدة 1xxx/2xxx/3xxx من القيود، بلا قيد افتتاحي مصطنع.
-- ============================================================================

-- ── 1. جدول الفترات المالية ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                 -- مثل '2025-01'
  fiscal_year integer NOT NULL,
  period_no   integer NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_at   timestamptz,
  closed_by   uuid REFERENCES auth.users(id),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_period_dates_ordered CHECK (end_date >= start_date),
  CONSTRAINT fiscal_period_unique_span UNIQUE (start_date, end_date)
);

CREATE INDEX IF NOT EXISTS ix_fiscal_periods_dates
  ON public.fiscal_periods (start_date, end_date);
CREATE INDEX IF NOT EXISTS ix_fiscal_periods_year
  ON public.fiscal_periods (fiscal_year, period_no);

COMMENT ON TABLE public.fiscal_periods IS
  'T-19: الفترات المالية. فترة مقفلة تمنع أي قيد جديد بتاريخها، وتُقفل بعد إقفال سنتها لا قبلها.';

-- تمنع الفترات المتداخلة: تداخل فترتين يعني أن التاريخ يقع في فترتين،
-- وأيهما يحكم قرار الإقفال يصبح سؤالًا بلا جواب.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_period_no_overlap'
  ) THEN
    ALTER TABLE public.fiscal_periods
      ADD CONSTRAINT fiscal_period_no_overlap
      EXCLUDE USING gist (
        daterange(start_date, end_date, '[]') WITH &&
      );
  END IF;
END $$;

-- ── 2. بذر السنة الحالية (غير مقفلة) ────────────────────────────────────────
-- 12 فترة شهرية للسنة الجارية، OPEN، آمنة لإعادة التطبيق.
INSERT INTO public.fiscal_periods (code, fiscal_year, period_no, start_date, end_date, status)
SELECT
  to_char(d, 'YYYY-MM'),
  EXTRACT(YEAR FROM d)::integer,
  EXTRACT(MONTH FROM d)::integer,
  d,
  (date_trunc('month', d) + interval '1 month - 1 day')::date,
  'OPEN'
FROM generate_series(
       date_trunc('year', CURRENT_DATE),
       date_trunc('year', CURRENT_DATE) + interval '11 months',
       interval '1 month'
     ) AS g(d)
ON CONFLICT (code) DO NOTHING;

-- ── 3. دالة فحص الفترة (OPEN فقط يسمح بالترحيل) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_period_open(p_date date)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_date IS NULL THEN
    RETURN;
  END IF;

  SELECT status INTO v_status
    FROM public.fiscal_periods
   WHERE p_date BETWEEN start_date AND end_date
   LIMIT 1;

  -- تاريخ خارج أي فترة مُعرَّفة: يُسمح به (فترة غير مفتوحة بعد). القفل يُطبَّق
  -- على الفترات المُعرَّفة والمقفلة فقط، لا على تاريخ لا تنظيم له.
  IF v_status IS NULL THEN
    RETURN;
  END IF;

  IF v_status = 'CLOSED' THEN
    RAISE EXCEPTION
      'الفترة المالية المحتوية على % مقفلة. لا يمكن الترحيل بتاريخ مقفول.',
      to_char(p_date, 'YYYY-MM-DD');
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.assert_period_open(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_period_open(date) TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_period_open(date) IS
  'T-19: يرفض الترحيل داخل فترة مقفلة. التواريخ خارج الفترات المُعرَّفة تُسمح.';

-- ── 4. create_journal_entry مع فحص الفترة وعلم العكس ────────────────────────
-- التوقيع القديم (6 وسائط) محفوظ كغلاف (wrapper) يفوّض إلى التوقيع الجديد
-- (7 وسائط)، فيبقى كل نداء قديم صالحًا كما هو.
CREATE OR REPLACE FUNCTION public.create_journal_entry(
  p_memo          text,
  p_entry_date    date DEFAULT CURRENT_DATE,
  p_source_type   text DEFAULT NULL,
  p_source_id     uuid DEFAULT NULL,
  p_is_system     boolean DEFAULT false,
  p_lines         jsonb DEFAULT '[]'::jsonb,
  p_is_reversal   boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id   uuid;
  v_num  text;
  v_d    numeric := 0;
  v_c    numeric := 0;
  src    jsonb;
  v_missing integer;
  v_blocked integer;
  v_sideless text;
  v_system_accounts integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- T-03: فحص الدور — القيد اليدوي (p_is_system=false) للمحاسبة فقط.
  -- القيد النظامي (من دوال الترحيل SECURITY DEFINER) مسموح لأي موظف مصادق:
  -- فالكاشير يبيع عبر create_sale، وترحيل فاتورته جزء من نفس العملية
  -- (قرار T-06-b المعتمد: مسار POS يستمر مع الترحيل التلقائي).
  IF NOT coalesce(p_is_system, false) THEN
    IF NOT (public.has_role(v_user, 'owner')
            OR public.has_role(v_user, 'manager')
            OR public.has_role(v_user, 'accountant')) THEN
      RAISE EXCEPTION 'Only an owner, manager or accountant may create manual journal entries';
    END IF;
  END IF;

  IF p_memo IS NULL OR btrim(p_memo) = '' THEN
    RAISE EXCEPTION 'A journal entry needs a description';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal entry needs at least two lines - one to debit and one to credit';
  END IF;

  -- A line must carry exactly one side. Checked up front, before the entry
  -- header is written, so a rejected line never leaves a DRAFT entry behind
  -- in the table for someone to find later and wonder about.
  SELECT string_agg(coalesce(ln->>'account_code', '?'), '، ') INTO v_sideless
    FROM jsonb_array_elements(p_lines) AS ln
   WHERE coalesce((ln->>'debit')::numeric, 0) = 0
     AND coalesce((ln->>'credit')::numeric, 0) = 0;
  IF v_sideless IS NOT NULL THEN
    RAISE EXCEPTION
      'Line(s) % carry neither a debit nor a credit. Every line must have exactly one side.',
      v_sideless;
  END IF;

  -- T-03: اليدوي لا يلمس حسابات النظام. دوال الترحيل تمرر p_is_system = true
  -- فتعمل كما كانت؛ النداء اليدوي (false) يُرفض إن كان أي حساب هدفه نظاميًا.
  IF NOT coalesce(p_is_system, false) THEN
    SELECT count(*) INTO v_system_accounts
      FROM jsonb_array_elements(p_lines) AS ln
      JOIN public.accounts a ON a.code = ln->>'account_code'
     WHERE a.is_system;
    IF v_system_accounts > 0 THEN
      RAISE EXCEPTION
        '% line(s) target a system account. Manual entries cannot post to system accounts.',
        v_system_accounts;
    END IF;
  END IF;

  -- T-19: لا قيد جديد بتاريخ فترة مقفلة. القيد العكسي مستثنى: هو يُلغي قيدًا
  -- قائمًا ولا ينشئ رقمًا جديدًا، ومنعُه يترك خطأً لا يمكن تصحيحه.
  IF NOT coalesce(p_is_reversal, false) THEN
    PERFORM public.assert_period_open(coalesce(p_entry_date, CURRENT_DATE));
  END IF;

  v_num := public.next_journal_number(coalesce(p_entry_date, CURRENT_DATE));

  INSERT INTO public.journal_entries
    (entry_number, entry_date, memo, source_type, source_id, is_system, created_by)
  VALUES (v_num, coalesce(p_entry_date, CURRENT_DATE), btrim(p_memo),
          p_source_type, p_source_id, p_is_system, v_user)
  RETURNING id INTO v_id;

  FOR src IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_d := v_d + coalesce((src->>'debit')::numeric, 0);
    v_c := v_c + coalesce((src->>'credit')::numeric, 0);
  END LOOP;

  IF v_d <> v_c THEN
    RAISE EXCEPTION
      'Entry does not balance: debits % vs credits % (difference %). An entry that cannot balance is not an entry.',
      round(v_d, 2)::text, round(v_c, 2)::text, round(v_d - v_c, 2)::text;
  END IF;
  IF v_d <= 0 THEN
    RAISE EXCEPTION 'Entry total must be greater than zero';
  END IF;

  -- The two failure modes are reported separately: "code does not exist" sends
  -- the operator hunting for a typo when the code was real and simply not
  -- postable, and that misdirection costs more than the extra check.
  SELECT count(*) FILTER (WHERE a.id IS NULL),
         count(*) FILTER (WHERE a.id IS NOT NULL AND NOT a.is_postable)
    INTO v_missing, v_blocked
    FROM jsonb_array_elements(p_lines) AS ln
    LEFT JOIN public.accounts a ON a.code = ln->>'account_code';

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'One or more account codes do not exist. Check the code before posting.';
  END IF;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION
      'One or more accounts is not postable directly (a contra or clearing account). Post through the account that moves it.';
  END IF;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, memo, partner_type, partner_id)
  SELECT v_id, a.id,
         coalesce((ln->>'debit')::numeric, 0),
         coalesce((ln->>'credit')::numeric, 0),
         nullif(btrim(coalesce(ln->>'memo','')), ''),
         nullif(btrim(coalesce(ln->>'partner_type','')), ''),
         (ln->>'partner_id')::uuid
    FROM jsonb_array_elements(p_lines) AS ln
    JOIN public.accounts a ON a.code = ln->>'account_code'
   WHERE (ln->>'debit')::numeric IS DISTINCT FROM 0
      OR (ln->>'credit')::numeric IS DISTINCT FROM 0;

  IF (SELECT count(*) FROM public.journal_lines WHERE entry_id = v_id)
     <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'One or more lines could not be written';
  END IF;

  UPDATE public.journal_entries
     SET total_debit = v_d, total_credit = v_c, status = 'POSTED',
         posted_by = v_user, posted_at = now()
   WHERE id = v_id;

  -- T-03: كل قيد له أثر في سجل التدقيق.
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'journal_entry.posted', 'journal_entry', v_id,
          jsonb_build_object('entry_number', v_num,
                             'entry_date', coalesce(p_entry_date, CURRENT_DATE),
                             'source_type', p_source_type,
                             'source_id', p_source_id,
                             'total', v_d,
                             'is_reversal', coalesce(p_is_reversal, false)));

  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb, boolean) IS
  'T-03/T-19: إنشاء قيد مزدوج مع فحص الدور، ومنع اليدوي على حسابات النظام، وسجل تدقيق، ومنع الترحيل في فترة مقفلة.';

-- الغلاف الخلفي: التوقيع القديم 6 وسائط → 7 وسائط.
DROP FUNCTION IF EXISTS public.create_journal_entry(text, date, text, uuid, boolean, jsonb);
CREATE OR REPLACE FUNCTION public.create_journal_entry(
  p_memo          text,
  p_entry_date    date,
  p_source_type   text,
  p_source_id     uuid,
  p_is_system     boolean,
  p_lines         jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.create_journal_entry(
    p_memo, p_entry_date, p_source_type, p_source_id, p_is_system, p_lines, false
  );
$$;

COMMENT ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb) IS
  'غلاف خلفي للتوافق مع النداءات القديمة (6 وسائط) → التوقيع الجديد مع فحص الفترة.';

REVOKE ALL ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb, boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb)
  TO authenticated, service_role;

-- ── 5. reverse_journal_entry يمرّر علم العكس ─────────────────────────────────
-- يعاد تعريفها لتستدعي التوقيع الجديد بـ p_is_reversal = true، فتُقبل حتى
-- داخل فترة مقفلة (تصحيح خطأ سنة مقفلة بلا فتحها).
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old  record;
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reversing an entry requires a reason';
  END IF;

  SELECT * INTO v_old FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_old.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted entry can be reversed';
  END IF;

  SELECT public.create_journal_entry(
    'عكس القيد ' || v_old.entry_number || ': ' || btrim(p_reason),
    CURRENT_DATE, 'journal_reversal', p_entry_id, v_old.is_system,
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'account_code', a.code,
        -- A reversal swaps the sides rather than negating: the credit of the
        -- original becomes the debit of the reversal.
        'debit',  CASE WHEN jl.debit  > 0 THEN 0 ELSE jl.credit END,
        'credit', CASE WHEN jl.debit  > 0 THEN jl.debit  ELSE 0 END,
        'memo',   coalesce(jl.memo, a.name_ar)
      ) ORDER BY jl.id), '[]'::jsonb)
       FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = p_entry_id),
    true  -- T-19: العكس مسموح داخل فترة مقفلة
  ) INTO v_id;

  UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = p_entry_id;
  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.reverse_journal_entry(uuid, text) IS
  'T-19: عكس قيد مرحَّل. مسموح داخل فترة مقفلة لأنه يُلغي قيدًا ولا ينشئ رقمًا جديدًا.';

-- ── 6. RLS على الفترات ───────────────────────────────────────────────────────
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_periods_read ON public.fiscal_periods;
CREATE POLICY fiscal_periods_read ON public.fiscal_periods
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

REVOKE ALL ON public.fiscal_periods FROM anon;
GRANT SELECT ON public.fiscal_periods TO authenticated, service_role;

-- ── 7. T-20: الإقفال السنوي ──────────────────────────────────────────────────
-- يقفل أرصدة 4xxx (إيرادات) و5xxx (مصروفات) في 3911 (أرباح محتجزة).
-- التاريخ 31/12 من السنة. يُرفض إن كانت الفترة المحتوية على 31/12 مقفلة،
-- لأن كتابة قيد الإقفال داخلها تكون مستحيلة بعد ذلك.
CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_year integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_close_date date;
  v_period    record;
  v_lines     jsonb;
  v_entry_id  uuid;
  v_net       numeric;
  v_existing  uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may close a fiscal year';
  END IF;

  v_close_date := make_date(p_year, 12, 31);

  -- فترة الإقفال يجب أن تكون مفتوحة: الإقفال يكتب قيدًا داخلها.
  SELECT * INTO v_period
    FROM public.fiscal_periods
   WHERE v_close_date BETWEEN start_date AND end_date;
  IF FOUND AND v_period.status = 'CLOSED' THEN
    RAISE EXCEPTION
      'فترة % مقفلة. لا يمكن إقفال سنة مقفلة بالفعل، أو فتح السنة قبل إقفالها.',
      v_period.code;
  END IF;

  -- لا إقفال مزدوج: قيد إقفال قائم لنفس السنة يُرفض.
  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'fiscal_year_close'
     AND source_id IS NULL
     AND memo LIKE '%' || p_year::text || '%'
     AND status = 'POSTED'
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'السنة % أُقفلت بالفعل (قيد %).', p_year, v_existing;
  END IF;

  -- قيد الإقفال: عكس طبيعة كل حساب 4xxx/5xxx لجعل رصيده صفرًا.
  -- الإيراد (رصيده دائن) يُمدَّن؛ المصروف (رصيده مدين) يُدان.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'account_code', a.code,
           'debit',  CASE WHEN a.account_type = 'REVENUE' THEN t.bal ELSE 0 END,
           'credit', CASE WHEN a.account_type = 'EXPENSE' THEN -t.bal ELSE 0 END,
           'memo',   'إقفال سنة ' || p_year::text || ' — ' || a.name_ar
         )), '[]'::jsonb)
    INTO v_lines
    FROM (
      SELECT jl.account_id,
             sum(jl.debit - jl.credit) AS bal
        FROM public.journal_lines jl
        JOIN public.journal_entries je
          ON je.id = jl.entry_id AND je.status = 'POSTED'
       WHERE je.entry_date BETWEEN make_date(p_year, 1, 1) AND v_close_date
       GROUP BY jl.account_id
      HAVING sum(jl.debit - jl.credit) <> 0
    ) AS t
    JOIN public.accounts a ON a.id = t.account_id
   WHERE a.account_type IN ('REVENUE','EXPENSE');

  -- لا شيء يُقفل: سنة بلا حركة 4xxx/5xxx. لا قيد فارغ.
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'لا توجد أرصدة إيراد أو مصروف لسنة % لإقفالها.', p_year;
  END IF;

  -- صافي الربح = مجموع (دائن الإيراد − مدين المصروف) = سالب مجموع bal لكل 4xxx/5xxx.
  SELECT -sum(t.bal) INTO v_net
    FROM (
      SELECT sum(jl.debit - jl.credit) AS bal
        FROM public.journal_lines jl
        JOIN public.journal_entries je
          ON je.id = jl.entry_id AND je.status = 'POSTED'
       WHERE je.entry_date BETWEEN make_date(p_year, 1, 1) AND v_close_date
       GROUP BY jl.account_id
    ) AS t
    JOIN public.accounts a ON a.id = t.account_id
   WHERE a.account_type IN ('REVENUE','EXPENSE');

  -- سطر 3911 يقابل الصافي: ربح → دائن، خسارة → مدين.
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'account_code', '3911',
      'debit',  CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
      'credit', CASE WHEN v_net > 0 THEN v_net ELSE 0 END,
      'memo',   'أرباح محتجزة — نتيجة سنة ' || p_year::text
    )
  );

  v_entry_id := public.create_journal_entry(
    'إقفال السنة المالية ' || p_year::text ||
      ' — ترحيل الإيرادات والمصروفات إلى الأرباح المحتجزة',
    v_close_date, 'fiscal_year_close', NULL, true, v_lines, true  -- قيد نظامي؛ يُسمح داخل فترة مقفلة
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fiscal_year.closed', 'fiscal_year', v_entry_id,
          jsonb_build_object('year', p_year, 'net_result', v_net,
                             'entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;

REVOKE ALL ON FUNCTION public.close_fiscal_year(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.close_fiscal_year(integer) IS
  'T-20: يقفل سنة مالية — 4xxx/5xxx تُصفَّر والنتيجة تُرحَّل إلى 3911 بتاريخ 31/12.';

-- ── 8. T-20: فتح سنة مالية جديدة ────────────────────────────────────────────
-- ينشئ فترات السنة الجديدة فقط. لا يكتب قيدًا افتتاحيًا: الأرصدة الافتتاحية
-- للسنة الجديدة هي نتاج القيود القائمة (trial_balance)، تمامًا كما في الدفاتر
-- الحقيقية. كتابة قيد افتتاحي ثانٍ تعني مصدرًا ثانيًا للحقيقة.
CREATE OR REPLACE FUNCTION public.open_fiscal_year(p_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_created integer := 0;
  v_first   date;
  v_last    date;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may open a fiscal year';
  END IF;

  v_first := make_date(p_year, 1, 1);
  v_last  := make_date(p_year, 12, 31);

  -- تداخل مع سنة قائمة يُرفض قبل المحاولة، برسالة تفهم السبب.
  IF EXISTS (
    SELECT 1 FROM public.fiscal_periods
     WHERE daterange(start_date, end_date, '[]') &&
           daterange(v_first, v_last, '[]')
  ) THEN
    RAISE EXCEPTION 'السنة % متداخلة مع فترات مالية قائمة.', p_year;
  END IF;

  INSERT INTO public.fiscal_periods (code, fiscal_year, period_no, start_date, end_date, status)
  SELECT to_char(g.d, 'YYYY-MM'),
         p_year,
         EXTRACT(MONTH FROM g.d)::integer,
         g.d,
         (date_trunc('month', g.d) + interval '1 month - 1 day')::date,
         'OPEN'
    FROM generate_series(v_first, v_last, interval '1 month') AS g(d)
  ON CONFLICT (code) DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fiscal_year.opened', 'fiscal_year', NULL,
          jsonb_build_object('year', p_year, 'periods_created', v_created));

  RETURN v_created;
END $$;

REVOKE ALL ON FUNCTION public.open_fiscal_year(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_fiscal_year(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.open_fiscal_year(integer) IS
  'T-20: يفتح سنة مالية بإنشاء 12 فترة شهرية. لا قيد افتتاحي — الأرصدة مشتقة من القيود.';

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.open_fiscal_year(integer);
-- DROP FUNCTION IF EXISTS public.close_fiscal_year(integer);
-- DROP FUNCTION IF EXISTS public.assert_period_open(date);
-- -- استعادة create_journal_entry للتوقيع القديم (من المهاجرة 17) قبل الحذف.
-- DROP FUNCTION IF EXISTS public.create_journal_entry(text, date, text, uuid, boolean, jsonb, boolean);
-- DROP FUNCTION IF EXISTS public.create_journal_entry(text, date, text, uuid, boolean, jsonb);
-- DROP TABLE IF EXISTS public.fiscal_periods;
