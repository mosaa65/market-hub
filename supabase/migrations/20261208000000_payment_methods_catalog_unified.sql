﻿-- ============================================================================
-- 20261208000000_payment_methods_catalog_unified.sql
--
-- طرق الدفع الموحّدة — الملف الوحيد الذي يعرّف طرق الدفع، وحدودها، وأين تُستخدم.
-- Unified payment-method definition: catalogue, tenant configuration, write
-- guards, and the single place that decides how a method posts to the ledger.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE REPLACES
-- ════════════════════════════════════════════════════════════════════════════
-- Before this migration, the set of usable payment methods was scattered across
-- eight files with no single owner:
--
--   ENUM definition + widening
--     20260621011940  CREATE TYPE payment_method ('cash','card','bank_transfer','credit')
--     20260706120000  ALTER TYPE … ADD VALUE 'mobile_money'   (blackbox seed patch)
--     20260706121000  ALTER TYPE … ADD VALUE 'mobile_money'   (duplicate, reset seed)
--     20260707021000  ALTER TYPE … ADD VALUE 'mobile_money'   (duplicate, yemen seed)
--
--   Allowed-value literals duplicated inside write RPCs
--     20260801090000  create_sale       NOT IN ('cash','card','bank_transfer','credit','mobile_money')
--     20260801090000  record_customer_payment NOT IN ('cash','card','bank_transfer','mobile_money')
--     20260929030000  create_sale       NOT IN (… ,'split')
--     20260929030000  split components  NOT IN ('cash','card','bank_transfer','mobile_money','split')
--     20260928000000  the same split guard, in the superseded copy
--
--   "Which account does this method post to" hard-coded in the ledger engine
--     20261202000000 / 20261202000100 / 20261202000200 / 20261203000000
--       IF payment_method IN ('bank_transfer','card','mobile_money') THEN '1111' ELSE '1101'
--
-- The consequence was concrete, not theoretical: adding a Yemeni method such as
-- بنك الكريمي required editing five files, and if you only edited the ENUM the
-- new method posted to the CASH account — silently overstating the till and
-- understating the bank, with no error anywhere.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE SINGLE SOURCE OF TRUTH, AFTER THIS FILE
-- ════════════════════════════════════════════════════════════════════════════
--   public.payment_methods            which methods exist, their identity,
--                                     icon key, ledger kind, contexts, and
--                                     accounting hook.  ← developers only
--   public.payment_method_settings     enabled / order / contexts per business
--
--   public.payment_method_legacy_id()  text  -> the value a document stores
--   public.payment_method_is_allowed()        may this be used, here, now
--   public.payment_method_ledger_account()    which account it settles to
--
-- Every write RPC and the posting engine now call these. A new method is added
-- in ONE place — the catalogue seed at the bottom of this file — and it is
-- immediately valid everywhere, posted correctly, and configurable per section.
--
-- ════════════════════════════════════════════════════════════════════════════
-- TARGETING: POSTGRESQL >= 12 (NO `ALTER TYPE … ADD VALUE` NEEDED)
-- ════════════════════════════════════════════════════════════════════════════
-- PostgreSQL 12 allows a non-CONCURRENT ALTER TYPE … ADD VALUE inside a
-- transaction block. That matters here: production has `mobile_money` only
-- because three separate seed-patch migrations ran, and a fresh database
-- created from migrations would still be missing `split`, which the sales
-- engine has required since 20260929030000. So this file widens the ENUM
-- idempotently and transactionally, and drops everything onto the widest set:
--
--     cash | card | bank_transfer | credit | mobile_money | split | cheque
--
-- On PostgreSQL 11 or older, run ONE statement on its own first:
--     ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cheque';
-- then apply this migration. It is written so the ENUM add is a no-op if the
-- values already exist.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔒 NO EXISTING DATA IS DELETED, UPDATED OR MOVED BY THIS FILE
-- ════════════════════════════════════════════════════════════════════════════
--   • Every existing column keeps its type and its value.
--   • Every existing row in sales_invoices, purchase_invoices, expenses,
--     customer_payments, sales_returns, purchase_returns and
--     customer_payment_splits keeps its stored `payment_method` byte for byte.
--   • Every historical ENUM value maps to a catalogue row, so old documents
--     still render with the correct Arabic name and icon.
--   • Nothing here DELETEs, UPDATEs or TRUNCATEs business data.
--   • The only writes are: the developer catalogue (developer-owned definition,
--     not customer data) and settings rows that do not already exist
--     (ON CONFLICT DO NOTHING — a business's own choices are never overwritten).
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY NOT DONE
-- ════════════════════════════════════════════════════════════════════════════
--   • The ENUM is NOT replaced by a text column + lookup table. That would
--     require rewriting six columns on seven tables of live financial history
--     for a benefit no user can see. The catalogue provides identity, ordering
--     and scoping; the ENUM keeps being the storage contract.
--   • No account_id is forced onto any method. `default_account_code` and
--     `payment_method_settings.default_account_id` are seams for the accounting
--     phase; today they are populated as guidance and read as a fallback only.
--   • No general ledger, journal, or chart-of-accounts behaviour is added.
--
-- IDEMPOTENT: safe to re-apply. Re-runs refresh the catalogue definitions
-- (names, icons, order, contexts) without touching tenant settings.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Widen the ENUM to the full set the application actually uses.
--
-- PostgreSQL 12+: legal inside a transaction. `IF NOT EXISTS` makes each of the
-- seven a no-op when it is already present, so this covers both "the three seed
-- patches ran" and "they did not".
-- ---------------------------------------------------------------------------
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cash';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'card';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'bank_transfer';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'credit';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'mobile_money';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'split';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cheque';

COMMENT ON TYPE public.payment_method IS
  'القيمة المخزّنة على المستند. لا تُستخدم للعرض ولا للتفعيل؛ العرض والتفعيل والأقسام تأتي من public.payment_methods.';


-- ============================================================================
-- 2. DEVELOPER CATALOGUE — which payment methods exist
--
-- A tenant never writes here. Rows arrive from this migration only, so a method
-- cannot be invented from the browser and an icon can never be supplied by a
-- customer. `id` is a STABLE TEXT KEY, not a UUID: a migration can address a
-- method unambiguously and idempotently forever, and the icon reference stays
-- readable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id                   text PRIMARY KEY,

  name_ar              text        NOT NULL,
  name_en              text,

  -- A KEY, never a URL and never base64. The bundled registry in
  -- src/lib/payments/payment-methods.ts resolves it to a component, so a
  -- payment icon costs zero network requests and cannot fail to load.
  icon_key             text        NOT NULL DEFAULT 'generic',

  -- Developer-level availability, for retiring a method everywhere at once
  -- without deleting the history that references it.
  is_active            boolean     NOT NULL DEFAULT true,

  -- Default presentation order. A tenant overrides it in settings.
  sort_order           integer     NOT NULL DEFAULT 100,

  -- Contexts the developers ALLOW. A tenant may only narrow this set.
  allowed_contexts     text[]      NOT NULL DEFAULT ARRAY[]::text[],

  -- Which family of account the money settles into. This is what the posting
  -- engine branches on, replacing the hard-coded ENUM list.
  ledger_kind          text        NOT NULL DEFAULT 'CASH',

  -- Accounting seam. Guidance today; the authoritative business-specific
  -- mapping is payment_method_settings.default_account_id.
  default_account_code text,

  -- Behaviour the UI must not hard-code.
  is_credit_term       boolean     NOT NULL DEFAULT false,
  requires_reference   boolean     NOT NULL DEFAULT false,

  -- The ENUM value(s) this row represents. Lets a historic invoice that stored
  -- 'bank_transfer' be labelled from the catalogue instead of a local map.
  legacy_ids           text[]      NOT NULL DEFAULT ARRAY[]::text[],

  notes                text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_methods_id_normalised
    CHECK (id = lower(btrim(id)) AND id <> ''),
  CONSTRAINT payment_methods_ledger_kind_valid
    CHECK (ledger_kind IN ('CASH','BANK','WALLET','CARD','CREDIT','OTHER')),
  CONSTRAINT payment_methods_contexts_valid
    CHECK (allowed_contexts <@ ARRAY[
      'pos','sales','purchases','expenses','customer_collection',
      'sales_returns','purchase_returns'
    ]::text[])
);

