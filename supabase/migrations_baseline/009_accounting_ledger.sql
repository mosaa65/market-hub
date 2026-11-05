-- ============================================================================
-- الترحيل 009_accounting_ledger.sql — مجال: accounting_ledger
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: activate_fixed_asset(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.activate_fixed_asset(p_asset_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_asset record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may activate fixed assets';
  END IF;

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fixed asset not found';
  END IF;

  IF v_asset.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Asset % is already in status %', v_asset.asset_code, v_asset.status;
  END IF;

  UPDATE public.fixed_assets
     SET status = 'ACTIVE'
   WHERE id = p_asset_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fixed_asset.activated', 'fixed_asset', p_asset_id,
          jsonb_build_object('asset_code', v_asset.asset_code, 'purchase_cost', v_asset.purchase_cost));

  RETURN true;
END $$;

--
-- Name: activate_prepaid_contract(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.activate_prepaid_contract(p_contract_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rec  record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may activate prepaid contracts';
  END IF;

  SELECT * INTO v_rec FROM public.prepaid_and_deferred_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;

  IF v_rec.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Contract % is already in status %', v_rec.contract_number, v_rec.status;
  END IF;

  UPDATE public.prepaid_and_deferred_contracts
     SET status = 'ACTIVE'
   WHERE id = p_contract_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'prepaid_contract.activated', 'prepaid_contract', p_contract_id,
          jsonb_build_object('contract_number', v_rec.contract_number, 'total_amount', v_rec.total_amount));

  RETURN true;
END $$;

--
-- Name: assert_period_open(date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.assert_period_open(p_date date) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
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

--
-- Name: balance_and_post_return(text, date, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.balance_and_post_return(p_memo text, p_date date, p_source_type text, p_source_id uuid, p_lines jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_d numeric := 0;
  v_c numeric := 0;
  v_diff numeric;
  r jsonb;
  v_lines jsonb := p_lines;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_d := v_d + coalesce((r->>'debit')::numeric, 0);
    v_c := v_c + coalesce((r->>'credit')::numeric, 0);
  END LOOP;

  v_diff := round(v_d - v_c, 2);
  IF v_diff <> 0 THEN
    -- فرق الهامش (سعر البيع مقابل التكلفة) في المرتجع. يُكتب على 5911 —
    -- الحساب المخصص للتسويات في الدليل — فيظهر في ميزان المراجعة ولا يُخفى.
    IF v_diff > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '5911', 'credit', v_diff, 'memo', 'فارق قيمة المرتجع');
    ELSE
      v_lines := v_lines || jsonb_build_object(
        'account_code', '5911', 'debit', -v_diff, 'memo', 'فارق قيمة المرتجع');
    END IF;
  END IF;

  RETURN public.create_journal_entry(p_memo, p_date, p_source_type, p_source_id, true, v_lines);
END $$;

--
-- Name: close_fiscal_year(integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.close_fiscal_year(p_year integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: create_journal_entry(text, date, text, uuid, boolean, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_journal_entry(p_memo text, p_entry_date date DEFAULT CURRENT_DATE, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_is_system boolean DEFAULT false, p_lines jsonb DEFAULT '[]'::jsonb, p_is_reversal boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END $$;

--
-- Name: dispose_fixed_asset(uuid, date, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.dispose_fixed_asset(p_asset_id uuid, p_disposal_date date, p_proceeds numeric DEFAULT 0, p_proceeds_account text DEFAULT '1101'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_asset       record;
  v_lines       jsonb := '[]'::jsonb;
  v_entry_id    uuid;
  v_gain_loss   numeric(18,2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may dispose fixed assets';
  END IF;

  PERFORM public.assert_period_open(p_disposal_date);

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fixed asset not found';
  END IF;

  IF v_asset.status NOT IN ('ACTIVE', 'FULLY_DEPRECIATED') THEN
    RAISE EXCEPTION 'Asset % cannot be disposed (current status: %)', v_asset.asset_code, v_asset.status;
  END IF;

  -- حساب الأرباح أو الخسائر الرأسمالية: الحصيلة - القيمة الدفترية
  v_gain_loss := coalesce(p_proceeds, 0) - v_asset.current_book_value;

  -- 1) إقفال مجمع الإهلاك (مدين 1491)
  IF v_asset.accumulated_depreciation > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', v_asset.accumulated_depreciation_account_code, -- 1491
        'debit', v_asset.accumulated_depreciation,
        'credit', 0,
        'memo', 'إقفال مجمع إهلاك الأصل المستبعد — ' || v_asset.name_ar
      )
    );
  END IF;

  -- 2) إثبات حصيلة البيع إن وجدت (مدين نقدية/بنك)
  IF coalesce(p_proceeds, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', coalesce(p_proceeds_account, '1101'),
        'debit', p_proceeds,
        'credit', 0,
        'memo', 'حصيلة بيع الأصل — ' || v_asset.name_ar
      )
    );
  END IF;

  -- 3) إثبات الخسارة الرأسمالية إن وجدت (مدين 5811 خسائر شطب أصول)
  IF v_gain_loss < 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '5811',
        'debit', -v_gain_loss,
        'credit', 0,
        'memo', 'خسائر بيع/شطب أصل — ' || v_asset.name_ar
      )
    );
  END IF;

  -- 4) إقفال التكلفة التاريخية للأصل (دائن 14xx)
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'account_code', v_asset.asset_account_code,
      'debit', 0,
      'credit', v_asset.purchase_cost,
      'memo', 'استبعاد تكلفة الأصل — ' || v_asset.name_ar
    )
  );

  -- 5) إثبات الأرباح الرأسمالية إن وجدت (دائن 4911 إيرادات أخرى)
  IF v_gain_loss > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '4911',
        'debit', 0,
        'credit', v_gain_loss,
        'memo', 'أرباح بيع أصل رأسمالي — ' || v_asset.name_ar
      )
    );
  END IF;

  v_entry_id := public.create_journal_entry(
    'استبعاد وشطب الأصل الثابت ' || v_asset.asset_code || ' — ' || v_asset.name_ar,
    p_disposal_date,
    'fixed_asset_disposal',
    p_asset_id,
    true,
    v_lines,
    false
  );

  UPDATE public.fixed_assets
     SET status = 'DISPOSED',
         disposal_date = p_disposal_date,
         disposal_amount = coalesce(p_proceeds, 0)
   WHERE id = p_asset_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fixed_asset.disposed', 'fixed_asset', p_asset_id,
          jsonb_build_object('asset_code', v_asset.asset_code, 'proceeds', p_proceeds,
                             'gain_loss', v_gain_loss, 'entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;

--
-- Name: generate_tax_declaration(date, date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.generate_tax_declaration(p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_sales_taxable numeric(18,2) := 0;
  v_output_tax    numeric(18,2) := 0;
  v_purch_taxable numeric(18,2) := 0;
  v_input_tax     numeric(18,2) := 0;
  v_net_tax       numeric(18,2) := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Tax declaration needs both start_date and end_date'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tax declaration end_date (%) is before start_date (%)', p_end_date, p_start_date
      USING ERRCODE = '22023';
  END IF;

  -- 1) ضريبة المخرجات من القيود المرحلة لحساب 2311 (رصيد دائن)
  SELECT coalesce(sum(jl.credit - jl.debit), 0)
    INTO v_output_tax
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE a.code = '2311'
     AND je.status = 'POSTED'
     AND je.source_type <> 'tax_settlement'
     AND je.entry_date BETWEEN p_start_date AND p_end_date;

  -- 2) ضريبة المدخلات من القيود المرحلة لحساب 1316 (رصيد مدين)
  SELECT coalesce(sum(jl.debit - jl.credit), 0)
    INTO v_input_tax
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE a.code = '1316'
     AND je.status = 'POSTED'
     AND je.source_type <> 'tax_settlement'
     AND je.entry_date BETWEEN p_start_date AND p_end_date;

  -- 3) إجمالي المبيعات الخاضعة للضريبة.
  --    ⚠️ sales_invoices ليس فيها invoice_date. التاريخ التشغيلي هو created_at
  --    (نفس ما تعتمده تقارير 12 ويومية الترحيل). المقارنة نصف مفتوحة كي لا
  --    تسقط فواتير آخر يوم في الفترة.
  SELECT coalesce(sum(subtotal), 0)
    INTO v_sales_taxable
    FROM public.sales_invoices
   WHERE status = 'confirmed'
     AND created_at >= p_start_date::timestamptz
     AND created_at <  (p_end_date + 1)::timestamptz;

  -- 4) إجمالي المشتريات في الفترة
  SELECT coalesce(sum(subtotal), 0)
    INTO v_purch_taxable
    FROM public.purchase_invoices
   WHERE status = 'confirmed'
     AND created_at >= p_start_date::timestamptz
     AND created_at <  (p_end_date + 1)::timestamptz;

  v_net_tax := v_output_tax - v_input_tax;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'taxable_sales', v_sales_taxable,
    'output_tax', v_output_tax,
    'taxable_purchases', v_purch_taxable,
    'input_tax', v_input_tax,
    'net_tax_payable', v_net_tax
  );
END $$;

