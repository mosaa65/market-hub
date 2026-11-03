-- ============================================================================
-- 13_reporting_views.sql
--
-- العروض (Views): ميزان المراجعة، تقييم المخزون، أرصدة العملاء، حالات الترحيل.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

CREATE OR REPLACE VIEW public.customer_ledger_balances AS
 SELECT c.id AS customer_id,
    c.name,
    round(COALESCE(sum((l.debit - l.credit)), (0)::numeric), 2) AS ledger_balance,
    c.balance AS legacy_balance,
    round((COALESCE(sum((l.debit - l.credit)), (0)::numeric) - c.balance), 2) AS difference
   FROM (customers c
     LEFT JOIN customer_ledger l ON ((l.customer_id = c.id)))
  GROUP BY c.id, c.name, c.balance;

CREATE OR REPLACE VIEW public.expense_legacy_reconciliation AS
 SELECT count(*) AS legacy_rows,
    count(*) FILTER (WHERE (l.id IS NULL)) AS not_yet_migrated,
    count(*) FILTER (WHERE (l.id IS NOT NULL)) AS already_migrated,
    COALESCE(sum(x.amount), (0)::numeric) AS legacy_total,
    COALESCE(sum(b.gross_amount), (0)::numeric) AS migrated_total,
    COALESCE(min(x.expense_date), CURRENT_DATE) AS first_date,
    COALESCE(max(x.expense_date), CURRENT_DATE) AS last_date,
    count(*) FILTER (WHERE (x.category_id IS NULL)) AS uncategorised_rows,
    count(*) FILTER (WHERE (x.payment_method = 'credit'::payment_method)) AS credit_method_rows
   FROM ((expenses x
     LEFT JOIN expense_entries l ON ((l.legacy_expense_id = x.id)))
     LEFT JOIN expense_lines b ON ((b.entry_id = l.id)))
  GROUP BY ();

CREATE OR REPLACE VIEW public.invoice_ledger_status AS
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
            WHEN (si.status = ANY (ARRAY['draft'::invoice_status, 'cancelled'::invoice_status])) THEN 'NEVER_POSTS'::text
            ELSE 'NOT_POSTED'::text
        END AS ledger_state,
        CASE
            WHEN ((je.id IS NOT NULL) AND (je.total_debit <> je.total_credit)) THEN 'UNBALANCED'::text
            ELSE 'OK'::text
        END AS integrity
   FROM (sales_invoices si
     LEFT JOIN journal_entries je ON (((je.source_type = 'sales_invoice'::text) AND (je.source_id = si.id) AND (je.status <> 'REVERSED'::text))));

CREATE OR REPLACE VIEW public.item_classification_gaps AS
 SELECT id,
    sku,
    name_ar,
    item_nature,
    item_class,
    inventory_policy,
        CASE
            WHEN ((sku IS NULL) OR (btrim(sku) = ''::text)) THEN 'بلا رمز صنف — التصنيف الخماسي غير مُتحقَّق منه (نخالة أم دقيق؟) يحتاج تأكيداً يدوياً'::text
            WHEN (item_nature = 'SERVICE'::item_nature) THEN 'nature: service, class must be SERVICE'::text
            WHEN (inventory_policy = 'CUSTOMER_OWNED'::inventory_policy) THEN 'policy: customer owned, class must be NON_STOCK_ITEM'::text
            WHEN (inventory_policy = 'UNTRACKED'::inventory_policy) THEN 'policy: untracked, class must be SERVICE or NON_STOCK_ITEM'::text
            WHEN (sku ~~ 'RM-%'::text) THEN 'sku: raw material prefix, class should be RAW_MATERIAL'::text
            WHEN (sku = 'FG-BRAN-40'::text) THEN 'catalogue: bran is a by-product'::text
            ELSE 'unclassified GOOD+TRACKED item'::text
        END AS reason
   FROM products p
  WHERE (is_active AND ((item_class IS NULL) OR ((sku IS NULL) OR (btrim(sku) = ''::text)) OR ((item_nature = 'SERVICE'::item_nature) AND (item_class <> 'SERVICE'::item_class)) OR ((inventory_policy = 'CUSTOMER_OWNED'::inventory_policy) AND (item_class <> 'NON_STOCK_ITEM'::item_class)) OR ((inventory_policy = 'UNTRACKED'::inventory_policy) AND (item_nature = 'GOOD'::item_nature) AND (item_class <> 'NON_STOCK_ITEM'::item_class)) OR ((sku ~~ 'RM-%'::text) AND (item_class <> 'RAW_MATERIAL'::item_class)) OR ((sku = 'FG-BRAN-40'::text) AND (item_class <> 'BY_PRODUCT'::item_class))));