COMMENT ON TABLE public.payment_methods IS
  'كتالوج طرق الدفع الذي يجهّزه المطورون. العميل لا ينشئ صفوفاً هنا؛ يختار ويفعّل فقط.';
COMMENT ON COLUMN public.payment_methods.icon_key IS
  'مفتاح أيقونة مركزي يُحلّ إلى مكوّن داخل الحزمة. ليس رابطاً خارجياً ولا Base64.';
COMMENT ON COLUMN public.payment_methods.ledger_kind IS
  'عائلة الحساب (صندوق/بنك/محفظة/بطاقة/آجل). يستخدمها محرك الترحيل بدل تعداد قيم الـEnum.';
COMMENT ON COLUMN public.payment_methods.default_account_code IS
  'ربط محاسبي مستقبلي: payment_method → account. إرشادي في هذه المرحلة.';
COMMENT ON COLUMN public.payment_methods.legacy_ids IS
  'قيم public.payment_method التي تمثّلها هذه الطريقة، لعرض الفواتير التاريخية من الكتالوج.';

CREATE INDEX IF NOT EXISTS ix_payment_methods_order
  ON public.payment_methods (is_active, sort_order, id);

CREATE INDEX IF NOT EXISTS ix_payment_methods_legacy_ids
  ON public.payment_methods USING gin (legacy_ids);


-- ============================================================================
-- 3. TENANT CONFIGURATION — what THIS business chose
--
-- A method with no row here has never been touched by the business and inherits
-- the catalogue defaults, so adding a method in a migration makes it available
-- without a data backfill.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_method_settings (
  payment_method_id  text PRIMARY KEY
    REFERENCES public.payment_methods(id) ON DELETE CASCADE,

  enabled            boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 100,
  enabled_contexts   text[]  NOT NULL DEFAULT ARRAY[]::text[],

  -- Accounting seam per business: the phase where بنك الكريمي maps to one
  -- specific bank account rather than a generic one.
  default_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,

  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT payment_method_settings_contexts_valid
    CHECK (enabled_contexts <@ ARRAY[
      'pos','sales','purchases','expenses','customer_collection',
      'sales_returns','purchase_returns'
    ]::text[])
);

COMMENT ON TABLE public.payment_method_settings IS
  'تخصيص العميل: تفعيل كل طريقة، ترتيب عرضها، والأقسام التي تظهر فيها.';
COMMENT ON COLUMN public.payment_method_settings.enabled_contexts IS
  'الأقسام المسموح بها لهذه المنشأة. لا يمكن أن تتجاوز allowed_contexts في الكتالوج.';

CREATE INDEX IF NOT EXISTS ix_payment_method_settings_order
  ON public.payment_method_settings (enabled, sort_order);