--
-- Name: open_fiscal_year(integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.open_fiscal_year(p_year integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: pay_tax_settlement(uuid, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.pay_tax_settlement(p_settlement_id uuid, p_payment_date date DEFAULT CURRENT_DATE, p_payment_account text DEFAULT '1101'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_settle   record;
  v_lines    jsonb;
  v_entry_id uuid;
  v_memo     text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may pay tax settlements';
  END IF;

  PERFORM public.assert_period_open(p_payment_date);

  SELECT * INTO v_settle FROM public.tax_settlement_periods WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tax settlement not found';
  END IF;

  IF v_settle.status <> 'SETTLED' THEN
    RAISE EXCEPTION 'Settlement % is not in SETTLED status (current: %)', v_settle.period_number, v_settle.status;
  END IF;

  IF v_settle.net_tax_payable <= 0 THEN
    RAISE EXCEPTION 'لا يوجد التزام ضريبي واجب السداد (الصافي %)', v_settle.net_tax_payable;
  END IF;

  v_memo := 'سداد ضريبة القيمة المضافة لهيئة الضرائب عن الفترة ' || v_settle.period_number;
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', '2321', -- تصفير الالتزام
      'debit', v_settle.net_tax_payable,
      'credit', 0,
      'memo', 'سداد الالتزام الضريبي — ' || v_settle.period_number
    ),
    jsonb_build_object(
      'account_code', coalesce(p_payment_account, '1101'), -- دفع من الصندوق أو البنك
      'debit', 0,
      'credit', v_settle.net_tax_payable,
      'memo', 'دفع الضريبة المستحقة'
    )
  );

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_payment_date,
    'tax_payment',
    p_settlement_id,
    true,
    v_lines,
    false
  );

  UPDATE public.tax_settlement_periods
     SET status = 'PAID',
         paid_at = now(),
         payment_journal_entry_id = v_entry_id
   WHERE id = p_settlement_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'tax.paid', 'tax_settlement', p_settlement_id,
          jsonb_build_object('period_number', v_settle.period_number, 'amount', v_settle.net_tax_payable, 'entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;

--
-- Name: post_journal_entry(date, text, jsonb, text, uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_journal_entry(p_entry_date date, p_memo text, p_lines jsonb, p_source_type text, p_source_id uuid, p_entry_number text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_entry_id uuid;
BEGIN
  IF nullif(btrim(p_entry_number), '') IS NULL THEN
    RAISE EXCEPTION 'A journal entry number is required';
  END IF;

  v_entry_id := public.create_journal_entry(
    p_memo,
    p_entry_date,
    p_source_type,
    p_source_id,
    true,
    p_lines
  );

  UPDATE public.journal_entries
     SET entry_number = p_entry_number
   WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

--
-- Name: post_opening_balance(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_opening_balance(_document_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc record;
  v_debit numeric;
  v_credit numeric;
  v_capital numeric;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_account text;
  v_balance numeric;
  l record;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post opening balances';
  END IF;
  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opening document not found'; END IF;
  IF v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Document % is already %', v_doc.document_number, v_doc.status;
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE side = 'DEBIT'), 0),
         coalesce(sum(amount) FILTER (WHERE side = 'CREDIT'), 0),
         coalesce(sum(amount) FILTER (WHERE section = 'CAPITAL'), 0)
    INTO v_debit, v_credit, v_capital
    FROM public.opening_balance_lines WHERE document_id = _document_id;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Opening entry does not balance: debits % vs credits % (difference %).',
      round(v_debit, 2)::text, round(v_credit, 2)::text, round(v_debit - v_credit, 2)::text;
  END IF;

  FOR l IN SELECT * FROM public.opening_balance_lines WHERE document_id = _document_id ORDER BY id
  LOOP
    IF l.section = 'STOCK' THEN
      PERFORM public.post_stock_delta(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => l.quantity, p_unit_cost => coalesce(l.unit_cost, 0),
        p_movement_kind => 'OPENING', p_movement_type_legacy => 'opening',
        p_source_type => 'opening_balance', p_source_id => _document_id,
        p_note => 'رصيد افتتاحي ' || v_doc.document_number,
        p_owner_type => 'COMPANY', p_owner_id => NULL);
      PERFORM public.apply_cost_movement(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => l.quantity, p_incoming_cost => l.unit_cost,
        p_source_type => 'opening_balance', p_source_id => _document_id,
        p_note => 'رصيد افتتاحي ' || v_doc.document_number);
      SELECT coalesce(l.ledger_account_code,
        CASE p.item_class WHEN 'RAW_MATERIAL' THEN '1311' WHEN 'BY_PRODUCT' THEN '1314' ELSE '1313' END)
        INTO v_account FROM public.products p WHERE p.id = l.product_id;
      v_lines := v_lines || jsonb_build_object('account_code', v_account,
        'debit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSIF l.section = 'RECEIVABLE' THEN
      INSERT INTO public.customer_ledger
        (customer_id, entry_type, debit, credit, reference_id, reference_type, occurred_at, created_by, note)
      VALUES (l.customer_id, 'adjustment', l.amount, 0, _document_id, 'opening_balance',
        v_doc.effective_date::timestamptz, v_user, 'رصيد افتتاحي ' || v_doc.document_number);
      v_lines := v_lines || jsonb_build_object('account_code', coalesce(l.ledger_account_code, '1211'),
        'debit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSIF l.section = 'PAYABLE' THEN
      UPDATE public.suppliers SET balance = coalesce(balance, 0) + l.amount WHERE id = l.supplier_id;
      SELECT balance INTO v_balance FROM public.suppliers WHERE id = l.supplier_id;
      INSERT INTO public.supplier_ledger
        (supplier_id, entry_type, debit, credit, balance_after, reference_type, reference_id,
         occurred_at, source_key, note, created_by)
      VALUES (l.supplier_id, 'OPENING_BALANCE', 0, l.amount, v_balance, 'opening_balance', _document_id,
        v_doc.effective_date::timestamptz, 'OB-' || _document_id::text || '-' || l.id::text,
        'رصيد افتتاحي ' || v_doc.document_number, v_user)
      ON CONFLICT (source_key) DO NOTHING;
      v_lines := v_lines || jsonb_build_object('account_code', coalesce(l.ledger_account_code, '2111'),
        'credit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSE
      v_account := coalesce(l.ledger_account_code,
        CASE l.section WHEN 'CASH' THEN '1101' WHEN 'BANK' THEN '1111'
          WHEN 'ASSET' THEN '1411' WHEN 'LIABILITY' THEN '2111' WHEN 'CAPITAL' THEN '3111' END);
      IF v_account IS NULL THEN RAISE EXCEPTION 'No ledger account mapping for %', l.section; END IF;
      v_lines := v_lines || jsonb_build_object('account_code', v_account,
        CASE WHEN l.side = 'DEBIT' THEN 'debit' ELSE 'credit' END,
        round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);
    END IF;
  END LOOP;

  v_journal := public.create_journal_entry(
    'رصيد افتتاحي ' || v_doc.document_number, v_doc.effective_date,
    'opening_balance', _document_id, true, v_lines);

  UPDATE public.opening_balance_documents
    SET total_assets = v_debit, total_liabilities = v_credit - v_capital,
        capital_required = v_debit - v_credit + v_capital,
        status = 'POSTED', posted_by = v_user, posted_at = now()
    WHERE id = _document_id;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'opening_balance.posted', 'opening_balance', _document_id,
    jsonb_build_object('document_number', v_doc.document_number, 'debits', v_debit,
      'credits', v_credit, 'journal_entry_id', v_journal));
  RETURN _document_id;
END;
$$;

--
-- Name: post_sales_invoice_cogs(uuid, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_sales_invoice_cogs(p_invoice_id uuid, p_entry_date date, p_invoice_number text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cost numeric;
  v_lines jsonb:='[]'::jsonb;
  r record;
BEGIN
  SELECT coalesce(sum(sm.total_cost),0) INTO v_cost
    FROM public.stock_movements sm
   WHERE sm.source_type='sales_invoice' AND sm.source_id=p_invoice_id AND sm.movement_type='sale';
  IF v_cost<=0 THEN RETURN; END IF;
  v_lines:=jsonb_build_array(jsonb_build_object('account_code','5111','debit',round(v_cost,2),'memo','تكلفة المبيعات'));
  FOR r IN
    SELECT CASE p.item_class WHEN 'RAW_MATERIAL' THEN '1311' WHEN 'BY_PRODUCT' THEN '1314'
                              WHEN 'PACKAGING' THEN '1315' ELSE '1313' END AS account_code,
           round(sum(sm.total_cost),2) AS amount,
           coalesce(p.item_class::text,'FINISHED_GOOD') AS item_class
      FROM public.stock_movements sm JOIN public.products p ON p.id=sm.product_id
     WHERE sm.source_type='sales_invoice' AND sm.source_id=p_invoice_id AND sm.movement_type='sale'
     GROUP BY 1,3 HAVING sum(sm.total_cost)>0
  LOOP
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'account_code',r.account_code,'credit',r.amount,'memo','صرف مخزون '||r.item_class));
  END LOOP;
  -- Preserve cents when grouping account codes by placing any rounding
  -- difference on the last inventory credit line.
  SELECT round(sum(coalesce((x->>'credit')::numeric,0)),2) INTO v_cost
    FROM jsonb_array_elements(v_lines) x WHERE x ? 'credit';
  IF v_cost<>round((SELECT coalesce(sum(sm.total_cost),0) FROM public.stock_movements sm
    WHERE sm.source_type='sales_invoice' AND sm.source_id=p_invoice_id AND sm.movement_type='sale'),2) THEN
    RAISE EXCEPTION 'تكلفة المبيعات حسب فئة المخزون غير متزنة';
  END IF;
  PERFORM public.post_journal_entry(
    p_entry_date,'تكلفة البضاعة المباعة - فاتورة '||p_invoice_number,v_lines,
    'sales_invoice_cogs',p_invoice_id,'JE-COGS-'||p_invoice_number);
END;
$$;

--
-- Name: post_stock_adjustment(uuid, text, text, date, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_number     text;
  v_line       record;
  v_policy     public.inventory_policy;
  v_nature     public.item_nature;
  v_total      numeric := 0;
  v_line_total numeric;
  v_entry      uuid;
  v_stock_code text;
  v_lines      jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'warehouse')
    OR public.has_role(v_user, 'accountant')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post stock adjustments';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'A documented reason is required for every stock adjustment';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'A stock adjustment requires at least one item';
  END IF;

  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    IF v_line.product_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity = 0 THEN
      RAISE EXCEPTION 'Every adjustment line requires an item and a non-zero quantity';
    END IF;

    SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = v_line.product_id;
    IF v_nature IS NULL THEN
      RAISE EXCEPTION 'Item % does not exist', v_line.product_id;
    END IF;
    IF v_nature = 'SERVICE' THEN
      RAISE EXCEPTION 'Item % is a SERVICE and has no inventory to adjust', v_line.product_id;
    END IF;

    v_policy := public.item_effective_policy(v_line.product_id);
    IF v_policy <> 'TRACKED' THEN
      RAISE EXCEPTION
        'Item % has inventory policy %, so it has no inventory balance to adjust',
        v_line.product_id, v_policy;
    END IF;
  END LOOP;

  v_number := public.next_stock_adjustment_number();

  INSERT INTO public.stock_adjustments (document_number, warehouse_id, effective_date, reason, note, created_by)
  VALUES (v_number, _warehouse_id, coalesce(_effective_date, current_date), btrim(_reason),
          nullif(btrim(coalesce(_note, '')), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    v_line_total := round(abs(v_line.quantity) * v_line.unit_cost, 2);
    v_total := v_total + v_line_total;

    -- حساب المخزون حسب item_class للقيد.
    SELECT CASE p.item_class
             WHEN 'RAW_MATERIAL' THEN '1311'
             WHEN 'BY_PRODUCT'   THEN '1314'
             ELSE '1313' END
      INTO v_stock_code
    FROM public.products p WHERE p.id = v_line.product_id;

    INSERT INTO public.stock_adjustment_items (adjustment_id, product_id, quantity, unit_cost, total_cost, note)
    VALUES (v_id, v_line.product_id, v_line.quantity, v_line.unit_cost, v_line_total, v_line.note);

    -- signed quantity goes straight through: positive adds, negative removes.
    PERFORM public.post_stock_delta(
      v_line.product_id,
      _warehouse_id,
      v_line.quantity,
      v_line.unit_cost,
      'ADJUSTMENT'::public.stock_movement_kind,
      'stock_adjustment',
      v_id,
      coalesce(v_line.note, btrim(_reason)),
      'COMPANY'::public.owner_type,
      NULL,
      'adjustment'::public.movement_type
    );

    -- ── T-09: سطر القيد لهذا الصنف ──────────────────────────────────────
    IF v_line.quantity < 0 THEN
      v_lines := v_lines
        || jsonb_build_object('account_code', '5921', 'debit', v_line_total,
                              'memo', 'نقص جرد — ' || btrim(_reason))
        || jsonb_build_object('account_code', v_stock_code, 'credit', v_line_total,
                              'memo', 'مخزون');
    ELSE
      v_lines := v_lines
        || jsonb_build_object('account_code', v_stock_code, 'debit', v_line_total,
                              'memo', 'فائض جرد')
        || jsonb_build_object('account_code', '5911', 'credit', v_line_total,
                              'memo', 'فائض جرد — ' || btrim(_reason));
    END IF;
  END LOOP;

  -- The DB constraint requires a coded reason on every adjustment movement.
  UPDATE public.stock_movements
  SET adjustment_reason = btrim(_reason)
  WHERE source_type = 'stock_adjustment'
    AND source_id = v_id
    AND movement_kind = 'ADJUSTMENT'
    AND adjustment_reason IS NULL;

  UPDATE public.stock_adjustments SET total_value = v_total WHERE id = v_id;

  -- ── T-09: قيد التسوية في الأستاذ ──────────────────────────────────────
  IF v_total > 0 AND jsonb_array_length(v_lines) >= 2 THEN
    v_entry := public.create_journal_entry(
      'تسوية مخزون ' || v_number, coalesce(_effective_date, current_date),
      'stock_adjustment', v_id, true, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock_adjustment.posted', 'stock_adjustment', v_id,
    jsonb_build_object(
      'document_number', v_number,
      'warehouse_id', _warehouse_id,
      'reason', btrim(_reason),
      'effective_date', coalesce(_effective_date, current_date),
      'lines', jsonb_array_length(_items),
      'total_value', v_total,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $$;

--
-- Name: production_inventory_account_code(public.item_class); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_inventory_account_code(p_class public.item_class) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE p_class
    WHEN 'RAW_MATERIAL' THEN '1311'
    WHEN 'BY_PRODUCT' THEN '1314'
    WHEN 'PACKAGING' THEN '1315'
    ELSE '1313'
  END;
$$;

--
-- Name: required_payment_ledger_accounts(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.required_payment_ledger_accounts() RETURNS TABLE(code text, expected_name text, ledger_kind text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  -- كل الأعمدة بـ `text` صريحًا حتى يطابق نوع الإرجاع المعلن.
  -- `VALUES` بلا تحويل صريح يستنتج أعمدة `unknown` فيُرفض في تدقيق التوقيع.
  SELECT * FROM (
    VALUES
      ('1101'::text, 'النقدية بالصندوق'::text,              'CASH'::text),
      ('1111'::text, 'حسابات البنوك'::text,                  'BANK'::text),
      ('1131'::text, 'المحافظ الإلكترونية'::text,            'WALLET'::text),
      ('1221'::text, 'أوراق قبض — شيكات برسم التحصيل'::text, 'CHEQUE'::text)
  ) AS t(code, expected_name, ledger_kind);
$$;

--
-- Name: reverse_journal_entry(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old record;
  v_id uuid;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may reverse journal entries';
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
      'debit', CASE WHEN jl.debit > 0 THEN 0 ELSE jl.credit END,
      'credit', CASE WHEN jl.debit > 0 THEN jl.debit ELSE 0 END,
      'memo', coalesce(jl.memo, a.name_ar)
    ) ORDER BY jl.id), '[]'::jsonb)
    FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
    WHERE jl.entry_id = p_entry_id),
    true
  ) INTO v_id;

  UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = p_entry_id;
  RETURN v_id;
END;
$$;

--
-- Name: reverse_opening_balance(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc record;
  v_new uuid;
  v_journal uuid;
  v_balance numeric;
  l record;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may reverse opening balances';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Reversing an opening entry requires a reason';
  END IF;
  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted opening document can be reversed';
  END IF;

  INSERT INTO public.opening_balance_documents
    (document_number, effective_date, status, fiscal_year, reverses_document_id,
     notes, created_by, posted_at, posted_by)
  VALUES ('OBR-' || v_doc.document_number, v_doc.effective_date, 'POSTED', v_doc.fiscal_year,
    _document_id, 'عكس القيد الافتتاحي ' || v_doc.document_number || ': ' || btrim(_reason),
    v_user, now(), v_user)
  RETURNING id INTO v_new;

  INSERT INTO public.opening_balance_lines
    (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
     customer_id, supplier_id, description, quantity, unit_cost, amount, ledger_account_code)
  SELECT v_new, section, CASE WHEN side = 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
    ref_type, ref_id, product_id, warehouse_id, customer_id, supplier_id,
    'عكس: ' || description, quantity, unit_cost, amount, ledger_account_code
  FROM public.opening_balance_lines WHERE document_id = _document_id;

  FOR l IN SELECT * FROM public.opening_balance_lines WHERE document_id = _document_id ORDER BY id
  LOOP
    IF l.section = 'STOCK' THEN
      PERFORM public.post_stock_delta(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => -l.quantity, p_unit_cost => coalesce(l.unit_cost, 0),
        p_movement_kind => 'ADJUSTMENT', p_movement_type_legacy => 'opening',
        p_source_type => 'opening_balance_reversal', p_source_id => v_new,
        p_note => 'عكس رصيد افتتاحي ' || v_doc.document_number,
        p_owner_type => 'COMPANY', p_owner_id => NULL);
      PERFORM public.apply_cost_movement(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => -l.quantity, p_incoming_cost => NULL,
        p_source_type => 'opening_balance_reversal', p_source_id => v_new,
        p_note => 'عكس رصيد افتتاحي ' || v_doc.document_number);

    ELSIF l.section = 'RECEIVABLE' THEN
      INSERT INTO public.customer_ledger
        (customer_id, entry_type, debit, credit, reference_id, reference_type, occurred_at, created_by, note)
      VALUES (l.customer_id, 'adjustment', 0, l.amount, v_new, 'opening_balance_reversal',
        now(), v_user, 'عكس رصيد افتتاحي ' || v_doc.document_number);

    ELSIF l.section = 'PAYABLE' THEN
      UPDATE public.suppliers SET balance = coalesce(balance, 0) - l.amount WHERE id = l.supplier_id;
      SELECT balance INTO v_balance FROM public.suppliers WHERE id = l.supplier_id;
      INSERT INTO public.supplier_ledger
        (supplier_id, entry_type, debit, credit, balance_after, reference_type, reference_id,
         occurred_at, source_key, note, created_by)
      VALUES (l.supplier_id, 'OPENING_BALANCE', l.amount, 0, v_balance, 'opening_balance_reversal', v_new,
        now(), 'OBR-' || _document_id::text || '-' || l.id::text,
        'عكس رصيد افتتاحي ' || v_doc.document_number || ': ' || btrim(_reason), v_user)
      ON CONFLICT (source_key) DO NOTHING;
    END IF;
  END LOOP;

  SELECT id INTO v_journal FROM public.journal_entries
    WHERE source_type = 'opening_balance' AND source_id = _document_id AND status = 'POSTED'
    FOR UPDATE;
  IF v_journal IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_journal, btrim(_reason));
  END IF;

  UPDATE public.opening_balance_documents SET status = 'REVERSED' WHERE id = _document_id;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'opening_balance.reversed', 'opening_balance', _document_id,
    jsonb_build_object('reversal_document_id', v_new, 'journal_entry_id', v_journal, 'reason', btrim(_reason)));
  RETURN v_new;
END;
$$;

--
-- Name: run_batch_amortization(date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.run_batch_amortization(p_date date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user    uuid := auth.uid();
  r         record;
  v_entry   uuid;
  v_count   integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may run batch amortization';
  END IF;

  FOR r IN
    SELECT id, contract_number FROM public.prepaid_and_deferred_contracts
     WHERE status = 'ACTIVE'
     ORDER BY start_date ASC
  LOOP
    BEGIN
      v_entry := public.run_contract_amortization(r.id, p_date);
      IF v_entry IS NOT NULL THEN
        v_count := v_count + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN others THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'date', p_date,
    'amortized_count', v_count,
    'skipped_count', v_skipped
  );
END $$;

--
-- Name: run_batch_depreciation(date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.run_batch_depreciation(p_date date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user      uuid := auth.uid();
  r           record;
  v_entry     uuid;
  v_count     integer := 0;
  v_total     numeric(18,2) := 0;
  v_skipped   integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may run batch depreciation';
  END IF;

  FOR r IN
    SELECT id, asset_code FROM public.fixed_assets
     WHERE status = 'ACTIVE'
     ORDER BY purchase_date ASC
  LOOP
    BEGIN
      v_entry := public.run_depreciation(r.id, p_date);
      IF v_entry IS NOT NULL THEN
        v_count := v_count + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN others THEN
      -- تخطي ما تم إهلاكه سابقاً في نفس اليوم
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'date', p_date,
    'depreciated_count', v_count,
    'skipped_count', v_skipped
  );
END $$;

--
-- Name: run_contract_amortization(uuid, date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.run_contract_amortization(p_contract_id uuid, p_date date DEFAULT CURRENT_DATE) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_rec         record;
  v_period_amt  numeric(18,2);
  v_amount      numeric(18,2);
  v_new_amort   numeric(18,2);
  v_new_rem     numeric(18,2);
  v_entry_id    uuid;
  v_memo        text;
  v_lines       jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may amortize prepaid contracts';
  END IF;

  -- فحص الفترة المالية
  PERFORM public.assert_period_open(p_date);

  SELECT * INTO v_rec FROM public.prepaid_and_deferred_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;

  IF v_rec.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Contract % is not active (status: %)', v_rec.contract_number, v_rec.status;
  END IF;

  -- منع تكرار الاستهلاك لنفس العقد في نفس التاريخ
  IF EXISTS (
    SELECT 1 FROM public.amortization_lines
     WHERE contract_id = p_contract_id AND period_date = p_date
  ) THEN
    RAISE EXCEPTION 'Contract % has already been amortized on %', v_rec.contract_number, p_date;
  END IF;

  IF v_rec.remaining_amount <= 0 THEN
    UPDATE public.prepaid_and_deferred_contracts
       SET status = 'COMPLETED'
     WHERE id = p_contract_id;
    RETURN NULL;
  END IF;

  v_period_amt := round(v_rec.total_amount / v_rec.total_periods, 2);
  v_amount     := least(v_period_amt, v_rec.remaining_amount);

  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  v_new_amort := v_rec.amortized_amount + v_amount;
  v_new_rem   := v_rec.total_amount - v_new_amort;

  -- بناء القيد المحاسبي المتوازن حسب نوع العقد
  IF v_rec.contract_type IN ('PREPAID_EXPENSE', 'DEFERRED_EXPENSE') THEN
    -- استهلاك مصروف مقدم: Dr حساب المصروف الفعلي / Cr حساب المصروف المقدم (1511/1512)
    v_memo := 'استهلاك قسط مصروف مقدم — ' || v_rec.title || ' (' || v_rec.contract_number || ')';
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_rec.target_account_code,
        'debit', v_amount,
        'credit', 0,
        'memo', 'تحميل مصروف الفترة — ' || v_rec.title
      ),
      jsonb_build_object(
        'account_code', v_rec.balance_account_code,
        'debit', 0,
        'credit', v_amount,
        'memo', 'تخفيض المصروف المقدم — ' || v_rec.title
      )
    );
  ELSE
    -- تحقق إيراد مؤجل: Dr حساب الإيراد المؤجل (2231) / Cr حساب الإيراد الفعلي (4xxx)
    v_memo := 'اعتراف بقسط إيراد مؤجل — ' || v_rec.title || ' (' || v_rec.contract_number || ')';
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_rec.balance_account_code,
        'debit', v_amount,
        'credit', 0,
        'memo', 'تخفيض التزام الإيراد المؤجل — ' || v_rec.title
      ),
      jsonb_build_object(
        'account_code', v_rec.target_account_code,
        'debit', 0,
        'credit', v_amount,
        'memo', 'تحقق إيراد الفترة — ' || v_rec.title
      )
    );
  END IF;

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_date,
    'prepaid_amortization',
    p_contract_id,
    true,
    v_lines,
    false
  );

  -- تسجيل في سجل الاستهلاك
  INSERT INTO public.amortization_lines (
    contract_id, period_date, amount, remaining_after, journal_entry_id
  )
  VALUES (
    p_contract_id, p_date, v_amount, v_new_rem, v_entry_id
  );

  -- تحديث العقد
  UPDATE public.prepaid_and_deferred_contracts
     SET amortized_amount       = v_new_amort,
         remaining_amount       = v_new_rem,
         last_amortization_date = p_date,
         status                 = CASE WHEN v_new_rem <= 0 THEN 'COMPLETED' ELSE 'ACTIVE' END
   WHERE id = p_contract_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'prepaid_contract.amortized', 'prepaid_contract', p_contract_id,
          jsonb_build_object('contract_number', v_rec.contract_number, 'amount', v_amount,
                             'journal_entry_id', v_entry_id, 'remaining', v_new_rem));

  RETURN v_entry_id;
END $$;

--
-- Name: run_depreciation(uuid, date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.run_depreciation(p_asset_id uuid, p_date date DEFAULT CURRENT_DATE) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_asset       record;
  v_monthly     numeric(18,2);
  v_depreciable numeric(18,2);
  v_remaining   numeric(18,2);
  v_amount      numeric(18,2);
  v_new_acc     numeric(18,2);
  v_new_book    numeric(18,2);
  v_entry_id    uuid;
  v_memo        text;
  v_lines       jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may run asset depreciation';
  END IF;

  -- فحص الفترة المالية
  PERFORM public.assert_period_open(p_date);

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fixed asset not found';
  END IF;

  IF v_asset.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Asset % is not active (status: %)', v_asset.asset_code, v_asset.status;
  END IF;

  -- منع تكرار الإهلاك في نفس التاريخ المحدد للأصل
  IF EXISTS (
    SELECT 1 FROM public.asset_depreciation_lines
     WHERE asset_id = p_asset_id AND depreciation_date = p_date
  ) THEN
    RAISE EXCEPTION 'Asset % has already been depreciated on %', v_asset.asset_code, p_date;
  END IF;

  -- حساب الإهلاك بالقسط الثابت: (التكلفة - قيمة الخردة) / العمر الإنتاجي
  v_depreciable := v_asset.purchase_cost - v_asset.salvage_value;
  v_monthly     := round(v_depreciable / v_asset.useful_life_months, 2);
  v_remaining   := v_depreciable - v_asset.accumulated_depreciation;

  IF v_remaining <= 0 THEN
    UPDATE public.fixed_assets
       SET status = 'FULLY_DEPRECIATED'
     WHERE id = p_asset_id;
    RETURN NULL;
  END IF;

  v_amount := least(v_monthly, v_remaining);
  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  v_new_acc  := v_asset.accumulated_depreciation + v_amount;
  v_new_book := v_asset.purchase_cost - v_new_acc;

  -- بناء القيد المحاسبي المتوازن: Dr 5611 / Cr 1491
  v_memo := 'إهلاك أصل ثابت ' || v_asset.asset_code || ' (' || v_asset.name_ar || ') بتاريخ ' || to_char(p_date, 'YYYY-MM-DD');
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', v_asset.depreciation_expense_account_code, -- 5611
      'debit', v_amount,
      'credit', 0,
      'memo', 'مصروف إهلاك — ' || v_asset.name_ar
    ),
    jsonb_build_object(
      'account_code', v_asset.accumulated_depreciation_account_code, -- 1491
      'debit', 0,
      'credit', v_amount,
      'memo', 'مجمع إهلاك — ' || v_asset.name_ar
    )
  );

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_date,
    'fixed_asset_depreciation',
    p_asset_id,
    true, -- قيد نظامي
    v_lines,
    false
  );

  -- تسجيل في سجل الإهلاك
  INSERT INTO public.asset_depreciation_lines (
    asset_id, depreciation_date, depreciation_amount, book_value_before, book_value_after, journal_entry_id
  )
  VALUES (
    p_asset_id, p_date, v_amount, v_asset.current_book_value, v_new_book, v_entry_id
  );

  -- تحديث الأصل
  UPDATE public.fixed_assets
     SET accumulated_depreciation = v_new_acc,
         current_book_value       = v_new_book,
         last_depreciation_date   = p_date,
         status                   = CASE WHEN v_new_acc >= v_depreciable THEN 'FULLY_DEPRECIATED' ELSE 'ACTIVE' END
   WHERE id = p_asset_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fixed_asset.depreciated', 'fixed_asset', p_asset_id,
          jsonb_build_object('asset_code', v_asset.asset_code, 'amount', v_amount,
                             'journal_entry_id', v_entry_id, 'new_book_value', v_new_book));

  RETURN v_entry_id;
END $$;

--
-- Name: set_period_status(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_period_status(p_period_id uuid, p_status text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_period record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may change fiscal period status';
  END IF;

  IF p_status NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'Status must be OPEN or CLOSED';
  END IF;

  SELECT * INTO v_period FROM public.fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period not found';
  END IF;

  UPDATE public.fiscal_periods
     SET status = p_status,
         closed_at = CASE WHEN p_status = 'CLOSED' THEN now() ELSE NULL END,
         closed_by = CASE WHEN p_status = 'CLOSED' THEN v_user ELSE NULL END
   WHERE id = p_period_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fiscal_period.status_changed', 'fiscal_period', p_period_id,
          jsonb_build_object('code', v_period.code, 'old_status', v_period.status, 'new_status', p_status));

  RETURN true;
END $$;

--
-- Name: settle_tax_period(date, date, text, date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date DEFAULT CURRENT_DATE) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_decl          jsonb;
  v_output_tax    numeric(18,2);
  v_input_tax     numeric(18,2);
  v_net_tax       numeric(18,2);
  v_sales         numeric(18,2);
  v_purch         numeric(18,2);
  v_lines         jsonb := '[]'::jsonb;
  v_entry_id      uuid;
  v_settle_id     uuid;
  v_memo          text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- نطاق وسياق إلزاميان: بدونهما كان يُنشأ قيد تسوية بقيمة صفر (أثر كاذب).
  IF p_start_date IS NULL OR p_end_date IS NULL
     OR nullif(btrim(coalesce(p_period_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Tax settlement requires start_date, end_date and period_number'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tax settlement end_date (%) is before start_date (%)', p_end_date, p_start_date
      USING ERRCODE = '22023';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may settle taxes'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_period_open(p_settlement_date);

  IF EXISTS (
    SELECT 1 FROM public.tax_settlement_periods
     WHERE period_number = p_period_number
  ) THEN
    RAISE EXCEPTION 'Tax period % already exists or settled', p_period_number;
  END IF;

  -- قراءة أرقام الإقرار (النسخة السليمة)
  v_decl := public.generate_tax_declaration(p_start_date, p_end_date);
  v_sales      := (v_decl->>'taxable_sales')::numeric;
  v_output_tax := (v_decl->>'output_tax')::numeric;
  v_purch      := (v_decl->>'taxable_purchases')::numeric;
  v_input_tax  := (v_decl->>'input_tax')::numeric;
  v_net_tax    := (v_decl->>'net_tax_payable')::numeric;

  IF coalesce(v_output_tax, 0) = 0 AND coalesce(v_input_tax, 0) = 0 THEN
    RAISE EXCEPTION 'لا توجد حركات ضريبية مرحّلة للفترة المحددة لتسويتها'
      USING ERRCODE = '22023';
  END IF;

  -- بناء قيد التسوية المتوازن:
  IF v_output_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2311', 'debit', v_output_tax, 'credit', 0,
        'memo', 'تسوية ضريبة المخرجات للفترة ' || p_period_number
      )
    );
  END IF;

  IF v_input_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '1316', 'debit', 0, 'credit', v_input_tax,
        'memo', 'تسوية ضريبة المدخلات للفترة ' || p_period_number
      )
    );
  END IF;

  IF v_net_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321', 'debit', 0, 'credit', v_net_tax,
        'memo', 'صافي ضريبة القيمة المضافة المستحقة للدفع — ' || p_period_number
      )
    );
  ELSIF v_net_tax < 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321', 'debit', -v_net_tax, 'credit', 0,
        'memo', 'رصيد ضريبة مدخلات فائض مسترد/مرحل — ' || p_period_number
      )
    );
  END IF;

  v_memo := 'قيد التسوية والإقرار الضريبي للفترة ' || p_period_number ||
            ' (' || to_char(p_start_date, 'YYYY-MM-DD') || ' إلى ' || to_char(p_end_date, 'YYYY-MM-DD') || ')';

  v_entry_id := public.create_journal_entry(
    v_memo, p_settlement_date, 'tax_settlement', NULL, true, v_lines, false
  );

  INSERT INTO public.tax_settlement_periods (
    period_number, start_date, end_date, total_taxable_sales,
    output_tax_amount, total_taxable_purchases, input_tax_amount,
    net_tax_payable, status, journal_entry_id, settled_at, settled_by
  )
  VALUES (
    btrim(p_period_number), p_start_date, p_end_date, v_sales,
    v_output_tax, v_purch, v_input_tax,
    v_net_tax, 'SETTLED', v_entry_id, now(), v_user
  )
  RETURNING id INTO v_settle_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'tax.settled', 'tax_settlement', v_settle_id,
          jsonb_build_object('period_number', p_period_number, 'net_tax', v_net_tax, 'entry_id', v_entry_id));

  RETURN v_settle_id;