CREATE OR REPLACE VIEW public.item_valuation AS
 WITH qty AS (
         SELECT inventory.product_id,
            sum(inventory.quantity) AS on_hand_qty
           FROM inventory
          WHERE (inventory.owner_type = 'COMPANY'::owner_type)
          GROUP BY inventory.product_id
        ), val AS (
         SELECT cl.product_id,
            sum(cl.total_value) AS valuation,
            count(*) FILTER (WHERE (cl.total_value > (0)::numeric)) AS valued_layers
           FROM item_cost_layers cl
          WHERE (cl.owner_type = 'COMPANY'::owner_type)
          GROUP BY cl.product_id
        )
 SELECT p.id AS product_id,
    p.sku,
    p.name_ar,
    p.item_class,
    COALESCE(q.on_hand_qty, (0)::numeric) AS on_hand_qty,
    COALESCE(v.valuation, (0)::numeric) AS valuation,
        CASE
            WHEN (COALESCE(q.on_hand_qty, (0)::numeric) <> (0)::numeric) THEN round((COALESCE(v.valuation, (0)::numeric) / q.on_hand_qty), 4)
            ELSE (0)::numeric
        END AS actual_unit_cost,
        CASE
            WHEN ((v.valued_layers IS NULL) OR (v.valued_layers = 0)) THEN 'REFERENCE_ONLY'::text
            ELSE 'ACTUAL'::text
        END AS valuation_basis,
    p.cost_price AS catalogue_cost,
    p.standard_cost
   FROM ((products p
     LEFT JOIN qty q ON ((q.product_id = p.id)))
     LEFT JOIN val v ON ((v.product_id = p.id)));

-- ── أمانات المطحنة: طبقة المطابقة — كل الرصيد مشتق من custody_ledger ─────
-- كشف العميل: المستلم، المطحون، المسلَّم، المتبقي — لكل عميل/صنف/مخزن.
CREATE OR REPLACE VIEW public.custody_customer_statement AS
 SELECT l.customer_id,
    c.name AS customer_name_ar,
    l.warehouse_id,
    w.name_ar AS warehouse_name_ar,
    l.item_id,
    p.sku,
    p.name_ar AS item_name_ar,
    p.item_class,
    sum(l.bags_in) AS received_bags,
    sum(l.kg_in) AS received_kg,
    sum(l.bags_out) AS issued_bags,
    sum(l.kg_out) AS issued_kg,
    sum((l.bags_in - l.bags_out)) AS remaining_bags,
    sum((l.kg_in - l.kg_out)) AS remaining_kg,
    max(l.created_at) AS last_movement_at
   FROM (((public.custody_ledger l
     JOIN public.products p ON ((p.id = l.item_id)))
     LEFT JOIN public.customers c ON ((c.id = l.customer_id)))
     LEFT JOIN public.warehouses w ON ((w.id = l.warehouse_id)))
  GROUP BY l.customer_id, c.name, l.warehouse_id, w.name_ar, l.item_id, p.sku, p.name_ar, p.item_class;