-- ---------------------------------------------------------------------------
-- 3.1 A tenant may NARROW the developers' context list, never WIDEN it.
--     A CHECK constraint cannot see the parent row, so this is a trigger.
--     Without it, a bug in the settings screen could offer آجل while collecting
--     cash, or a wallet inside a purchase return where a refund method is
--     supposed to be honoured.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
BEGIN
  SELECT allowed_contexts INTO v_allowed
  FROM public.payment_methods
  WHERE id = NEW.payment_method_id;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'طريقة الدفع غير موجودة في الكتالوج: %', NEW.payment_method_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT (NEW.enabled_contexts <@ v_allowed) THEN
    RAISE EXCEPTION
      'الأقسام المختارة (%) تتجاوز ما يسمح به الكتالوج لطريقة % (%)',
      array_to_string(NEW.enabled_contexts, ', '),
      NEW.payment_method_id,
      array_to_string(v_allowed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.payment_method_settings_guard() IS
  'يمنع توسيع أقسام طريقة الدفع خارج ما يسمح به كتالوج المطورين.';

DROP TRIGGER IF EXISTS payment_method_settings_context_guard
  ON public.payment_method_settings;
CREATE TRIGGER payment_method_settings_context_guard
  BEFORE INSERT OR UPDATE ON public.payment_method_settings
  FOR EACH ROW EXECUTE FUNCTION public.payment_method_settings_guard();

DROP TRIGGER IF EXISTS payment_methods_updated ON public.payment_methods;
CREATE TRIGGER payment_methods_updated
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS payment_method_settings_updated
  ON public.payment_method_settings;
CREATE TRIGGER payment_method_settings_updated
  BEFORE UPDATE ON public.payment_method_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ---------------------------------------------------------------------------
-- 3.2 RLS.
--     The catalogue is readable by any staff member — every screen needs the
--     names and icons — and writable by nobody over PostgREST: it ships in
--     migrations, which run as the owner and bypass RLS.
--     The tenant configuration is readable by staff and writable by
--     owner/manager, matching every other settings surface in the project.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_methods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_method_settings  ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.payment_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_method_settings TO authenticated;
GRANT ALL ON public.payment_methods, public.payment_method_settings TO service_role;

DROP POLICY IF EXISTS "payment_methods read" ON public.payment_methods;
CREATE POLICY "payment_methods read"
  ON public.payment_methods
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "payment_method_settings read" ON public.payment_method_settings;
CREATE POLICY "payment_method_settings read"
  ON public.payment_method_settings
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "payment_method_settings write" ON public.payment_method_settings;
CREATE POLICY "payment_method_settings write"
  ON public.payment_method_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'));


-- ============================================================================
-- 4. THE SEED — the Yemeni catalogue
--
-- These are the methods we, the developers, prepare. ON CONFLICT DO UPDATE so
-- re-applying refreshes names, icons, order and contexts. It deliberately does
-- NOT touch payment_method_settings: a tenant's toggles are theirs, and a
-- migration must never reset them.
--
-- `legacy_ids` is load-bearing, not decoration. It is what lets cash/card/
-- bank_transfer/credit/mobile_money keep their exact meaning while five named
-- Yemeni institutions are first-class, selectable methods alongside them.
-- ============================================================================
INSERT INTO public.payment_methods (
  id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
  ledger_kind, default_account_code, is_credit_term, requires_reference,
  legacy_ids, notes
) VALUES
  -- ─── النقد: الأصل، ومتاح في كل قسم بما فيه المرتجعات ──────────────────────
  ('cash', 'نقداً', 'Cash', 'cash', true, 10,
   ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
   'CASH', '1101', false, false, ARRAY['cash'],
   'الصندوق. الأكثر استخداماً في السوق اليمني.'),

  -- ─── الآجل ────────────────────────────────────────────────────────────────
  ('credit', 'آجل', 'Credit', 'credit', true, 20,
   ARRAY['pos','sales','purchases','sales_returns','purchase_returns'],
   'CREDIT', '1211', true, false, ARRAY['credit'],
   'لا يُحصَّل الآن: يصبح ذمة على العميل أو للمورد. لا معنى له في المصروفات أو التحصيل.'),

  -- ─── تحويل بنكي عام: غير مرتبط ببنك بعينه ────────────────────────────────
  ('bank_transfer', 'تحويل بنكي', 'Bank transfer', 'bank-transfer', true, 30,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'BANK', '1111', false, true, ARRAY['bank_transfer'],
   'حوالة مصرفية عامة. يتطلب رقم الحوالة.'),

  -- ─── بنك الكريمي: أكبر شبكة تحويلات في اليمن ──────────────────────────────
  ('kuraimi_bank', 'بنك الكريمي', 'Al-Kuraimi Bank', 'kuraimi', true, 40,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'BANK', '1111', false, true, ARRAY[]::text[],
   'أوسع شبكة حوالات في اليمن. يتطلب رقم الحوالة.'),

  -- ─── بنك اليمن الدولي ────────────────────────────────────────────────────
  ('yemen_kuwait_bank', 'بنك اليمن الدولي', 'Yemen International Bank', 'bank', true, 50,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'BANK', '1121', false, true, ARRAY[]::text[],
   'حساب بنكي مستقل في دفتر الحسابات.'),

  -- ─── جوالي (يمن موبايل) ──────────────────────────────────────────────────
  ('jawali', 'جوالي', 'Jawali', 'mobile-money', true, 60,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'WALLET', NULL, false, true, ARRAY['mobile_money'],
   'محفظة يمن موبايل. المحفظة الأولى في الكتالوج تحمل قيمة mobile_money التاريخية.'),

  -- ─── جيب (محفظة بنك الكريمي) ─────────────────────────────────────────────
  ('jaib', 'جيب', 'Jaib Wallet', 'wallet', true, 70,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'WALLET', NULL, false, true, ARRAY[]::text[],
   'محفظة جيب التابعة لبنك الكريمي.'),

  -- ─── فلوسك ───────────────────────────────────────────────────────────────
  ('floosak', 'فلوسك', 'Floosak', 'wallet', true, 80,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'WALLET', NULL, false, true, ARRAY[]::text[],
   'محفظة إلكترونية.'),

  -- ─── ون كاش ──────────────────────────────────────────────────────────────
  ('one_cash', 'ون كاش', 'One Cash', 'wallet', true, 90,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'WALLET', NULL, false, true, ARRAY[]::text[],
   'محفظة إلكترونية.'),

  -- ─── البطاقة / الشبكة ────────────────────────────────────────────────────
  ('card', 'بطاقة / شبكة', 'Card', 'card', true, 100,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'CARD', '1111', false, false, ARRAY['card'],
   'شبكة مدى/الدفع الإلكتروني. تُسوّى عبر البنك.'),

  -- ─── المحفظة الإلكترونية العامة: البديل التاريخي بلا مؤسسة محددة ─────────
  ('mobile_money', 'محفظة إلكترونية', 'Mobile money', 'mobile-money', true, 110,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'WALLET', NULL, false, true, ARRAY['mobile_money'],
   'محفظة محلية غير محددة. تبقى للتوافق مع العمليات القديمة.'),

  -- ─── شيك ─────────────────────────────────────────────────────────────────
  ('cheque', 'شيك', 'Cheque', 'bank-transfer', true, 120,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'BANK', '1111', false, true, ARRAY['cheque'],
   'شيك مصرفي. يتطلب رقم الشيك كمرجع.'),

  -- ─── خط الدفع المجزأ: اسم وأيقونة للفاتورة التي سُدّدت بأكثر من وسيلة ────
  ('split', 'دفع بأكثر من طريقة', 'Split payment', 'split', true, 900,
   ARRAY['pos','sales'],
   'OTHER', NULL, false, false, ARRAY['split'],
   'ليس وسيلة يختارها الكاشير؛ ما تسجّله الفاتورة عند تعدد وسائل السداد.')
ON CONFLICT (id) DO UPDATE SET
  name_ar              = EXCLUDED.name_ar,
  name_en              = EXCLUDED.name_en,
  icon_key             = EXCLUDED.icon_key,
  is_active            = EXCLUDED.is_active,
  sort_order           = EXCLUDED.sort_order,
  allowed_contexts     = EXCLUDED.allowed_contexts,
  ledger_kind          = EXCLUDED.ledger_kind,
  default_account_code = COALESCE(EXCLUDED.default_account_code, public.payment_methods.default_account_code),
  is_credit_term       = EXCLUDED.is_credit_term,
  requires_reference   = EXCLUDED.requires_reference,
  legacy_ids           = EXCLUDED.legacy_ids,
  notes                = EXCLUDED.notes,
  updated_at           = now();


-- ---------------------------------------------------------------------------
-- 4.1 Backfill the tenant configuration for the legacy methods.
--
-- The six rows that correspond to today's ENUM values must stay enabled exactly
-- where they already appear, or the upgrade would silently remove payment
-- options from the till. ON CONFLICT DO NOTHING: an operator who has already
-- configured a method must not have their choice overwritten.
--
-- The named Yemeni methods get no row here. Absence means "inherit the
-- catalogue default", which is enabled and scoped to the catalogue's contexts —
-- so they appear as an ordinary addition, and switching one off is one tap.
-- ---------------------------------------------------------------------------
INSERT INTO public.payment_method_settings (
  payment_method_id, enabled, sort_order, enabled_contexts
)
SELECT m.id, true, m.sort_order, m.allowed_contexts
FROM public.payment_methods m
WHERE m.id IN ('cash','credit','bank_transfer','card','mobile_money','split')
ON CONFLICT (payment_method_id) DO NOTHING;


-- ============================================================================
-- 5. THE THREE HELPERS EVERYTHING ELSE CALLS
--
-- These replace, in one place, what used to be duplicated as ENUM literals in
-- five RPCs and four ledger-posting migrations.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 5.1 A catalogue id -> the value a document stores.
--
-- The ONLY sanctioned conversion. A screen must never guess, and `create_sale`
-- must never receive a value the ENUM cannot hold.
--
-- An unknown id returns 'cash' rather than NULL, because a NULL payment_method
-- on an invoice is worse than a wrong-but-valid one: the ledger engine would
-- fall through its CASE and post to the till regardless. The guard in 6.1 is
-- what refuses unknown ids up front; this is the last-resort floor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_legacy_id(p_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT lower(btrim(coalesce(p_id, ''))) AS v
  ),
  direct AS (
    -- The id already IS an ENUM value (cash, card, bank_transfer, credit,
    -- mobile_money, split, cheque): accept it as-is. This is what keeps every
    -- existing caller working unchanged.
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
             nullif(m.legacy_ids[1], ''),
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
    'cash'
  );
$$;

COMMENT ON FUNCTION public.payment_method_legacy_id(text) IS
  'يحوّل معرّف الكتالوج إلى القيمة التي يفهمها عمود payment_method. المصدر الوحيد لهذا التحويل في النظام.';

-- ---------------------------------------------------------------------------
-- 5.2 A stored value -> the catalogue row that represents it.
--     Used to label historic documents from the catalogue instead of a local
--     label map, so a new method's name is defined once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_catalog_id(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.payment_methods m
  WHERE lower(btrim(coalesce(p_stored, ''))) = ANY (m.legacy_ids)
  ORDER BY m.sort_order, m.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.payment_method_catalog_id(text) IS
  'يعيد معرّف الكتالوج المقابل لقيمة مخزّنة، لعرض الفواتير التاريخية من الكتالوج.';

-- ---------------------------------------------------------------------------
-- 5.3 Normalise an arbitrary incoming value to a catalogue id.
--
-- Order of resolution matters. A raw ENUM value must resolve to the CANONICAL
-- catalogue row for that value, not to whichever named institution happens to
-- also carry it. 'bank_transfer' must become the generic تحويل بنكي, never
-- بنك الكريمي.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_resolve_id(p_value text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT lower(btrim(coalesce(p_value, ''))) AS v
  )
  SELECT coalesce(
    -- 1. An exact catalogue id wins outright.
    (SELECT m.id FROM public.payment_methods m, norm n WHERE m.id = n.v),
    -- 2. An exact ENUM value resolves to the canonical row for that value.
    (SELECT public.payment_method_catalog_id(n.v) FROM norm n WHERE n.v <> ''),
    -- 3. Unresolvable: return the input so the caller can report it honestly
    --    instead of silently substituting a method the operator did not choose.
    (SELECT nullif(n.v, '') FROM norm n)
  );
$$;

COMMENT ON FUNCTION public.payment_method_resolve_id(text) IS
  'يطبّع أي قيمة واردة من الواجهة إلى معرّف كتالوجي، دون تخمين صامت.';

-- ---------------------------------------------------------------------------
-- 5.4 May this method be used, in this context, right now?
--
-- The single write guard. Reads the tenant configuration and falls back to the
-- catalogue, so a method nobody has configured is usable immediately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_is_allowed(
  p_value   text,
  p_context text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
      -- The developers can retire a method everywhere without deleting it.
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

COMMENT ON FUNCTION public.payment_method_is_allowed(text, text) IS
  'هل طريقة الدفع مفعّلة ومسموح بها في هذا القسم لهذه المنشأة؟ الحارس الوحيد في النظام.';

-- ---------------------------------------------------------------------------
-- 5.5 Which account does this method settle to?
--
-- Replaces the four copies of
--   IF payment_method IN ('bank_transfer','card','mobile_money') THEN '1111' ELSE '1101'
-- that made every new Yemeni method post to the cash drawer.
--
-- `credit` intentionally returns NULL: nothing was collected, so there is no
-- cash or bank line to write. The caller must test for NULL rather than treat
-- the result as a code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_ledger_account(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Explicit guidance on the catalogue row wins.
    WHEN m.default_account_code IS NOT NULL THEN m.default_account_code
    -- Otherwise derive from the account family. NULL for CREDIT is deliberate.
    WHEN m.ledger_kind IN ('BANK','WALLET','CARD') THEN '1111'
    WHEN m.ledger_kind = 'CREDIT' THEN NULL
    WHEN m.ledger_kind = 'CASH'   THEN '1101'
    ELSE '1101'
  END
  FROM public.payment_methods m
  WHERE m.id = public.payment_method_resolve_id(p_stored);
$$;

COMMENT ON FUNCTION public.payment_method_ledger_account(text) IS
  'الحساب الذي تُسوّى إليه طريقة الدفع. يعيد NULL للآجل لأن شيئاً لم يُحصَّل.';

-- ---------------------------------------------------------------------------
-- 5.6 Grant the helpers. They are read-only, SECURITY DEFINER and deterministic
--     for a given catalogue, so authenticated callers may execute them.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payment_method_legacy_id(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_catalog_id(text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_resolve_id(text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_is_allowed(text, text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_ledger_account(text)     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.payment_method_legacy_id(text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_catalog_id(text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_resolve_id(text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_is_allowed(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_ledger_account(text)   TO authenticated, service_role;


-- ============================================================================
-- 6. THE WRITE GUARD — one function, replacing five hard-coded ENUM lists
--
-- Every write path calls this instead of repeating
--   NOT IN ('cash','card','bank_transfer','credit','mobile_money')
-- which is what made a new method impossible to add without editing five files,
-- and what let the returns screens send a `bank` value the ENUM cannot hold.
--
-- `p_strict_context` controls whether the context scoping applies:
--   • true  — normal operator input. The method must be enabled for THIS
--             section. Prevents a wallet appearing in a purchase return.
--   • false — replay / repair. The method must exist and be enabled for the
--             business, but is not scoped to a section. Used where a historic
--             document is being re-posted after the business changed its
--             settings, so we do not rewrite history.
--
-- Returns the value to STORE (already converted through the ENUM), or raises.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_writable_payment_method(
  p_value          text,
  p_context        text,
  p_strict_context boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      text;
  v_stored  text;
  v_enabled boolean;
BEGIN
  v_id := public.payment_method_resolve_id(p_value);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'طريقة دفع غير صالحة: %', coalesce(p_value, '(فارغ)')
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

  IF p_strict_context
     AND NOT public.payment_method_is_allowed(v_id, coalesce(p_context, 'pos')) THEN
    RAISE EXCEPTION
      'طريقة الدفع "%" غير مسموح بها في قسم "%"', p_value, coalesce(p_context, 'pos')
      USING ERRCODE = 'check_violation';
  END IF;

  v_stored := public.payment_method_legacy_id(v_id);

  IF v_stored IS NULL THEN
    RAISE EXCEPTION 'تعذّر تحويل طريقة الدفع إلى قيمة صالحة: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_stored;
END $$;

COMMENT ON FUNCTION public.resolve_writable_payment_method(text, text, boolean) IS
  'الحارس الموحّد لكتابة طريقة الدفع: يتحقق من الصلاحية ثم يعيد القيمة المخزّنة. بديل القوائم المضمّنة في دوال الكتابة.';

REVOKE ALL ON FUNCTION public.resolve_writable_payment_method(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_writable_payment_method(text, text, boolean) TO authenticated, service_role;


-- ============================================================================
-- 7. WRITE PATHS NOW USE THE CATALOGUE
--
-- Each of these is the CURRENT body of the function, unchanged except for the
-- payment-method handling. Nothing about stock, credit limits, ledger posting
-- for debts, audit or numbering is touched — a payment method is a label and an
-- account family, not a business rule.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 7.1 create_sale (7-argument core engine)
--
-- The full current body of the unified sales engine from
-- 20260929030000_invoice_line_types_and_policy_sales_engine.sql, with ONE
-- change: the inline literal guard becomes a catalogue call, and the stored
-- value is the one the catalogue sanctions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id       uuid;
  v_invoice_number   text;
  v_user             uuid := auth.uid();
  v_line             record;
  v_subtotal         numeric := 0;
  v_tax_total        numeric := 0;
  v_discount         numeric := coalesce(_discount, 0);
  v_total            numeric := 0;
  v_paid             numeric := 0;
  v_outstanding      numeric := 0;
  v_price            numeric;
  v_tax_rate         numeric;
  v_cost             numeric;
  v_customer_balance numeric;
  v_credit_limit     numeric;
  v_line_total       numeric;
  v_line_tax         numeric;
  v_effect           text;
  v_line_type        text;
  v_sellable         boolean;
  v_status           public.invoice_status;
  v_last_item_id     uuid;
  v_available        numeric;
  v_stored_method    text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post sales';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- ── الوحيد المتغيّر: الحارس يأتي من الكتالوج بدل قائمة مضمّنة ─────────────
  v_stored_method := public.resolve_writable_payment_method(
    _payment_method, 'sales', true
  );

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- ============================================================== VALIDATION
  -- Only lines whose policy is STOCK_ISSUE are stock-checked. Aggregating by
  -- item and locking the inventory row protects against concurrent checkouts.
  FOR v_line IN
    SELECT r.o_product_id AS product_id, sum(r.o_quantity) AS quantity
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    WHERE r.o_stock_effect = 'STOCK_ISSUE'
    GROUP BY r.o_product_id
    ORDER BY r.o_product_id
  LOOP
    SELECT i.quantity
      INTO v_available
    FROM public.inventory i
    WHERE i.product_id = v_line.product_id
      AND i.warehouse_id = _warehouse_id
      AND i.owner_type = 'COMPANY'
      AND i.owner_id IS NULL
    FOR UPDATE;

    v_available := coalesce(v_available, 0);

    IF v_available < v_line.quantity THEN
      RAISE EXCEPTION
        'Insufficient stock for item %: available %, requested %',
        v_line.product_id, v_available, v_line.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Totals. Catalogue price wins for a catalogue item; the operator's price is
  -- used only for ad-hoc service lines.
  FOR v_line IN
    SELECT r.o_product_id    AS product_id,
           r.o_quantity      AS quantity,
           r.o_service_name  AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'Every sale line requires a positive quantity';
    END IF;

    IF v_line.product_id IS NULL THEN
      IF coalesce(v_line.service_name, '') = '' THEN
        RAISE EXCEPTION 'Every service line requires a description';
      END IF;
      IF v_line.input_price < 0 OR v_line.input_tax < 0 OR v_line.input_tax > 100 THEN
        RAISE EXCEPTION 'Service line "%" has an invalid price or tax rate', v_line.service_name;
      END IF;
      v_price    := v_line.input_price;
      v_tax_rate := v_line.input_tax;
    ELSE
      SELECT p.sale_price, p.tax_rate, p.is_sellable
        INTO v_price, v_tax_rate, v_sellable
      FROM public.products p
      WHERE p.id = v_line.product_id AND p.is_active = true
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % is not available for sale', v_line.product_id;
      END IF;
      IF v_sellable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as sellable', v_line.product_id;
      END IF;
      IF v_price < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
        RAISE EXCEPTION 'Item % has invalid pricing or tax configuration', v_line.product_id;
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + round(v_line_total * v_tax_rate / 100, 2);
  END LOOP;

  v_total := round(v_subtotal + v_tax_total - v_discount, 2);

  IF v_discount > v_subtotal + v_tax_total OR v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the invoice amount';
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT balance, credit_limit
      INTO v_customer_balance, v_credit_limit
    FROM public.customers
    WHERE id = _customer_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is unavailable';
    END IF;
  END IF;

  -- Tender above the total is change, not revenue and not credit.
  v_paid := least(coalesce(_paid, 0), v_total);
  v_outstanding := round(v_total - v_paid, 2);

  IF v_outstanding > 0 AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount';
  END IF;

  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_status := CASE
    WHEN v_paid >= v_total THEN 'paid'::public.invoice_status
    WHEN v_paid = 0      THEN 'unpaid'::public.invoice_status
    ELSE 'partial'::public.invoice_status
  END;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status,
    v_subtotal, v_discount, v_tax_total, v_total, v_paid,
    v_stored_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  -- ================================================================== POSTING
  FOR v_line IN
    SELECT r.o_product_id   AS product_id,
           r.o_quantity     AS quantity,
           r.o_stock_effect AS stock_effect,
           r.o_service_name AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax,
           nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    v_cost := NULL;

    IF v_line.product_id IS NULL THEN
      v_price     := v_line.input_price;
      v_tax_rate  := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE';
      v_effect    := 'NONE';
    ELSE
      SELECT p.sale_price, p.tax_rate, p.cost_price
        INTO v_price, v_tax_rate, v_cost
      FROM public.products p WHERE p.id = v_line.product_id;

      v_line_type := public.item_line_type(v_line.product_id, false);
      -- Re-derive the effect at posting time so a policy change between
      -- validation and posting cannot slip a movement through unannounced.
      v_effect := public.item_stock_effect(v_line.product_id, 'out');

      IF v_effect = 'STOCK_ISSUE' THEN
        PERFORM public.post_stock_delta(
          v_line.product_id,
          _warehouse_id,
          -v_line.quantity,
          v_cost,
          'ISSUE'::public.stock_movement_kind,
          'sales_invoice',
          v_invoice_id,
          'POS sale',
          'COMPANY'::public.owner_type,
          NULL,
          'sale'::public.movement_type
        );
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);

    INSERT INTO public.sales_invoice_items (
      invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
      line_type, stock_effect, uom_id
    )
    VALUES (
      v_invoice_id,
      v_line.product_id,
      CASE WHEN v_line.product_id IS NULL THEN v_line.service_name ELSE NULL END,
      v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax,
      v_line_type, v_effect, v_line.uom_id
    )
    RETURNING id INTO v_last_item_id;

    IF v_line_type = 'AD_HOC_SERVICE' THEN
      INSERT INTO public.ad_hoc_service_lines (
        invoice_id, invoice_item_id, description, quantity, unit_price,
        discount, tax, total, created_by
      )
      VALUES (
        v_invoice_id, v_last_item_id, v_line.service_name, v_line.quantity,
        v_price, 0, v_line_tax, v_line_total + v_line_tax, v_user
      );
    END IF;
  END LOOP;

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      now(), v_user, 'sale:' || v_invoice_id, 'قيد بيع آجل'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.posted', 'sales_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'warehouse_id', _warehouse_id,
      'customer_id', _customer_id,
      'payment_method', v_stored_method,
      'total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'line_count', jsonb_array_length(_items)
    ));

  RETURN v_invoice_id;
END $$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb) IS
  'محرك البيع الموحد. الأثر المخزني يُحدَّد من سياسة الصنف، وطريقة الدفع من كتالوج payment_methods.';


-- ---------------------------------------------------------------------------
-- 7.2 create_sale — 8-argument overload (business date)
--
-- Body unchanged from 20260929030000: validate the date, delegate to the core
-- engine, then pin the invoice and its stock movements to the business date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_posted_at  timestamptz;
BEGIN
  IF _sale_date IS NULL THEN
    RAISE EXCEPTION 'Sale date is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- All validation, stock movement, ledger posting and auditing happen here.
  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items
  );

  v_posted_at := _sale_date::timestamp + localtime;

  UPDATE public.sales_invoices
  SET created_at = v_posted_at, updated_at = now()
  WHERE id = v_invoice_id;

  UPDATE public.stock_movements
  SET created_at = v_posted_at
  WHERE source_type = 'sales_invoice' AND source_id = v_invoice_id;

  RETURN v_invoice_id;
END $$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) TO authenticated;

COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) IS
  'يسجّل البيع عبر المحرك الموحد ثم يثبّت التاريخ التجاري على الفاتورة وحركاتها.';


-- ---------------------------------------------------------------------------
-- 7.3 create_sale — 9-argument overload (split tender breakdown)
--
-- TWO changes from 20260929030000, both about method resolution:
--   • a split component is validated through the catalogue for its own context
--     instead of the twice-duplicated literal list
--   • the component value is CONVERTED to the stored ENUM value. This is the
--     bug that made a split sale impossible with a method the ENUM does not
--     carry: 'jaib' reached `method::payment_method` untouched and failed.
--
-- The arithmetic, the total-must-match guard, the invoice update and the
-- customer_payment_splits rows are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date,
  _payment_splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id       uuid;
  v_total            numeric;
  v_paid             numeric;
  v_user             uuid := auth.uid();
  v_split            record;
  v_component_count  integer := 0;
  v_split_total      numeric := 0;
  v_distinct_methods integer := 0;
  v_single_method    text;
  v_recorded_method  text;
  v_stored_component text;
BEGIN
  IF coalesce(jsonb_typeof(_payment_splits), 'jsonb') <> 'array'
     OR coalesce(jsonb_array_length(_payment_splits), 0) = 0 THEN
    -- No breakdown supplied: exact legacy behaviour.
    RETURN public.create_sale(
      _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, _sale_date
    );
  END IF;

  -- ── التحقق من كل مكوّن عبر الكتالوج، وتحويله إلى القيمة المخزّنة ──────────
  FOR v_split IN
    SELECT (part ->> 'method') AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount
    FROM jsonb_array_elements(_payment_splits) AS part
  LOOP
    IF v_split.method IS NULL OR btrim(v_split.method) = '' THEN
      RAISE EXCEPTION 'Unsupported payment method: (empty)'
        USING ERRCODE = 'check_violation';
    END IF;

    v_stored_component := public.resolve_writable_payment_method(
      v_split.method, 'pos', true
    );

    IF v_stored_component = 'credit' THEN
      RAISE EXCEPTION 'الدفع الآجل لا يُدرج كمكوّن في دفعة مجزأة'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_split.amount <= 0 THEN
      RAISE EXCEPTION 'Every payment tender component requires a positive amount';
    END IF;

    v_component_count := v_component_count + 1;
    v_split_total     := v_split_total + v_split.amount;
  END LOOP;

  -- Distinct on the STORED value, so two named banks that both settle to
  -- bank_transfer are honestly reported as one tender, not two.
  SELECT count(DISTINCT public.payment_method_legacy_id(part ->> 'method')),
         min(public.payment_method_legacy_id(part ->> 'method'))
    INTO v_distinct_methods, v_single_method
  FROM jsonb_array_elements(_payment_splits) AS part;

  -- The tender breakdown and the paid amount must agree; otherwise the invoice
  -- and the recorded payments would drift apart.
  IF round(v_split_total, 2) <> round(coalesce(_paid, 0), 2) THEN
    RAISE EXCEPTION
      'Payment breakdown total % does not match the paid amount %',
      round(v_split_total, 2),
      round(coalesce(_paid, 0), 2);
  END IF;

  v_recorded_method := CASE
    WHEN v_distinct_methods > 1 THEN 'split'
    ELSE v_single_method
  END;

  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, v_recorded_method, _paid, _discount, _note, _items, _sale_date
  );

  SELECT total, paid INTO v_total, v_paid FROM public.sales_invoices WHERE id = v_invoice_id;

  -- Keep the invoice method truthful even if the caller sent something else.
  UPDATE public.sales_invoices
  SET payment_method = v_recorded_method::public.payment_method, updated_at = now()
  WHERE id = v_invoice_id
    AND payment_method IS DISTINCT FROM v_recorded_method::public.payment_method;

  FOR v_split IN
    SELECT (part ->> 'method') AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount
    FROM jsonb_array_elements(_payment_splits) AS part
  LOOP
    INSERT INTO public.customer_payment_splits (
      customer_id, invoice_id, method, amount, occurred_at, created_by
    )
    VALUES (
      _customer_id,
      v_invoice_id,
      public.payment_method_legacy_id(v_split.method)::public.payment_method,
      round(v_split.amount, 2),
      coalesce(_sale_date, current_date)::timestamp + localtime,
      v_user
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.tender_breakdown.recorded', 'sales_invoice', v_invoice_id,
    jsonb_build_object(
      'recorded_payment_method', v_recorded_method,
      'components', v_component_count,
      'tender_total', round(v_split_total, 2),
      'total', v_total,
      'paid', v_paid
    ));

  RETURN v_invoice_id;
END $$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) IS
  'بيع بدفعة مجزأة: يتحقق من كل وسيلة عبر الكتالوج ويحوّلها إلى القيمة المخزّنة قبل كتابة تفصيل الدفعات.';


-- ---------------------------------------------------------------------------
-- 7.4 record_customer_payment
--
-- Body unchanged from 20260801090000 apart from the guard and the stored value.
-- The invoice allocation, the advance-payment path, the customer balance
-- update, the ledger entry and the audit row are byte-for-byte the same.
--
-- The old guard rejected anything outside four values, which is why the
-- collection sheet silently collapsed 'card' and 'mobile_money' onto
-- 'bank_transfer' before calling it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method text,
  _payment_date date,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id                uuid;
  v_user              uuid := auth.uid();
  v_invoice           record;
  v_customer_balance  numeric;
  v_remaining         numeric := coalesce(_amount, 0);
  v_allocation        numeric;
  v_stored_method     text;
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

  IF _customer_id IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;

  -- ── الحارس الموحّد: الصلاحية من الكتالوج، والقيمة المخزّنة محسوبة ─────────
  v_stored_method := public.resolve_writable_payment_method(
    _method, 'customer_collection', true
  );

  SELECT balance
    INTO v_customer_balance
  FROM public.customers
  WHERE id = _customer_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id
      INTO v_invoice
    FROM public.sales_invoices
    WHERE id = _invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;

    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;

    IF v_remaining > v_invoice.total - v_invoice.paid THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
    )
    VALUES (
      _customer_id, _invoice_id, v_remaining, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
    )
    RETURNING id INTO v_id;

    UPDATE public.sales_invoices
    SET paid = paid + v_remaining,
        status = CASE
          WHEN paid + v_remaining >= total THEN 'paid'::public.invoice_status
          WHEN paid + v_remaining = 0 THEN 'unpaid'::public.invoice_status
          ELSE 'partial'::public.invoice_status
        END,
        updated_at = now()
    WHERE id = _invoice_id;
  ELSE
    -- A general customer payment is applied to the oldest outstanding invoices.
    -- This keeps customer balance, invoice status, and payment history aligned.
    FOR v_invoice IN
      SELECT id, total, paid
      FROM public.sales_invoices
      WHERE customer_id = _customer_id
        AND total > paid
        AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_allocation := least(v_remaining, v_invoice.total - v_invoice.paid);

      INSERT INTO public.customer_payments (
        customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
      )
      VALUES (
        _customer_id, v_invoice.id, v_allocation, v_stored_method::public.payment_method,
        coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
      )
      RETURNING id INTO v_id;

      UPDATE public.sales_invoices
      SET paid = paid + v_allocation,
          status = CASE
            WHEN paid + v_allocation >= total THEN 'paid'::public.invoice_status
            WHEN paid + v_allocation = 0 THEN 'unpaid'::public.invoice_status
            ELSE 'partial'::public.invoice_status
          END,
          updated_at = now()
      WHERE id = v_invoice.id;

      v_remaining := v_remaining - v_allocation;
    END LOOP;

    -- Anything left over is an advance, not a lost amount.
    IF v_remaining > 0 THEN
      INSERT INTO public.customer_payments (customer_id, invoice_id, amount, payment_method, payment_date, note, created_by)
      VALUES (_customer_id, NULL, v_remaining, v_stored_method::public.payment_method, coalesce(_payment_date, current_date), coalesce(nullif(trim(_note), ''), 'دفعة مقدمة'), v_user)
      RETURNING id INTO v_id;
    END IF;
  END IF;

  UPDATE public.customers
  SET balance = round(coalesce(balance, 0) - _amount, 2), updated_at = now()
  WHERE id = _customer_id;

  INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
  VALUES (_customer_id, 'payment', round(_amount, 2), v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة عميل'));

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'customer_payment.recorded',
    'customer',
    _customer_id,
    jsonb_build_object(
      'invoice_id', _invoice_id,
      'amount', _amount,
      'method', v_stored_method,
      'payment_date', coalesce(_payment_date, current_date)
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text)
  TO authenticated;

COMMENT ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text) IS
  'سند تحصيل عميل: يوزّع تلقائياً على أقدم الفواتير المستحقة، والحارس من كتالوج طرق الدفع.';


-- ---------------------------------------------------------------------------
-- 7.5 create_sales_return
--
-- Body unchanged from 20260929030000 apart from the refund method. The old code
-- wrote `_refund_method::public.payment_method` with NO validation at all, which
-- is why the returns screen could send 'bank' — a value the ENUM cannot hold —
-- and the whole return failed with a cast error rather than a clear message.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sales_return(
  _invoice_id uuid,
  _warehouse_id uuid,
  _customer_id uuid,
  _refund_method text,
  _note text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id             uuid;
  v_no             text;
  v_user           uuid := auth.uid();
  v_item           jsonb;
  v_sub            numeric := 0;
  v_tax            numeric := 0;
  v_tot            numeric := 0;
  v_qty            numeric;
  v_price          numeric;
  v_tr             numeric;
  v_lt             numeric;
  v_ltax           numeric;
  v_p              uuid;
  v_effect         text;
  v_type           text;
  v_stored_refund  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  -- ── الحارس الموحّد لطريقة الاسترداد ──────────────────────────────────────
  v_stored_refund := public.resolve_writable_payment_method(
    _refund_method, 'sales_returns', true
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty   := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;
    v_tr    := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt    := v_qty * v_price;
    v_ltax  := v_lt * v_tr / 100;
    v_sub   := v_sub + v_lt;
    v_tax   := v_tax + v_ltax;
  END LOOP;
  v_tot := v_sub + v_tax;
  v_no  := public.next_sales_return_number();

  INSERT INTO public.sales_returns (
    return_number, invoice_id, customer_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, _customer_id, _warehouse_id,
    v_sub, v_tax, v_tot, v_stored_refund::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p     := (v_item ->> 'product_id')::uuid;
    v_qty   := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;
    v_tr    := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt    := v_qty * v_price;
    v_ltax  := v_lt * v_tr / 100;

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'in');

    INSERT INTO public.sales_return_items (
      return_id, product_id, quantity, unit_price, tax, total, line_type
    )
    VALUES (v_id, v_p, v_qty, v_price, v_ltax, v_lt + v_ltax, v_type);

    -- Only a tracked good comes back into stock.
    IF v_effect = 'STOCK_RECEIPT' THEN
      PERFORM public.post_stock_delta(
        v_p,
        _warehouse_id,
        v_qty,
        v_price,
        'RECEIPT'::public.stock_movement_kind,
        'sales_return',
        v_id,
        'Sales return',
        'COMPANY'::public.owner_type,
        NULL,
        'return_in'::public.movement_type
      );
    END IF;
  END LOOP;

  IF _customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET balance = greatest(balance - v_tot, 0), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'return', round(v_tot, 2), v_id, 'sales_return',
      now(), v_user, 'return:' || v_id, 'مرتجع مبيعات'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sales_return.posted', 'sales_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'customer_id', _customer_id,
      'refund_method', v_stored_refund,
      'total', v_tot
    ));

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) IS
  'مرتجع مبيعات: لا يعيد للمخزون إلا الأصناف المتتبعة، وطريقة الاسترداد محقّقة من الكتالوج.';


-- ---------------------------------------------------------------------------
-- 7.6 create_purchase_return
--
-- Body unchanged from 20260929040000 apart from the refund method. The old code
-- also cast `_refund_method::public.payment_method` without validation, so the
-- purchase-returns screen's 'bank' value failed as a cast error.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_return(
  _invoice_id uuid,
  _warehouse_id uuid,
  _supplier_id uuid,
  _refund_method text,
  _note text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id             uuid;
  v_no             text;
  v_user           uuid := auth.uid();
  v_item           jsonb;
  v_sub            numeric := 0;
  v_tax            numeric := 0;
  v_tot            numeric := 0;
  v_qty            numeric;
  v_cost           numeric;
  v_tr             numeric;
  v_lt             numeric;
  v_ltax           numeric;
  v_p              uuid;
  v_effect         text;
  v_type           text;
  v_avail          numeric;
  v_stored_refund  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  -- ── الحارس الموحّد لطريقة الاسترداد ──────────────────────────────────────
  v_stored_refund := public.resolve_writable_payment_method(
    _refund_method, 'purchase_returns', true
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p    := (v_item ->> 'product_id')::uuid;
    v_qty  := (v_item ->> 'quantity')::numeric;
    v_cost := (v_item ->> 'unit_cost')::numeric;
    v_tr   := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    v_effect := public.item_stock_effect(v_p, 'out');

    -- Only a tracked good has stock to send back.
    IF v_effect = 'STOCK_ISSUE' THEN
      SELECT i.quantity INTO v_avail
      FROM public.inventory i
      WHERE i.product_id = v_p
        AND i.warehouse_id = _warehouse_id
        AND i.owner_type = 'COMPANY'
        AND i.owner_id IS NULL;

      IF coalesce(v_avail, 0) < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for item %', v_p;
      END IF;
    END IF;

    v_lt   := v_qty * v_cost;
    v_ltax := v_lt * v_tr / 100;
    v_sub  := v_sub + v_lt;
    v_tax  := v_tax + v_ltax;
  END LOOP;
  v_tot := v_sub + v_tax;
  v_no  := public.next_purchase_return_number();

  INSERT INTO public.purchase_returns (
    return_number, invoice_id, supplier_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, _supplier_id, _warehouse_id,
    v_sub, v_tax, v_tot, v_stored_refund::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p    := (v_item ->> 'product_id')::uuid;
    v_qty  := (v_item ->> 'quantity')::numeric;
    v_cost := (v_item ->> 'unit_cost')::numeric;
    v_tr   := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt   := v_qty * v_cost;
    v_ltax := v_lt * v_tr / 100;

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'out');

    INSERT INTO public.purchase_return_items (
      return_id, product_id, quantity, unit_cost, tax, total, line_type
    )
    VALUES (v_id, v_p, v_qty, v_cost, v_ltax, v_lt + v_ltax, v_type);

    IF v_effect = 'STOCK_ISSUE' THEN
      PERFORM public.post_stock_delta(
        v_p,
        _warehouse_id,
        -v_qty,
        v_cost,
        'ISSUE'::public.stock_movement_kind,
        'purchase_return',
        v_id,
        'Purchase return',
        'COMPANY'::public.owner_type,
        NULL,
        'return_out'::public.movement_type
      );
    END IF;
  END LOOP;

  IF _supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET balance = greatest(balance - v_tot, 0), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase_return.posted', 'purchase_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'supplier_id', _supplier_id,
      'refund_method', v_stored_refund,
      'total', v_tot
    ));

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) IS
  'مرتجع مشتريات: يعيد المتتبَّع فقط إلى المخزون، وطريقة الاسترداد محقّقة من الكتالوج.';


