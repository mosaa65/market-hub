-- ============================================================================
-- الترحيل 004_partners_and_ledgers.sql — مجال: partners_and_ledgers
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: get_supplier_statement(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.get_supplier_statement(p_supplier_id uuid, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(id uuid, occurred_at timestamp with time zone, entry_type text, debit numeric, credit numeric, running_balance numeric, reference_type text, reference_id uuid, due_date date, note text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Only finance roles may read supplier statements'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH ordered_entries AS (
      SELECT sl.id, sl.occurred_at, sl.entry_type, sl.debit, sl.credit,
        SUM(sl.credit - sl.debit) OVER (ORDER BY sl.occurred_at ASC, sl.id ASC) AS running_balance,
        sl.reference_type, sl.reference_id, sl.due_date, sl.note
      FROM public.supplier_ledger sl
      WHERE sl.supplier_id = p_supplier_id
    )
    SELECT oe.id, oe.occurred_at, oe.entry_type, oe.debit, oe.credit, oe.running_balance,
      oe.reference_type, oe.reference_id, oe.due_date, oe.note
    FROM ordered_entries oe
    WHERE (p_start_date IS NULL OR oe.occurred_at >= p_start_date)
      AND (p_end_date IS NULL OR oe.occurred_at <= p_end_date)
    ORDER BY oe.occurred_at DESC, oe.id DESC;
END;
$$;

--
-- Name: next_supplier_voucher_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_supplier_voucher_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_seq bigint;
  v_prefix text;
BEGIN
  v_seq := nextval('public.supplier_payment_seq');
  v_prefix := 'PV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  RETURN v_prefix || lpad(v_seq::text, 4, '0');
END;
$$;

--
-- Name: tg_suppliers_system_guard(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_suppliers_system_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION
        'The system cash supplier is a protected system entity and cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    IF NEW.is_system IS DISTINCT FROM true OR NEW.system_key IS DISTINCT FROM OLD.system_key THEN
      RAISE EXCEPTION
        'The system cash supplier flag cannot be cleared or re-keyed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION
        'The system cash supplier cannot be renamed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'The system cash supplier cannot be deactivated'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF coalesce(NEW.balance, 0) <> 0 THEN
      RAISE EXCEPTION
        'The system cash supplier must keep a zero balance (got %)', NEW.balance
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.is_system THEN
      RAISE EXCEPTION
        'System entities are provisioned by the seed, not created through the API'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IN ('مورد نقدي') THEN
      RAISE EXCEPTION
        'That name is reserved for the system cash supplier'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

--
-- Name: cheques_register; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.cheques_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cheque_number text NOT NULL,
    bank_name text NOT NULL,
    drawer_name text,
    due_date date NOT NULL,
    amount numeric(18,2) NOT NULL,
    status text DEFAULT 'UNDER_COLLECTION'::text NOT NULL,
    customer_id uuid,
    invoice_id uuid,
    payment_id uuid,
    clearing_bank_account_id uuid,
    clearing_journal_entry_id uuid,
    cleared_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cheques_register_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT cheques_register_status_check CHECK ((status = ANY (ARRAY['UNDER_COLLECTION'::text, 'CLEARED'::text, 'BOUNCED'::text, 'RETURNED'::text]))),
    CONSTRAINT cheques_register_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: customers; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    credit_limit numeric(14,2) DEFAULT 0 NOT NULL,
    balance numeric(14,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    loyalty_points numeric DEFAULT 0 NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    system_key text,
    CONSTRAINT customers_credit_limit_nonnegative CHECK ((credit_limit >= (0)::numeric)),
    CONSTRAINT customers_system_flag_shape CHECK ((is_system = (system_key IS NOT NULL)))
);

--
-- Name: customer_balance_adjustments; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.customer_balance_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    previous_balance numeric(14,2) NOT NULL,
    new_balance numeric(14,2) NOT NULL,
    ledger_balance numeric(14,2) NOT NULL,
    difference numeric(14,2) NOT NULL,
    reason text NOT NULL,
    correction_type text NOT NULL,
    actor_id uuid,
    document_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_balance_adjustments_type_check CHECK ((correction_type = ANY (ARRAY['recalculation'::text, 'document_repost'::text]))),
    CONSTRAINT customer_balance_adjustments_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: customer_ledger; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.customer_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    entry_type text NOT NULL,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    reference_id uuid,
    reference_type text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    note text,
    source_key text,
    CONSTRAINT customer_ledger_check CHECK ((NOT ((debit > (0)::numeric) AND (credit > (0)::numeric)))),
    CONSTRAINT customer_ledger_check1 CHECK (((debit + credit) > (0)::numeric)),
    CONSTRAINT customer_ledger_credit_check CHECK ((credit >= (0)::numeric)),
    CONSTRAINT customer_ledger_debit_check CHECK ((debit >= (0)::numeric)),
    CONSTRAINT customer_ledger_entry_type_check CHECK ((entry_type = ANY (ARRAY['sale'::text, 'payment'::text, 'return'::text, 'adjustment'::text, 'credit'::text]))),
    CONSTRAINT customer_ledger_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: customer_payment_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.customer_payment_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: customer_payment_splits; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.customer_payment_splits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    invoice_id uuid,
    payment_id uuid,
    method public.payment_method NOT NULL,
    amount numeric(14,2) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    reference_no text,
    CONSTRAINT customer_payment_splits_amount_check CHECK ((amount > (0)::numeric))
);

--
-- Name: customer_payments; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.customer_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    invoice_id uuid,
    amount numeric(14,2) NOT NULL,
    payment_method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    payment_reference text,
    CONSTRAINT customer_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT customer_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: supplier_ledger; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.supplier_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    entry_type text NOT NULL,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    balance_after numeric(14,2),
    reference_type text,
    reference_id uuid,
    due_date date,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    source_key text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: supplier_payment_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.supplier_payment_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: supplier_payments; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.supplier_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voucher_number text NOT NULL,
    supplier_id uuid NOT NULL,
    amount numeric(14,2) NOT NULL,
    payment_method text DEFAULT 'CASH'::text NOT NULL,
    account_code text DEFAULT '1101'::text NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    journal_entry_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cashbox_id uuid,
    bank_account_id uuid,
    CONSTRAINT supplier_payments_amount_check CHECK ((amount > (0)::numeric))
);

--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    balance numeric(14,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    system_key text,
    CONSTRAINT suppliers_system_flag_shape CHECK ((is_system = (system_key IS NOT NULL)))
);


--
-- Name: FUNCTION get_supplier_statement(p_supplier_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.get_supplier_statement(p_supplier_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone) IS 'T-24: جلب كشف حساب المورد التفصيلي مع احتساب الرصيد التراكمي المستحق للمورد عبر الفترات.';

--
-- Name: FUNCTION get_supplier_statement(p_supplier_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.get_supplier_statement(p_supplier_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_supplier_statement(p_supplier_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone) TO service_role;

GRANT ALL ON FUNCTION public.get_supplier_statement(p_supplier_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION next_supplier_voucher_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_supplier_voucher_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_supplier_voucher_number() TO service_role;


--
-- Name: TABLE cheques_register; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.cheques_register IS 'سجل الشيكات وأوراق القبض ومتابعة تواريخ الاستحقاق والتحصيل والارتداد.';

--
-- Name: cheques_register cheques_register_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cheques_register
    ADD CONSTRAINT cheques_register_pkey PRIMARY KEY (id);

--
-- Name: ix_cheques_customer; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_cheques_customer ON public.cheques_register USING btree (customer_id);

--
-- Name: ix_cheques_invoice; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_cheques_invoice ON public.cheques_register USING btree (invoice_id);

--
-- Name: ix_cheques_status_date; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_cheques_status_date ON public.cheques_register USING btree (status, due_date);

--
-- Name: cheques_register; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.cheques_register ENABLE ROW LEVEL SECURITY;

--
-- Name: cheques_register cheques_register_admin; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cheques_register_admin ON public.cheques_register FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: cheques_register cheques_register_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cheques_register_insert ON public.cheques_register FOR INSERT TO authenticated WITH CHECK (true);

--
-- Name: cheques_register cheques_register_select; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cheques_register_select ON public.cheques_register FOR SELECT TO authenticated USING (true);

--
-- Name: TABLE cheques_register; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cheques_register TO service_role;

--
-- Name: customer_credit_limit_allows(uuid, numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customers AS c
    LEFT JOIN public.company_settings AS s ON s.id = 1
    WHERE c.id = p_customer_id
      AND (
        coalesce(s.enforce_customer_credit_limit, FALSE) IS NOT TRUE
        OR coalesce(c.credit_limit, 0) = 0
        OR coalesce(c.balance, 0) + greatest(coalesce(p_new_due, 0), 0) <= c.credit_limit
      )
  )
$$;

--
-- Name: is_system_customer(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.is_system_customer(p_customer_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce((SELECT c.is_system FROM public.customers c WHERE c.id = p_customer_id), false);
$$;


--
-- Name: COLUMN customers.is_system; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.customers.is_system IS 'P1-6: كيان نظامي (العميل النقدي) — اسمه وحالته وحذفه محمية في القاعدة، ومخفي من دليل العملاء.';

--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

--
-- Name: customers customers_system_key_unique; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_system_key_unique UNIQUE (system_key);

--
-- Name: idx_customers_is_system; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_customers_is_system ON public.customers USING btree (is_system) WHERE is_system;

--
-- Name: customers customers_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: customers tg_customers_system_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_customers_system_guard BEFORE DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.tg_customers_system_guard();

--
-- Name: customers cust_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cust_manage ON public.customers TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'cashier'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'cashier'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: customers cust_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cust_view ON public.customers FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customers TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customers TO authenticated;


--
-- Name: TABLE customer_balance_adjustments; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.customer_balance_adjustments IS 'سجل تصحيحات الرصيد المخزَّن للعميل: من كم إلى كم، وما كان رصيد الدفتر، والسبب، ومن نفّذه ومتى. لا يُحذف ولا يُعدَّل.';

--
-- Name: COLUMN customer_balance_adjustments.correction_type; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.customer_balance_adjustments.correction_type IS 'recalculation = إعادة احتساب من الدفتر؛ document_repost = استدراك مستند مالي مفقود (حركة في الدفتر، لا تعديل رقم).';

--
-- Name: customer_balance_adjustments customer_balance_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_balance_adjustments
    ADD CONSTRAINT customer_balance_adjustments_pkey PRIMARY KEY (id);

--
-- Name: idx_customer_balance_adjustments_customer; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_customer_balance_adjustments_customer ON public.customer_balance_adjustments USING btree (customer_id, created_at DESC);

--
-- Name: customer_balance_adjustments; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.customer_balance_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_balance_adjustments customer_balance_adjustments_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY customer_balance_adjustments_read ON public.customer_balance_adjustments FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: TABLE customer_balance_adjustments; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.customer_balance_adjustments TO authenticated;

GRANT ALL ON TABLE public.customer_balance_adjustments TO service_role;


--
-- Name: customer_ledger customer_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_ledger
    ADD CONSTRAINT customer_ledger_pkey PRIMARY KEY (id);

--
-- Name: customer_ledger customer_ledger_source_key_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_ledger
    ADD CONSTRAINT customer_ledger_source_key_key UNIQUE (source_key);

--
-- Name: customer_ledger_customer_date_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX customer_ledger_customer_date_idx ON public.customer_ledger USING btree (customer_id, occurred_at, id);

--
-- Name: uq_customer_ledger_opening_source; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_customer_ledger_opening_source ON public.customer_ledger USING btree (customer_id, reference_id, reference_type) WHERE (reference_type = 'opening_balance'::text);

--
-- Name: INDEX uq_customer_ledger_opening_source; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON INDEX public.uq_customer_ledger_opening_source IS 'سطر افتتاحي واحد لكل عميل في كل مستند افتتاحي — إعادة تشغيل ترحيل البيانات لا تُنشئ حركة ثانية. للعكس مستنده الخاص (reference_id مختلف).';

--
-- Name: customer_ledger; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.customer_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_ledger customer_ledger_view_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY customer_ledger_view_finance ON public.customer_ledger FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: TABLE customer_ledger; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_ledger TO service_role;

GRANT SELECT ON TABLE public.customer_ledger TO authenticated;


--
-- Name: SEQUENCE customer_payment_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.customer_payment_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.customer_payment_seq TO authenticated;


--
-- Name: customer_payment_splits customer_payment_splits_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payment_splits
    ADD CONSTRAINT customer_payment_splits_pkey PRIMARY KEY (id);

--
-- Name: customer_payment_splits_invoice_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX customer_payment_splits_invoice_idx ON public.customer_payment_splits USING btree (invoice_id, occurred_at DESC);

--
-- Name: customer_payment_splits_occurred_at_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX customer_payment_splits_occurred_at_idx ON public.customer_payment_splits USING btree (occurred_at DESC);

--
-- Name: customer_payment_splits; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.customer_payment_splits ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_payment_splits customer_payment_splits staff read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "customer_payment_splits staff read" ON public.customer_payment_splits FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: customer_payment_splits customer_payment_splits staff write; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "customer_payment_splits staff write" ON public.customer_payment_splits FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: TABLE customer_payment_splits; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.customer_payment_splits TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customer_payment_splits TO authenticated;


--
-- Name: customer_payments customer_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_pkey PRIMARY KEY (id);

--
-- Name: idx_customer_payments_customer; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_customer_payments_customer ON public.customer_payments USING btree (customer_id, payment_date DESC);

--
-- Name: idx_customer_payments_invoice; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_customer_payments_invoice ON public.customer_payments USING btree (invoice_id);

--
-- Name: ix_customer_payments_bank_acc; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_customer_payments_bank_acc ON public.customer_payments USING btree (bank_account_id);

--
-- Name: ix_customer_payments_cashbox; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_customer_payments_cashbox ON public.customer_payments USING btree (cashbox_id);

--
-- Name: customer_payments trg_customer_payments_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_customer_payments_updated BEFORE UPDATE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: customer_payments; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_payments customer_payments_view_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY customer_payments_view_finance ON public.customer_payments FOR SELECT TO authenticated USING ((public.can_read_finance(auth.uid()) OR public.has_role(auth.uid(), 'cashier'::public.app_role)));

--
-- Name: TABLE customer_payments; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_payments TO service_role;

GRANT SELECT ON TABLE public.customer_payments TO authenticated;


--
-- Name: TABLE supplier_ledger; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.supplier_ledger IS 'T-24: دفتر أستاذ حركات الموردين التفصيلية (فواتير، مرتجعات، دفعات، تسويات) بتاريخ استحقاق وسداد صريح.';

--
-- Name: supplier_ledger supplier_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_ledger
    ADD CONSTRAINT supplier_ledger_pkey PRIMARY KEY (id);

--
-- Name: supplier_ledger supplier_ledger_source_key_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_ledger
    ADD CONSTRAINT supplier_ledger_source_key_key UNIQUE (source_key);

--
-- Name: idx_supplier_ledger_reference; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_supplier_ledger_reference ON public.supplier_ledger USING btree (reference_type, reference_id);

--
-- Name: idx_supplier_ledger_supplier_occurred; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_supplier_ledger_supplier_occurred ON public.supplier_ledger USING btree (supplier_id, occurred_at);

--
-- Name: uq_supplier_ledger_expense_source; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_supplier_ledger_expense_source ON public.supplier_ledger USING btree (reference_type, reference_id, source_key) WHERE (reference_type = ANY (ARRAY['expense'::text, 'expense_payment'::text]));

--
-- Name: supplier_ledger; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.supplier_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_ledger supplier_ledger_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY supplier_ledger_read_finance ON public.supplier_ledger FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: TABLE supplier_ledger; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.supplier_ledger TO service_role;


--
-- Name: SEQUENCE supplier_payment_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.supplier_payment_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.supplier_payment_seq TO authenticated;


--
-- Name: TABLE supplier_payments; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.supplier_payments IS 'T-24: سندات صرف الموردين المستقلة مع توثيق طريقة الدفع، الحساب المالي، والقيد المحاسبي.';

--
-- Name: supplier_payments supplier_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_pkey PRIMARY KEY (id);

--
-- Name: supplier_payments supplier_payments_voucher_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_voucher_number_key UNIQUE (voucher_number);

--
-- Name: idx_supplier_payments_supplier_date; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_supplier_payments_supplier_date ON public.supplier_payments USING btree (supplier_id, payment_date);

--
-- Name: ix_supplier_payments_bank_acc; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_supplier_payments_bank_acc ON public.supplier_payments USING btree (bank_account_id);

--
-- Name: ix_supplier_payments_cashbox; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_supplier_payments_cashbox ON public.supplier_payments USING btree (cashbox_id);

--
-- Name: supplier_payments; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_payments supplier_payments_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY supplier_payments_read_finance ON public.supplier_payments FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: TABLE supplier_payments; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.supplier_payments TO service_role;

--
-- Name: is_system_supplier(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.is_system_supplier(p_supplier_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce((SELECT s.is_system FROM public.suppliers s WHERE s.id = p_supplier_id), false);
$$;


--
-- Name: COLUMN suppliers.is_system; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.suppliers.is_system IS 'P1-6: كيان نظامي (المورد النقدي) — اسمه وحالته وحذفه محمية في القاعدة، ومخفي من دليل الموردين.';

--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);

--
-- Name: suppliers suppliers_system_key_unique; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_system_key_unique UNIQUE (system_key);

--
-- Name: idx_suppliers_is_system; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_suppliers_is_system ON public.suppliers USING btree (is_system) WHERE is_system;

--
-- Name: suppliers suppliers_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: suppliers tg_suppliers_system_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_suppliers_system_guard BEFORE DELETE OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.tg_suppliers_system_guard();

--
-- Name: suppliers supp_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY supp_manage ON public.suppliers TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role)));

--
-- Name: suppliers supp_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY supp_view ON public.suppliers FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE suppliers; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.suppliers TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.suppliers TO authenticated;


--
-- Name: FUNCTION customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric) TO service_role;

GRANT ALL ON FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric) TO authenticated;


--
-- Name: FUNCTION is_system_customer(p_customer_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.is_system_customer(p_customer_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_system_customer(p_customer_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_system_customer(p_customer_id uuid) TO authenticated;


--
-- Name: FUNCTION is_system_supplier(p_supplier_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.is_system_supplier(p_supplier_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_system_supplier(p_supplier_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_system_supplier(p_supplier_id uuid) TO authenticated;


--
-- Name: FUNCTION tg_suppliers_system_guard(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_suppliers_system_guard() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_suppliers_system_guard() TO service_role;