-- التبويب المالي: المستند الموحد هو المصدر للفواتير الجديدة. الجزء الثاني
-- يبقي فواتير الربط اليدوي التاريخية قابلة للقراءة فقط أثناء الانتقال.
CREATE OR REPLACE VIEW public.custody_service_money AS
 SELECT d.id AS custody_entry_id,
    d.customer_id,
    c.name AS customer_name_ar,
    d.document_number AS doc_number,
    d.created_at,
    si.id AS invoice_id,
    si.invoice_number,
    si.status,
    si.subtotal,
    si.tax,
    si.discount,
    si.total,
    si.paid,
    round((si.total - si.paid), 2) AS outstanding
   FROM ((public.milling_service_documents d
     JOIN public.sales_invoices si ON ((si.id = d.sales_invoice_id)))
     LEFT JOIN public.customers c ON ((c.id = d.customer_id)))
 UNION ALL
 SELECT l.id AS custody_entry_id,
    l.customer_id,
    c.name AS customer_name_ar,
    l.doc_number,
    l.created_at,
    si.id AS invoice_id,
    si.invoice_number,
    si.status,
    si.subtotal,
    si.tax,
    si.discount,
    si.total,
    si.paid,
    round((si.total - si.paid), 2) AS outstanding
   FROM ((public.custody_ledger l
     JOIN public.sales_invoices si ON ((si.id = l.service_invoice_id)))
     LEFT JOIN public.customers c ON ((c.id = l.customer_id)))
  WHERE NOT EXISTS (
    SELECT 1 FROM public.milling_service_documents d
    WHERE d.sales_invoice_id = l.service_invoice_id
  );

-- الفاقد المكتشف: صادر الحبوب − وارد النواتج لكل عملية طحن (مستند/سند).
-- لا حقل إدخال للفاقد؛ التنبيه استدلالي لمراقبة التوازن التشغيلي (ح2).
CREATE OR REPLACE VIEW public.custody_detected_loss AS
 WITH grain_flow AS (
         SELECT l.customer_id,
            l.warehouse_id,
            l.item_id,
            coalesce(l.milling_document_id::text, l.doc_number) AS operation_key,
            p.name_ar AS grain_name_ar,
            sum(l.kg_out) AS milled_kg,
            sum(l.bags_out) AS milled_bags
           FROM (public.custody_ledger l
             JOIN public.products p ON ((p.id = l.item_id)))
          WHERE ((l.entry_type = 'MILLING'::custody_entry_type) AND (p.item_class = 'RAW_MATERIAL'::item_class))
          GROUP BY l.customer_id, l.warehouse_id, l.item_id, coalesce(l.milling_document_id::text, l.doc_number), p.name_ar
        ), output_flow AS (
         SELECT l.customer_id,
            l.warehouse_id,
            coalesce(l.milling_document_id::text, l.doc_number) AS operation_key,
            sum(l.kg_in) AS produced_kg,
            sum(l.bags_in) AS produced_bags
           FROM (public.custody_ledger l
             JOIN public.products p ON ((p.id = l.item_id)))
          WHERE ((l.entry_type = 'MILLING'::custody_entry_type) AND (p.item_class = ANY (ARRAY['FINISHED_GOOD'::item_class, 'BY_PRODUCT'::item_class])))
          GROUP BY l.customer_id, l.warehouse_id, coalesce(l.milling_document_id::text, l.doc_number)
        )
 SELECT g.customer_id,
    c.name AS customer_name_ar,
    g.warehouse_id,
    w.name_ar AS warehouse_name_ar,
    g.item_id,
    g.grain_name_ar,
    g.operation_key,
    g.milled_bags,
    g.milled_kg,
    COALESCE(o.produced_bags, (0)::numeric) AS produced_bags,
    COALESCE(o.produced_kg, (0)::numeric) AS produced_kg,
    round((g.milled_kg - COALESCE(o.produced_kg, (0)::numeric)), 3) AS detected_loss_kg,
        CASE
            WHEN ((g.milled_kg > (0)::numeric) AND ((g.milled_kg - COALESCE(o.produced_kg, (0)::numeric)) > (g.milled_kg * (0.05)::numeric))) THEN 'REVIEW'::text
            ELSE 'OK'::text
        END AS loss_status
   FROM (((grain_flow g
     LEFT JOIN output_flow o ON (((o.customer_id = g.customer_id) AND (o.warehouse_id = g.warehouse_id) AND (o.operation_key = g.operation_key))))
     LEFT JOIN public.customers c ON ((c.id = g.customer_id)))
     LEFT JOIN public.warehouses w ON ((w.id = g.warehouse_id)));