-- ============================================================================
-- 8. THE LEDGER POSTING ENGINE NOW ASKS THE CATALOGUE
--
-- Four migrations each carried their own copy of:
--
--   IF payment_method = 'credit' THEN NULL
--   ELSIF payment_method IN ('bank_transfer','card','mobile_money') THEN '1111'
--   ELSE '1101' END IF
--
-- That three-line branch was the reason a new Yemeni method could not be added
-- safely. بنك الكريمي recorded as 'bank_transfer' posted correctly BY ACCIDENT:
-- only because its `legacy_ids` happened to map onto a value already in the
-- list. A method whose ledger kind was BANK but whose legacy value resolved to
-- something else would have posted to the cash drawer with no error at all.
--
-- Each body below is the CURRENT function, with only that branch replaced by
-- public.payment_method_ledger_account(). The entry construction, the revenue
-- classification, the cost resolution, the VAT line, the exactly-once guard and
-- the view are untouched.
--
-- Note the ordering of the four definitions: each supersedes the previous one,
-- and they are replayed here in the same order so the final definition is
-- identical to what production already runs — plus the catalogue call.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 8.1 ledger_account_code_for_payment_method — the branch, named once.
--
-- Kept as a wrapper rather than inlining the call into each posting function,
-- so the four functions still read exactly as they did and a reviewer can diff
-- them line by line against their originals.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_account_code_for_payment_method(
  p_payment_method text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.payment_method_ledger_account(p_payment_method);
$$;

COMMENT ON FUNCTION public.ledger_account_code_for_payment_method(text) IS
  'الحساب الذي تُسوّى إليه طريقة الدفع في القيود. يعيد NULL للآجل، ويأتي من الكتالوج لا من قائمة مضمّنة.';

REVOKE ALL ON FUNCTION public.ledger_account_code_for_payment_method(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_account_code_for_payment_method(text) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8.2 post_sales_invoice
--
-- Reproduced VERBATIM from
--   20261202000200_cash_received_is_debited_not_credited.sql
-- which is the newest of the three sales-ledger definitions. The single change
-- is the replacement of:
--
--   IF v_inv.payment_method = 'credit' THEN NULL
--   ELSIF v_inv.payment_method IN ('bank_transfer','card','mobile_money') THEN '1111'
--   ELSE '1101' END IF
--
-- with a call to the catalogue. Everything else — the exactly-once guard, the
-- overpaid refusal, the revenue classification by item_class, the VAT line, the
-- COGS lines, and create_journal_entry — is untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_collectable numeric := 0;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
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

  -- ── الحساب من الكتالوج بدل القائمة المضمّنة ─────────────────────────────
  -- 'credit'          -> NULL      (لم يُحصَّل شيء)
  -- BANK/WALLET/CARD  -> '1111'    (يخرج عبر البنك)
  -- CASH / OTHER      -> '1101'    (الصندوق؛ وsplit تُسوّى نقداً)
  v_cash_acct := public.ledger_account_code_for_payment_method(v_inv.payment_method);

  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── revenue, credited ──
  FOR r IN
    SELECT p.item_class, sum(it.total) AS amount
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY p.item_class
    HAVING sum(it.total) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.item_class);
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- ── what the mill received: cash and receivable are both DEBITS ──
  -- They are alternatives for the same increase, so a fully-paid sale has a
  -- cash debit and no receivable, and a credit sale the reverse.
  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'debit', round(v_inv.paid, 2),
      'memo', 'تحصيل نقدي/بنكي');
  END IF;
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'debit', round(v_collectable, 2),
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة القيمة المضافة المستحقة');
  END IF;

  -- ── the cost of the goods that left ──
  FOR r IN
    SELECT p.item_class,
           sum(it.quantity * public.resolve_unit_cost(p.id, v_inv.warehouse_id)) AS cost
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.stock_effect = 'STOCK_ISSUE'
     GROUP BY p.item_class
  LOOP
    IF r.cost IS NULL OR r.cost = 0 THEN
      CONTINUE;   -- no cost known; a zero COGS line would overstate profit
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'credit', round(r.cost, 2),
      'memo', 'تكلفة ' || r.item_class);
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111', 'debit', round(r.cost, 2),
      'memo', 'تكلفة البضاعة المباعة');
  END LOOP;

  v_entry := public.create_journal_entry(
    'فاتورة مبيعات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'sales_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END $$;

REVOKE ALL ON FUNCTION public.post_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION public.post_sales_invoice(uuid) IS
  'يرحّل فاتورة مبيعات إلى الدفتر. حساب التحصيل يأتي من كتالوج طرق الدفع، والإيراد من تصنيف الصنف.';


-- ---------------------------------------------------------------------------
-- 8.3 post_purchase_invoice
--
-- Reproduced VERBATIM from
--   20261203000000_post_purchase_invoices_to_ledger.sql
-- with the same single change to the payment-method branch. The classification
-- of goods-versus-expense by stock_effect, the recoverable input VAT on 1316,
-- and the supplier partner_id on the payable line are all untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_owed     numeric := 0;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
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

  -- ── الحساب من الكتالوج بدل القائمة المضمّنة ─────────────────────────────
  v_cash_acct := public.ledger_account_code_for_payment_method(v_inv.payment_method);

  v_owed := greatest(v_inv.total - v_inv.paid, 0);

  -- ── what was acquired ──
  FOR r IN
    SELECT p.item_class,
           coalesce(it.stock_effect, 'NONE') AS effect,
           sum(it.total)                     AS amount,
           sum(it.tax)                       AS line_tax
      FROM public.purchase_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY p.item_class, coalesce(it.stock_effect, 'NONE')
    HAVING sum(it.total) <> 0 OR sum(it.tax) <> 0
  LOOP
    IF r.amount <> 0 THEN
      -- Goods that entered stock go to the inventory account for their class;
      -- anything else is an expense, not an increase in stock.
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE
          WHEN r.effect <> 'STOCK_RECEIPT' THEN '5911'
          ELSE CASE r.item_class
                 WHEN 'RAW_MATERIAL' THEN '1311'
                 WHEN 'BY_PRODUCT'   THEN '1314'
                 WHEN 'FINISHED_GOOD' THEN '1313'
                 ELSE '1315' END END,
        'debit', round(r.amount, 2),
        'memo', CASE WHEN r.effect <> 'STOCK_RECEIPT'
                     THEN 'مصروف مشتريات ' || r.item_class
                     ELSE 'شراء ' || r.item_class END);
    END IF;

    -- Input VAT is recoverable and therefore an asset in its own right.
    IF r.line_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1316', 'debit', round(r.line_tax, 2),
        'memo', 'ضريبة مدخلات قابلة للاسترداد');
    END IF;
  END LOOP;

  -- A purchase carrying tax on the header but not on its lines still has it.
  IF v_inv.tax <> 0 AND not exists (
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

  -- ── what was paid and what is owed ──
  IF v_owed > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2111', 'credit', round(v_owed, 2),
      'memo', 'مستحق للمورد',
      'partner_type', 'supplier',
      'partner_id', v_inv.supplier_id);
  END IF;

  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_inv.paid, 2),
      'memo', 'سداد للمورد');
  END IF;

  v_entry := public.create_journal_entry(
    'فاتورة مشتريات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'purchase_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END $$;

REVOKE ALL ON FUNCTION public.post_purchase_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.post_purchase_invoice(uuid) IS
  'يرحّل فاتورة مشتريات: مخزون/مصروف + ضريبة مدخلات، مقابل النقدية أو ذمم الموردين. '
  'حساب الدفع يأتي من كتالوج طرق الدفع لا من قائمة مضمّنة.';


-- ============================================================================
-- 9. REPORTING VIEW — method names come from the catalogue, not from a CASE
--
-- One read helper so statements, reports and exports do not each rebuild a
-- label map. Returns the catalogue id, the Arabic and English names, and the
-- account family, for any stored value including historic ones.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.payment_method_catalog_view()
RETURNS TABLE (
  id                  text,
  name_ar             text,
  name_en             text,
  icon_key            text,
  ledger_kind         text,
  default_account_code text,
  is_credit_term      boolean,
  is_active           boolean,
  sort_order          integer,
  allowed_contexts    text[],
  -- Tenant layer, coalesced so an unconfigured method reports its defaults
  -- rather than NULLs a report would have to special-case.
  enabled             boolean,
  effective_sort_order integer,
  effective_contexts  text[],
  is_configured       boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
    coalesce(s.enabled, true),
    coalesce(s.sort_order, m.sort_order),
    CASE
      WHEN coalesce(cardinality(s.enabled_contexts), 0) > 0
        THEN s.enabled_contexts
      ELSE m.allowed_contexts
    END,
    (s.payment_method_id IS NOT NULL)
  FROM public.payment_methods m
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  ORDER BY coalesce(s.sort_order, m.sort_order), m.id;
$$;

COMMENT ON FUNCTION public.payment_method_catalog_view() IS
  'عرض موحّد لطرق الدفع مع تخصيص المنشأة، لاستخدامه في التقارير والتصدير دون خرائط تسميات محلية.';

REVOKE ALL ON FUNCTION public.payment_method_catalog_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_catalog_view() TO authenticated, service_role;


-- ============================================================================
-- 10. WHERE THE OLD DEFINITIONS WENT
--
-- The migrations below are now SUPERSEDED and left in place for history only —
-- they are never edited, because rewriting an applied migration would make the
-- schema depend on which order the files happened to run in:
--
--   20260706120000  ALTER TYPE payment_method ADD VALUE 'mobile_money'
--   20260706121000  duplicate of the above (reset-seed path)
--   20260707021000  duplicate of the above (Yemen-seed path)
--        -> section 1 widens the ENUM to the full set transactionally.
--
--   20260801090000  create_sale / record_customer_payment literal guards
--        -> section 7.1 and 7.4 replace both with
--           resolve_writable_payment_method.
--
--   20260928000000  superseded split-payment engine, literal component guard
--        -> superseded by 20260929030000, which section 7.3 now replaces.
--
--   20260929030000  create_sale (three overloads), create_sales_return
--        -> sections 7.1-7.3 and 7.5.
--
--   20260929040000  create_purchase_return
--        -> section 7.6.
--
--   20261202000000  post_sales_invoice, payment-method branch
--   20261202000100  the same branch, overpaid refusal
--   20261202000200  the same branch, cash debit correction
--   20261203000000  post_purchase_invoice, the same branch
--        -> sections 8.2 and 8.3.
--
-- WHY THEY ARE NOT DELETED: each one also creates indexes, views, constraints
-- and helper functions that this file does not recreate. Deleting them would
-- drop those objects on a fresh database while leaving production untouched —
-- exactly the kind of drift that makes a schema impossible to reason about.
-- Superseding the definitions here is both safer and sufficient: after this
-- migration, no live function contains a hard-coded payment-method list.
-- ============================================================================

COMMIT;
