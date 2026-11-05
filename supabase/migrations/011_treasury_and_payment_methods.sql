-- ============================================================================
-- الترحيل 011_treasury_and_payment_methods.sql — مجال: treasury_and_payment_methods
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: assert_split_payment_document_balance(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.assert_split_payment_document_balance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_document_id uuid := (to_jsonb(NEW) ->> 'id')::uuid;
  v_method text := to_jsonb(NEW) ->> 'payment_method';
  v_paid numeric := round(coalesce((to_jsonb(NEW) ->> 'paid')::numeric, 0), 2);
  v_count integer;
  v_split_total numeric;
  v_single_method text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) ->> 'payment_method') IS NOT DISTINCT FROM v_method THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] = 'sales' THEN
    SELECT count(*), round(coalesce(sum(amount), 0), 2), min(method::text)
      INTO v_count, v_split_total, v_single_method
      FROM public.customer_payment_splits
     WHERE invoice_id = v_document_id;
  ELSIF TG_ARGV[0] = 'purchases' THEN
    SELECT count(*), round(coalesce(sum(amount), 0), 2), min(method::text)
      INTO v_count, v_split_total, v_single_method
      FROM public.payment_splits
     WHERE document_type = 'purchase_invoice'
       AND document_id = v_document_id;
  ELSE
    RAISE EXCEPTION 'Unknown split payment document type: %', TG_ARGV[0]
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_method = 'split' AND v_count < 2 THEN
    RAISE EXCEPTION 'A split payment document requires at least two tender rows'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_method = 'split' AND v_split_total <> v_paid THEN
    RAISE EXCEPTION 'Split tender total (%) must equal document paid amount (%)',
      v_split_total, v_paid
      USING ERRCODE = 'check_violation';
  END IF;
  -- Older clients may mirror a single scalar payment as one tender row. It is
  -- safe only when method and total both exactly match the document fields.
  IF v_method IS DISTINCT FROM 'split' AND v_count = 1
     AND v_split_total = v_paid AND v_single_method = v_method THEN
    RETURN NEW;
  END IF;
  IF v_method IS DISTINCT FROM 'split' AND v_count > 0 THEN
    RAISE EXCEPTION 'Tender rows require the document payment method to be split'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