CREATE OR REPLACE VIEW public.milling_margin_report AS
 WITH sold AS (
         SELECT it.product_id,
            sum(it.quantity) AS qty_sold,
            sum(it.total) AS revenue,
            count(DISTINCT si.id) AS invoice_count
           FROM (sales_invoice_items it
             JOIN sales_invoices si ON ((si.id = it.invoice_id)))
          WHERE ((((si.created_at)::date >= (CURRENT_DATE - 365)) AND ((si.created_at)::date <= CURRENT_DATE)) AND (si.status <> ALL (ARRAY['draft'::invoice_status, 'cancelled'::invoice_status])) AND (it.stock_effect = 'STOCK_ISSUE'::text))
          GROUP BY it.product_id
        )
 SELECT p.id AS product_id,
    p.sku,
    p.name_ar,
    p.item_class,
    COALESCE(s.qty_sold, (0)::numeric) AS qty_sold,
    COALESCE(s.revenue, (0)::numeric) AS revenue,
    COALESCE(s.invoice_count, (0)::bigint) AS invoice_count,
    c.unit_cost,
    c.basis,
    round((COALESCE(s.qty_sold, (0)::numeric) * COALESCE(c.unit_cost, (0)::numeric)), 2) AS cost_of_goods,
    round((COALESCE(s.revenue, (0)::numeric) - (COALESCE(s.qty_sold, (0)::numeric) * COALESCE(c.unit_cost, (0)::numeric))), 2) AS margin,
        CASE
            WHEN (COALESCE(s.revenue, (0)::numeric) > (0)::numeric) THEN round((((COALESCE(s.revenue, (0)::numeric) - (COALESCE(s.qty_sold, (0)::numeric) * COALESCE(c.unit_cost, (0)::numeric))) * (100)::numeric) / s.revenue), 2)
            ELSE NULL::numeric
        END AS margin_pct,
        CASE
            WHEN (c.basis = 'ACTUAL'::text) THEN 'ACTUAL'::text
            ELSE 'REFERENCE'::text
        END AS cost_basis
   FROM ((sold s
     JOIN products p ON ((p.id = s.product_id)))
     LEFT JOIN LATERAL ( SELECT COALESCE(
                CASE
                    WHEN (l.quantity > (0)::numeric) THEN round((l.total_value / l.quantity), 4)
                    ELSE NULL::numeric
                END, p.cost_price, (0)::numeric) AS unit_cost,
                CASE
                    WHEN ((l.quantity > (0)::numeric) AND (l.total_value > (0)::numeric)) THEN 'ACTUAL'::text
                    ELSE 'REFERENCE'::text
                END AS basis
           FROM (( SELECT 1 AS "?column?") x
             LEFT JOIN LATERAL ( SELECT sum(cl.quantity) AS quantity,
                    sum(cl.total_value) AS total_value
                   FROM item_cost_layers cl
                  WHERE ((cl.product_id = p.id) AND (cl.owner_type = 'COMPANY'::owner_type))) l ON (true))) c ON (true));