END $$;

--
-- Name: tg_journal_entries_no_delete(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_journal_entries_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION
    'Deleting a journal entry is forbidden. Reverse it via reverse_journal_entry instead (entry %).',
    OLD.entry_number
    USING ERRCODE = 'restrict_violation';
END;
$$;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(20) NOT NULL,
    name_ar text NOT NULL,
    account_type public.account_type NOT NULL,
    parent_id uuid,
    is_system boolean DEFAULT false NOT NULL,
    is_postable boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    requires_reconciliation boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: amortization_lines; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.amortization_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    period_date date NOT NULL,
    amount numeric(18,2) NOT NULL,
    remaining_after numeric(18,2) NOT NULL,
    journal_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT amortization_lines_amount_check CHECK ((amount > (0)::numeric))
);

--
-- Name: asset_depreciation_lines; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.asset_depreciation_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    depreciation_date date NOT NULL,
    depreciation_amount numeric(18,2) NOT NULL,
    book_value_before numeric(18,2) NOT NULL,
    book_value_after numeric(18,2) NOT NULL,
    journal_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_depreciation_lines_depreciation_amount_check CHECK ((depreciation_amount > (0)::numeric))
);

--
-- Name: fiscal_periods; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.fiscal_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    fiscal_year integer NOT NULL,
    period_no integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    closed_at timestamp with time zone,
    closed_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fiscal_period_dates_ordered CHECK ((end_date >= start_date)),
    CONSTRAINT fiscal_periods_period_no_check CHECK (((period_no >= 1) AND (period_no <= 12))),
    CONSTRAINT fiscal_periods_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text]))),
    CONSTRAINT fiscal_periods_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id)
);

