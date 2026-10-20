CREATE OR REPLACE FUNCTION public.settle_tax_period(p_start_date date, p_end_date date, p_period_number text, p_settlement_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may settle taxes';
  END IF;

  PERFORM public.assert_period_open(p_settlement_date);

  IF EXISTS (
    SELECT 1 FROM public.tax_settlement_periods
     WHERE period_number = p_period_number
  ) THEN
    RAISE EXCEPTION 'Tax period % already exists or settled', p_period_number;
  END IF;

  -- قراءة أرقام الإقرار
  v_decl := public.generate_tax_declaration(p_start_date, p_end_date);
  v_sales      := (v_decl->>'taxable_sales')::numeric;
  v_output_tax := (v_decl->>'output_tax')::numeric;
  v_purch      := (v_decl->>'taxable_purchases')::numeric;
  v_input_tax  := (v_decl->>'input_tax')::numeric;
  v_net_tax    := (v_decl->>'net_tax_payable')::numeric;

  IF v_output_tax = 0 AND v_input_tax = 0 THEN
    RAISE EXCEPTION 'لا توجد حركات ضريبية مرحّلة للفترة المحددة لتسويتها';
  END IF;

  -- بناء قيد التسوية المتوازن:
  -- 1) تصفير ضريبة المخرجات: Dr 2311 بمقدار رصيدها
  IF v_output_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2311',
        'debit', v_output_tax,
        'credit', 0,
        'memo', 'تسوية ضريبة المخرجات للفترة ' || p_period_number
      )
    );
  END IF;

  -- 2) تصفير ضريبة المدخلات: Cr 1316 بمقدار رصيدها
  IF v_input_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '1316',
        'debit', 0,
        'credit', v_input_tax,
        'memo', 'تسوية ضريبة المدخلات للفترة ' || p_period_number
      )
    );
  END IF;

  -- 3) حساب صافي الضريبة المستحقة (2321):
  IF v_net_tax > 0 THEN
    -- التزام مستحق الدفع للهيئة: Cr 2321
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321',
        'debit', 0,
        'credit', v_net_tax,
        'memo', 'صافي ضريبة القيمة المضافة المستحقة للدفع — ' || p_period_number
      )
    );
  ELSIF v_net_tax < 0 THEN
    -- رصيد دائن مسترد للمنشأة: Dr 2321
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321',
        'debit', -v_net_tax,
        'credit', 0,
        'memo', 'رصيد ضريبة مدخلات فائض مسترد/مرحل — ' || p_period_number
      )
    );
  END IF;

  v_memo := 'قيد التسوية والإقرار الضريبي للفترة ' || p_period_number ||
            ' (' || to_char(p_start_date, 'YYYY-MM-DD') || ' إلى ' || to_char(p_end_date, 'YYYY-MM-DD') || ')';

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_settlement_date,
    'tax_settlement',
    NULL,
    true,
    v_lines,
    false
  );

  INSERT INTO public.tax_settlement_periods (
    period_number, start_date, end_date, total_taxable_sales,
    output_tax_amount, total_taxable_purchases, input_tax_amount,
    net_tax_payable, status, journal_entry_id, settled_at, settled_by
  )
  VALUES (
    p_period_number, p_start_date, p_end_date, v_sales,
    v_output_tax, v_purch, v_input_tax,
    v_net_tax, 'SETTLED', v_entry_id, now(), v_user
  )
  RETURNING id INTO v_settle_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'tax.settled', 'tax_settlement', v_settle_id,
          jsonb_build_object('period_number', p_period_number, 'net_tax', v_net_tax, 'entry_id', v_entry_id));

  RETURN v_settle_id;
END $function$