CREATE OR REPLACE VIEW public.opening_balance_summary AS
 SELECT d.id,
    d.document_number,
    d.effective_date,
    d.status,
    d.fiscal_year,
    d.total_assets,
    d.total_liabilities,
    d.capital_required,
    d.notes,
    COALESCE(s.stock_amount, (0)::numeric) AS stock_amount,
    COALESCE(s.receivable_amount, (0)::numeric) AS receivable_amount,
    COALESCE(s.payable_amount, (0)::numeric) AS payable_amount,
    COALESCE(s.cash_amount, (0)::numeric) AS cash_amount,
    COALESCE(s.bank_amount, (0)::numeric) AS bank_amount,
    COALESCE(s.asset_amount, (0)::numeric) AS asset_amount,
    COALESCE(s.liability_amount, (0)::numeric) AS liability_amount,
    COALESCE(s.capital_amount, (0)::numeric) AS capital_amount,
    COALESCE(s.debit, (0)::numeric) AS total_debits,
    COALESCE(s.credit, (0)::numeric) AS total_credits,
    round((COALESCE(s.debit, (0)::numeric) - COALESCE(s.credit, (0)::numeric)), 2) AS capital_required_now,
    (COALESCE(s.debit, (0)::numeric) = COALESCE(s.credit, (0)::numeric)) AS is_balanced
   FROM (opening_balance_documents d
     LEFT JOIN LATERAL ( SELECT sum(l.amount) FILTER (WHERE (l.side = 'DEBIT'::text)) AS debit,
            sum(l.amount) FILTER (WHERE (l.side = 'CREDIT'::text)) AS credit,
            sum(l.amount) FILTER (WHERE (l.section = 'STOCK'::text)) AS stock_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'RECEIVABLE'::text)) AS receivable_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'PAYABLE'::text)) AS payable_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'CASH'::text)) AS cash_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'BANK'::text)) AS bank_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'ASSET'::text)) AS asset_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'LIABILITY'::text)) AS liability_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'CAPITAL'::text)) AS capital_amount
           FROM opening_balance_lines l
          WHERE (l.document_id = d.id)) s ON (true));

CREATE OR REPLACE VIEW public.purchase_ledger_status AS
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
            WHEN (pi.status = ANY (ARRAY['draft'::invoice_status, 'cancelled'::invoice_status])) THEN 'NEVER_POSTS'::text
            ELSE 'NOT_POSTED'::text
        END AS ledger_state
   FROM (purchase_invoices pi
     LEFT JOIN journal_entries je ON (((je.source_type = 'purchase_invoice'::text) AND (je.source_id = pi.id) AND (je.status <> 'REVERSED'::text))));