--
-- Name: fixed_assets; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.fixed_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_code text NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    category text NOT NULL,
    purchase_date date NOT NULL,
    purchase_cost numeric(18,2) NOT NULL,
    salvage_value numeric(18,2) DEFAULT 0 NOT NULL,
    useful_life_months integer NOT NULL,
    depreciation_method text DEFAULT 'STRAIGHT_LINE'::text NOT NULL,
    asset_account_code text DEFAULT '1411'::text NOT NULL,
    accumulated_depreciation_account_code text DEFAULT '1491'::text NOT NULL,
    depreciation_expense_account_code text DEFAULT '5611'::text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    accumulated_depreciation numeric(18,2) DEFAULT 0 NOT NULL,
    current_book_value numeric(18,2) NOT NULL,
    last_depreciation_date date,
    disposal_date date,
    disposal_amount numeric(18,2),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fixed_assets_accumulated_depreciation_check CHECK ((accumulated_depreciation >= (0)::numeric)),
    CONSTRAINT fixed_assets_category_check CHECK ((category = ANY (ARRAY['MACHINERY'::text, 'VEHICLES'::text, 'EQUIPMENT'::text, 'BUILDINGS'::text, 'OTHER'::text]))),
    CONSTRAINT fixed_assets_check CHECK (((salvage_value >= (0)::numeric) AND (salvage_value < purchase_cost))),
    CONSTRAINT fixed_assets_depreciation_method_check CHECK ((depreciation_method = ANY (ARRAY['STRAIGHT_LINE'::text, 'DECLINING_BALANCE'::text]))),
    CONSTRAINT fixed_assets_purchase_cost_check CHECK ((purchase_cost > (0)::numeric)),
    CONSTRAINT fixed_assets_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'FULLY_DEPRECIATED'::text, 'DISPOSED'::text]))),
    CONSTRAINT fixed_assets_useful_life_months_check CHECK ((useful_life_months > 0)),
    CONSTRAINT fixed_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_number text NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    memo text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    source_type text,
    source_id uuid,
    is_system boolean DEFAULT false NOT NULL,
    reverses_id uuid,
    total_debit numeric(18,2) DEFAULT 0 NOT NULL,
    total_credit numeric(18,2) DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    posted_by uuid,
    posted_at timestamp with time zone,
    CONSTRAINT journal_entries_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text]))),
    CONSTRAINT journal_no_self_reversal CHECK ((reverses_id IS DISTINCT FROM id)),
    CONSTRAINT journal_posted_has_totals CHECK (((status <> 'POSTED'::text) OR ((total_debit > (0)::numeric) AND (total_debit = total_credit)))),
    CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
    CONSTRAINT journal_entries_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES auth.users(id)
);