--
-- Name: bounce_cheque(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.bounce_cheque(p_cheque_id uuid, p_reason text DEFAULT 'عدم كفاية الرصيد'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cheque record;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
  ) THEN
    RAISE EXCEPTION 'Only accountant, manager or owner may mark cheques as bounced';
  END IF;

  SELECT * INTO v_cheque
  FROM public.cheques_register
  WHERE id = p_cheque_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;

  IF v_cheque.status <> 'UNDER_COLLECTION' THEN
    RAISE EXCEPTION 'Cannot bounce cheque in status %', v_cheque.status;
  END IF;

  -- قيد الارتداد: إعادة المديونية للعميل وإلغاء ورقة القبض
  -- Dr 1211 (ذمم العملاء) / Cr 1221 (أوراق قبض)
  IF v_cheque.customer_id IS NOT NULL THEN
    v_lines := v_lines
      || jsonb_build_object(
        'account_code', '1211',
        'debit', v_cheque.amount,
        'memo', 'ارتداد شيك رقم ' || v_cheque.cheque_number || ' — ' || coalesce(p_reason, '')
      )
      || jsonb_build_object(
        'account_code', '1221',
        'credit', v_cheque.amount,
        'memo', 'إلغاء ورقة قبض لشيك مرتد رقم ' || v_cheque.cheque_number
      );

    v_journal := public.create_journal_entry(
      'ارتداد شيك رقم ' || v_cheque.cheque_number || ' — ' || coalesce(p_reason, ''),
      CURRENT_DATE,
      'cheque_bounce',
      v_cheque.id,
      true,
      v_lines
    );

    -- تسجيل حركة مدينة في كشف حساب العميل
    INSERT INTO public.customer_ledger(
      customer_id, entry_type, debit, reference_id, reference_type, occurred_at, created_by, source_key, note
    )
    VALUES (
      v_cheque.customer_id, 'adjustment', v_cheque.amount, v_cheque.id, 'cheque_bounce',
      now(), v_user, 'cheque_bounce:' || v_cheque.id, 'ارتداد شيك رقم ' || v_cheque.cheque_number
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  UPDATE public.cheques_register
  SET status = 'BOUNCED',
      notes = coalesce(notes || ' | ', '') || 'مرتد: ' || coalesce(p_reason, ''),
      updated_at = now()
  WHERE id = p_cheque_id;

  RETURN jsonb_build_object(
    'cheque_id', p_cheque_id,
    'cheque_number', v_cheque.cheque_number,
    'status', 'BOUNCED',
    'journal_id', v_journal
  );
END;
$$;

--
-- Name: can_author_payment_methods(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.can_author_payment_methods() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_platform_superadmin(auth.uid())
      OR public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'manager');
$$;

--
-- Name: clear_cheque(uuid, uuid, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.clear_cheque(p_cheque_id uuid, p_clearing_bank_account_id uuid, p_cleared_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cheque record;
  v_bank_code text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
  ) THEN
    RAISE EXCEPTION 'Only accountant, manager or owner may clear cheques';
  END IF;

  SELECT * INTO v_cheque
  FROM public.cheques_register
  WHERE id = p_cheque_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;

  IF v_cheque.status <> 'UNDER_COLLECTION' THEN
    RAISE EXCEPTION 'Cheque % is already %', v_cheque.cheque_number, v_cheque.status;
  END IF;

  -- كود الحساب البنكي المودع فيه
  SELECT a.code INTO v_bank_code
  FROM public.company_bank_accounts b
  JOIN public.accounts a ON a.id = b.account_id
  WHERE b.id = p_clearing_bank_account_id;

  IF v_bank_code IS NULL THEN
    RAISE EXCEPTION 'Selected clearing bank account has no valid ledger account';
  END IF;

  -- قيد التحصيل: من حـ/ البنك إلى حـ/ أوراق قبض
  v_lines := v_lines
    || jsonb_build_object(
      'account_code', v_bank_code,
      'debit', v_cheque.amount,
      'memo', 'تحصيل وإيداع شيك رقم ' || v_cheque.cheque_number
    )
    || jsonb_build_object(
      'account_code', '1221',
      'credit', v_cheque.amount,
      'memo', 'إقفال أوراق قبض — شيك رقم ' || v_cheque.cheque_number
    );

  v_journal := public.create_journal_entry(
    'تحصيل شيك مصرفي رقم ' || v_cheque.cheque_number || ' — ' || coalesce(p_notes, ''),
    coalesce(p_cleared_date, CURRENT_DATE),
    'cheque_clearing',
    v_cheque.id,
    true,
    v_lines
  );

  UPDATE public.cheques_register
  SET status = 'CLEARED',
      clearing_bank_account_id = p_clearing_bank_account_id,
      clearing_journal_entry_id = v_journal,
      cleared_at = coalesce(p_cleared_date, CURRENT_DATE)::timestamptz,
      notes = coalesce(notes || ' | ', '') || coalesce(p_notes, 'تم التحصيل بالبنك'),
      updated_at = now()
  WHERE id = p_cheque_id;

  RETURN jsonb_build_object(
    'cheque_id', p_cheque_id,
    'cheque_number', v_cheque.cheque_number,
    'status', 'CLEARED',
    'journal_id', v_journal
  );
END;
$$;

--
-- Name: create_tenant_payment_method(text, text, text, text, text, text[], boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_tenant_payment_method(p_name_ar text, p_name_en text, p_icon_key text, p_legacy_id text, p_ledger_kind text, p_contexts text[] DEFAULT NULL::text[], p_requires_reference boolean DEFAULT true) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_name        text;
  v_name_en     text;
  v_legacy      text;
  v_kind        text;
  v_contexts    text[];
  v_base        text;
  v_next_order  integer;
  v_auto_id     text;
  v_suffix      integer := 1;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية إضافة طرق دفع — هذه الصلاحية لصاحب المنشأة والمدير وسوبر أدمن المنصة'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := public.payment_method_clean_label(p_name_ar);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'اسم طريقة الدفع مطلوب' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_name) > 60 THEN
    RAISE EXCEPTION 'اسم طريقة الدفع طويل جداً (الحد 60 حرفاً)'
      USING ERRCODE = 'check_violation';
  END IF;
  v_name_en := public.payment_method_clean_label(p_name_en);
  IF v_name_en IS NOT NULL AND length(v_name_en) > 60 THEN
    RAISE EXCEPTION 'الاسم الإنجليزي طويل جداً (الحد 60 حرفاً)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- أربع قيم فقط: الثلاث المعتمدة للتحصيل، مع `card` و`cheque` باقيتين للتوافق
  -- مع صفوف قديمة. ما تغيّر عن الترحيل 16 هو مسار التجزئة أدناه، لا هذه القائمة.
  v_legacy := lower(btrim(coalesce(p_legacy_id, '')));
  IF v_legacy NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
    RAISE EXCEPTION
      'القيمة المخزّنة "%" غير متاحة لطريقة تنشئها المنشأة (المتاح: cash, bank_transfer, mobile_money)',
      coalesce(p_legacy_id, '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;

  -- العائلة تتبع القيمة المخزّنة، ولا تُقبل من المتصفح.
  v_kind := CASE v_legacy
              WHEN 'cash'           THEN 'CASH'
              WHEN 'bank_transfer'  THEN 'BANK'
              WHEN 'mobile_money'   THEN 'WALLET'
            END;

  v_contexts := coalesce(
    p_contexts,
    ARRAY['pos','sales','purchases','expenses','customer_collection']::text[]
  );
  IF NOT (v_contexts <@ ARRAY[
    'pos','sales','purchases','expenses','customer_collection',
    'sales_returns','purchase_returns']::text[]) THEN
    RAISE EXCEPTION 'أحد الأقسام المختارة غير معروف'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_methods m
     WHERE m.is_active
       AND lower(btrim(m.name_ar)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'توجد طريقة دفع مفعّلة بهذا الاسم: %', v_name
      USING ERRCODE = 'unique_violation';
  END IF;

  -- نفس اشتقاق الترحيل 16: الاسم الإنجليزي أولًا، وإلا معرّف الكتالوج المرجعي
  -- للقيمة المخزّنة، وإلا بادئة محايدة. الاسم العربي لا يُستخدم حرفيًا لأن قيد
  -- الجدول يشترط أن يكون المعرّف لاتينيًا صغيرًا.
  v_base := regexp_replace(lower(coalesce(v_name_en, '')), '[^a-z0-9]+', '_', 'g');
  v_base := btrim(coalesce(v_base, ''), '_');

  IF v_base = '' THEN
    SELECT regexp_replace(lower(m.id), '[^a-z0-9]+', '_', 'g')
      INTO v_base
    FROM public.payment_methods m
    WHERE m.id = public.payment_method_resolve_id(v_legacy);

    v_base := btrim(coalesce(v_base, ''), '_');
  END IF;

  IF v_base = '' THEN
    v_base := 'tenant_' || nullif(btrim(v_legacy, '_'), '');
  END IF;

  -- 🔒 مفتاح واحد لكل معرّف يُشتق من هذا الاسم. بدونه يقرأ طلبان متزامنان
  --    «غير موجود» فيختاران نفس المعرّف، فينجح أحدهما ويفشل الآخر بقيد التفرّد.
  PERFORM pg_advisory_xact_lock(hashtext('payment_method_id:' || v_base));

  v_auto_id := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payment_methods m WHERE m.id = v_auto_id);
    v_suffix := v_suffix + 1;
    v_auto_id := v_base || '_' || v_suffix::text;
  END LOOP;

  -- يُرتَّب بعد آخر صف قائم، فتظهر الطريقة المضافة حديثًا في نهاية ترتيب المشغّل.
  SELECT coalesce(max(m.sort_order), 100) + 10
    INTO v_next_order
    FROM public.payment_methods m;

  INSERT INTO public.payment_methods (
    id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
    ledger_kind, default_account_code, is_credit_term, requires_reference,
    legacy_ids, legacy_id, default_ledger_kind, is_system, created_by, notes
  ) VALUES (
    v_auto_id,
    v_name,
    v_name_en,
    coalesce(public.payment_method_clean_label(p_icon_key), 'wallet'),
    true,
    v_next_order,
    v_contexts,
    v_kind,
    public.payment_method_ledger_account(v_legacy),
    false,
    coalesce(p_requires_reference, true),
    ARRAY[]::text[],
    v_legacy,
    v_kind,
    false,
    v_user,
    'طريقة دفع أنشأتها المنشأة.'
  );

  -- صف في الإعدادات أيضًا، فتصير الطريقة الجديدة قابلة للتعديل فورًا وتحمل
  -- الأقسام نفسها التي حصل عليها صف الكتالوج.
  INSERT INTO public.payment_method_settings (
    payment_method_id, enabled, sort_order, enabled_contexts, created_by
  )
  SELECT m.id, true, m.sort_order, m.allowed_contexts, v_user
  FROM public.payment_methods m
  WHERE m.id = v_auto_id
  ON CONFLICT (payment_method_id) DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, payload)
  VALUES (
    v_user, 'payment_method.created', 'payment_method',
    jsonb_build_object(
      'id', v_auto_id, 'name_ar', v_name, 'legacy_id', v_legacy,
      'ledger_kind', v_kind, 'contexts', v_contexts,
      'by_platform', public.is_platform_superadmin(v_user)
    ));

  RETURN v_auto_id;
END $$;

--
-- Name: derive_payment_status(numeric, numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.derive_payment_status(p_paid numeric, p_total numeric) RETURNS public.payment_status
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN coalesce(p_total, 0) <= 0            THEN 'unpaid'::public.payment_status
    WHEN coalesce(p_paid, 0) <= 0             THEN 'unpaid'::public.payment_status
    WHEN p_paid >= p_total - 0.005            THEN 'paid'::public.payment_status
    ELSE 'partial'::public.payment_status
  END
$$;

--
-- Name: guard_four_payment_method_catalogue(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_four_payment_method_catalogue() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: guard_four_payment_method_write(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_four_payment_method_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_method text := nullif(lower(btrim(to_jsonb(NEW) ->> TG_ARGV[0])), '');
  v_method_id text;
  v_context text := TG_ARGV[2];
  v_old_method text;
  v_old_id text;
  v_allow_split boolean := coalesce(TG_ARGV[3], 'false')::boolean;
  v_allow_credit boolean := coalesce(TG_ARGV[4], 'false')::boolean;
  v_resolved text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_method := nullif(lower(btrim(to_jsonb(OLD) ->> TG_ARGV[0])), '');
    IF TG_ARGV[1] <> '' THEN
      v_old_id := nullif(to_jsonb(OLD) ->> TG_ARGV[1], '');
    END IF;
  END IF;
  IF TG_ARGV[1] <> '' THEN
    v_method_id := nullif(to_jsonb(NEW) ->> TG_ARGV[1], '');
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_method IS NOT DISTINCT FROM v_old_method
     AND v_method_id IS NOT DISTINCT FROM v_old_id THEN
    RETURN NEW;
  END IF;

  IF v_method IS NULL AND v_method_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_method IS NULL THEN
    RAISE EXCEPTION 'A catalogue ID cannot be supplied without a stored payment method'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_method = 'split' AND v_allow_split THEN
    IF v_method_id IS NOT NULL AND v_method_id <> 'split' THEN
      RAISE EXCEPTION 'The split document state cannot use a tender catalogue ID'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF v_method = 'credit' AND NOT v_allow_credit THEN
    RAISE EXCEPTION 'Credit is not a tender for this transaction type'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_context = 'document' THEN
    v_context := CASE to_jsonb(NEW) ->> 'document_type'
      WHEN 'purchase_invoice' THEN 'purchases'
      WHEN 'milling_service_document' THEN 'sales'
      ELSE NULL
    END;
  END IF;
  v_resolved := public.resolve_writable_payment_method(
    coalesce(v_method_id, v_method), v_context, true
  );
  IF v_resolved IS DISTINCT FROM v_method THEN
    RAISE EXCEPTION 'Payment method identity does not match stored value (%)', v_method
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

--
-- Name: guard_split_tender_approved(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_split_tender_approved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_method    text := lower(btrim(coalesce(to_jsonb(NEW) ->> TG_ARGV[0], '')));
  v_old       text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := lower(btrim(coalesce(to_jsonb(OLD) ->> TG_ARGV[0], '')));
    IF v_method IS NOT DISTINCT FROM v_old THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ثلاث قنوات، لا «كل ما ليس البطاقة»: القائمة المسموحة تُغلق الباب على أي
  -- قيمة تاريخية أخرى (cheque) تُدخل من مسار RPC قديم.
  IF v_method NOT IN ('cash', 'bank_transfer', 'mobile_money') THEN
    RAISE EXCEPTION
      'قناة الدفع المجزأ "%" غير معتمدة. القنوات: نقداً، تحويل بنكي، محفظة إلكترونية.',
      coalesce(nullif(v_method, ''), '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

--
-- Name: payment_method_clean_label(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_clean_label(p_label text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT nullif(btrim(coalesce(p_label, '')), '');
$$;

--
-- Name: payment_method_settings_guard(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_settings_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_allowed text[];
BEGIN
  IF NEW.payment_method_id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money') THEN
    RAISE EXCEPTION 'Only the four approved payment methods may have settings: %', NEW.payment_method_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT allowed_contexts INTO v_allowed
    FROM public.payment_methods
   WHERE id = NEW.payment_method_id AND is_active = true;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'Payment method is missing or inactive: %', NEW.payment_method_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.enabled_contexts IS NOT NULL AND NOT (NEW.enabled_contexts <@ v_allowed) THEN
    RAISE EXCEPTION 'Payment method contexts exceed the catalogue policy: %', NEW.payment_method_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

--
-- Name: payment_methods_authoring_guard(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_methods_authoring_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  -- مشغّل الترحيلات ومفتاح خدمة المنصة لا يقيّدهما هذا الحكم: فهما المطورون،
  -- وهذا الـtrigger موجود أصلًا ليتسنّى لهما تغيير البذرة.
  IF v_user IS NULL OR public.is_platform_superadmin(v_user) THEN
    RETURN NEW;
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل طرق الدفع'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3.1 صف المطور ليس ملك المنشأة لتثريه. يمكنها إعادة تسميته وتغيير أيقونته؛
  --     وكل عمود يقرّر كيف تتحرّك الأموال مجمّد.
  IF OLD.is_system THEN
    IF NEW.ledger_kind   IS DISTINCT FROM OLD.ledger_kind
       OR NEW.legacy_id  IS DISTINCT FROM OLD.legacy_id
       OR NEW.is_system  IS DISTINCT FROM OLD.is_system
       OR NEW.is_active  IS DISTINCT FROM OLD.is_active
       OR NEW.legacy_ids IS DISTINCT FROM OLD.legacy_ids
       OR NEW.id         IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION
        'لا يمكن تغيير طبيعة طريقة دفع نظامية (%) — يمكن تعديل الاسم والأيقونة والترتيب فقط',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- 3.2 A tenant row is theirs, but its shape is still the platform's.
  IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'لا يمكن ترقية طريقة دفع إلى نظامية من الواجهة'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.ledger_kind NOT IN ('CASH','BANK','WALLET','CARD','OTHER') THEN
    RAISE EXCEPTION 'نوع الحساب "%" غير متاح لطريقة دفع تنشئها المنشأة', NEW.ledger_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

--
-- Name: payment_methods_delete_guard(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_methods_delete_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR public.is_platform_superadmin(v_user) THEN
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    RAISE EXCEPTION
      'لا يمكن حذف طريقة دفع نظامية (%) — عطّلها بدلاً من ذلك', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية حذف طرق الدفع'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN OLD;
END $$;

--
-- Name: post_expense(uuid, integer, boolean, public.payment_method, text, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer DEFAULT NULL::integer, p_pay_now boolean DEFAULT false, p_payment_method public.payment_method DEFAULT 'cash'::public.payment_method, p_account_label text DEFAULT NULL::text, p_payment_date date DEFAULT NULL::date, p_idempotency_key text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.post_expense(
    p_entry_id, p_expected_version, p_pay_now, p_payment_method,
    p_account_label, p_payment_date, p_idempotency_key, NULL
  );
END $$;

--
-- Name: post_expense(uuid, integer, boolean, public.payment_method, text, date, text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer DEFAULT NULL::integer, p_pay_now boolean DEFAULT false, p_payment_method public.payment_method DEFAULT 'cash'::public.payment_method, p_account_label text DEFAULT NULL::text, p_payment_date date DEFAULT NULL::date, p_idempotency_key text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ BEGIN
  RETURN public.post_expense(p_entry_id,p_expected_version,p_pay_now,p_payment_method,p_account_label,
    p_payment_date,p_idempotency_key,p_account_id,NULL,NULL,NULL);
END $$;

--
-- Name: post_expense(uuid, integer, boolean, public.payment_method, text, date, text, uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer DEFAULT NULL::integer, p_pay_now boolean DEFAULT false, p_payment_method public.payment_method DEFAULT 'cash'::public.payment_method, p_account_label text DEFAULT NULL::text, p_payment_date date DEFAULT NULL::date, p_idempotency_key text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid, p_cashbox_id uuid DEFAULT NULL::uuid, p_bank_account_id uuid DEFAULT NULL::uuid, p_payment_method_id text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_from public.expense_status;
  v_lines jsonb := '[]'::jsonb;
  v_tax numeric(18,2) := 0;
  v_tax_account text;
  v_payable_role text;
  v_journal uuid;
  v_override_reason text;
  r record;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  v_from := v_entry.status;
  IF v_from IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED') THEN RETURN v_entry; END IF;
  IF v_from NOT IN ('APPROVED', 'DRAFT') THEN
    RAISE EXCEPTION 'This expense cannot be posted from status %', v_from USING ERRCODE = '55000';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.post');
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;
  IF v_entry.entry_type = 'ADVANCE' THEN
    RAISE EXCEPTION 'Employee advances need a separate issue and settlement document; this expense entry cannot post them'
      USING ERRCODE = '55000';
  END IF;
  IF v_entry.total_amount <= 0 OR v_entry.line_count = 0 THEN
    RAISE EXCEPTION 'Cannot post an expense with no lines' USING ERRCODE = '22023';
  END IF;

  -- ⛔ قاعدة المرحلة 1: لا يُرحَّم مسودة بالصلاحية وحدها. يلزم اعتماد مسجل
  --    عبر decide_expense مسبقاً (يكتب allow_draft_post وسبباً موثقاً)، ويلزم
  --    أيضاً أن يكون المرحّل مالكاً. والترحيل نفسه لا يمرر Maker-checker من
  --    داخل الواجهة، حتى لو كان الفاعل مالكاً.
  IF v_from = 'DRAFT' THEN
    IF NOT (public.has_role(v_user, 'owner') AND coalesce(v_entry.allow_draft_post, false)) THEN
      RAISE EXCEPTION 'Submit this expense for approval before posting it' USING ERRCODE = '55000';
    END IF;
    v_override_reason := public.expense_require_override_reason(v_entry.draft_post_reason);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.expense_lines l
      LEFT JOIN public.expense_categories c ON c.id = l.category_id
      LEFT JOIN public.accounts a ON a.id = c.account_id
     WHERE l.entry_id = p_entry_id
       AND (c.id IS NULL OR c.account_id IS NULL OR a.id IS NULL
            OR a.account_type::text <> 'EXPENSE' OR NOT a.is_active OR NOT a.is_postable)
  ) THEN
    RAISE EXCEPTION 'Every expense line needs an active, postable expense account mapping' USING ERRCODE = '55000';
  END IF;

  v_payable_role := CASE
    WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE'
    WHEN v_entry.payee_type = 'EMPLOYEE' AND v_entry.employee_id IS NOT NULL THEN 'EMPLOYEE_PAYABLE'
    ELSE 'OTHER_PAYABLE'
  END;
  -- Resolve before changing status so a missing role never leaves a document
  -- apparently posted without its journal.
  PERFORM public.expense_posting_account_code(v_payable_role);
  IF v_entry.tax_recoverable AND EXISTS (
    SELECT 1 FROM public.expense_lines WHERE entry_id = p_entry_id AND tax_amount > 0
  ) THEN
    v_tax_account := public.expense_posting_account_code('INPUT_TAX');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries je
     WHERE je.source_type = 'expense' AND je.source_id = p_entry_id
  ) THEN
    RAISE EXCEPTION 'This expense already has a journal entry; reload it instead of posting again'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.expense_entries
     SET status = 'POSTED', posting_date = coalesce(posting_date, CURRENT_DATE),
         posted_by = v_user, posted_at = now(), version = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;
  PERFORM public.expense_log_action(
    p_entry_id, 'posted', v_from, 'POSTED',
    CASE WHEN v_override_reason IS NOT NULL
         THEN 'Posted from draft by owner override: ' || v_override_reason END,
    v_user);

  FOR r IN (
    SELECT a.code::text AS account_code,
           coalesce(c.name_ar, c.name, 'مصروف') AS label,
           round(sum(l.net_amount + CASE WHEN v_entry.tax_recoverable THEN 0 ELSE l.tax_amount END), 2) AS debit_amount,
           round(sum(l.tax_amount), 2) AS tax_amount
      FROM public.expense_lines l
      JOIN public.expense_categories c ON c.id = l.category_id
      JOIN public.accounts a ON a.id = c.account_id
     WHERE l.entry_id = p_entry_id
     GROUP BY a.code, coalesce(c.name_ar, c.name, 'مصروف')
  ) LOOP
    IF r.debit_amount > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', r.account_code, 'debit', r.debit_amount,
        'memo', 'مصروف ' || v_entry.reference || ' — ' || r.label
      );
    END IF;
    v_tax := v_tax + r.tax_amount;
  END LOOP;
  IF v_tax > 0 AND v_entry.tax_recoverable THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_tax_account, 'debit', round(v_tax, 2),
      'memo', 'ضريبة قابلة للاسترداد على مصروف ' || v_entry.reference
    );
  END IF;
  v_lines := v_lines || jsonb_build_object(
    'account_code', public.expense_posting_account_code(v_payable_role),
    'credit', round(v_entry.total_amount, 2),
    'memo', 'التزام مصروف ' || v_entry.reference
  );
  v_journal := public.create_journal_entry(
    'إثبات استحقاق مصروف ' || v_entry.reference,
    coalesce(v_entry.expense_date, CURRENT_DATE), 'expense', p_entry_id, true, v_lines
  );

  -- مصروف المورد: الذمة العامة في الأستاذ العام كانت وحدها تُحدَّث، فينفصل
  -- كشف المورد عن حساب الموردين (2111). الآن يُكتب الاستحقاق في دفتر المورد
  -- بنفس العملية الذرية وبمفتاح مصدر فريد.
  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN
    PERFORM public.expense_write_supplier_ledger(
      v_entry.supplier_id, 'EXPENSE_ACCRUAL', 'CREDIT', v_entry.total_amount,
      'expense', p_entry_id, 'EXP-' || p_entry_id::text,
      v_entry.due_date, v_entry.expense_date::timestamptz,
      'مصروف ' || v_entry.reference, v_user);
  END IF;

  IF p_pay_now THEN
    SELECT * INTO v_entry FROM public.record_expense_payment(
      p_entry_id, v_entry.total_amount, coalesce(p_payment_date, CURRENT_DATE),
      p_payment_method, p_account_label, NULL, 'Settled at posting',
      coalesce(NULLIF(btrim(coalesce(p_idempotency_key, '')), ''), 'post:' || p_entry_id::text),
      p_account_id, p_cashbox_id, p_bank_account_id, p_payment_method_id
    );
  END IF;
  RETURN v_entry;
END;
$$;

--
-- Name: post_purchase_invoice(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_purchase_invoice(p_invoice_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_split_acct text;
  v_owed     numeric := 0;
  v_has_splits boolean := false;
  r         record;
  r_split   record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant') OR
          (public.has_role(v_user,'cashier') AND
           current_setting('app.payment_split_internal_post', true) = 'on')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post a purchase invoice';
  END IF;

  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Purchase % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Purchase % carries a negative payment (%). A supplier return is a return document, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Purchase % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'purchase_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  -- P0: نداء موضعي على المصدر مباشرة، فلا يتأثر بأي اسم وسيط.
  v_cash_acct := public.resolve_document_settlement_account(
    v_inv.payment_method::text, v_inv.cashbox_id, v_inv.bank_account_id, v_inv.payment_method_id
  );
  v_owed := greatest(v_inv.total - v_inv.paid, 0);

  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS item_class,
           coalesce(it.stock_effect, 'NONE') AS effect,
           sum(it.total)                     AS amount,
           sum(it.tax)                       AS line_tax
      FROM public.purchase_invoice_items it
      LEFT JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED'), coalesce(it.stock_effect, 'NONE')
    HAVING sum(it.total) <> 0 OR sum(it.tax) <> 0
  LOOP
    IF r.amount <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE
          WHEN r.effect <> 'STOCK_RECEIPT' THEN '5911'
          ELSE CASE r.item_class
                 WHEN 'RAW_MATERIAL'  THEN '1311'
                 WHEN 'BY_PRODUCT'    THEN '1314'
                 WHEN 'FINISHED_GOOD' THEN '1313'
                 ELSE '1315' END END,
        'debit', round(r.amount, 2),
        'memo', CASE WHEN r.effect <> 'STOCK_RECEIPT'
                     THEN 'مصروف مشتريات ' || r.item_class
                     ELSE 'شراء ' || r.item_class END);
    END IF;

    IF r.line_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1316', 'debit', round(r.line_tax, 2),
        'memo', 'ضريبة مدخلات قابلة للاسترداد');
    END IF;
  END LOOP;

  IF v_inv.tax <> 0 AND NOT EXISTS (
       SELECT 1 FROM public.purchase_invoice_items it
        WHERE it.invoice_id = p_invoice_id AND it.tax <> 0) THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1316', 'debit', round(v_inv.tax, 2),
      'memo', 'ضريبة مدخلات قابلة للاسترداد');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase % has nothing to post - its lines are empty or zero',
      v_inv.invoice_number;
  END IF;

  IF v_owed > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2111', 'credit', round(v_owed, 2),
      'memo', 'مستحق للمورد',
      'partner_type', 'supplier',
      'partner_id', v_inv.supplier_id);
  END IF;

  -- ── السداد: إمّا حساب واحد (السلوك السابق) أو حساب لكل طريقة ──
  SELECT EXISTS (
    SELECT 1 FROM public.payment_splits
     WHERE document_type = 'purchase_invoice' AND document_id = p_invoice_id
  ) INTO v_has_splits;

  IF v_inv.paid > 0 AND v_has_splits THEN
    FOR r_split IN
      SELECT method::text AS method, amount, reference, cashbox_id,
             bank_account_id, payment_method_id
        FROM public.payment_splits
       WHERE document_type = 'purchase_invoice' AND document_id = p_invoice_id
    LOOP
      v_split_acct := public.resolve_document_settlement_account(
        r_split.method, r_split.cashbox_id, r_split.bank_account_id,
        coalesce(r_split.payment_method_id, r_split.method)
      );
      IF v_split_acct IS NULL THEN
        RAISE EXCEPTION 'No ledger account could be resolved for split tender %', r_split.method;
      END IF;
      IF r_split.amount > 0 THEN
        v_lines := v_lines || jsonb_build_object(
          'account_code', v_split_acct,
          'credit', r_split.amount,
          'memo', 'سداد للمورد (دفع مجزأ) — ' || r_split.method ||
                  coalesce(' — ' || nullif(r_split.reference, ''), ''));
      END IF;
    END LOOP;
  ELSIF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_inv.paid, 2),
      'memo', 'سداد للمورد');
  END IF;

  v_entry := public.create_journal_entry(
    p_memo => 'فاتورة مشتريات ' || v_inv.invoice_number,
    p_entry_date => v_inv.created_at::date,
    p_source_type => 'purchase_invoice',
    p_source_id => p_invoice_id,
    p_is_system => true,
    p_lines => v_lines);

  RETURN v_entry;
END $$;

--
-- Name: post_sales_invoice(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_sales_invoice(p_invoice_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_split_acct text;
  v_collectable numeric := 0;
  v_split_total numeric := 0;
  v_service_total numeric := 0;
  v_cost    record;
  r         record;
  r_split   record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant') OR
          (public.has_role(v_user,'cashier') AND
           current_setting('app.payment_split_internal_post', true) = 'on')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post an invoice';
  END IF;

  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative payment (%). A refund is a credit note, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Invoice % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;
  IF v_inv.tax < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative tax amount', v_inv.invoice_number;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'sales_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  -- حل حساب التسوية المفرد
  v_cash_acct := public.resolve_document_settlement_account(
    v_inv.payment_method::text,
    v_inv.cashbox_id,
    v_inv.bank_account_id,
    v_inv.payment_method_id
  );
  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── الإيراد دائن: بند مُصنَّف حسب item_class ──
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket, sum(it.total) AS amount
      FROM public.sales_invoice_items it
      LEFT JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.product_id IS NOT NULL
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(it.total) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.bucket);
  END LOOP;

  -- ── الإيراد دائن: الخدمة الحرة ──
  SELECT coalesce(sum(l.total), 0) INTO v_service_total
    FROM public.ad_hoc_service_lines l
   WHERE l.invoice_id = p_invoice_id;
  IF v_service_total <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4311',
      'credit', round(v_service_total, 2),
      'memo', 'إيراد خدمة حرة (AD_HOC_SERVICE)');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- ── أسطر التحصيل (مدين) ──
  IF v_inv.paid > 0 THEN
    -- فحص الدفع المجزأ أولاً: إذا كانت هناك سجلات تجزئة
    IF EXISTS (SELECT 1 FROM public.customer_payment_splits WHERE invoice_id = p_invoice_id) THEN
      SELECT round(coalesce(sum(amount), 0), 2)
        INTO v_split_total
        FROM public.customer_payment_splits
       WHERE invoice_id = p_invoice_id;
      IF v_split_total <> round(v_inv.paid, 2) THEN
        RAISE EXCEPTION 'Invoice % split total (%) does not match paid amount (%)',
          v_inv.invoice_number, v_split_total, round(v_inv.paid, 2);
      END IF;

      FOR r_split IN
        SELECT method::text AS method, amount, cashbox_id, bank_account_id,
               payment_method_id, reference_no
        FROM public.customer_payment_splits
        WHERE invoice_id = p_invoice_id
      LOOP
        IF r_split.amount > 0 THEN
          v_split_acct := public.resolve_document_settlement_account(
            r_split.method, r_split.cashbox_id, r_split.bank_account_id,
            coalesce(r_split.payment_method_id, r_split.method)
          );
          IF v_split_acct IS NULL THEN
            RAISE EXCEPTION 'No ledger account could be resolved for split tender %', r_split.method;
          END IF;
          v_lines := v_lines || jsonb_build_object(
            'account_code', v_split_acct,
            'debit', round(r_split.amount, 2),
            'memo', 'تحصيل مجزأ عبر ' || r_split.method ||
                    coalesce(' — ' || nullif(r_split.reference_no, ''), ''));
        END IF;
      END LOOP;
    ELSIF v_cash_acct IS NOT NULL THEN
      -- دفع مفرد
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_cash_acct,
        'debit', round(v_inv.paid, 2),
        'memo', CASE
                  WHEN v_cash_acct = '1111' THEN 'تحصيل عبر البنك'
                  WHEN v_cash_acct = '1131' THEN 'تحصيل عبر المحفظة الإلكترونية'
                  ELSE 'تحصيل نقدي بالصندوق'
                END);
    END IF;
  END IF;

  -- سطر الآجل (مدين - ذمم العملاء 1211)
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211',
      'debit', round(v_collectable, 2),
      'partner_type', 'customer',
      'partner_id', v_inv.customer_id,
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  -- سطر الضريبة
  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311',
      'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة مخرجات مستحقة');
  END IF;

  -- إنشاء وترحيل قيد اليومية
  v_entry := public.post_journal_entry(
    p_entry_date := v_inv.created_at::date,
    p_memo := 'ترحيل فاتورة مبيعات ' || v_inv.invoice_number,
    p_lines := v_lines,
    p_source_type := 'sales_invoice',
    p_source_id := p_invoice_id,
    p_entry_number := 'JE-SI-' || v_inv.invoice_number
  );

  -- ترحيل تكلفة المبيعات حسب فئة الصنف من تكلفة حركة الصرف الفعلية.
  PERFORM public.post_sales_invoice_cogs(p_invoice_id,v_inv.created_at::date,v_inv.invoice_number);

  RETURN v_entry;
END;
$$;

--
-- Name: record_customer_advance_payment(uuid, numeric, text, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_stored_method text;
  v_cash_acct text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;

  IF _customer_id IS NULL OR coalesce(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive advance amount are required';
  END IF;

  v_stored_method := public.resolve_writable_payment_method(
    _method, 'customer_collection', true
  );

  PERFORM 1 FROM public.customers
  WHERE id = _customer_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  INSERT INTO public.customer_payments (
    customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
  )
  VALUES (
    _customer_id, NULL, round(_amount, 2), v_stored_method::public.payment_method,
    coalesce(_payment_date, current_date),
    coalesce(nullif(trim(_note), ''), 'دفعة مقدمة'), v_user
  )
  RETURNING id INTO v_id;

  UPDATE public.customers
  SET balance = round(coalesce(balance, 0) - _amount, 2), updated_at = now()
  WHERE id = _customer_id;

  INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
  VALUES (_customer_id, 'credit', round(_amount, 2), v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'advance-payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة مقدمة'))
  ON CONFLICT (source_key) DO NOTHING;

  -- ── T-10: قيد الدفعة المقدمة — نقد مدين مقابل ذمة عكسية للعميل ──────────
  v_cash_acct := public.payment_method_ledger_account(v_stored_method);
  IF v_cash_acct IS NOT NULL THEN
    v_lines := v_lines
      || jsonb_build_object('account_code', v_cash_acct, 'debit', round(_amount, 2),
                            'memo', 'دفعة مقدمة من عميل')
      || jsonb_build_object('account_code', '1211', 'credit', round(_amount, 2),
                            'memo', 'رصيد دائن للعميل — دفعة مقدمة');
    v_journal := public.create_journal_entry(
      'دفعة مقدمة من عميل', COALESCE(_payment_date, CURRENT_DATE),
      'customer_advance_payment', v_id, true, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user, 'customer_advance_payment.recorded', 'customer', _customer_id,
    jsonb_build_object('amount', _amount, 'method', v_stored_method,
                       'payment_date', coalesce(_payment_date, current_date),
                       'journal_entry_id', v_journal)
  );

  RETURN v_id;
END;
$$;

--
-- Name: record_customer_payment(uuid, uuid, numeric, text, date, text, uuid, uuid, text, text, text, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text, _cashbox_id uuid DEFAULT NULL::uuid, _bank_account_id uuid DEFAULT NULL::uuid, _payment_method_id text DEFAULT NULL::text, _cheque_number text DEFAULT NULL::text, _cheque_bank text DEFAULT NULL::text, _cheque_due_date date DEFAULT NULL::date, _cheque_drawer text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_amount numeric := round(coalesce(_amount, 0), 2);
  v_method_id text;
  v_stored_method text;
  v_account text;
  v_payment_id uuid;
  v_customer_balance numeric;
  v_ledger_balance numeric;
  v_invoice record;
  v_inv_cur record;
  v_remaining numeric;
  v_allocation numeric;
  v_lines jsonb;
  v_doc_date date := coalesce(_payment_date, public.business_today());
  v_occurred timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;
  IF _customer_id IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;
  IF v_amount <> coalesce(_amount, 0) THEN
    RAISE EXCEPTION 'Payment amount must not have more than two decimal places';
  END IF;

  -- تاريخ المستقبل ليس تحصيلاً وقع بعد.
  IF v_doc_date > public.business_today() THEN
    RAISE EXCEPTION 'A collection cannot be dated in the future (%)', v_doc_date;
  END IF;

  -- تحصيل اليوم يُسجَّل بلحظته الفعلية؛ وتاريخ سابق يُسجَّل بمنتصف ليل ذلك اليوم
  -- بتوقيت المنشأة — لا بتوقيت الخادم.
  v_occurred := CASE
    WHEN v_doc_date = public.business_today() THEN public.business_now()
    ELSE public.business_timestamp(v_doc_date, time '00:00')
  END;

  v_method_id := coalesce(_payment_method_id, _method);
  v_stored_method := public.resolve_writable_payment_method(
    v_method_id, 'customer_collection', true
  );
  IF v_stored_method = 'credit' THEN
    RAISE EXCEPTION 'A collection cannot record آجل — that is a deferred sale, not a receipt';
  END IF;

  v_customer_balance := public.customer_balance_lock(_customer_id);
  IF v_customer_balance IS NULL THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
    INTO v_ledger_balance
    FROM public.customer_ledger l
   WHERE l.customer_id = _customer_id;

  v_account := public.resolve_document_settlement_account(
    v_stored_method, _cashbox_id, _bank_account_id, v_method_id
  );
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No ledger account could be resolved for collection tender %', v_method_id;
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id INTO v_invoice
      FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;
    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;
    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;
    IF v_amount > v_invoice.total - v_invoice.paid + 0.001 THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;
  ELSE
    IF v_amount > greatest(coalesce(v_ledger_balance, 0), 0) + 0.001 THEN
      RAISE EXCEPTION
        'Payment exceeds the customer outstanding balance (ledger %)', v_ledger_balance;
    END IF;
  END IF;

  INSERT INTO public.customer_payments (
    customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
    cashbox_id, bank_account_id, payment_method_id, payment_reference
  ) VALUES (
    _customer_id, _invoice_id, v_amount, v_stored_method::public.payment_method,
    v_doc_date, nullif(trim(_note), ''), v_user,
    _cashbox_id, _bank_account_id, v_method_id, _cheque_number
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.customer_ledger(
    customer_id, entry_type, credit, reference_id, reference_type,
    occurred_at, created_by, source_key, note
  ) VALUES (
    _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
    v_occurred, v_user,
    'payment:' || v_payment_id,
    coalesce(nullif(trim(_note), ''), 'دفعة عميل')
  );

  IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND _cheque_number IS NOT NULL THEN
    INSERT INTO public.cheques_register (
      cheque_number, bank_name, drawer_name, due_date, amount, status,
      customer_id, invoice_id, payment_id, notes, created_by
    ) VALUES (
      _cheque_number, coalesce(_cheque_bank, 'شيك مصرفي'), _cheque_drawer,
      coalesce(_cheque_due_date, v_doc_date), v_amount, 'UNDER_COLLECTION',
      _customer_id, _invoice_id, v_payment_id, _note, v_user
    );
  END IF;

  IF _invoice_id IS NOT NULL THEN
    UPDATE public.sales_invoices
       SET paid = paid + v_amount,
           status = 'confirmed'::public.invoice_status,
           payment_status = public.derive_payment_status(paid + v_amount, total),
           updated_at = now()
     WHERE id = _invoice_id;
  ELSE
    v_remaining := v_amount;
    FOR v_inv_cur IN
      SELECT id, total, paid
        FROM public.sales_invoices
       WHERE customer_id = _customer_id AND total > paid
         AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocation := least(v_remaining, v_inv_cur.total - v_inv_cur.paid);
      IF v_allocation <= 0 THEN
        CONTINUE;
      END IF;
      UPDATE public.sales_invoices
         SET paid = round(paid + v_allocation, 2),
             status = 'confirmed'::public.invoice_status,
             payment_status = public.derive_payment_status(round(paid + v_allocation, 2), total),
             updated_at = now()
       WHERE id = v_inv_cur.id;
      v_remaining := round(v_remaining - v_allocation, 2);
    END LOOP;
  END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', v_account, 'debit', v_amount,
      'memo', CASE WHEN v_account = '1221'
                   THEN 'أوراق قبض (شيك برسم التحصيل)'
                   ELSE 'تحصيل من عميل' END),
    jsonb_build_object(
      'account_code', '1211', 'credit', v_amount,
      'memo', 'تحصيل ذمة عميل', 'partner_type', 'customer', 'partner_id', _customer_id)
  );
  -- القيد يحمل تاريخ المستند التشغيلي، لا تاريخ الخادم.
  PERFORM public.create_journal_entry(
    'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
    v_doc_date, 'customer_payment', v_payment_id, true, v_lines
  );

  PERFORM public.recalculate_customer_balance(
    _customer_id, 'تحصيل نقدي — ' || v_payment_id::text, 'document_repost');

  RETURN v_payment_id;
END
$$;

--
-- Name: record_customer_payment_splits(uuid, uuid, numeric, date, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_customer_payment_splits(_customer_id uuid, _invoice_id uuid, _amount numeric, _payment_date date, _note text, _splits jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_customer_balance numeric;
  v_ledger_balance numeric;
  v_customer_outstanding numeric := 0;
  v_total numeric := 0;
  v_split_total numeric := 0;
  v_method_id text;
  v_stored_method text;
  v_account text;
  v_amount numeric;
  v_payment_id uuid;
  v_last_id uuid;
  v_remaining numeric;
  v_invoice record;
  v_inv_cur record;
  v_allocation numeric;
  v_tender_lines jsonb;
  r_split record;
  v_doc_date date := coalesce(_payment_date, public.business_today());
  v_occurred timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;
  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required';
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR round(_amount, 2) <> _amount THEN
    RAISE EXCEPTION 'A positive collection total with at most two decimals is required';
  END IF;
  IF coalesce(jsonb_typeof(_splits), '') <> 'array'
     OR jsonb_array_length(_splits) < 2 THEN
    RAISE EXCEPTION 'A split collection requires at least two tenders';
  END IF;
  IF v_doc_date > public.business_today() THEN
    RAISE EXCEPTION 'A collection cannot be dated in the future (%)', v_doc_date;
  END IF;

  v_occurred := CASE
    WHEN v_doc_date = public.business_today() THEN public.business_now()
    ELSE public.business_timestamp(v_doc_date, time '00:00')
  END;

  v_customer_balance := public.customer_balance_lock(_customer_id);
  IF v_customer_balance IS NULL THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
    INTO v_ledger_balance
    FROM public.customer_ledger l
   WHERE l.customer_id = _customer_id;

  FOR r_split IN
    SELECT part ->> 'methodId' AS method_id,
           part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount,
           nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference,
           nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
           nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
           nullif(part ->> 'payment_method_id', '') AS payment_method_id
      FROM jsonb_array_elements(_splits) AS part
  LOOP
    IF r_split.amount <= 0 THEN
      RAISE EXCEPTION 'Every collection tender requires a positive amount';
    END IF;
    v_method_id := coalesce(r_split.method_id, r_split.method);
    v_stored_method := public.resolve_writable_payment_method(
      v_method_id, 'customer_collection', true
    );
    IF v_stored_method = 'credit' THEN
      RAISE EXCEPTION 'A collection cannot record آجل — that is a deferred sale, not a receipt';
    END IF;
    v_split_total := v_split_total + r_split.amount;
  END LOOP;
  IF v_split_total <> round(v_split_total, 2) THEN
    RAISE EXCEPTION 'Each payment tender must not have more than two decimal places';
  END IF;
  v_total := round(v_split_total, 2);
  IF v_total <= 0 OR v_split_total <> v_total
     OR (_amount IS NOT NULL AND round(_amount, 2) <> v_total) THEN
    RAISE EXCEPTION 'Collection total (%) does not match the sum of its tenders (%)',
      round(coalesce(_amount, 0), 2), v_total;
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id INTO v_invoice
      FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
    IF NOT FOUND OR v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice not found for this customer';
    END IF;
    IF v_invoice.total - v_invoice.paid <= 0
       OR v_total > v_invoice.total - v_invoice.paid + 0.001
       OR v_total > greatest(coalesce(v_ledger_balance, 0), 0) + 0.001 THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;
  ELSE
    SELECT round(coalesce(sum(total - paid), 0), 2)
      INTO v_customer_outstanding
      FROM public.sales_invoices
     WHERE customer_id = _customer_id AND total > paid
       AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status);
    IF v_total > greatest(coalesce(v_ledger_balance, 0), 0) + 0.001
       OR (v_customer_outstanding > 0 AND v_total > v_customer_outstanding + 0.001) THEN
      RAISE EXCEPTION 'Payment exceeds the customer outstanding balance (ledger %)', v_ledger_balance;
    END IF;
  END IF;

  v_remaining := v_total;
  FOR r_split IN
    SELECT part ->> 'methodId' AS method_id,
           part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount,
           nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference,
           nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
           nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
           nullif(part ->> 'payment_method_id', '') AS payment_method_id
      FROM jsonb_array_elements(_splits) AS part
  LOOP
    v_method_id := coalesce(r_split.method_id, r_split.method);
    v_stored_method := public.resolve_writable_payment_method(
      v_method_id, 'customer_collection', true
    );
    v_account := public.resolve_document_settlement_account(
      v_stored_method, r_split.cashbox_id, r_split.bank_account_id, v_method_id
    );
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'No ledger account could be resolved for collection tender %', v_method_id;
    END IF;
    v_amount := round(r_split.amount, 2);

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
      payment_method_id, payment_reference, cashbox_id, bank_account_id
    ) VALUES (
      _customer_id, _invoice_id, v_amount, v_stored_method::public.payment_method,
      v_doc_date,
      nullif(trim(concat_ws(' — ', _note, r_split.reference)), ''),
      v_user, v_method_id, r_split.reference, r_split.cashbox_id, r_split.bank_account_id
    ) RETURNING id INTO v_payment_id;
    v_last_id := v_payment_id;

    INSERT INTO public.customer_ledger(
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
      v_occurred, v_user,
      'payment:' || v_payment_id,
      coalesce(nullif(trim(_note), ''), 'دفعة عميل (دفع مجزأ)')
    );

    IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND r_split.reference IS NOT NULL THEN
      INSERT INTO public.cheques_register (
        cheque_number, bank_name, due_date, amount, status,
        customer_id, invoice_id, payment_id, notes, created_by
      ) VALUES (
        r_split.reference, 'شيك مصرفي', v_doc_date, v_amount,
        'UNDER_COLLECTION', _customer_id, _invoice_id, v_payment_id, _note, v_user
      );
    END IF;

    v_tender_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_account, 'debit', v_amount,
        'memo', 'تحصيل من عميل (دفع مجزأ) — ' || v_stored_method),
      jsonb_build_object(
        'account_code', '1211', 'credit', v_amount,
        'memo', 'تحصيل ذمة عميل', 'partner_type', 'customer', 'partner_id', _customer_id)
    );
    PERFORM public.create_journal_entry(
      'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
      v_doc_date,
      'customer_payment', v_payment_id, true, v_tender_lines
    );
  END LOOP;

  IF _invoice_id IS NOT NULL THEN
    UPDATE public.sales_invoices
       SET paid = paid + v_total,
           status = 'confirmed'::public.invoice_status,
           payment_status = public.derive_payment_status(paid + v_total, total),
           updated_at = now()
     WHERE id = _invoice_id;
  ELSE
    FOR v_inv_cur IN
      SELECT id, total, paid
        FROM public.sales_invoices
       WHERE customer_id = _customer_id AND total > paid
         AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocation := least(v_remaining, v_inv_cur.total - v_inv_cur.paid);
      IF v_allocation <= 0 THEN
        CONTINUE;
      END IF;
      UPDATE public.sales_invoices
         SET paid = round(paid + v_allocation, 2),
             status = 'confirmed'::public.invoice_status,
             payment_status = public.derive_payment_status(round(paid + v_allocation, 2), total),
             updated_at = now()
       WHERE id = v_inv_cur.id;
      v_remaining := round(v_remaining - v_allocation, 2);
    END LOOP;
  END IF;

  PERFORM public.recalculate_customer_balance(
    _customer_id, 'تحصيل مجزأ — ' || coalesce(v_last_id::text, ''), 'document_repost');

  RETURN v_last_id;
END
$$;

--
-- Name: record_expense_payment(uuid, numeric, date, public.payment_method, text, text, text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method public.payment_method DEFAULT 'cash'::public.payment_method, p_account_label text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.record_expense_payment(
    p_entry_id, p_amount, p_payment_date, p_payment_method,
    p_account_label, p_reference_no, p_note, p_idempotency_key, NULL
  );
END $$;

--
-- Name: record_expense_payment(uuid, numeric, date, public.payment_method, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method public.payment_method DEFAULT 'cash'::public.payment_method, p_account_label text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ BEGIN
  RETURN public.record_expense_payment(p_entry_id,p_amount,p_payment_date,p_payment_method,p_account_label,
    p_reference_no,p_note,p_idempotency_key,p_account_id,NULL,NULL,NULL);
END $$;

--
-- Name: record_expense_payment(uuid, numeric, date, public.payment_method, text, text, text, text, uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method public.payment_method DEFAULT 'cash'::public.payment_method, p_account_label text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid, p_cashbox_id uuid DEFAULT NULL::uuid, p_bank_account_id uuid DEFAULT NULL::uuid, p_payment_method_id text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_amount numeric(18,2);
  v_existing public.expense_payments;
  v_label text := nullif(btrim(coalesce(p_account_label, '')), '');
  v_cash_acct text;
  v_credit_acct text;
  v_payable_role text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.pay');
  v_amount := public.expense_round(p_amount);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount is invalid or exceeds remaining amount' USING ERRCODE = '22023';
  END IF;
  -- إعادة الطلب (شبكة/مهلة): إن وُجد الدفع بنفس المفتاح نعيد المستند كما هو.
  -- المفتاح فريد على مستوى الجدول: أساس الدفع هو الدفعة، لا المستند.
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.expense_payments
     WHERE idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.entry_id <> p_entry_id OR v_existing.amount <> v_amount THEN
        RAISE EXCEPTION 'Payment request key was already used for a different payment'
          USING ERRCODE = '23505';
      END IF;
      RETURN v_entry;
    END IF;
  END IF;
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payments can only be recorded against posted expenses (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  IF v_amount > v_entry.remaining_amount + 0.005 THEN
    RAISE EXCEPTION 'Payment amount is invalid or exceeds remaining amount' USING ERRCODE = '22023';
  END IF;

  IF p_cashbox_id IS NOT NULL THEN
    SELECT c.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.cashboxes c JOIN public.accounts a ON a.id = c.account_id
     WHERE c.id = p_cashbox_id AND c.is_active AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cashbox is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_bank_account_id IS NOT NULL THEN
    SELECT b.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.company_bank_accounts b JOIN public.accounts a ON a.id = b.account_id
     WHERE b.id = p_bank_account_id AND b.is_active AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank account is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_account_id IS NOT NULL THEN
    SELECT a.name_ar, a.code INTO v_label, v_cash_acct FROM public.accounts a
     WHERE a.id = p_account_id AND a.account_type::text = 'ASSET' AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected settlement account is unavailable' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_cash_acct IS NULL THEN
    v_cash_acct := public.payment_method_ledger_account(coalesce(p_payment_method::text, 'cash'));
  END IF;
  IF v_cash_acct IS NULL THEN
    RAISE EXCEPTION 'No active ledger account is configured for this payment method' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.code = v_cash_acct AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable
  ) THEN
    RAISE EXCEPTION 'The payment method is not linked to an active, postable cash or bank account'
      USING ERRCODE = '22023';
  END IF;
  v_payable_role := CASE
    WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE'
    WHEN v_entry.payee_type = 'EMPLOYEE' AND v_entry.employee_id IS NOT NULL THEN 'EMPLOYEE_PAYABLE'
    ELSE 'OTHER_PAYABLE'
  END;
  v_credit_acct := public.expense_posting_account_code(v_payable_role);

  INSERT INTO public.expense_payments (
    entry_id, amount, payment_date, payment_method, account_label, reference_no,
    note, idempotency_key, created_by, account_id, cashbox_id, bank_account_id, payment_method_id
  ) VALUES (
    p_entry_id, v_amount, coalesce(p_payment_date, CURRENT_DATE), coalesce(p_payment_method, 'cash'),
    v_label, nullif(btrim(coalesce(p_reference_no, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
    v_key, v_user, p_account_id,
    p_cashbox_id, p_bank_account_id, p_payment_method_id
  ) RETURNING id INTO v_payment_id;

  v_lines := v_lines
    || jsonb_build_object('account_code', v_credit_acct, 'debit', v_amount, 'memo', 'تسوية التزام مصروف ' || v_entry.reference)
    || jsonb_build_object('account_code', v_cash_acct, 'credit', v_amount, 'memo', 'صرف دفعة مصروف ' || v_entry.reference);
  v_journal := public.create_journal_entry(
    'سداد مصروف ' || v_entry.reference, coalesce(p_payment_date, CURRENT_DATE),
    'expense_payment', v_payment_id, true, v_lines
  );

  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN
    PERFORM public.expense_write_supplier_ledger(
      v_entry.supplier_id, 'EXPENSE_PAYMENT', 'DEBIT', v_amount,
      'expense_payment', v_payment_id, 'EXPPAY-' || v_payment_id::text,
      v_entry.due_date, coalesce(p_payment_date, CURRENT_DATE)::timestamptz,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'سداد مصروف ' || v_entry.reference),
      v_user);
  END IF;

  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id;
  PERFORM public.expense_log_action(p_entry_id, 'payment', v_entry.status, v_entry.status,
    'Payment of ' || v_amount::text || ' ' || v_entry.currency_symbol || ' recorded', v_user);
  RETURN v_entry;
END;
$$;

--
-- Name: record_supplier_payment(uuid, numeric, text, text, date, text, date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text DEFAULT 'CASH'::text, p_account_code text DEFAULT NULL::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_supplier_name text;
  v_payment_id uuid;
  v_voucher_no text;
  v_account text;
  v_journal_id uuid;
  v_lines jsonb;
  v_new_balance numeric;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier ID is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero, got %', p_amount;
  END IF;

  SELECT name INTO v_supplier_name
  FROM public.suppliers
  WHERE id = p_supplier_id;

  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'Supplier with ID % not found', p_supplier_id;
  END IF;

  -- تحديد الحساب المالي (الصندوق أو البنك)
  IF p_account_code IS NOT NULL AND btrim(p_account_code) <> '' THEN
    v_account := btrim(p_account_code);
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = v_account) THEN
      RAISE EXCEPTION 'Account code % does not exist in chart of accounts', v_account;
    END IF;
  ELSE
    -- الافتراضي: إن كانت طريقة الدفع بنك أو تحويل -> 1111، وإلا -> 1101 (صندوق)
    IF upper(coalesce(p_payment_method, 'CASH')) IN ('BANK', 'TRANSFER', 'CHEQUE', 'CARD') THEN
      v_account := '1111';
    ELSE
      v_account := '1101';
    END IF;
  END IF;

  v_voucher_no := public.next_supplier_voucher_number();

  -- 1. إدراج سند الصرف
  INSERT INTO public.supplier_payments (
    voucher_number,
    supplier_id,
    amount,
    payment_method,
    account_code,
    payment_date,
    notes,
    created_by
  ) VALUES (
    v_voucher_no,
    p_supplier_id,
    round(p_amount, 2),
    upper(coalesce(p_payment_method, 'CASH')),
    v_account,
    coalesce(p_payment_date, CURRENT_DATE),
    p_notes,
    v_user
  ) RETURNING id INTO v_payment_id;

  -- 2. إعداد وترحيل القيد المحاسبي المزدوج المتوازن:
  -- Dr 2111 (ذمم الموردين) - تخفيض الالتزام
  -- Cr v_account (1101 نقدية بالصندوق أو 1111 بنك) - تخفيض النقدية
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', '2111',
      'debit', round(p_amount, 2),
      'credit', 0,
      'memo', 'سداد ذمة للمورد ' || v_supplier_name
    ),
    jsonb_build_object(
      'account_code', v_account,
      'debit', 0,
      'credit', round(p_amount, 2),
      'memo', 'صرف نقدي/بنكي بسند ' || v_voucher_no
    )
  );

  v_journal_id := public.create_journal_entry(
    'سند صرف مورد ' || v_supplier_name || ' (' || v_voucher_no || ')',
    coalesce(p_payment_date, CURRENT_DATE),
    'supplier_payment',
    v_payment_id,
    true, -- is_system
    v_lines
  );

  -- ربط القيد بالسند
  UPDATE public.supplier_payments
  SET journal_entry_id = v_journal_id
  WHERE id = v_payment_id;

  -- 3. تحديث رصيد المورد ذرياً دون greatest(..., 0)
  UPDATE public.suppliers
  SET balance = round(coalesce(balance, 0) - p_amount, 2),
      updated_at = now()
  WHERE id = p_supplier_id
  RETURNING balance INTO v_new_balance;

  -- 4. إدراج الحركة في دفتر الموردين
  INSERT INTO public.supplier_ledger (
    supplier_id,
    entry_type,
    debit,
    credit,
    balance_after,
    reference_type,
    reference_id,
    due_date,
    occurred_at,
    created_by,
    source_key,
    note
  ) VALUES (
    p_supplier_id,
    'PAYMENT',
    round(p_amount, 2),
    0,
    v_new_balance,
    'supplier_payment',
    v_payment_id,
    p_due_date,
    coalesce(p_payment_date::timestamptz, now()),
    v_user,
    'SUP-PAY-' || v_payment_id::text,
    coalesce(p_notes, 'سند صرف رقم ' || v_voucher_no)
  );

  -- سجل التدقيق
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'supplier_payment.recorded',
    'supplier_payment',
    v_payment_id,
    jsonb_build_object(
      'voucher_number', v_voucher_no,
      'supplier_id', p_supplier_id,
      'amount', round(p_amount, 2),
      'account_code', v_account,
      'journal_entry_id', v_journal_id,
      'new_balance', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'voucher_number', v_voucher_no,
    'journal_entry_id', v_journal_id,
    'amount', round(p_amount, 2),
    'new_balance', v_new_balance
  );
END;
$$;

--
-- Name: record_supplier_payment(uuid, numeric, text, text, date, text, date, uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text DEFAULT 'CASH'::text, p_account_code text DEFAULT NULL::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_cashbox_id uuid DEFAULT NULL::uuid, p_bank_account_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_supplier_name text;
  v_payment_id uuid;
  v_voucher_no text;
  v_account text;
  v_journal_id uuid;
  v_lines jsonb;
  v_new_balance numeric;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier ID is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero, got %', p_amount;
  END IF;

  SELECT name INTO v_supplier_name
  FROM public.suppliers
  WHERE id = p_supplier_id;

  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'Supplier with ID % not found', p_supplier_id;
  END IF;

  -- تحديد الحساب المالي (من الصندوق أو البنك أو الحساب المدخل)
  IF p_account_code IS NOT NULL AND btrim(p_account_code) <> '' THEN
    v_account := btrim(p_account_code);
  ELSIF p_cashbox_id IS NOT NULL THEN
    SELECT a.code INTO v_account
    FROM public.cashboxes c
    JOIN public.accounts a ON a.id = c.account_id
    WHERE c.id = p_cashbox_id;
  ELSIF p_bank_account_id IS NOT NULL THEN
    SELECT a.code INTO v_account
    FROM public.company_bank_accounts b
    JOIN public.accounts a ON a.id = b.account_id
    WHERE b.id = p_bank_account_id;
  END IF;

  IF v_account IS NULL THEN
    IF upper(coalesce(p_payment_method, 'CASH')) IN ('BANK', 'TRANSFER', 'CHEQUE', 'CARD') THEN
      v_account := '1111';
    ELSIF upper(coalesce(p_payment_method, 'CASH')) = 'WALLET' THEN
      v_account := '1131';
    ELSE
      v_account := '1101';
    END IF;
  END IF;

  v_voucher_no := public.next_supplier_voucher_number();

  INSERT INTO public.supplier_payments (
    voucher_number,
    supplier_id,
    amount,
    payment_method,
    account_code,
    payment_date,
    notes,
    created_by,
    cashbox_id,
    bank_account_id
  ) VALUES (
    v_voucher_no,
    p_supplier_id,
    round(p_amount, 2),
    upper(coalesce(p_payment_method, 'CASH')),
    v_account,
    coalesce(p_payment_date, CURRENT_DATE),
    p_notes,
    v_user,
    p_cashbox_id,
    p_bank_account_id
  ) RETURNING id INTO v_payment_id;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', '2111',
      'debit', round(p_amount, 2),
      'credit', 0,
      'memo', 'سداد ذمة للمورد ' || v_supplier_name,
      'partner_type', 'supplier',
      'partner_id', p_supplier_id
    ),
    jsonb_build_object(
      'account_code', v_account,
      'debit', 0,
      'credit', round(p_amount, 2),
      'memo', 'سند صرف رقم ' || v_voucher_no || ' للمورد ' || v_supplier_name
    )
  );

  v_journal_id := public.create_journal_entry(
    'سند صرف للمورد ' || v_supplier_name || ' (' || v_voucher_no || ')',
    coalesce(p_payment_date, CURRENT_DATE),
    'supplier_payment',
    v_payment_id,
    true,
    v_lines
  );

  UPDATE public.supplier_payments
  SET journal_entry_id = v_journal_id
  WHERE id = v_payment_id;

  UPDATE public.suppliers
  SET balance = balance - round(p_amount, 2),
      updated_at = now()
  WHERE id = p_supplier_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'supplier_payment.recorded', 'supplier_payment', v_payment_id,
    jsonb_build_object(
      'voucher_number', v_voucher_no,
      'supplier_id', p_supplier_id,
      'amount', round(p_amount, 2),
      'account_code', v_account,
      'payment_method', p_payment_method,
      'cashbox_id', p_cashbox_id,
      'bank_account_id', p_bank_account_id,
      'new_balance', v_new_balance
    ));

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'voucher_number', v_voucher_no,
    'journal_entry_id', v_journal_id,
    'new_balance', v_new_balance
  );
END;
$$;

--
-- Name: resolve_document_settlement_account(text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.resolve_document_settlement_account(p_payment_method text, p_cashbox_id uuid DEFAULT NULL::uuid, p_bank_account_id uuid DEFAULT NULL::uuid, p_payment_method_id text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_code text;
  v_norm_method text := lower(btrim(coalesce(p_payment_method, '')));
  v_norm_catalog_id text := lower(btrim(coalesce(p_payment_method_id, '')));
BEGIN
  -- 0. إذا كان الدفع آجل، فلا يوجد حساب تسوية نقدية (NULL)
  IF v_norm_method = 'credit' OR v_norm_catalog_id = 'credit' THEN
    RETURN NULL;
  END IF;

  -- 1. الصناديق: إذا تم تمرير صندوق محدد ومفعل
  IF p_cashbox_id IS NOT NULL THEN
    SELECT a.code INTO v_code
    FROM public.cashboxes c
    JOIN public.accounts a ON a.id = c.account_id
    WHERE c.id = p_cashbox_id AND c.is_active = true;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 2. البنوك والمحافظ: إذا تم تمرير حساب بنكي/محفظة محددة ومفعلة
  IF p_bank_account_id IS NOT NULL THEN
    SELECT a.code INTO v_code
    FROM public.company_bank_accounts b
    JOIN public.accounts a ON a.id = b.account_id
    WHERE b.id = p_bank_account_id AND b.is_active = true;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 3. الشيكات: تُسوّى محاسبياً على حساب أوراق القبض برسم التحصيل (1221)
  IF v_norm_method = 'cheque' OR v_norm_catalog_id = 'cheque' THEN
    SELECT a.code INTO v_code FROM public.accounts a WHERE a.code = '1221';
    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 4. فحص إعدادات المنشأة لطريقة الدفع (payment_method_settings.default_account_id)
  IF v_norm_catalog_id <> '' THEN
    SELECT a.code INTO v_code
    FROM public.payment_method_settings s
    JOIN public.accounts a ON a.id = s.default_account_id
    WHERE s.payment_method_id = v_norm_catalog_id;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;

    -- فحص كود الحساب الافتراضي بالكتالوج (default_account_code)
    SELECT m.default_account_code INTO v_code
    FROM public.payment_methods m
    WHERE m.id = v_norm_catalog_id;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 5. البديل المتوافق مع كتالوج طرق الدفع التاريخي
  RETURN public.ledger_account_code_for_payment_method(coalesce(nullif(v_norm_method, ''), v_norm_catalog_id));
END;
$$;

--
-- Name: resolve_writable_payment_method(text, text, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.resolve_writable_payment_method(p_value text, p_context text, p_strict_context boolean DEFAULT true) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id text;
  v_stored text;
  v_enabled boolean;
BEGIN
  v_id := public.payment_method_resolve_id(p_value);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'طريقة دفع غير صالحة: %', coalesce(p_value, '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money') THEN
    RAISE EXCEPTION 'طريقة الدفع متوقفة. الخيارات المعتمدة: نقداً، آجل، تحويل بنكي، محفظة إلكترونية.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(s.enabled, true) AND m.is_active
    INTO v_enabled
    FROM public.payment_methods m
    LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
   WHERE m.id = v_id;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'طريقة الدفع غير مفعّلة: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_strict_context AND NOT public.payment_method_is_allowed(v_id, coalesce(p_context, 'pos')) THEN
    RAISE EXCEPTION 'طريقة الدفع غير مسموح بها في هذا القسم: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;

  v_stored := public.payment_method_legacy_id(v_id);
  IF v_stored IS NULL THEN
    RAISE EXCEPTION 'تعذّر تحويل طريقة الدفع إلى قيمة قاعدة بيانات: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_stored;
END $$;

--
-- Name: set_payment_method_default_account(text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_payment_method_default_account(p_method_id text, p_account_id uuid) RETURNS TABLE(payment_method_id text, default_account_id uuid, account_code text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_kind      text;
  v_acct      public.accounts;
  v_expected  text;
  v_expected_code text;
  v_in_family boolean;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل طرق الدفع — هذه الصلاحية لصاحب المنشأة والمدير وسوبر أدمن المنصة'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.ledger_kind INTO v_kind
    FROM public.payment_methods m
   WHERE m.id = p_method_id AND m.is_active;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'طريقة الدفع غير موجودة أو متوقفة: %', p_method_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_kind NOT IN ('CASH', 'BANK', 'WALLET') THEN
    RAISE EXCEPTION 'هذه الطريقة لا تُسوّى على حساب: %', p_method_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM public.accounts a WHERE a.id = p_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الحساب غير موجود في دليل الحسابات' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_acct.is_postable IS NOT TRUE OR v_acct.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'الحساب "%" غير قابل للترحيل أو غير مفعّل', v_acct.code
        USING ERRCODE = 'check_violation';
    END IF;

    --
    -- مطابقة الكود المباشرة لا تكفي: الحسابات البنكية الفعلية تُنشأ تحت 1111
    -- بأكواد فرعية مثل 1111001، وحسابات المحافظ تحت 1131. فنقبل الكود نفسه أو
    -- أي كود يبدأ بادئته. وتُقبل أيضًا 1101 لصناديق تحمل حسابها الأصلي، لأن
    -- الصندوق الرئيسي في البذرة مرتبط بـ 1101 مباشرةً.
    v_expected := CASE v_kind WHEN 'CASH' THEN '1101' WHEN 'BANK' THEN '1111' ELSE '1131' END;
    v_expected_code := coalesce(public.payment_method_ledger_account(p_method_id), v_expected);

    v_in_family :=
      v_acct.code = v_expected
      OR v_acct.code LIKE v_expected || '%'
      OR v_acct.code = v_expected_code
      OR v_acct.code LIKE v_expected_code || '%';

    IF NOT v_in_family THEN
      RAISE EXCEPTION
        'الحساب "%" لا ينتمي إلى عائلة هذه الطريقة (المتوقع % أو أحد فروعه)',
        v_acct.code, v_expected
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.payment_method_settings AS s (
    payment_method_id, enabled, sort_order, enabled_contexts, default_account_id,
    updated_at, updated_by
  )
  VALUES (
    p_method_id, true,
    coalesce((SELECT m.sort_order FROM public.payment_methods m WHERE m.id = p_method_id), 100),
    ARRAY[]::text[], p_account_id, now(), auth.uid()
  )
  ON CONFLICT (payment_method_id) DO UPDATE
    SET default_account_id = EXCLUDED.default_account_id,
        updated_at         = now(),
        updated_by         = auth.uid();

  RETURN QUERY
    SELECT s.payment_method_id, s.default_account_id, a.code
      FROM public.payment_method_settings s
      LEFT JOIN public.accounts a ON a.id = s.default_account_id
     WHERE s.payment_method_id = p_method_id;
END $$;

--
-- Name: cashboxes; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.cashboxes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    code character varying(30) NOT NULL,
    warehouse_id uuid,
    account_id uuid NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: company_bank_accounts; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.company_bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    kind text DEFAULT 'BANK'::text NOT NULL,
    bank_name text NOT NULL,
    account_number text,
    iban text,
    currency text DEFAULT 'YER'::text NOT NULL,
    account_id uuid NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_bank_accounts_kind_check CHECK ((kind = ANY (ARRAY['BANK'::text, 'WALLET'::text, 'POS_TERMINAL'::text])))
);

--
-- Name: payment_account_archive; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_account_archive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    archived_account_id uuid NOT NULL,
    account_code text NOT NULL,
    target_account_id uuid NOT NULL,
    target_account_code text NOT NULL,
    account_snapshot jsonb NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_by uuid DEFAULT auth.uid()
);

--
-- Name: payment_account_journal_archive; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_account_journal_archive (
    journal_line_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    archived_account_id uuid NOT NULL,
    target_account_id uuid NOT NULL,
    debit numeric(18,2) NOT NULL,
    credit numeric(18,2) NOT NULL,
    memo text,
    partner_type text,
    partner_id uuid,
    line_created_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: payment_account_reference_archive; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_account_reference_archive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relation_name text NOT NULL,
    column_name text NOT NULL,
    row_snapshot jsonb NOT NULL,
    archived_account_id uuid NOT NULL,
    target_account_id uuid NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: payment_method_settings; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_method_settings (
    payment_method_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    enabled_contexts text[] DEFAULT ARRAY[]::text[] NOT NULL,
    default_account_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    created_by uuid,
    updated_by_platform boolean DEFAULT false NOT NULL,
    CONSTRAINT payment_method_settings_contexts_valid CHECK ((enabled_contexts <@ ARRAY['pos'::text, 'sales'::text, 'purchases'::text, 'expenses'::text, 'customer_collection'::text, 'sales_returns'::text, 'purchase_returns'::text])),
    CONSTRAINT payment_method_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT payment_method_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: payment_method_settings_archive; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_method_settings_archive (
    payment_method_id text NOT NULL,
    settings_snapshot jsonb NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_by uuid DEFAULT auth.uid()
);

--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_methods (
    id text NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    icon_key text DEFAULT 'generic'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    allowed_contexts text[] DEFAULT ARRAY[]::text[] NOT NULL,
    ledger_kind text DEFAULT 'CASH'::text NOT NULL,
    default_account_code text,
    is_credit_term boolean DEFAULT false NOT NULL,
    requires_reference boolean DEFAULT false NOT NULL,
    legacy_ids text[] DEFAULT ARRAY[]::text[] NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    is_system boolean DEFAULT true NOT NULL,
    legacy_id text NOT NULL,
    default_ledger_kind text,
    shipped_name_ar text,
    CONSTRAINT payment_methods_contexts_valid CHECK ((allowed_contexts <@ ARRAY['pos'::text, 'sales'::text, 'purchases'::text, 'expenses'::text, 'customer_collection'::text, 'sales_returns'::text, 'purchase_returns'::text])),
    CONSTRAINT payment_methods_id_normalised CHECK (((id = lower(btrim(id))) AND (id <> ''::text))),
    CONSTRAINT payment_methods_ledger_kind_valid CHECK ((ledger_kind = ANY (ARRAY['CASH'::text, 'BANK'::text, 'WALLET'::text, 'CARD'::text, 'CREDIT'::text, 'OTHER'::text]))),
    CONSTRAINT payment_methods_legacy_id_valid CHECK ((legacy_id = ANY (ARRAY['cash'::text, 'card'::text, 'bank_transfer'::text, 'credit'::text, 'mobile_money'::text, 'split'::text, 'cheque'::text]))),
    CONSTRAINT payment_methods_name_ar_present CHECK ((btrim(COALESCE(name_ar, ''::text)) <> ''::text)),
    CONSTRAINT payment_methods_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: payment_methods_catalog_archive; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_methods_catalog_archive (
    id text NOT NULL,
    row_snapshot jsonb NOT NULL,
    rows_deleted bigint DEFAULT 0 NOT NULL,
    rows_retargeted bigint DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_by uuid DEFAULT auth.uid()
);

--
-- Name: payment_splits; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.payment_splits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type text NOT NULL,
    document_id uuid NOT NULL,
    method public.payment_method NOT NULL,
    amount numeric(18,2) NOT NULL,
    reference text,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_splits_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payment_splits_document_type_check CHECK ((document_type = ANY (ARRAY['purchase_invoice'::text, 'milling_service_document'::text]))),
    CONSTRAINT payment_splits_not_credit CHECK ((method <> 'credit'::public.payment_method)),
    CONSTRAINT payment_splits_not_split CHECK ((method <> 'split'::public.payment_method)),
    CONSTRAINT payment_splits_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);


--
-- Name: purchase_invoices trg_purchase_invoice_split_balance; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE CONSTRAINT TRIGGER trg_purchase_invoice_split_balance AFTER INSERT OR UPDATE ON public.purchase_invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_split_payment_document_balance('purchases');

--
-- Name: sales_invoices trg_sales_invoice_split_balance; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE CONSTRAINT TRIGGER trg_sales_invoice_split_balance AFTER INSERT OR UPDATE ON public.sales_invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_split_payment_document_balance('sales');

--
-- Name: FUNCTION assert_split_payment_document_balance(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.assert_split_payment_document_balance() FROM PUBLIC;

GRANT ALL ON FUNCTION public.assert_split_payment_document_balance() TO service_role;


--
-- Name: FUNCTION bounce_cheque(p_cheque_id uuid, p_reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.bounce_cheque(p_cheque_id uuid, p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.bounce_cheque(p_cheque_id uuid, p_reason text) TO service_role;

GRANT ALL ON FUNCTION public.bounce_cheque(p_cheque_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION can_author_payment_methods(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.can_author_payment_methods() IS 'هل يملك المستخدم الحالي حق تسمية/أيقنة/إنشاء طرق دفع؟ صاحب المنشأة والمدير وسوبر أدمن المنصة.';

--
-- Name: FUNCTION can_author_payment_methods(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.can_author_payment_methods() FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_author_payment_methods() TO service_role;

GRANT ALL ON FUNCTION public.can_author_payment_methods() TO authenticated;


--
-- Name: FUNCTION clear_cheque(p_cheque_id uuid, p_clearing_bank_account_id uuid, p_cleared_date date, p_notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.clear_cheque(p_cheque_id uuid, p_clearing_bank_account_id uuid, p_cleared_date date, p_notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.clear_cheque(p_cheque_id uuid, p_clearing_bank_account_id uuid, p_cleared_date date, p_notes text) TO service_role;

GRANT ALL ON FUNCTION public.clear_cheque(p_cheque_id uuid, p_clearing_bank_account_id uuid, p_cleared_date date, p_notes text) TO authenticated;


--
-- Name: FUNCTION create_tenant_payment_method(p_name_ar text, p_name_en text, p_icon_key text, p_legacy_id text, p_ledger_kind text, p_contexts text[], p_requires_reference boolean); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.create_tenant_payment_method(p_name_ar text, p_name_en text, p_icon_key text, p_legacy_id text, p_ledger_kind text, p_contexts text[], p_requires_reference boolean) IS 'إضافة طريقة دفع لم يشحنها المطورون: تُشتق قيمتها المخزّنة ونوع حسابها من اختيار المنشأة، والمعرّف يُولَّد تحت قفل استشاري بالاسم.';

--
-- Name: FUNCTION create_tenant_payment_method(p_name_ar text, p_name_en text, p_icon_key text, p_legacy_id text, p_ledger_kind text, p_contexts text[], p_requires_reference boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_tenant_payment_method(p_name_ar text, p_name_en text, p_icon_key text, p_legacy_id text, p_ledger_kind text, p_contexts text[], p_requires_reference boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_tenant_payment_method(p_name_ar text, p_name_en text, p_icon_key text, p_legacy_id text, p_ledger_kind text, p_contexts text[], p_requires_reference boolean) TO authenticated;

GRANT ALL ON FUNCTION public.create_tenant_payment_method(p_name_ar text, p_name_en text, p_icon_key text, p_legacy_id text, p_ledger_kind text, p_contexts text[], p_requires_reference boolean) TO service_role;


--
-- Name: FUNCTION derive_payment_status(p_paid numeric, p_total numeric); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.derive_payment_status(p_paid numeric, p_total numeric) IS 'يشتقّ حالة السداد من (المدفوع مقابل الإجمالي). نقطة الحقيقة الواحدة — لا تُكتب الحالة يدويًا.';

--
-- Name: FUNCTION derive_payment_status(p_paid numeric, p_total numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.derive_payment_status(p_paid numeric, p_total numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.derive_payment_status(p_paid numeric, p_total numeric) TO service_role;


--
-- Name: FUNCTION guard_four_payment_method_catalogue(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_four_payment_method_catalogue() FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_four_payment_method_catalogue() TO service_role;


--
-- Name: customer_payments trg_four_payment_methods_customer_payment; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_customer_payment BEFORE INSERT OR UPDATE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method', 'payment_method_id', 'customer_collection', 'false', 'false');

--
-- Name: customer_payment_splits trg_four_payment_methods_customer_split; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_customer_split BEFORE INSERT OR UPDATE ON public.customer_payment_splits FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('method', 'payment_method_id', 'customer_collection', 'false', 'false');

--
-- Name: expenses trg_four_payment_methods_expense; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_expense BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method', '', 'expenses', 'false', 'false');

--
-- Name: expense_payments trg_four_payment_methods_expense_payment; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_expense_payment BEFORE INSERT OR UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method', 'payment_method_id', 'expenses', 'false', 'false');

--
-- Name: purchase_invoices trg_four_payment_methods_purchase_invoice; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_purchase_invoice BEFORE INSERT OR UPDATE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method', 'payment_method_id', 'purchases', 'true', 'true');

--
-- Name: purchase_returns trg_four_payment_methods_purchase_return; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_purchase_return BEFORE INSERT OR UPDATE ON public.purchase_returns FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('refund_method', 'payment_method_id', 'purchase_returns', 'false', 'true');

--
-- Name: sales_invoices trg_four_payment_methods_sales_invoice; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_sales_invoice BEFORE INSERT OR UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method', 'payment_method_id', 'sales', 'true', 'true');

--
-- Name: sales_returns trg_four_payment_methods_sales_return; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_sales_return BEFORE INSERT OR UPDATE ON public.sales_returns FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('refund_method', 'payment_method_id', 'sales_returns', 'false', 'false');

--
-- Name: supplier_payments trg_four_payment_methods_supplier_payment; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_supplier_payment BEFORE INSERT OR UPDATE ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method', '', 'purchases', 'false', 'false');

--
-- Name: FUNCTION guard_four_payment_method_write(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_four_payment_method_write() FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_four_payment_method_write() TO service_role;


--
-- Name: FUNCTION guard_split_tender_approved(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.guard_split_tender_approved() IS 'لا يقبل في صف تجزئة جديد إلا القنوات الثلاث المعتمدة، ويترك الصفوف التاريخية كما هي.';

--
-- Name: customer_payment_splits trg_split_tender_approved_customer; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_split_tender_approved_customer BEFORE INSERT OR UPDATE OF method ON public.customer_payment_splits FOR EACH ROW EXECUTE FUNCTION public.guard_split_tender_approved('method');

--
-- Name: FUNCTION guard_split_tender_approved(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_split_tender_approved() FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_split_tender_approved() TO service_role;


--
-- Name: FUNCTION payment_method_clean_label(p_label text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_clean_label(p_label text) IS 'تطبيع تسمية طريقة الدفع: قصّ الفراغات وإرجاع NULL للنص الفارغ.';

--
-- Name: FUNCTION payment_method_clean_label(p_label text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_clean_label(p_label text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_clean_label(p_label text) TO service_role;


--
-- Name: FUNCTION payment_method_settings_guard(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_settings_guard() IS 'يمنع توسيع أقسام طريقة الدفع خارج ما يسمح به كتالوج المطورين.';

--
-- Name: FUNCTION payment_method_settings_guard(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_settings_guard() FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_settings_guard() TO service_role;



--
-- Name: FUNCTION post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid) IS 'T-07: ترحيل المصروف للاستحقاق مع قيد أستاذ مزدوج (مصروف+ضريبة مقابل ذمة/نقد/مستحق).';


--
-- Name: FUNCTION post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text) TO service_role;

GRANT ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text) TO authenticated;

--
-- Name: FUNCTION post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid) TO authenticated;

--
-- Name: FUNCTION post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) TO authenticated;

GRANT ALL ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method public.payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) TO service_role;


--
-- Name: FUNCTION post_purchase_invoice(p_invoice_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.post_purchase_invoice(p_invoice_id uuid) IS 'يرحّل فاتورة شراء واحدة بقيود متوازنة، ويوزّع السداد على حساب كل طريقة دفع عند وجود تجزئة.';

--
-- Name: FUNCTION post_purchase_invoice(p_invoice_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_purchase_invoice(p_invoice_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_purchase_invoice(p_invoice_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.post_purchase_invoice(p_invoice_id uuid) TO authenticated;


--
-- Name: FUNCTION post_sales_invoice(p_invoice_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.post_sales_invoice(p_invoice_id uuid) IS 'T-01: يرحّل فاتورة المبيعات بإيراد صافٍ من ضريبة البند — الضريبة تُحمَّل مرة واحدة على 2311.';

--
-- Name: FUNCTION post_sales_invoice(p_invoice_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_sales_invoice(p_invoice_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_sales_invoice(p_invoice_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.post_sales_invoice(p_invoice_id uuid) TO authenticated;


--
-- Name: FUNCTION record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text) IS 'T-10: دفعة مقدمة صريحة بقيد أستاذ (نقد مدين مقابل رصيد دائن للعميل على 1211).';

--
-- Name: FUNCTION record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text) TO service_role;

--
-- Name: record_customer_payment(uuid, uuid, numeric, text, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.record_customer_payment(
    _customer_id, _invoice_id, _amount, _method, _payment_date, _note,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  );
$$;


--
-- Name: FUNCTION record_customer_payment_splits(_customer_id uuid, _invoice_id uuid, _amount numeric, _payment_date date, _note text, _splits jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_customer_payment_splits(_customer_id uuid, _invoice_id uuid, _amount numeric, _payment_date date, _note text, _splits jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_customer_payment_splits(_customer_id uuid, _invoice_id uuid, _amount numeric, _payment_date date, _note text, _splits jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.record_customer_payment_splits(_customer_id uuid, _invoice_id uuid, _amount numeric, _payment_date date, _note text, _splits jsonb) TO service_role;



--
-- Name: FUNCTION record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid) IS 'T-07: دفعة مصروف بقيد أستاذ (نقد/بنك مدين مقابل الذمة الائتمانية).';


--
-- Name: FUNCTION record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text) TO service_role;

GRANT ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text) TO authenticated;

--
-- Name: FUNCTION record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid) TO authenticated;

--
-- Name: FUNCTION record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) TO authenticated;

GRANT ALL ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method public.payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) TO service_role;


--
-- Name: FUNCTION record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date) IS 'T-24: تسجيل سند صرف للمورد وترحيل قيد مزدوج متوازن Dr 2111 / Cr 1101-1111، وتحديث رصيد ودفتر المورد ذرياً.';


--
-- Name: FUNCTION record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date) TO service_role;

GRANT ALL ON FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date) TO authenticated;

--
-- Name: FUNCTION record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date, p_cashbox_id uuid, p_bank_account_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date, p_cashbox_id uuid, p_bank_account_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date, p_cashbox_id uuid, p_bank_account_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_payment_method text, p_account_code text, p_payment_date date, p_notes text, p_due_date date, p_cashbox_id uuid, p_bank_account_id uuid) TO authenticated;


--
-- Name: FUNCTION resolve_document_settlement_account(p_payment_method text, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.resolve_document_settlement_account(p_payment_method text, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) IS 'يحل كود الحساب المحاسبي بدقة بحسب الصندوق المختار، أو البنك/المحفظة، أو أوراق القبض للشيكات، أو بديل الكتالوج.';

--
-- Name: FUNCTION resolve_document_settlement_account(p_payment_method text, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.resolve_document_settlement_account(p_payment_method text, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_document_settlement_account(p_payment_method text, p_cashbox_id uuid, p_bank_account_id uuid, p_payment_method_id text) TO service_role;


--
-- Name: FUNCTION resolve_writable_payment_method(p_value text, p_context text, p_strict_context boolean); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.resolve_writable_payment_method(p_value text, p_context text, p_strict_context boolean) IS 'الحارس الموحّد لكتابة طريقة الدفع: يتحقق من الصلاحية ثم يعيد القيمة المخزّنة. بديل القوائم المضمّنة في دوال الكتابة.';

--
-- Name: FUNCTION resolve_writable_payment_method(p_value text, p_context text, p_strict_context boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.resolve_writable_payment_method(p_value text, p_context text, p_strict_context boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_writable_payment_method(p_value text, p_context text, p_strict_context boolean) TO service_role;


--
-- Name: FUNCTION set_payment_method_default_account(p_method_id text, p_account_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.set_payment_method_default_account(p_method_id text, p_account_id uuid) IS 'تربط طريقة الدفع بحساب فرعي من عائلتها (صندوق/بنك/محفظة)، أو ترجعها للافتراضي بإرسال NULL.';

--
-- Name: FUNCTION set_payment_method_default_account(p_method_id text, p_account_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_payment_method_default_account(p_method_id text, p_account_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_payment_method_default_account(p_method_id text, p_account_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.set_payment_method_default_account(p_method_id text, p_account_id uuid) TO service_role;


--
-- Name: TABLE cashboxes; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.cashboxes IS 'صناديق وخزائن المنشأة ونقاط البيع، مع ربط كل صندوق بحسابه في الدليل المحاسبي.';

--
-- Name: cashboxes cashboxes_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cashboxes
    ADD CONSTRAINT cashboxes_code_key UNIQUE (code);

--
-- Name: cashboxes cashboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cashboxes
    ADD CONSTRAINT cashboxes_pkey PRIMARY KEY (id);

--
-- Name: ix_cashboxes_account; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_cashboxes_account ON public.cashboxes USING btree (account_id);

--
-- Name: ix_cashboxes_active; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_cashboxes_active ON public.cashboxes USING btree (is_active, is_default);

--
-- Name: ix_cashboxes_warehouse; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_cashboxes_warehouse ON public.cashboxes USING btree (warehouse_id);

--
-- Name: cashboxes; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.cashboxes ENABLE ROW LEVEL SECURITY;

--
-- Name: cashboxes cashboxes_admin; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cashboxes_admin ON public.cashboxes TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: cashboxes cashboxes_select; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cashboxes_select ON public.cashboxes FOR SELECT TO authenticated USING (true);

--
-- Name: TABLE cashboxes; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cashboxes TO service_role;

GRANT SELECT ON TABLE public.cashboxes TO authenticated;


--
-- Name: TABLE company_bank_accounts; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.company_bank_accounts IS 'الحسابات البنكية والمحافظ الإلكترونية للمنشأة للتسوية والتحصيلات البنكية والإلكترونية.';

--
-- Name: company_bank_accounts company_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_bank_accounts
    ADD CONSTRAINT company_bank_accounts_pkey PRIMARY KEY (id);

--
-- Name: ix_company_bank_accounts_account; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_company_bank_accounts_account ON public.company_bank_accounts USING btree (account_id);

--
-- Name: ix_company_bank_accounts_kind; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_company_bank_accounts_kind ON public.company_bank_accounts USING btree (kind, is_active, is_default);

--
-- Name: company_bank_accounts; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: company_bank_accounts company_bank_accounts_admin; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY company_bank_accounts_admin ON public.company_bank_accounts TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: company_bank_accounts company_bank_accounts_select; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY company_bank_accounts_select ON public.company_bank_accounts FOR SELECT TO authenticated USING (true);

--
-- Name: TABLE company_bank_accounts; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.company_bank_accounts TO service_role;

GRANT SELECT ON TABLE public.company_bank_accounts TO authenticated;


--
-- Name: TABLE payment_account_archive; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.payment_account_archive IS 'لقطة غير قابلة للتحرير من حسابات الدفع الموحّدة؛ تحفظ الكود والهوية والحساب الهدف.';

--
-- Name: payment_account_archive payment_account_archive_identity_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_account_archive
    ADD CONSTRAINT payment_account_archive_identity_key UNIQUE (archived_account_id);

--
-- Name: payment_account_archive payment_account_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_account_archive
    ADD CONSTRAINT payment_account_archive_pkey PRIMARY KEY (id);

--
-- Name: payment_account_archive; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_account_archive ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_account_archive payment_account_archive_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY payment_account_archive_finance_read ON public.payment_account_archive FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE payment_account_archive; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.payment_account_archive TO authenticated;

GRANT ALL ON TABLE public.payment_account_archive TO service_role;


--
-- Name: TABLE payment_account_journal_archive; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.payment_account_journal_archive IS 'يحفظ الحساب التاريخي لكل سطر قيد قبل تحويله إلى حساب الدفع الموحد.';

--
-- Name: payment_account_journal_archive payment_account_journal_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_account_journal_archive
    ADD CONSTRAINT payment_account_journal_archive_pkey PRIMARY KEY (journal_line_id);

--
-- Name: payment_account_journal_archive; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_account_journal_archive ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_account_journal_archive payment_account_journal_archive_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY payment_account_journal_archive_finance_read ON public.payment_account_journal_archive FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE payment_account_journal_archive; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.payment_account_journal_archive TO authenticated;

GRANT ALL ON TABLE public.payment_account_journal_archive TO service_role;


--
-- Name: TABLE payment_account_reference_archive; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.payment_account_reference_archive IS 'يحفظ الصفوف التي تشير إلى حساب الدفع القديم قبل تحويل مراجعها إلى الحساب الموحد.';

--
-- Name: payment_account_reference_archive payment_account_reference_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_account_reference_archive
    ADD CONSTRAINT payment_account_reference_archive_pkey PRIMARY KEY (id);

--
-- Name: payment_account_reference_archive; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_account_reference_archive ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_account_reference_archive payment_account_reference_archive_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY payment_account_reference_archive_finance_read ON public.payment_account_reference_archive FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE payment_account_reference_archive; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.payment_account_reference_archive TO authenticated;

GRANT ALL ON TABLE public.payment_account_reference_archive TO service_role;


--
-- Name: TABLE payment_method_settings; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.payment_method_settings IS 'تخصيص العميل: تفعيل كل طريقة، ترتيب عرضها، والأقسام التي تظهر فيها.';

--
-- Name: COLUMN payment_method_settings.enabled_contexts; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_method_settings.enabled_contexts IS 'أقسام ظهور هذه الطريقة لهذه المنشأة. NULL أو صف غائب = ترث أقسام الكتالوج. مصفوفة فارغة = مُعطَّلة في كل الأقسام عن قصد.';

--
-- Name: COLUMN payment_method_settings.updated_by_platform; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_method_settings.updated_by_platform IS 'true = آخر تعديل جاء من مسؤول منصة (سوبر أدمن)، لا من المنشأة نفسها.';

--
-- Name: payment_method_settings payment_method_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_method_settings
    ADD CONSTRAINT payment_method_settings_pkey PRIMARY KEY (payment_method_id);

--
-- Name: ix_payment_method_settings_order; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_payment_method_settings_order ON public.payment_method_settings USING btree (enabled, sort_order);

--
-- Name: payment_method_settings payment_method_settings_context_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER payment_method_settings_context_guard BEFORE INSERT OR UPDATE ON public.payment_method_settings FOR EACH ROW EXECUTE FUNCTION public.payment_method_settings_guard();

--
-- Name: payment_method_settings payment_method_settings_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER payment_method_settings_updated BEFORE UPDATE ON public.payment_method_settings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: payment_method_settings; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_method_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_method_settings payment_method_settings read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "payment_method_settings read" ON public.payment_method_settings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: payment_method_settings payment_method_settings write; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "payment_method_settings write" ON public.payment_method_settings TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: TABLE payment_method_settings; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.payment_method_settings TO service_role;

GRANT SELECT ON TABLE public.payment_method_settings TO authenticated;


--
-- Name: payment_method_settings_archive payment_method_settings_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_method_settings_archive
    ADD CONSTRAINT payment_method_settings_archive_pkey PRIMARY KEY (payment_method_id);

--
-- Name: payment_method_settings_archive; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_method_settings_archive ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_method_settings_archive payment_method_settings_archive_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY payment_method_settings_archive_finance_read ON public.payment_method_settings_archive FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE payment_method_settings_archive; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.payment_method_settings_archive TO authenticated;

GRANT ALL ON TABLE public.payment_method_settings_archive TO service_role;

--
-- Name: payment_method_catalog_id(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_catalog_id(p_stored text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT m.id
  FROM public.payment_methods m
  WHERE lower(btrim(coalesce(p_stored, ''))) = ANY (m.legacy_ids)
  ORDER BY m.sort_order, m.id
  LIMIT 1;
$$;

--
-- Name: payment_method_catalog_view(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_catalog_view() RETURNS TABLE(id text, name_ar text, name_en text, icon_key text, ledger_kind text, default_account_code text, is_credit_term boolean, is_active boolean, sort_order integer, allowed_contexts text[], legacy_id text, is_system boolean, requires_reference boolean, enabled boolean, effective_sort_order integer, effective_contexts text[], is_configured boolean, is_renamed boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: payment_method_legacy_id(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_legacy_id(p_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH norm AS (
    SELECT lower(btrim(coalesce(p_id, ''))) AS v
  ),
  direct AS (
    SELECT n.v
    FROM norm n
    WHERE n.v <> ''
      AND EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace ns ON ns.oid = t.typnamespace
        WHERE ns.nspname = 'public' AND t.typname = 'payment_method'
          AND e.enumlabel = n.v
      )
  ),
  via_catalog AS (
    SELECT coalesce(
             -- 1. القيمة التي يصرّح بها الصف. هنا تحمل الطريقة التي أنشأتها المنشأة
             --    هويتها.
             nullif(m.legacy_id, ''),
             -- 2. القائمة التاريخية، لأي صف يسبق وجود هذا العمود.
             nullif(m.legacy_ids[1], ''),
             -- 3. عائلة الحساب. ومؤسسة مسمّاة يشحنها الكتالوج الموحّد تحمل قائمة
             --    legacy **فارغة** عن قصد — فهي تتشارك قيمة bank_transfer /
             --    mobile_money العامة — فأدناه جواب حقيقي لها لا بديل مؤقت. وهو
             --    ما يمنع «البنك» من الهبوط على الصندوق أبدًا.
             CASE m.ledger_kind
               WHEN 'BANK'   THEN 'bank_transfer'
               WHEN 'WALLET' THEN 'mobile_money'
               WHEN 'CARD'   THEN 'card'
               WHEN 'CREDIT' THEN 'credit'
               WHEN 'CASH'   THEN 'cash'
               ELSE 'cash'
             END
           ) AS v
    FROM public.payment_methods m, norm n
    WHERE m.id = n.v
  )
  SELECT coalesce(
    (SELECT v FROM direct),
    (SELECT v FROM via_catalog),
    -- لا يصل إلى هنا إلا معرّف لا يعرفه الكتالوج فعلًا. فالكاشير لا يمكنه قبول
    -- مال بطريقة لا نعرفها، فهذا عمدًا النقد العام الأمين بدل NULL في عمود فاتورة.
    'cash'
  );
$$;

--
-- Name: payment_methods_seed_is_identity_owned(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_methods_seed_is_identity_owned(p_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_methods m
    JOIN public.payment_method_settings s ON s.payment_method_id = m.id
    WHERE m.id = p_id
      AND s.updated_by_platform = false
      AND s.payment_method_id IS NOT NULL
      AND m.is_system
      -- لا يُعدّ مؤلَّفًا إلا صف لمسته المنشأة فعلًا.
      AND m.updated_at > m.created_at
  );
$$;

--
-- Name: remove_tenant_payment_method(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.remove_tenant_payment_method(p_id text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_row   public.payment_methods;
  v_in_use boolean;
  v_legacy text;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية حذف طرق الدفع'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `payment_methods.id` is qualified so it is the COLUMN and not a variable.
  SELECT * INTO v_row FROM public.payment_methods WHERE public.payment_methods.id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طريقة الدفع "%" غير موجودة', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_row.is_system THEN
    RAISE EXCEPTION
      'لا يمكن حذف طريقة دفع نظامية (%) — عطّلها أو غيّر تسميتها بدلاً من ذلك', p_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_legacy := v_row.legacy_id;

  -- هل القيمة المخزّنة ما زالت على مستند؟ لا تصل إلى هنا إلا طرق المنشأة **نفسها**،
  -- وقيمتها المخزّنة مشتركة مع الطريقة العامة للعائلة نفسها، فهذا سؤال حقيقي فقط
  -- عندما تكون الطريقة جديدة كليًا.
  SELECT EXISTS (
    SELECT 1 FROM public.customer_payment_splits s WHERE s.method::text = v_legacy
    UNION ALL
    SELECT 1 FROM public.sales_returns  r WHERE r.refund_method::text = v_legacy
    UNION ALL
    SELECT 1 FROM public.purchase_returns r WHERE r.refund_method::text = v_legacy
    UNION ALL
    SELECT 1 FROM public.expenses e WHERE e.payment_method::text = v_legacy
  ) INTO v_in_use;

  IF v_in_use THEN
    RAISE EXCEPTION
      'طريقة الدفع "%" مستخدمة في مستندات قائمة — عطّلها (Disabled) بدلاً من حذفها', p_id
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, payload)
  VALUES (
    auth.uid(), 'payment_method.deleted', 'payment_method',
    jsonb_build_object(
      'id', p_id, 'name_ar', v_row.name_ar, 'legacy_id', v_legacy,
      'by_platform', public.is_platform_superadmin(auth.uid())
    ));

  DELETE FROM public.payment_methods WHERE public.payment_methods.id = p_id;
END $$;

--
-- Name: update_payment_method_identity(text, text, text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.update_payment_method_identity(p_id text, p_name_ar text DEFAULT NULL::text, p_name_en text DEFAULT NULL::text, p_icon_key text DEFAULT NULL::text) RETURNS TABLE(id text, name_ar text, name_en text, icon_key text, is_system boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_row       public.payment_methods;
  v_name_ar   text;
  v_name_en   text;
  v_icon_key  text;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل طرق الدفع — هذه الصلاحية لصاحب المنشأة والمدير وسوبر أدمن المنصة'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `payment_methods.id` مُؤهّل عن قصد: فـ `id` غير المؤهّل داخل دالة plpgsql
  -- تحمل معامل OUT باسم `id` يُحلّ إلى **المعامل** لا العمود، فيطابق البحث لا شيء
  -- بصمت.
  SELECT * INTO v_row FROM public.payment_methods WHERE public.payment_methods.id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طريقة الدفع "%" غير موجودة في الكتالوج', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- تُحلّ القيم الثلاث الجديدة **قبل** التحديث، حتى لا تشير قائمة SET في UPDATE
  -- إلا إلى متغيّرات عادية. فداخل دالة RETURNS TABLE، يكون `name_ar` غير المؤهّل
  -- في تعبير هو معامل OUT — قابل للكتابة في PostgreSQL >= 14 وخطأ قبلها. والإسناد
  -- إلى متغيرات محلية أولًا يجعل الجملة تعني الشيء نفسه على كل نسخة مدعومة.

  -- لا يجوز أن تُفرِغ إعادة التسمية طريقةً من الصندوق.
  IF p_name_ar IS NOT NULL AND public.payment_method_clean_label(p_name_ar) IS NULL THEN
    RAISE EXCEPTION 'اسم طريقة الدفع لا يمكن أن يكون فارغاً'
      USING ERRCODE = 'check_violation';
  END IF;

  v_name_ar  := coalesce(public.payment_method_clean_label(p_name_ar), v_row.name_ar);
  v_name_en  := CASE
                  WHEN p_name_en IS NULL THEN v_row.name_en
                  ELSE public.payment_method_clean_label(p_name_en)
                END;
  v_icon_key := coalesce(public.payment_method_clean_label(p_icon_key), v_row.icon_key);

  UPDATE public.payment_methods m
     SET name_ar    = v_name_ar,
         name_en    = v_name_en,
         icon_key   = v_icon_key,
         updated_at = now()
   WHERE m.id = p_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, payload)
  VALUES (
    auth.uid(),
    'payment_method.identity.updated',
    'payment_method',
    jsonb_build_object(
      'id', p_id,
      'before', jsonb_build_object(
        'name_ar', v_row.name_ar, 'name_en', v_row.name_en, 'icon_key', v_row.icon_key),
      'after',  jsonb_build_object(
        'name_ar', v_name_ar, 'name_en', v_name_en, 'icon_key', v_icon_key),
      'by_platform', public.is_platform_superadmin(auth.uid())
    ));

  RETURN QUERY
    SELECT m.id::text, m.name_ar::text, m.name_en::text, m.icon_key::text, m.is_system::boolean
    FROM public.payment_methods m
    WHERE m.id = p_id;
END $$;


--
-- Name: TABLE payment_methods; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.payment_methods IS 'كتالوج طرق الدفع الذي يجهّزه المطورون. العميل لا ينشئ صفوفاً هنا؛ يختار ويفعّل فقط.';

--
-- Name: COLUMN payment_methods.icon_key; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.icon_key IS 'مفتاح أيقونة مركزي يُحلّ إلى مكوّن داخل الحزمة (ليس رابطاً). قائمة المفاتيح المتاحة للعميل في src/lib/payments/payment-methods.ts.';

--
-- Name: COLUMN payment_methods.ledger_kind; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.ledger_kind IS 'عائلة الحساب (صندوق/بنك/محفظة/بطاقة/آجل). يستخدمها محرك الترحيل بدل تعداد قيم الـEnum.';

--
-- Name: COLUMN payment_methods.default_account_code; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.default_account_code IS 'ربط محاسبي مستقبلي: payment_method → account. إرشادي في هذه المرحلة.';

--
-- Name: COLUMN payment_methods.legacy_ids; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.legacy_ids IS 'قيم public.payment_method التي تمثّلها هذه الطريقة، لعرض الفواتير التاريخية من الكتالوج.';

--
-- Name: COLUMN payment_methods.created_by; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.created_by IS 'من أنشأ الطريقة. NULL = أنشأها المطورون في ترحيل، لا منشأة.';

--
-- Name: COLUMN payment_methods.is_system; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.is_system IS 'true = صف يملكه المطورون. لا تحذفه منشأة، ولا يغيّر أحدٌ نوع حسابه.';

--
-- Name: COLUMN payment_methods.legacy_id; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.legacy_id IS 'القيمة المخزّنة التي تُسوّى عليها الطريقة. للصفوف النظامية = legacy_ids[1]، وللصفوف التي أنشأتها منشأة يختارها المنشئ من ضمن الـEnum.';

--
-- Name: COLUMN payment_methods.default_ledger_kind; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.default_ledger_kind IS 'نوع الحساب الذي اقترحته المنشأة عند الإنشاء. للعرض والتشخيص فقط؛ المحرّك يقرأ ledger_kind.';

--
-- Name: COLUMN payment_methods.shipped_name_ar; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.payment_methods.shipped_name_ar IS 'الاسم العربي كما شحنه المطورون في البذرة. لا يُعدَّل بعد الزرع، ويُقارَن به name_ar لمعرفة إن كانت المنشأة قد أعادت التسمية.';

--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);

--
-- Name: ix_payment_methods_legacy_ids; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_payment_methods_legacy_ids ON public.payment_methods USING gin (legacy_ids);

--
-- Name: ix_payment_methods_order; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_payment_methods_order ON public.payment_methods USING btree (is_active, sort_order, id);

--
-- Name: ix_payment_methods_system; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_payment_methods_system ON public.payment_methods USING btree (is_system, is_active, sort_order);

--
-- Name: payment_methods payment_methods_authoring_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER payment_methods_authoring_guard BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.payment_methods_authoring_guard();

--
-- Name: payment_methods payment_methods_delete_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER payment_methods_delete_guard BEFORE DELETE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.payment_methods_delete_guard();

--
-- Name: payment_methods payment_methods_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER payment_methods_updated BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: payment_methods trg_four_payment_method_catalogue; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_method_catalogue BEFORE INSERT OR UPDATE OF id, is_active ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_catalogue();

--
-- Name: payment_methods; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_methods payment_methods platform delete; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "payment_methods platform delete" ON public.payment_methods FOR DELETE TO authenticated USING (public.is_platform_superadmin(auth.uid()));

--
-- Name: payment_methods payment_methods read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "payment_methods read" ON public.payment_methods FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: payment_methods payment_methods tenant insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "payment_methods tenant insert" ON public.payment_methods FOR INSERT TO authenticated WITH CHECK (public.is_platform_superadmin(auth.uid()));

--
-- Name: payment_methods payment_methods tenant update; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "payment_methods tenant update" ON public.payment_methods FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.is_platform_superadmin(auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.is_platform_superadmin(auth.uid())));

--
-- Name: TABLE payment_methods; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.payment_methods TO service_role;

GRANT SELECT ON TABLE public.payment_methods TO authenticated;


--
-- Name: TABLE payment_methods_catalog_archive; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.payment_methods_catalog_archive IS 'نسخ صفوف طرق الدفع المتقاعدة قبل حذفها، مع عدد المستندات التي كانت تشير إليها.';

--
-- Name: payment_methods_catalog_archive payment_methods_catalog_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_methods_catalog_archive
    ADD CONSTRAINT payment_methods_catalog_archive_pkey PRIMARY KEY (id);

--
-- Name: payment_methods_catalog_archive; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_methods_catalog_archive ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_methods_catalog_archive payment_methods_catalog_archive_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY payment_methods_catalog_archive_finance_read ON public.payment_methods_catalog_archive FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: TABLE payment_methods_catalog_archive; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.payment_methods_catalog_archive TO authenticated;

GRANT ALL ON TABLE public.payment_methods_catalog_archive TO service_role;


--
-- Name: TABLE payment_splits; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.payment_splits IS 'تفصيل الدفعة الواحدة على أكثر من طريقة دفع. كل صف = طريقة تحصيل فعلية بمبلغها. الآجل لا يُسجّل هنا لأنه دين لا تحصيل.';

--
-- Name: payment_splits payment_splits_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_splits
    ADD CONSTRAINT payment_splits_pkey PRIMARY KEY (id);

--
-- Name: payment_splits_document_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX payment_splits_document_idx ON public.payment_splits USING btree (document_type, document_id);

--
-- Name: payment_splits trg_four_payment_methods_purchase_milling_split; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_four_payment_methods_purchase_milling_split BEFORE INSERT OR UPDATE ON public.payment_splits FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('method', 'payment_method_id', 'document', 'false', 'false');

--
-- Name: payment_splits trg_split_tender_approved_document; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_split_tender_approved_document BEFORE INSERT OR UPDATE OF method ON public.payment_splits FOR EACH ROW EXECUTE FUNCTION public.guard_split_tender_approved('method');

--
-- Name: payment_splits; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_splits payment_splits_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY payment_splits_insert ON public.payment_splits FOR INSERT TO authenticated WITH CHECK (false);

--
-- Name: payment_splits payment_splits_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY payment_splits_read ON public.payment_splits FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role) OR public.has_role(auth.uid(), 'cashier'::public.app_role)));

--
-- Name: TABLE payment_splits; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.payment_splits TO authenticated;

GRANT ALL ON TABLE public.payment_splits TO service_role;


--
-- Name: FUNCTION record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text) IS 'T-10: تحصيل بقيد أستاذ (نقد/بنك مدين مقابل ذمم) — التوزيع على الأقدم بلا تغيير.';


--
-- Name: FUNCTION record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text) TO service_role;

GRANT ALL ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text) TO authenticated;

--
-- Name: FUNCTION record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text, _cashbox_id uuid, _bank_account_id uuid, _payment_method_id text, _cheque_number text, _cheque_bank text, _cheque_due_date date, _cheque_drawer text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text, _cashbox_id uuid, _bank_account_id uuid, _payment_method_id text, _cheque_number text, _cheque_bank text, _cheque_due_date date, _cheque_drawer text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text, _cashbox_id uuid, _bank_account_id uuid, _payment_method_id text, _cheque_number text, _cheque_bank text, _cheque_due_date date, _cheque_drawer text) TO service_role;

GRANT ALL ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text, _cashbox_id uuid, _bank_account_id uuid, _payment_method_id text, _cheque_number text, _cheque_bank text, _cheque_due_date date, _cheque_drawer text) TO authenticated;


--
-- Name: FUNCTION payment_method_catalog_id(p_stored text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_catalog_id(p_stored text) IS 'يعيد معرّف الكتالوج المقابل لقيمة مخزّنة، لعرض الفواتير التاريخية من الكتالوج.';

--
-- Name: payment_method_resolve_id(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_resolve_id(p_value text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH norm AS (
    SELECT lower(btrim(coalesce(p_value, ''))) AS v
  )
  SELECT coalesce(
    -- 1. معرّف كتالوجي مطابق يفوز مباشرةً.
    (SELECT m.id FROM public.payment_methods m, norm n WHERE m.id = n.v),
    -- 2. قيمة ENUM مطابقة تُحلّ إلى الصف المرجعي لتلك القيمة.
    (SELECT public.payment_method_catalog_id(n.v) FROM norm n WHERE n.v <> ''),
    -- 3. غير قابلة للحل: تُعاد كما هي ليبلّغ المستدعي بأمانة بدل أن يستبدل
    --    صامتًا طريقة لم يخترها المشغّل.
    (SELECT nullif(n.v, '') FROM norm n)
  );
$$;

--
-- Name: FUNCTION payment_method_catalog_id(p_stored text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_catalog_id(p_stored text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_catalog_id(p_stored text) TO service_role;


--
-- Name: FUNCTION payment_method_catalog_view(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_catalog_view() IS 'عرض موحّد لطرق الدفع مع تخصيص المنشأة والأسماء المعدّلة، لاستخدامه في التقارير والإعدادات دون خرائط محلية.';

--
-- Name: FUNCTION payment_method_catalog_view(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_catalog_view() FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_catalog_view() TO service_role;

GRANT ALL ON FUNCTION public.payment_method_catalog_view() TO authenticated;


--
-- Name: FUNCTION payment_method_legacy_id(p_id text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_legacy_id(p_id text) IS 'يحوّل معرّف الكتالوج إلى القيمة التي يفهمها عمود payment_method. يقرأ legacy_id أولاً لدعم الطرق التي أنشأتها المنشأة.';

--
-- Name: FUNCTION payment_method_legacy_id(p_id text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_legacy_id(p_id text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_legacy_id(p_id text) TO service_role;


--
-- Name: FUNCTION payment_methods_seed_is_identity_owned(p_id text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_methods_seed_is_identity_owned(p_id text) IS 'هل عدّلت المنشأة اسم/أيقونة هذه الطريقة؟ يستخدمه الـSeed لاحقاً ليحترم التعديل؛ الترحيلات التي تزرع لا تضرب صفوف المنشأة.';

--
-- Name: FUNCTION payment_methods_seed_is_identity_owned(p_id text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_methods_seed_is_identity_owned(p_id text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_methods_seed_is_identity_owned(p_id text) TO service_role;


--
-- Name: FUNCTION remove_tenant_payment_method(p_id text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.remove_tenant_payment_method(p_id text) IS 'حذف طريقة دفع أنشأتها المنشأة. يرفض الحذف إذا كانت الطريقة مستخدمة في مستندات قائمة، ويطلب تعطيلها بدلاً من ذلك.';

--
-- Name: FUNCTION remove_tenant_payment_method(p_id text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.remove_tenant_payment_method(p_id text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.remove_tenant_payment_method(p_id text) TO service_role;

GRANT ALL ON FUNCTION public.remove_tenant_payment_method(p_id text) TO authenticated;


--
-- Name: FUNCTION update_payment_method_identity(p_id text, p_name_ar text, p_name_en text, p_icon_key text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.update_payment_method_identity(p_id text, p_name_ar text, p_name_en text, p_icon_key text) IS 'تعديل اسم طريقة الدفع وأيقونتها. لا يمسّ نوع الحساب ولا القيمة المخزّنة، ولا يسمح بتسمية فارغة.';

--
-- Name: FUNCTION update_payment_method_identity(p_id text, p_name_ar text, p_name_en text, p_icon_key text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.update_payment_method_identity(p_id text, p_name_ar text, p_name_en text, p_icon_key text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_payment_method_identity(p_id text, p_name_ar text, p_name_en text, p_icon_key text) TO service_role;

GRANT ALL ON FUNCTION public.update_payment_method_identity(p_id text, p_name_ar text, p_name_en text, p_icon_key text) TO authenticated;


--
-- Name: FUNCTION payment_methods_authoring_guard(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_methods_authoring_guard() IS 'يسمح للمنشأة بتعديل الاسم والأيقونة، ويمنعها من تغيير نوع الحساب أو القيمة المخزّنة لطريقة نظامية.';

--
-- Name: FUNCTION payment_methods_authoring_guard(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_methods_authoring_guard() FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_methods_authoring_guard() TO service_role;


--
-- Name: FUNCTION payment_methods_delete_guard(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_methods_delete_guard() IS 'يمنع حذف طريقة نظامية؛ ويقصر حذف طرق المنشأة على المالك أو المدير.';

--
-- Name: FUNCTION payment_methods_delete_guard(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_methods_delete_guard() FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_methods_delete_guard() TO service_role;

--
-- Name: payment_method_is_allowed(text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_is_allowed(p_value text, p_context text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH resolved AS (
    SELECT public.payment_method_resolve_id(p_value) AS id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_methods m
    LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
    CROSS JOIN resolved r
    WHERE m.id = r.id
      -- يمكن للمطورين إيقاف طريقة في كل مكان بلا حذفها.
      AND m.is_active
      AND coalesce(s.enabled, true)
      AND p_context = ANY (
        CASE
          WHEN coalesce(cardinality(s.enabled_contexts), 0) > 0
            THEN s.enabled_contexts
          ELSE m.allowed_contexts
        END
      )
  );
$$;

--
-- Name: payment_method_ledger_account(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_ledger_account(p_stored text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE lower(btrim(coalesce(p_stored, '')))
    WHEN 'credit' THEN NULL
    WHEN 'split' THEN NULL
    WHEN 'cash' THEN '1101'
    WHEN 'bank' THEN '1111'
    WHEN 'bank_transfer' THEN '1111'
    WHEN 'card' THEN '1111'
    WHEN 'kuraimi_bank' THEN '1111'
    WHEN 'yemen_kuwait_bank' THEN '1111'
    WHEN 'cheque' THEN '1221'
    WHEN 'mobile_money' THEN '1131'
    WHEN 'wallet' THEN '1131'
    WHEN 'jawali' THEN '1131'
    WHEN 'jaib' THEN '1131'
    WHEN 'floosak' THEN '1131'
    WHEN 'one_cash' THEN '1131'
    ELSE m.default_account_code
  END
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.payment_methods m ON m.id = public.payment_method_resolve_id(p_stored);
$$;


--
-- Name: FUNCTION payment_method_resolve_id(p_value text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_resolve_id(p_value text) IS 'يطبّع أي قيمة واردة من الواجهة إلى معرّف كتالوجي، دون تخمين صامت.';

--
-- Name: FUNCTION payment_method_resolve_id(p_value text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_resolve_id(p_value text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_resolve_id(p_value text) TO service_role;


--
-- Name: FUNCTION payment_method_is_allowed(p_value text, p_context text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_is_allowed(p_value text, p_context text) IS 'هل طريقة الدفع مفعّلة ومسموح بها في هذا القسم لهذه المنشأة؟ الحارس الوحيد في النظام.';

--
-- Name: FUNCTION payment_method_is_allowed(p_value text, p_context text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_is_allowed(p_value text, p_context text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_is_allowed(p_value text, p_context text) TO service_role;

--
-- Name: ledger_account_code_for_payment_method(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.ledger_account_code_for_payment_method(p_payment_method text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  SELECT public.payment_method_ledger_account($1);
$_$;

--
-- Name: payment_method_account_linkage(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.payment_method_account_linkage() RETURNS TABLE(method_id text, method_name text, ledger_kind text, is_active boolean, account_code text, account_name text, account_exists boolean, account_postable boolean, is_healthy boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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
      -- لا تحصيل نقدي بهاتين الحالتين: آجل دين، وsplit وصف مستند.
      WHEN m.ledger_kind IN ('CREDIT', 'OTHER') THEN true
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
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  LEFT JOIN public.accounts sa ON sa.id = s.default_account_id
  LEFT JOIN public.accounts ga ON ga.code = l.account_code
  ORDER BY m.sort_order, m.id;
$$;


--
-- Name: FUNCTION payment_method_ledger_account(p_stored text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_ledger_account(p_stored text) IS 'الحساب الذي تُسوّى إليه طريقة الدفع. يعيد NULL للآجل لأن شيئاً لم يُحصَّل.';

--
-- Name: FUNCTION payment_method_ledger_account(p_stored text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_ledger_account(p_stored text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_ledger_account(p_stored text) TO service_role;


--
-- Name: FUNCTION ledger_account_code_for_payment_method(p_payment_method text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.ledger_account_code_for_payment_method(p_payment_method text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.ledger_account_code_for_payment_method(p_payment_method text) TO service_role;


--
-- Name: FUNCTION payment_method_account_linkage(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.payment_method_account_linkage() IS 'لكل طريقة: الحساب الذي ربطته المنشأة أو العام لعائلتها، وسلامته. آجل وsplit سليمان بلا حساب لأنهما لا يحصّلان.';

--
-- Name: FUNCTION payment_method_account_linkage(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.payment_method_account_linkage() FROM PUBLIC;

GRANT ALL ON FUNCTION public.payment_method_account_linkage() TO authenticated;

GRANT ALL ON FUNCTION public.payment_method_account_linkage() TO service_role;