CREATE OR REPLACE VIEW public.purchase_register AS
 SELECT i.id AS purchase_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    s.supplier_id,
    s.status,
    i.product_id,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku,
    i.quantity,
    i.unit_cost,
    i.discount,
    i.tax,
    i.total,
    COALESCE(i.line_type,
        CASE
            WHEN (i.product_id IS NULL) THEN 'AD_HOC_SERVICE'::text
            ELSE item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    (COALESCE(i.stock_effect, 'NONE'::text) = 'STOCK_RECEIPT'::text) AS increases_inventory
   FROM ((purchase_invoice_items i
     JOIN purchase_invoices s ON ((s.id = i.invoice_id)))
     LEFT JOIN products p ON ((p.id = i.product_id)));

CREATE OR REPLACE VIEW public.sales_register AS
 SELECT i.id AS invoice_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    s.customer_id,
    s.status,
    s.payment_method,
    i.product_id,
    i.description,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku,
    i.quantity,
    i.unit_price,
    i.discount,
    i.tax,
    i.total,
    COALESCE(i.line_type,
        CASE
            WHEN (i.product_id IS NULL) THEN 'AD_HOC_SERVICE'::text
            ELSE item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    i.uom_id,
    sales_line_cost(i.product_id, i.invoice_id, i.quantity, i.line_type) AS line_cost
   FROM ((sales_invoice_items i
     JOIN sales_invoices s ON ((s.id = i.invoice_id)))
     LEFT JOIN products p ON ((p.id = i.product_id)));

CREATE OR REPLACE VIEW public.service_revenue AS
 SELECT invoice_id,
    invoice_number,
    created_at,
    customer_id,
    line_type,
    description,
    quantity,
    unit_price,
    total,
    false AS affects_inventory
   FROM sales_register r
  WHERE ((line_type = ANY (ARRAY['SERVICE'::text, 'AD_HOC_SERVICE'::text])) AND (status <> ALL (ARRAY['draft'::invoice_status, 'cancelled'::invoice_status, 'returned'::invoice_status])));

CREATE OR REPLACE VIEW public.standard_cost_readiness AS
 SELECT p.id AS product_id,
    p.sku,
    p.name_ar,
    p.item_class,
    p.unit_id,
    p.cost_price AS catalogue_cost,
    p.standard_cost,
        CASE
            WHEN (cl.quantity > (0)::numeric) THEN round((cl.total_value / cl.quantity), 4)
            ELSE NULL::numeric
        END AS implied_standard,
    COALESCE(cl.quantity, (0)::numeric) AS on_hand_qty,
        CASE
            WHEN (p.standard_cost IS NOT NULL) THEN 'READY'::text
            WHEN (cl.quantity > (0)::numeric) THEN 'NEEDS_DECISION'::text
            ELSE 'NO_HISTORY'::text
        END AS readiness,
        CASE
            WHEN (p.standard_cost IS NOT NULL) THEN 'معيار معتمد'::text
            WHEN (cl.quantity > (0)::numeric) THEN 'لا يوجد معيار — رشح القيمة القائمة، أو أدخل ميزانية'::text
            ELSE 'لا يوجد معيار ولا حركات — أدخل الميزانية يدوياً'::text
        END AS note
   FROM (products p
     LEFT JOIN LATERAL ( SELECT sum(c.quantity) AS quantity,
            sum(c.total_value) AS total_value
           FROM item_cost_layers c
          WHERE ((c.product_id = p.id) AND (c.owner_type = 'COMPANY'::owner_type))) cl ON (true))
  WHERE (p.is_active AND (p.item_nature = 'GOOD'::item_nature) AND (p.inventory_policy = 'TRACKED'::inventory_policy) AND (p.item_class <> 'SERVICE'::item_class) AND (p.standard_cost IS NULL));

CREATE OR REPLACE VIEW public.stock_positions AS
 SELECT i.product_id AS item_id,
    i.warehouse_id,
    i.owner_type,
    i.owner_id,
    i.quantity,
    p.item_nature,
    COALESCE(ci.inventory_policy, p.inventory_policy) AS inventory_policy,
    p.costing_method,
    COALESCE(ci.default_cost, p.cost_price, (0)::numeric) AS reference_unit_cost,
        CASE
            WHEN ((i.owner_type = 'COMPANY'::owner_type) AND (COALESCE(ci.inventory_policy, p.inventory_policy) = 'TRACKED'::inventory_policy)) THEN round((i.quantity * COALESCE(ci.default_cost, p.cost_price, (0)::numeric)), 2)
            ELSE (0)::numeric
        END AS reference_valuation,
    (i.owner_type = 'COMPANY'::owner_type) AS is_company_owned,
    w.name AS warehouse_name,
    w.name_ar AS warehouse_name_ar,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku
   FROM (((inventory i
     JOIN products p ON ((p.id = i.product_id)))
     JOIN warehouses w ON ((w.id = i.warehouse_id)))
     LEFT JOIN company_items ci ON (((ci.item_id = p.id) AND (ci.company_id = 1) AND ci.is_active)));

CREATE OR REPLACE VIEW public.trial_balance AS
 WITH posted AS (
         SELECT jl.account_id,
            jl.debit,
            jl.credit
           FROM (journal_lines jl
             JOIN journal_entries je ON ((je.id = jl.entry_id)))
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
            WHEN (a.account_type = ANY (ARRAY['ASSET'::account_type, 'EXPENSE'::account_type])) THEN 1
            ELSE '-1'::integer
        END)::numeric), 2) AS natural_balance
   FROM (accounts a
     LEFT JOIN posted p ON ((p.account_id = a.id)))
  WHERE a.is_active
  GROUP BY a.id, a.code, a.name_ar, a.account_type
 HAVING ((COALESCE(sum(p.debit), (0)::numeric) > (0)::numeric) OR (COALESCE(sum(p.credit), (0)::numeric) > (0)::numeric));