--
-- Name: journal_entry_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.journal_entry_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.journal_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    debit numeric(18,2) DEFAULT 0 NOT NULL,
    credit numeric(18,2) DEFAULT 0 NOT NULL,
    memo text,
    partner_type text,
    partner_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journal_lines_credit_check CHECK ((credit >= (0)::numeric)),
    CONSTRAINT journal_lines_debit_check CHECK ((debit >= (0)::numeric)),
    CONSTRAINT journal_lines_one_side CHECK ((((debit > (0)::numeric) AND (credit = (0)::numeric)) OR ((credit > (0)::numeric) AND (debit = (0)::numeric))))
);

--
-- Name: prepaid_and_deferred_contracts; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.prepaid_and_deferred_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_number text NOT NULL,
    contract_type text NOT NULL,
    title text NOT NULL,
    total_amount numeric(18,2) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    total_periods integer NOT NULL,
    balance_account_code text NOT NULL,
    target_account_code text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    amortized_amount numeric(18,2) DEFAULT 0 NOT NULL,
    remaining_amount numeric(18,2) NOT NULL,
    last_amortization_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_contract_dates CHECK ((end_date >= start_date)),
    CONSTRAINT prepaid_and_deferred_contracts_amortized_amount_check CHECK ((amortized_amount >= (0)::numeric)),
    CONSTRAINT prepaid_and_deferred_contracts_contract_type_check CHECK ((contract_type = ANY (ARRAY['PREPAID_EXPENSE'::text, 'DEFERRED_EXPENSE'::text, 'DEFERRED_REVENUE'::text]))),
    CONSTRAINT prepaid_and_deferred_contracts_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'COMPLETED'::text, 'CANCELLED'::text]))),
    CONSTRAINT prepaid_and_deferred_contracts_total_amount_check CHECK ((total_amount > (0)::numeric)),
    CONSTRAINT prepaid_and_deferred_contracts_total_periods_check CHECK ((total_periods > 0)),
    CONSTRAINT prepaid_and_deferred_contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

--
-- Name: tax_settlement_periods; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.tax_settlement_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_number text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    total_taxable_sales numeric(18,2) DEFAULT 0 NOT NULL,
    output_tax_amount numeric(18,2) DEFAULT 0 NOT NULL,
    total_taxable_purchases numeric(18,2) DEFAULT 0 NOT NULL,
    input_tax_amount numeric(18,2) DEFAULT 0 NOT NULL,
    net_tax_payable numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    journal_entry_id uuid,
    settled_at timestamp with time zone,
    settled_by uuid,
    paid_at timestamp with time zone,
    payment_journal_entry_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_tax_period_dates CHECK ((end_date >= start_date)),
    CONSTRAINT tax_settlement_periods_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SETTLED'::text, 'PAID'::text]))),
    CONSTRAINT tax_settlement_periods_settled_by_fkey FOREIGN KEY (settled_by) REFERENCES auth.users(id)
);


--
-- Name: FUNCTION activate_fixed_asset(p_asset_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.activate_fixed_asset(p_asset_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.activate_fixed_asset(p_asset_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.activate_fixed_asset(p_asset_id uuid) TO authenticated;


--
-- Name: FUNCTION activate_prepaid_contract(p_contract_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.activate_prepaid_contract(p_contract_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.activate_prepaid_contract(p_contract_id uuid) TO service_role;


--
-- Name: FUNCTION assert_period_open(p_date date); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.assert_period_open(p_date date) IS 'T-19: يرفض الترحيل داخل فترة مقفلة. التواريخ خارج الفترات المُعرَّفة تُسمح.';

--
-- Name: FUNCTION assert_period_open(p_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.assert_period_open(p_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.assert_period_open(p_date date) TO service_role;


--
-- Name: FUNCTION balance_and_post_return(p_memo text, p_date date, p_source_type text, p_source_id uuid, p_lines jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.balance_and_post_return(p_memo text, p_date date, p_source_type text, p_source_id uuid, p_lines jsonb) IS 'توازن سطور قيد مرتجع (يكتب فرق الهامش على 5911) ثم يسجّل قيدًا مزدوجًا.';

--
-- Name: FUNCTION balance_and_post_return(p_memo text, p_date date, p_source_type text, p_source_id uuid, p_lines jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.balance_and_post_return(p_memo text, p_date date, p_source_type text, p_source_id uuid, p_lines jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.balance_and_post_return(p_memo text, p_date date, p_source_type text, p_source_id uuid, p_lines jsonb) TO service_role;


--
-- Name: FUNCTION close_fiscal_year(p_year integer); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.close_fiscal_year(p_year integer) IS 'T-20: يقفل سنة مالية — 4xxx/5xxx تُصفَّر والنتيجة تُرحَّل إلى 3911 بتاريخ 31/12.';

--
-- Name: FUNCTION close_fiscal_year(p_year integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.close_fiscal_year(p_year integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.close_fiscal_year(p_year integer) TO service_role;

GRANT ALL ON FUNCTION public.close_fiscal_year(p_year integer) TO authenticated;


--
-- Name: FUNCTION create_journal_entry(p_memo text, p_entry_date date, p_source_type text, p_source_id uuid, p_is_system boolean, p_lines jsonb, p_is_reversal boolean); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.create_journal_entry(p_memo text, p_entry_date date, p_source_type text, p_source_id uuid, p_is_system boolean, p_lines jsonb, p_is_reversal boolean) IS 'T-03/T-19: إنشاء قيد مزدوج مع فحص الدور، ومنع اليدوي على حسابات النظام، وسجل تدقيق، ومنع الترحيل في فترة مقفلة.';

--
-- Name: FUNCTION create_journal_entry(p_memo text, p_entry_date date, p_source_type text, p_source_id uuid, p_is_system boolean, p_lines jsonb, p_is_reversal boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_journal_entry(p_memo text, p_entry_date date, p_source_type text, p_source_id uuid, p_is_system boolean, p_lines jsonb, p_is_reversal boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_journal_entry(p_memo text, p_entry_date date, p_source_type text, p_source_id uuid, p_is_system boolean, p_lines jsonb, p_is_reversal boolean) TO service_role;


--
-- Name: FUNCTION dispose_fixed_asset(p_asset_id uuid, p_disposal_date date, p_proceeds numeric, p_proceeds_account text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.dispose_fixed_asset(p_asset_id uuid, p_disposal_date date, p_proceeds numeric, p_proceeds_account text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.dispose_fixed_asset(p_asset_id uuid, p_disposal_date date, p_proceeds numeric, p_proceeds_account text) TO service_role;

GRANT ALL ON FUNCTION public.dispose_fixed_asset(p_asset_id uuid, p_disposal_date date, p_proceeds numeric, p_proceeds_account text) TO authenticated;


--
-- Name: FUNCTION generate_tax_declaration(p_start_date date, p_end_date date); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.generate_tax_declaration(p_start_date date, p_end_date date) IS 'T-23: أرقام الإقرار الضريبي للفترة. تاريخ الفواتير = created_at (لا يوجد invoice_date في المخطط).';

--
-- Name: FUNCTION generate_tax_declaration(p_start_date date, p_end_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.generate_tax_declaration(p_start_date date, p_end_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.generate_tax_declaration(p_start_date date, p_end_date date) TO service_role;

GRANT ALL ON FUNCTION public.generate_tax_declaration(p_start_date date, p_end_date date) TO authenticated;


--
-- Name: FUNCTION open_fiscal_year(p_year integer); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.open_fiscal_year(p_year integer) IS 'T-20: يفتح سنة مالية بإنشاء 12 فترة شهرية. لا قيد افتتاحي — الأرصدة مشتقة من القيود.';

--
-- Name: FUNCTION open_fiscal_year(p_year integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.open_fiscal_year(p_year integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.open_fiscal_year(p_year integer) TO service_role;

GRANT ALL ON FUNCTION public.open_fiscal_year(p_year integer) TO authenticated;


--
-- Name: FUNCTION pay_tax_settlement(p_settlement_id uuid, p_payment_date date, p_payment_account text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.pay_tax_settlement(p_settlement_id uuid, p_payment_date date, p_payment_account text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.pay_tax_settlement(p_settlement_id uuid, p_payment_date date, p_payment_account text) TO service_role;

GRANT ALL ON FUNCTION public.pay_tax_settlement(p_settlement_id uuid, p_payment_date date, p_payment_account text) TO authenticated;


--
-- Name: FUNCTION post_journal_entry(p_entry_date date, p_memo text, p_lines jsonb, p_source_type text, p_source_id uuid, p_entry_number text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_journal_entry(p_entry_date date, p_memo text, p_lines jsonb, p_source_type text, p_source_id uuid, p_entry_number text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_journal_entry(p_entry_date date, p_memo text, p_lines jsonb, p_source_type text, p_source_id uuid, p_entry_number text) TO authenticated;

GRANT ALL ON FUNCTION public.post_journal_entry(p_entry_date date, p_memo text, p_lines jsonb, p_source_type text, p_source_id uuid, p_entry_number text) TO service_role;


--
-- Name: FUNCTION post_opening_balance(_document_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.post_opening_balance(_document_id uuid) IS 'T-11: ترحيل الأرصدة الافتتاحية كاملةً للأستاذ — النقدية والبنوك والأصول والالتزامات ورأس المال لم تعد بلا أثر.';

--
-- Name: FUNCTION post_opening_balance(_document_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_opening_balance(_document_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_opening_balance(_document_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.post_opening_balance(_document_id uuid) TO authenticated;


--
-- Name: FUNCTION post_sales_invoice_cogs(p_invoice_id uuid, p_entry_date date, p_invoice_number text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_sales_invoice_cogs(p_invoice_id uuid, p_entry_date date, p_invoice_number text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_sales_invoice_cogs(p_invoice_id uuid, p_entry_date date, p_invoice_number text) TO service_role;


--
-- Name: FUNCTION post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb) IS 'T-09: تسوية مخزون بقيد أستاذ — نقص Dr 5921/Cr مخزون، فائض Dr مخزون/Cr 5911. (التوقيع والسلوك التشغيلي بلا تغيير — القيد إضافة).';

--
-- Name: FUNCTION post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb) TO authenticated;


--
-- Name: FUNCTION production_inventory_account_code(p_class public.item_class); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_inventory_account_code(p_class public.item_class) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_inventory_account_code(p_class public.item_class) TO service_role;


--
-- Name: FUNCTION required_payment_ledger_accounts(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.required_payment_ledger_accounts() IS 'الحسابات الأربعة التي يعتمد عليها payment_method_ledger_account(). يعرّضها فحص الإصدار وشاشة الإعدادات.';

--
-- Name: FUNCTION required_payment_ledger_accounts(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.required_payment_ledger_accounts() FROM PUBLIC;

GRANT ALL ON FUNCTION public.required_payment_ledger_accounts() TO authenticated;

GRANT ALL ON FUNCTION public.required_payment_ledger_accounts() TO service_role;


--
-- Name: FUNCTION reverse_journal_entry(p_entry_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text) IS 'T-19: عكس قيد مرحَّل. مسموح داخل فترة مقفلة لأنه يُلغي قيدًا ولا ينشئ رقمًا جديدًا.';

--
-- Name: FUNCTION reverse_journal_entry(p_entry_id uuid, p_reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text) TO service_role;

GRANT ALL ON FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION reverse_opening_balance(_document_id uuid, _reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text) TO service_role;

GRANT ALL ON FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION run_batch_amortization(p_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.run_batch_amortization(p_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.run_batch_amortization(p_date date) TO service_role;

GRANT ALL ON FUNCTION public.run_batch_amortization(p_date date) TO authenticated;


--
-- Name: FUNCTION run_batch_depreciation(p_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.run_batch_depreciation(p_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.run_batch_depreciation(p_date date) TO service_role;

GRANT ALL ON FUNCTION public.run_batch_depreciation(p_date date) TO authenticated;


--
-- Name: FUNCTION run_contract_amortization(p_contract_id uuid, p_date date); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.run_contract_amortization(p_contract_id uuid, p_date date) IS 'T-22: توزيع واستهلاك قسط المصروف أو الإيراد المقدم بقيد مزدوج متوازن مع منع التكرار وتحديث الأرصدة.';

--
-- Name: FUNCTION run_contract_amortization(p_contract_id uuid, p_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.run_contract_amortization(p_contract_id uuid, p_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.run_contract_amortization(p_contract_id uuid, p_date date) TO service_role;

GRANT ALL ON FUNCTION public.run_contract_amortization(p_contract_id uuid, p_date date) TO authenticated;


--
-- Name: FUNCTION run_depreciation(p_asset_id uuid, p_date date); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.run_depreciation(p_asset_id uuid, p_date date) IS 'T-21: ترحيل قسط الإهلاك الدوري للأصل الثابت بالقيد المتوازن Dr 5611 / Cr 1491 مع تحديث القيمة الدفترية ومنع التكرار.';

--
-- Name: FUNCTION run_depreciation(p_asset_id uuid, p_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.run_depreciation(p_asset_id uuid, p_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.run_depreciation(p_asset_id uuid, p_date date) TO service_role;

GRANT ALL ON FUNCTION public.run_depreciation(p_asset_id uuid, p_date date) TO authenticated;


--
-- Name: FUNCTION set_period_status(p_period_id uuid, p_status text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.set_period_status(p_period_id uuid, p_status text) IS 'T-19: تغيير حالة الفترة المالية بين OPEN و CLOSED مع فحص الصلاحيات وتسجيل التدقيق.';

--
-- Name: FUNCTION set_period_status(p_period_id uuid, p_status text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_period_status(p_period_id uuid, p_status text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_period_status(p_period_id uuid, p_status text) TO service_role;

GRANT ALL ON FUNCTION public.set_period_status(p_period_id uuid, p_status text) TO authenticated;


--
-- Name: FUNCTION settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date) IS 'T-23: قيد تسوية 2311/1316 والفرق إلى 2321. يرفض النطاق الفارغ والتسوية الصفرية.';

--
-- Name: FUNCTION settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date) TO service_role;

GRANT ALL ON FUNCTION public.settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date) TO authenticated;


--
-- Name: FUNCTION tg_journal_entries_no_delete(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.tg_journal_entries_no_delete() IS 'T-03: يمنع حذف أي قيد — التصحيح يكون بالعكس فقط.';

--
-- Name: FUNCTION tg_journal_entries_no_delete(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_journal_entries_no_delete() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_journal_entries_no_delete() TO service_role;


--
-- Name: accounts accounts_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_code_key UNIQUE (code);

--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts accounts_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY accounts_read_finance ON public.accounts FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: TABLE accounts; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.accounts TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.accounts TO authenticated;


--
-- Name: TABLE amortization_lines; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.amortization_lines IS 'T-22: سجل قيود وأقساط التوزيع الزمني للمصروفات/الإيرادات المقدمة مع منع التكرار.';

--
-- Name: amortization_lines amortization_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.amortization_lines
    ADD CONSTRAINT amortization_lines_pkey PRIMARY KEY (id);

--
-- Name: amortization_lines uq_contract_period_date; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.amortization_lines
    ADD CONSTRAINT uq_contract_period_date UNIQUE (contract_id, period_date);

--
-- Name: ix_amortization_contract; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_amortization_contract ON public.amortization_lines USING btree (contract_id);

--
-- Name: ix_amortization_date; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_amortization_date ON public.amortization_lines USING btree (period_date);

--
-- Name: amortization_lines; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.amortization_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: amortization_lines amortization_lines_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY amortization_lines_read ON public.amortization_lines FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE amortization_lines; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.amortization_lines TO service_role;


--
-- Name: TABLE asset_depreciation_lines; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.asset_depreciation_lines IS 'T-21: سجل قيود وأقساط الإهلاك المحسوبة لكل أصل لمنع التكرار وحفظ الأثر المحاسبي.';

--
-- Name: asset_depreciation_lines asset_depreciation_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.asset_depreciation_lines
    ADD CONSTRAINT asset_depreciation_lines_pkey PRIMARY KEY (id);

--
-- Name: asset_depreciation_lines uq_asset_depreciation_date; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.asset_depreciation_lines
    ADD CONSTRAINT uq_asset_depreciation_date UNIQUE (asset_id, depreciation_date);

--
-- Name: ix_asset_depr_asset; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_asset_depr_asset ON public.asset_depreciation_lines USING btree (asset_id);

--
-- Name: ix_asset_depr_date; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_asset_depr_date ON public.asset_depreciation_lines USING btree (depreciation_date);

--
-- Name: asset_depreciation_lines; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.asset_depreciation_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_depreciation_lines asset_depreciation_lines_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY asset_depreciation_lines_read ON public.asset_depreciation_lines FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE asset_depreciation_lines; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.asset_depreciation_lines TO service_role;

GRANT SELECT ON TABLE public.asset_depreciation_lines TO authenticated;


--
-- Name: TABLE fiscal_periods; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.fiscal_periods IS 'T-19: الفترات المالية. فترة مقفلة تمنع أي قيد جديد بتاريخها، وتُقفل بعد إقفال سنتها لا قبلها.';

--
-- Name: fiscal_periods fiscal_period_no_overlap; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_period_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]'::text) WITH &&);

--
-- Name: fiscal_periods fiscal_period_unique_span; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_period_unique_span UNIQUE (start_date, end_date);

--
-- Name: fiscal_periods fiscal_periods_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_code_key UNIQUE (code);

--
-- Name: fiscal_periods fiscal_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_pkey PRIMARY KEY (id);

--
-- Name: ix_fiscal_periods_dates; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_fiscal_periods_dates ON public.fiscal_periods USING btree (start_date, end_date);

--
-- Name: ix_fiscal_periods_year; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_fiscal_periods_year ON public.fiscal_periods USING btree (fiscal_year, period_no);

--
-- Name: fiscal_periods; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: fiscal_periods fiscal_periods_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY fiscal_periods_read ON public.fiscal_periods FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE fiscal_periods; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.fiscal_periods TO service_role;


--
-- Name: TABLE fixed_assets; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.fixed_assets IS 'T-21: الأصول الثابتة للمنشأة ومتابعة قيمتها الدفترية ومجمع إهلاكها ودورة حياتها.';

--
-- Name: fixed_assets fixed_assets_asset_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_asset_code_key UNIQUE (asset_code);

--
-- Name: fixed_assets fixed_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_pkey PRIMARY KEY (id);

--
-- Name: ix_fixed_assets_code; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_fixed_assets_code ON public.fixed_assets USING btree (asset_code);

--
-- Name: ix_fixed_assets_status; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_fixed_assets_status ON public.fixed_assets USING btree (status);

--
-- Name: fixed_assets; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_assets fixed_assets_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY fixed_assets_insert ON public.fixed_assets FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: fixed_assets fixed_assets_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY fixed_assets_read ON public.fixed_assets FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: fixed_assets fixed_assets_update; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY fixed_assets_update ON public.fixed_assets FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE fixed_assets; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.fixed_assets TO service_role;

GRANT SELECT ON TABLE public.fixed_assets TO authenticated;


--
-- Name: invoice_ledger_status; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.invoice_ledger_status WITH (security_invoker='true') AS
 SELECT si.id AS invoice_id,
    si.invoice_number,
    (si.status)::text AS invoice_status,
    si.total,
    si.paid,
    si.tax,
    (si.payment_method)::text AS payment_method,
    je.id AS journal_entry_id,
    je.entry_number,
        CASE
            WHEN (je.id IS NOT NULL) THEN 'POSTED'::text
            WHEN (si.status = ANY (ARRAY['draft'::public.invoice_status, 'cancelled'::public.invoice_status])) THEN 'NEVER_POSTS'::text
            ELSE 'NOT_POSTED'::text
        END AS ledger_state,
        CASE
            WHEN ((je.id IS NOT NULL) AND (je.total_debit <> je.total_credit)) THEN 'UNBALANCED'::text
            ELSE 'OK'::text
        END AS integrity
   FROM (public.sales_invoices si
     LEFT JOIN public.journal_entries je ON (((je.source_type = 'sales_invoice'::text) AND (je.source_id = si.id) AND (je.status <> 'REVERSED'::text))));

--
-- Name: purchase_ledger_status; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.purchase_ledger_status WITH (security_invoker='true') AS
 SELECT pi.id AS invoice_id,
    pi.invoice_number,
    (pi.status)::text AS invoice_status,
    pi.total,
    pi.paid,
    (pi.payment_method)::text AS payment_method,
    je.id AS journal_entry_id,
    je.entry_number,
        CASE
            WHEN (je.id IS NOT NULL) THEN 'POSTED'::text
            WHEN (pi.status = ANY (ARRAY['draft'::public.invoice_status, 'cancelled'::public.invoice_status])) THEN 'NEVER_POSTS'::text
            ELSE 'NOT_POSTED'::text
        END AS ledger_state
   FROM (public.purchase_invoices pi
     LEFT JOIN public.journal_entries je ON (((je.source_type = 'purchase_invoice'::text) AND (je.source_id = pi.id) AND (je.status <> 'REVERSED'::text))));

--
-- Name: journal_entries journal_entries_entry_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_entry_number_key UNIQUE (entry_number);

--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);

--
-- Name: ix_journal_date; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_journal_date ON public.journal_entries USING btree (entry_date DESC);

--
-- Name: ix_journal_source; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_journal_source ON public.journal_entries USING btree (source_type, source_id);

--
-- Name: uq_journal_source_active; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_journal_source_active ON public.journal_entries USING btree (source_type, source_id) WHERE ((source_id IS NOT NULL) AND (status <> 'REVERSED'::text));

--
-- Name: INDEX uq_journal_source_active; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON INDEX public.uq_journal_source_active IS 'T-02: قيد واحد نشط لكل مستند مصدر — منع الترحيل المزدوج بنيويًا.';

--
-- Name: journal_entries journal_entries_no_delete; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.tg_journal_entries_no_delete();

--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries journal_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY journal_read_finance ON public.journal_entries FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: TABLE journal_entries; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.journal_entries TO service_role;

GRANT SELECT ON TABLE public.journal_entries TO authenticated;

--
-- Name: next_journal_number(date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_journal_number(p_date date) RETURNS text
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  SELECT 'JE-' || to_char(p_date, 'YYYYMMDD') || '-' ||
         lpad(nextval('public.journal_entry_seq')::text, 4, '0')
$$;


--
-- Name: SEQUENCE journal_entry_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.journal_entry_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.journal_entry_seq TO authenticated;

--
-- Name: get_chart_of_accounts_tree(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.get_chart_of_accounts_tree() RETURNS TABLE(id uuid, code character varying, name_ar text, account_type public.account_type, parent_id uuid, parent_code character varying, level integer, is_postable boolean, is_system boolean, is_active boolean, notes text, total_debit numeric, total_credit numeric, current_balance numeric, children_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH RECURSIVE coa_tree AS (
    -- الجذور (المستوى 1: الأصول، الخصوم، حقوق الملكية، الإيرادات، المصروفات)
    SELECT
      a.id,
      a.code,
      a.name_ar,
      a.account_type,
      a.parent_id,
      CAST(NULL AS varchar(20)) AS parent_code,
      1 AS level,
      a.is_postable,
      a.is_system,
      a.is_active,
      a.notes,
      ARRAY[a.code::text] AS path
    FROM public.accounts a
    WHERE a.parent_id IS NULL

    UNION ALL

    -- الأبناء بالتكرار
    SELECT
      c.id,
      c.code,
      c.name_ar,
      c.account_type,
      c.parent_id,
      p.code AS parent_code,
      p.level + 1 AS level,
      c.is_postable,
      c.is_system,
      c.is_active,
      c.notes,
      p.path || c.code::text AS path
    FROM public.accounts c
    JOIN coa_tree p ON c.parent_id = p.id
  ),
  account_balances AS (
    -- مجاميع القيود المرحلة من دفتر اليومية لكل حساب
    SELECT
      jl.account_id,
      round(coalesce(sum(jl.debit), 0), 2) AS debit,
      round(coalesce(sum(jl.credit), 0), 2) AS credit
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id AND je.status = 'POSTED'
    GROUP BY jl.account_id
  ),
  children_counts AS (
    SELECT parent_id, count(*) AS cnt
    FROM public.accounts
    WHERE parent_id IS NOT NULL
    GROUP BY parent_id
  )
  SELECT
    t.id,
    t.code,
    t.name_ar,
    t.account_type,
    t.parent_id,
    t.parent_code,
    t.level,
    t.is_postable,
    t.is_system,
    t.is_active,
    t.notes,
    coalesce(ab.debit, 0) AS total_debit,
    coalesce(ab.credit, 0) AS total_credit,
    CASE
      -- طبيعة مدينة للأصول والمصروفات: مدين - دائن
      WHEN t.account_type IN ('ASSET', 'EXPENSE') THEN
        round(coalesce(ab.debit, 0) - coalesce(ab.credit, 0), 2)
      -- طبيعة دائنة للخصوم وحقوق الملكية والإيرادات: دائن - مدين
      ELSE
        round(coalesce(ab.credit, 0) - coalesce(ab.debit, 0), 2)
    END AS current_balance,
    coalesce(cc.cnt, 0) AS children_count
  FROM coa_tree t
  LEFT JOIN account_balances ab ON ab.account_id = t.id
  LEFT JOIN children_counts cc ON cc.parent_id = t.id
  ORDER BY t.code ASC;
$$;


--
-- Name: trial_balance; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.trial_balance WITH (security_invoker='true') AS
 WITH posted AS (
         SELECT jl.account_id,
            jl.debit,
            jl.credit
           FROM (public.journal_lines jl
             JOIN public.journal_entries je ON ((je.id = jl.entry_id)))
          WHERE (je.status = ANY (ARRAY['POSTED'::text, 'REVERSED'::text]))
        )
 SELECT a.code,
    a.name_ar,
    a.account_type,
    round(COALESCE(sum(p.debit), (0)::numeric), 2) AS total_debit,
    round(COALESCE(sum(p.credit), (0)::numeric), 2) AS total_credit,
    round(COALESCE(sum((p.debit - p.credit)), (0)::numeric), 2) AS balance,
    round((COALESCE(sum((p.debit - p.credit)), (0)::numeric) * (
        CASE
            WHEN (a.account_type = ANY (ARRAY['ASSET'::public.account_type, 'EXPENSE'::public.account_type])) THEN 1
            ELSE '-1'::integer
        END)::numeric), 2) AS natural_balance
   FROM (public.accounts a
     LEFT JOIN posted p ON ((p.account_id = a.id)))
  WHERE a.is_active
  GROUP BY a.id, a.code, a.name_ar, a.account_type
 HAVING ((COALESCE(sum(p.debit), (0)::numeric) > (0)::numeric) OR (COALESCE(sum(p.credit), (0)::numeric) > (0)::numeric));

--
-- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);

--
-- Name: ix_journal_lines_account; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_journal_lines_account ON public.journal_lines USING btree (account_id);

--
-- Name: ix_journal_lines_entry; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_journal_lines_entry ON public.journal_lines USING btree (entry_id);

--
-- Name: journal_lines; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_lines journal_lines_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY journal_lines_read_finance ON public.journal_lines FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: TABLE journal_lines; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.journal_lines TO service_role;

GRANT SELECT ON TABLE public.journal_lines TO authenticated;


--
-- Name: TABLE prepaid_and_deferred_contracts; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.prepaid_and_deferred_contracts IS 'T-22: إدارة عقود المصروفات والإيرادات المقدمة والمؤجلة وتوزيعها على الفترات المحاسبية.';

--
-- Name: prepaid_and_deferred_contracts prepaid_and_deferred_contracts_contract_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.prepaid_and_deferred_contracts
    ADD CONSTRAINT prepaid_and_deferred_contracts_contract_number_key UNIQUE (contract_number);

--
-- Name: prepaid_and_deferred_contracts prepaid_and_deferred_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.prepaid_and_deferred_contracts
    ADD CONSTRAINT prepaid_and_deferred_contracts_pkey PRIMARY KEY (id);

--
-- Name: ix_prepaid_status; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_prepaid_status ON public.prepaid_and_deferred_contracts USING btree (status);

--
-- Name: ix_prepaid_type; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_prepaid_type ON public.prepaid_and_deferred_contracts USING btree (contract_type);

--
-- Name: prepaid_and_deferred_contracts; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.prepaid_and_deferred_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: prepaid_and_deferred_contracts prepaid_contracts_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY prepaid_contracts_read ON public.prepaid_and_deferred_contracts FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: prepaid_and_deferred_contracts prepaid_contracts_write; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY prepaid_contracts_write ON public.prepaid_and_deferred_contracts TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE prepaid_and_deferred_contracts; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.prepaid_and_deferred_contracts TO service_role;


--
-- Name: TABLE tax_settlement_periods; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.tax_settlement_periods IS 'T-23: سجل الإقرارات والتسويات الضريبية الدورية وقيد التسوية 2311 مقابل 1316 وسداد 2321.';

--
-- Name: tax_settlement_periods tax_settlement_periods_period_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.tax_settlement_periods
    ADD CONSTRAINT tax_settlement_periods_period_number_key UNIQUE (period_number);

--
-- Name: tax_settlement_periods tax_settlement_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.tax_settlement_periods
    ADD CONSTRAINT tax_settlement_periods_pkey PRIMARY KEY (id);

--
-- Name: ix_tax_settlement_dates; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_tax_settlement_dates ON public.tax_settlement_periods USING btree (start_date, end_date);

--
-- Name: ix_tax_settlement_status; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_tax_settlement_status ON public.tax_settlement_periods USING btree (status);

--
-- Name: tax_settlement_periods; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.tax_settlement_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_settlement_periods tax_settlements_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY tax_settlements_read ON public.tax_settlement_periods FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: tax_settlement_periods tax_settlements_write; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY tax_settlements_write ON public.tax_settlement_periods TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE tax_settlement_periods; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tax_settlement_periods TO service_role;


--
-- Name: TABLE invoice_ledger_status; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.invoice_ledger_status TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.invoice_ledger_status TO service_role;


--
-- Name: TABLE purchase_ledger_status; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.purchase_ledger_status TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_ledger_status TO service_role;


--
-- Name: FUNCTION next_journal_number(p_date date); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.next_journal_number(p_date date) IS 'T-04: رقم القيد من تسلسل ذري journal_entry_seq — بلا اصطدام تحت التزامن.';

--
-- Name: FUNCTION next_journal_number(p_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_journal_number(p_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_journal_number(p_date date) TO service_role;


--
-- Name: FUNCTION get_chart_of_accounts_tree(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.get_chart_of_accounts_tree() IS 'T-25: استخراج الشجرة الهرمية الكاملة لدليل الحسابات مع مستويات التفرع، ومجاميع القيود، والأرصدة حسب طبيعة الحساب.';

--
-- Name: FUNCTION get_chart_of_accounts_tree(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.get_chart_of_accounts_tree() FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_chart_of_accounts_tree() TO service_role;

GRANT ALL ON FUNCTION public.get_chart_of_accounts_tree() TO authenticated;


--
-- Name: TABLE trial_balance; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.trial_balance TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.trial_balance TO service_role;