CREATE OR REPLACE VIEW public.company_stock_positions AS
 SELECT item_id,
    warehouse_id,
    owner_type,
    owner_id,
    quantity,
    item_nature,
    inventory_policy,
    costing_method,
    reference_unit_cost,
    reference_valuation,
    is_company_owned,
    warehouse_name,
    warehouse_name_ar,
    item_name,
    item_name_ar,
    sku
   FROM stock_positions
  WHERE ((owner_type = 'COMPANY'::owner_type) AND (inventory_policy = 'TRACKED'::inventory_policy));

CREATE OR REPLACE VIEW public.customer_balance_reconciliation AS
 SELECT customer_id,
    name,
    ledger_balance,
    legacy_balance,
    difference
   FROM customer_ledger_balances
  WHERE (difference <> (0)::numeric);

CREATE OR REPLACE VIEW public.customer_owned_positions AS
 SELECT item_id,
    warehouse_id,
    owner_type,
    owner_id,
    quantity,
    item_nature,
    inventory_policy,
    costing_method,
    reference_unit_cost,
    reference_valuation,
    is_company_owned,
    warehouse_name,
    warehouse_name_ar,
    item_name,
    item_name_ar,
    sku
   FROM stock_positions
  WHERE (owner_type <> 'COMPANY'::owner_type);

CREATE OR REPLACE VIEW public.inventory_valuation AS
 SELECT item_id,
    item_name,
    item_name_ar,
    sku,
    warehouse_id,
    warehouse_name,
    warehouse_name_ar,
    quantity,
    costing_method,
    reference_unit_cost,
    reference_valuation,
    (costing_method <> 'STANDARD'::costing_method) AS valuation_is_reference_based
   FROM company_stock_positions p
  WHERE (quantity <> (0)::numeric);

CREATE OR REPLACE VIEW public.milling_inventory_report AS
 SELECT p.item_class,
    p.id AS product_id,
    p.sku,
    p.name_ar,
    COALESCE(i.warehouse_name_ar, '—'::text) AS warehouse,
    COALESCE(i.qty, (0)::numeric) AS on_hand_qty,
    COALESCE(u.name_ar, '—'::text) AS unit,
    COALESCE(v.actual_unit_cost, (0)::numeric) AS unit_cost,
    (COALESCE(i.qty, (0)::numeric) * COALESCE(v.actual_unit_cost, (0)::numeric)) AS valuation,
    COALESCE(v.valuation_basis, 'REFERENCE_ONLY'::text) AS cost_basis
   FROM (((products p
     LEFT JOIN LATERAL ( SELECT sp.warehouse_name_ar,
            sp.quantity AS qty
           FROM stock_positions sp
          WHERE ((sp.item_id = p.id) AND sp.is_company_owned AND (sp.quantity <> (0)::numeric))
          ORDER BY sp.warehouse_name_ar) i ON (true))
     LEFT JOIN units u ON ((u.id = p.base_uom_id)))
     LEFT JOIN item_valuation v ON ((v.product_id = p.id)))
  WHERE ((p.item_class = ANY (ARRAY['RAW_MATERIAL'::item_class, 'FINISHED_GOOD'::item_class, 'BY_PRODUCT'::item_class, 'NON_STOCK_ITEM'::item_class])) AND p.is_active AND ((COALESCE(i.qty, (0)::numeric) <> (0)::numeric) OR (COALESCE(v.on_hand_qty, (0)::numeric) <> (0)::numeric)));
