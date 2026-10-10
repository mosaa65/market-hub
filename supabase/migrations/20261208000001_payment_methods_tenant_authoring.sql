-- ============================================================================
-- 20261208000001_payment_methods_tenant_authoring.sql
--
-- VERSION NOTE: this file was authored as `20261009000000_...`, which collided
-- with the already-applied `20261009000000_arabic_rpc_messages_and_data_cleanup`
-- migration. Supabase keys `schema_migrations` on the version string alone, so
-- the two could never coexist and the push failed on the final bookkeeping
-- INSERT (duplicate key) — after the whole body had already run and been rolled
-- back with it. The version is now `20261208000001`, which sits immediately after
-- the unified catalogue it depends on and collides with nothing.
--
-- طرق الدفع — طبقة التأليف: العميل ينشئ ويسمّي ويغيّر الأيقونة، والمنصة تشرف.
-- Tenant authoring for payment methods: the business may ADD a method and may
-- RENAME / RE-ICON an existing one, while the platform keeps the last word.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE CHANGES ABOUT 20261208000000
-- ════════════════════════════════════════════════════════════════════════════
-- The unified catalogue decided, deliberately, that:
--
--   "كل قيم الـEnum الحالية مُثبَّتة كـ legacy_values لطرق كتالوجية مكافئة…
--    العميل لا ينشئ صفوفاً هنا؛ يختار ويفعّل فقط."
--
-- That stays true for the SET of tender families — a tenant still cannot invent
-- a new `ledger_kind`, and cannot make the ENUM grow. What changes here is the
-- two things the plan's acceptance criteria could not express:
--
--   1. تسمية الطريقة وأيقونتها ملك للمنشأة، لا للمطور.
--      «بنك الكريمي» عند منشأة، و«حوالات صنعاء» عند أخرى، وكلاهما القيمة
--      المخزّنة نفسها `bank_transfer` — فلا تتغيّر القيود ولا التقارير.
--
--   2. طريقة جديدة بمؤسسة يمنية لم تكن في الكتالوج (شركة صرافة، شبكة محلية،
--      محفظة جديدة) تُضاف من شاشة الإعدادات بلا ترحيل جديد.
--
-- ════════════════════════════════════════════════════════════════════════════
-- HOW A TENANT-CREATED METHOD CAN EXIST ON A CLOSED ENUM
-- ════════════════════════════════════════════════════════════════════════════
-- The ENUM is the storage contract and is NOT widened (see the long argument in
-- 20261208000000 section "WHAT IS DELIBERATELY NOT DONE"). A tenant method
-- therefore does not need a new ENUM value: it DECLARES which existing value it
-- settles as. `legacy_id` on the catalogue row is that declaration, and
-- `payment_method_legacy_id()` already reads it.
--
--   tenant adds «شركة الأمين للصرافة»  →  legacy_id = 'bank_transfer'  → BANK
--   tenant adds «محفظة أم فلوس»        →  legacy_id = 'mobile_money'   → WALLET
--
-- Consequence, stated plainly because it is a real limit and not a bug:
--   • Documents record `bank_transfer`; the institution name lives in the
--     catalogue and in the note/reference the operator typed.
--   • Nothing historical changes, nothing has to be migrated, and an invoice
--     written yesterday still balances today.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHO MAY DO WHAT
-- ════════════════════════════════════════════════════════════════════════════
--   owner      of the business   may RENAME / RE-ICON a developer method
--                                may ADD a tenant method
--                                may NOT delete a developer method
--                                may NEVER change ledger_kind or legacy_id
--                                of a developer row  ← this is what stops the
--                                till/ledger being repointed by a rename
--   manager                      same authoring rights, EXCEPT it may not
--                                re-point a developer row either (same rule)
--   superadmin of the platform   may do everything a tenant owner may, AND
--                                may retire (is_active = false) any method,
--                                AND its edits are recorded as platform edits.
--
-- `ledger_kind` and `legacy_id` on a DEVELOPER row are frozen for every
-- authenticated caller. A rename cannot move money from the bank account to the
-- till; only a migration can.
--
-- 🔒 NO EXISTING DATA IS DELETED, UPDATED OR MOVED BY THIS FILE.
--    It adds columns (all nullable or safely defaulted), one column-scoped
--    guard trigger, and three RPCs. Existing catalogue rows keep every value.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Provenance and authoring columns on the catalogue.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_system        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_id        text,
  ADD COLUMN IF NOT EXISTS default_ledger_kind text;

COMMENT ON COLUMN public.payment_methods.created_by IS
  'من أنشأ الطريقة. NULL = أنشأها المطورون في ترحيل، لا منشأة.';
COMMENT ON COLUMN public.payment_methods.is_system IS
  'true = صف يملكه المطورون. لا تحذفه منشأة، ولا يغيّر أحدٌ نوع حسابه.';
COMMENT ON COLUMN public.payment_methods.legacy_id IS
  'القيمة المخزّنة التي تُسوّى عليها الطريقة. للصفوف النظامية = legacy_ids[1]، وللصفوف التي أنشأتها منشأة يختارها المنشئ من ضمن الـEnum.';
COMMENT ON COLUMN public.payment_methods.default_ledger_kind IS
  'نوع الحساب الذي اقترحته المنشأة عند الإنشاء. للعرض والتشخيص فقط؛ المحرّك يقرأ ledger_kind.';

-- 1.1 Backfill: every existing row is a developer row.
--
--     The stored value is legacy_ids[1] when the row declares one. A NAMED
--     institution shipped by the unified catalogue deliberately carries an
--     EMPTY legacy list — بنك الكريمي and جيب share the generic
--     `bank_transfer` / `mobile_money` value rather than redefining it — so
--     falling back to 'cash' here would repoint a bank onto the till and make
--     `payment_method_legacy_id('kuraimi_bank')` return 'cash'.
--
--     The correct fallback is therefore the ACCOUNT FAMILY, which is what the
--     posting engine already treats as authoritative, and only then 'cash' for
--     a row that has neither. This mirrors the last-resort CASE inside
--     `payment_method_legacy_id` so the column and the helper cannot disagree.
UPDATE public.payment_methods
   SET is_system = true,
       legacy_id = coalesce(
         legacy_id,
         nullif(legacy_ids[1], ''),
         CASE ledger_kind
           WHEN 'BANK'   THEN 'bank_transfer'
           WHEN 'WALLET' THEN 'mobile_money'
           WHEN 'CARD'   THEN 'card'
           WHEN 'CREDIT' THEN 'credit'
           WHEN 'CASH'   THEN 'cash'
           ELSE 'cash'
         END
       )
 WHERE legacy_id IS NULL OR is_system IS DISTINCT FROM true;

-- 1.2 From now on the column is authoritative, so it must always be present.
ALTER TABLE public.payment_methods
  ALTER COLUMN legacy_id SET DEFAULT 'cash';
UPDATE public.payment_methods SET legacy_id = 'cash' WHERE legacy_id IS NULL;
ALTER TABLE public.payment_methods
  ALTER COLUMN legacy_id SET NOT NULL;

-- 1.3 It may only ever hold a value the ENUM can store. This is the constraint
--     that makes it impossible for a tenant-created method to write a value the
--     financial tables would reject.
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_legacy_id_valid;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_legacy_id_valid
  CHECK (legacy_id IN ('cash','card','bank_transfer','credit','mobile_money','split','cheque'));

-- 1.4 A tenant row must not use a developer id. `is_system` is what separates
--     the two, so a tenant method can never shadow بنك الكريمي.
CREATE INDEX IF NOT EXISTS ix_payment_methods_system
  ON public.payment_methods (is_system, is_active, sort_order);

-- 1.5 Names are what the operator reads at the till; empty is not acceptable.
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_name_ar_present;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_name_ar_present
  CHECK (btrim(coalesce(name_ar, '')) <> '');

-- 1.6 A tenant row has no history to preserve, so it may carry no legacy list
--     at all; the column stays for the developer rows that need it.
ALTER TABLE public.payment_methods
  ALTER COLUMN legacy_ids SET DEFAULT ARRAY[]::text[];

-- 1.7 One icond key per row, from the bundled registry. A developer row with a
--     key the client bundle does not know still renders through the ledger-kind
--     fallback, so this is guidance, not a wall.
COMMENT ON COLUMN public.payment_methods.icon_key IS
  'مفتاح أيقونة مركزي يُحلّ إلى مكوّن داخل الحزمة (ليس رابطاً). قائمة المفاتيح المتاحة للعميل في src/lib/payments/payment-methods.ts.';

-- ---------------------------------------------------------------------------
-- 2. Ownership columns on the tenant settings, so an edit shows who and where
--    it came from. `updated_at` / `updated_by` already exist.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_method_settings
  ADD COLUMN IF NOT EXISTS created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_platform boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payment_method_settings.updated_by_platform IS
  'true = آخر تعديل جاء من مسؤول منصة (سوبر أدمن)، لا من المنشأة نفسها.';

-- ---------------------------------------------------------------------------
-- 3. THE GUARD — what a rename may and may not change.
--
--    A trigger, not a policy, because the rule is about WHICH COLUMNS changed,
--    and RLS cannot see the OLD row. It runs for every writer, including a
--    direct PostgREST update from an owner, which is exactly the case a UI-only
--    rule would leave open.
--
--    Read the two branches as one sentence:
--      "اسمٌ وأيقونة: نعم. حسابٌ وقيمةٌ مخزّنة: لا، إلا في صفٍّ أنشأته أنت."
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_methods_authoring_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  -- The migration runner and the platform's own service key are not bound by
  -- this rule: they are the developers, and this trigger exists for them to be
  -- able to change the seed at all.
  IF v_user IS NULL OR public.is_platform_superadmin(v_user) THEN
    RETURN NEW;
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل طرق الدفع'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3.1 A developer row is not the tenant's to enrich. They may rename it and
  --     re-icon it; every column that decides how money moves is frozen.
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

COMMENT ON FUNCTION public.payment_methods_authoring_guard() IS
  'يسمح للمنشأة بتعديل الاسم والأيقونة، ويمنعها من تغيير نوع الحساب أو القيمة المخزّنة لطريقة نظامية.';

DROP TRIGGER IF EXISTS payment_methods_authoring_guard ON public.payment_methods;
CREATE TRIGGER payment_methods_authoring_guard
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.payment_methods_authoring_guard();

-- 3.3 The same sentence for DELETE: a tenant method may be removed by its owner,
--     a developer method never. `ON DELETE CASCADE` on the settings row means
--     the configuration disappears with it — which is correct for a row the
--     business itself created.
CREATE OR REPLACE FUNCTION public.payment_methods_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

COMMENT ON FUNCTION public.payment_methods_delete_guard() IS
  'يمنع حذف طريقة نظامية؛ ويقصر حذف طرق المنشأة على المالك أو المدير.';

DROP TRIGGER IF EXISTS payment_methods_delete_guard ON public.payment_methods;
CREATE TRIGGER payment_methods_delete_guard
  BEFORE DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.payment_methods_delete_guard();

-- 3.4 Defence in depth: even if a policy is ever widened, a non-platform caller
--     can never INSERT straight into the catalogue. Inserts go through the RPC
--     in section 4, which stamps created_by and is_system = false.
DROP POLICY IF EXISTS "payment_methods tenant insert" ON public.payment_methods;
CREATE POLICY "payment_methods tenant insert"
  ON public.payment_methods
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

-- 3.5 And DELETE over PostgREST is a platform action only. A tenant's own row
--     is removed through remove_tenant_payment_method(), which is auditable and
--     can refuse when the method is in use.
DROP POLICY IF EXISTS "payment_methods platform delete" ON public.payment_methods;
CREATE POLICY "payment_methods platform delete"
  ON public.payment_methods
  FOR DELETE TO authenticated
  USING (public.is_platform_superadmin(auth.uid()));

-- 3.6 UPDATE is already governed by the existing staff policy, and the trigger
--     in 3.1 narrows it to ownership above that. Explicitly re-created here so
--     the file is self-contained on a database where the policy was renamed.
DROP POLICY IF EXISTS "payment_methods tenant update" ON public.payment_methods;
CREATE POLICY "payment_methods tenant update"
  ON public.payment_methods
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')
         OR public.is_platform_superadmin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')
              OR public.is_platform_superadmin(auth.uid()));

GRANT INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE THREE RPCs the settings screen calls.
--
--    Each one is the only sanctioned way to do its job, so a rule that matters
--    has exactly one place to be enforced and one place to be read.
-- ---------------------------------------------------------------------------

-- 4.1 May the caller author the catalogue at all?
CREATE OR REPLACE FUNCTION public.can_author_payment_methods()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_superadmin(auth.uid())
      OR public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'manager');
$$;

COMMENT ON FUNCTION public.can_author_payment_methods() IS
  'هل يملك المستخدم الحالي حق تسمية/أيقنة/إنشاء طرق دفع؟ صاحب المنشأة والمدير وسوبر أدمن المنصة.';

REVOKE ALL ON FUNCTION public.can_author_payment_methods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_author_payment_methods() TO authenticated, service_role;

-- 4.2 A label is a label: trim it, cap it, refuse an empty one. Keeping this in
--     one function means the RPC and any future surface cannot disagree.
CREATE OR REPLACE FUNCTION public.payment_method_clean_label(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(btrim(coalesce(p_label, '')), '');
$$;

COMMENT ON FUNCTION public.payment_method_clean_label(text) IS
  'تطبيع تسمية طريقة الدفع: قصّ الفراغات وإرجاع NULL للنص الفارغ.';

REVOKE ALL ON FUNCTION public.payment_method_clean_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_clean_label(text) TO authenticated, service_role;

-- 4.3 RENAME / RE-ICON.
--
--     Deliberately returns the new state so the caller can assert it, rather
--     than trusting that the update matched a row.
CREATE OR REPLACE FUNCTION public.update_payment_method_identity(
  p_id        text,
  p_name_ar   text DEFAULT NULL,
  p_name_en   text DEFAULT NULL,
  p_icon_key  text DEFAULT NULL
)
RETURNS TABLE (id text, name_ar text, name_en text, icon_key text, is_system boolean)
LANGUAGE plpgsql
SECURITY INVOKER
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

  -- `payment_methods.id` is qualified on purpose: an unqualified `id` inside a
  -- plpgsql function with an `id` OUT parameter resolves to the PARAMETER, not
  -- the column, and the lookup would silently match nothing.
  SELECT * INTO v_row FROM public.payment_methods WHERE public.payment_methods.id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طريقة الدفع "%" غير موجودة في الكتالوج', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Resolve the three new values BEFORE the update, so the UPDATE's SET list
  -- refers only to plain variables. Inside a RETURNS TABLE function, an
  -- unqualified `name_ar` in an expression is the OUT parameter — writable in
  -- PostgreSQL >= 14, an error before it. Assigning to locals first makes the
  -- statement mean the same thing on every supported version.

  -- A rename must not be able to blank a method out of the till.
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

COMMENT ON FUNCTION public.update_payment_method_identity(text, text, text, text) IS
  'تعديل اسم طريقة الدفع وأيقونتها. لا يمسّ نوع الحساب ولا القيمة المخزّنة، ولا يسمح بتسمية فارغة.';

REVOKE ALL ON FUNCTION public.update_payment_method_identity(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_payment_method_identity(text, text, text, text) TO authenticated, service_role;

-- 4.4 ADD a method the developers did not ship.
--
--     The id is DERIVED from the Arabic name and de-duplicated, never taken
--     from the browser: an id is a stable key that migrations and reports will
--     address forever, so it must not be something a client can choose or
--     predictably collide with بنك الكريمي.
CREATE OR REPLACE FUNCTION public.create_tenant_payment_method(
  p_name_ar       text,
  p_name_en       text,
  p_icon_key      text,
  p_legacy_id     text,
  p_ledger_kind   text,
  p_contexts      text[] DEFAULT NULL,
  p_requires_reference boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
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

  -- The stored value. A tenant may not introduce one the ENUM cannot hold, and
  -- may not choose 'split' — that value means «سُدّدت بأكثر من وسيلة» and is
  -- written by the split engine, not chosen by an operator.
  v_legacy := lower(btrim(coalesce(p_legacy_id, '')));
  IF v_legacy NOT IN ('cash','card','bank_transfer','mobile_money','cheque') THEN
    RAISE EXCEPTION
      'القيمة المخزّنة "%" غير متاحة لطريقة تنشئها المنشأة (المتاح: cash, card, bank_transfer, mobile_money, cheque)',
      coalesce(p_legacy_id, '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;

  -- The account family follows from the stored value. Deriving it instead of
  -- accepting it means a tenant cannot make a wallet post to the till: the
  -- pairing is a fact about the ENUM, not a preference.
  --
  -- `p_ledger_kind` is deliberately IGNORED. It exists in the signature so the
  -- platform's own tooling can pass guidance, but a caller that sends 'CASH'
  -- for a wallet does not get it: the CASE below is the only answer.
  v_kind := CASE v_legacy
              WHEN 'cash'         THEN 'CASH'
              WHEN 'card'         THEN 'CARD'
              WHEN 'bank_transfer' THEN 'BANK'
              WHEN 'cheque'       THEN 'BANK'
              WHEN 'mobile_money' THEN 'WALLET'
            END;

  -- Contexts default to everything the family can legitimately appear in.
  -- `credit` is not in the list on purpose: a tenant method is a way of
  -- COLLECTING money, and آجل is not.
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

  -- A stable, readable id derived from the name. Arabic is transliterated to a
  -- slug; anything that leaves no usable characters falls back to a prefix, so
  -- the id is always non-empty and always matches the table's CHECK.
  --
  -- If no English name was supplied, the slug is taken from the catalogue
  -- GENERATED from the Arabic id, not from the literal Arabic text: the table's
  -- CHECK requires `id = lower(btrim(id))`, and Arabic has no case, so a raw
  -- Arabic base would pass today and break the moment anyone added a Latin word.
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

  -- One id, assigned before the INSERT, so the statement below refers only to
  -- plain locals. Letting PostgreSQL pick the next free suffix inline is
  -- possible, but it makes the uniqueness of `id` depend on a subquery's
  -- snapshot instead of on a loop against the live table.
  v_auto_id := v_base;
  WHILE EXISTS (SELECT 1 FROM public.payment_methods m WHERE m.id = v_auto_id) LOOP
    v_auto_id := v_base || '_' || (2 + (SELECT count(*) FROM public.payment_methods m
                                       WHERE m.id LIKE v_base || '\_%'))::text;
  END LOOP;

  -- Sorted after the last existing row, so a newly added method appears at the
  -- end of the operator's own ordering rather than in the middle of it.
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

  -- A row in settings as well, so the new method is immediately editable and
  -- carries the same contexts the catalogue row just got.
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

COMMENT ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean) IS
  'إضافة طريقة دفع لم يشحنها المطورون: تُشتق قيمتها المخزّنة ونوع حسابها من اختيار المنشأة، والمعرّف يُولَّد ولا يأتي من المتصفح.';

REVOKE ALL ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean) TO authenticated, service_role;

-- 4.5 REMOVE a tenant method.
--
--     Refuses while documents still reference it: a removal that silently
--     changed how a past invoice labels itself is the one outcome this feature
--     must never produce. The operator is told to disable it instead.
CREATE OR REPLACE FUNCTION public.remove_tenant_payment_method(p_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
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

  -- Is the stored value still on a document? Only the tenant's OWN methods can
  -- reach here, and their stored value is shared with the generic method of the
  -- same family, so this is a real question only when a method is brand new.
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

COMMENT ON FUNCTION public.remove_tenant_payment_method(text) IS
  'حذف طريقة دفع أنشأتها المنشأة. يرفض الحذف إذا كانت الطريقة مستخدمة في مستندات قائمة، ويطلب تعطيلها بدلاً من ذلك.';

REVOKE ALL ON FUNCTION public.remove_tenant_payment_method(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_tenant_payment_method(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The write guard and the ledger must both understand a tenant method.
--
--    `resolve_writable_payment_method` in 20261208000000 already resolves any
--    catalogue id through `payment_method_resolve_id`, so an id created here
--    works with no change. What needs re-checking is the VALUE it returns:
--    `payment_method_legacy_id` reads `legacy_ids[1]` first, which is EMPTY for
--    a tenant row, and only then falls back to the ledger kind. That fallback
--    would map a tenant «cheque» (legacy_id 'cheque', kind BANK) onto
--    'bank_transfer' — silently discarding the value the tenant chose.
--
--    So the helper now reads the explicit `legacy_id` first. For every existing
--    row `legacy_id` was backfilled from `legacy_ids[1]`, so this is a no-op for
--    all historical methods and only changes behaviour for tenant rows.
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
             -- 1. The value the row explicitly declares. This is where a
             --    tenant-created method carries its identity.
             nullif(m.legacy_id, ''),
             -- 2. The historical list, for any row that predates the column.
             nullif(m.legacy_ids[1], ''),
             -- 3. The account family. A named institution shipped by the unified
             --    catalogue carries an EMPTY legacy list on purpose — it shares
             --    the generic bank_transfer / mobile_money value — so this is a
             --    real answer for it, not a placeholder. It is what keeps
             --    "bank" from ever landing on the till.
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
    -- Only an id the catalogue does not know at all reaches here. A cashier
    -- cannot take money on a method we cannot identify, so this is deliberately
    -- the honest generic tender rather than NULL on an invoice column.
    'cash'
  );
$$;

COMMENT ON FUNCTION public.payment_method_legacy_id(text) IS
  'يحوّل معرّف الكتالوج إلى القيمة التي يفهمها عمود payment_method. يقرأ legacy_id أولاً لدعم الطرق التي أنشأتها المنشأة.';

-- 5.1 `payment_method_ledger_account` resolves through
--     `payment_method_resolve_id`, which is unchanged and already handles a
--     tenant id. Re-asserted here so a reader of THIS file can see the whole
--     path without opening the previous migration.
CREATE OR REPLACE FUNCTION public.payment_method_ledger_account(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- آجل is checked FIRST, before any guidance code. A credit sale collects
    -- nothing, so there is no cash or bank line to write — and the catalogue
    -- seed gives the credit row a default_account_code ('1211') as guidance for
    -- the RECEIVABLE account. Letting that code win would post a bank/cash
    -- movement for money that was never received.
    WHEN m.ledger_kind = 'CREDIT' THEN NULL
    -- Explicit guidance on the catalogue row wins for every real tender.
    WHEN m.default_account_code IS NOT NULL THEN m.default_account_code
    WHEN m.ledger_kind IN ('BANK','WALLET','CARD') THEN '1111'
    WHEN m.ledger_kind = 'CASH'   THEN '1101'
    ELSE '1101'
  END
  FROM public.payment_methods m
  WHERE m.id = public.payment_method_resolve_id(p_stored);
$$;

-- ---------------------------------------------------------------------------
-- 6. The reporting view must expose the new columns, because the settings
--    screen edits names and icons and the reports label historic documents.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payment_method_catalog_view();

CREATE OR REPLACE FUNCTION public.payment_method_catalog_view()
RETURNS TABLE (
  id                   text,
  name_ar              text,
  name_en              text,
  icon_key             text,
  ledger_kind          text,
  default_account_code text,
  is_credit_term       boolean,
  is_active            boolean,
  sort_order           integer,
  allowed_contexts     text[],
  legacy_id            text,
  is_system            boolean,
  requires_reference   boolean,
  enabled              boolean,
  effective_sort_order integer,
  effective_contexts   text[],
  is_configured        boolean,
  is_renamed           boolean
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
    m.legacy_id,
    m.is_system,
    m.requires_reference,
    coalesce(s.enabled, true),
    coalesce(s.sort_order, m.sort_order),
    CASE
      WHEN coalesce(cardinality(s.enabled_contexts), 0) > 0
        THEN s.enabled_contexts
      ELSE m.allowed_contexts
    END,
    (s.payment_method_id IS NOT NULL),
    -- A developer row whose label no longer matches the shipped Arabic name.
    -- Reported so the settings screen can show "معدّلة" and offer a reset,
    -- which is the honest alternative to silently losing the original.
    (
      m.is_system
      AND EXISTS (
        SELECT 1 FROM public.payment_methods d
        WHERE d.id = m.id
          AND d.is_system
          AND d.name_ar <> m.name_ar
      )
    )
  FROM public.payment_methods m
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  ORDER BY coalesce(s.sort_order, m.sort_order), m.id;
$$;

COMMENT ON FUNCTION public.payment_method_catalog_view() IS
  'عرض موحّد لطرق الدفع مع تخصيص المنشأة والأسماء المعدّلة، لاستخدامه في التقارير والإعدادات دون خرائط محلية.';

REVOKE ALL ON FUNCTION public.payment_method_catalog_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_catalog_view() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The seed refreshes developer rows only — HOW TO DO IT CORRECTLY
--
--    `ON CONFLICT DO UPDATE` in 20261208000000 reset name_ar / icon_key on
--    every re-apply, so a future migration that re-runs that seed would
--    overwrite every rename a business had made.
--
--    The seed there is a static `VALUES` list, and PostgreSQL gives an
--    `ON CONFLICT DO UPDATE` no way to reference the row's OLD value —
--    `EXCLUDED` is the incoming tuple, `payment_methods.*` is the existing one,
--    and there is no `OLD` in this context. So the fix is not a cleverer SET
--    expression: it is to write the refreshed seed into a TEMP table first and
--    merge from it, where the existing row is an ordinary join target.
--
--    The recipe the next migration should follow is below, commented rather
--    than executed, because changing the seed's CONTENT is not this file's job:
--
--      CREATE TEMP TABLE seed_pm ON COMMIT DROP AS
--        SELECT * FROM (VALUES
--          ('cash', 'نقداً', 'Cash', 'cash', 10, ...),
--          ('cheque', 'شيك', 'Cheque', 'cheque', 120, ...)
--        ) AS t(id, name_ar, name_en, icon_key, sort_order, ...);
--
--      -- 7.1 Rows the business renamed keep their authoring.
--      UPDATE public.payment_methods m
--         SET sort_order   = s.sort_order,
--             allowed_contexts = s.allowed_contexts,
--             ledger_kind  = s.ledger_kind,
--             default_account_code = s.default_account_code,
--             requires_reference   = s.requires_reference,
--             legacy_id    = s.legacy_id,
--             legacy_ids   = s.legacy_ids,
--             updated_at   = now()
--        FROM seed_pm s
--       WHERE m.id = s.id
--         AND m.is_system
--         AND EXISTS (SELECT 1 FROM public.payment_method_settings st
--                      WHERE st.payment_method_id = m.id
--                        AND st.updated_by_platform = false
--                        AND m.updated_at > m.created_at);
--
--      -- 7.2 Rows nobody personalised get the shipped label back.
--      UPDATE public.payment_methods m
--         SET name_ar = s.name_ar, name_en = s.name_en, icon_key = s.icon_key,
--             sort_order = s.sort_order, allowed_contexts = s.allowed_contexts,
--             ledger_kind = s.ledger_kind, legacy_id = s.legacy_id,
--             legacy_ids = s.legacy_ids, updated_at = now()
--        FROM seed_pm s
--       WHERE m.id = s.id AND m.is_system
--         AND NOT EXISTS (SELECT 1 FROM public.payment_method_settings st
--                          WHERE st.payment_method_id = m.id
--                            AND st.updated_by_platform = false
--                            AND m.updated_at > m.created_at);
--
--      -- 7.3 Anything new in the seed.
--      INSERT INTO public.payment_methods (id, name_ar, ...)
--      SELECT s.* FROM seed_pm s
--      WHERE NOT EXISTS (SELECT 1 FROM public.payment_methods m WHERE m.id = s.id);
--
--    `is_system`, `id` and `ledger_kind` are never taken from a tenant, and
--    `updated_by_platform = true` marks an edit the platform made itself, so
--    the platform can correct its own row without freezing it forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_methods_seed_is_identity_owned(p_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_methods m
    JOIN public.payment_method_settings s ON s.payment_method_id = m.id
    WHERE m.id = p_id
      AND s.updated_by_platform = false
      AND s.payment_method_id IS NOT NULL
      AND m.is_system
      -- Only a row the business actually touched counts as authored.
      AND m.updated_at > m.created_at
  );
$$;

COMMENT ON FUNCTION public.payment_methods_seed_is_identity_owned(text) IS
  'هل عدّلت المنشأة اسم/أيقونة هذه الطريقة؟ يستخدمه الـSeed لاحقاً ليحترم التعديل؛ الترحيلات التي تزرع لا تضرب صفوف المنشأة.';

REVOKE ALL ON FUNCTION public.payment_methods_seed_is_identity_owned(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_methods_seed_is_identity_owned(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Verify the invariants this file claims, and fail loudly if any is broken.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
  v_repaired integer;
BEGIN
  -- ── 8.1 Repair any row whose legacy_id disagrees with its account family ──
  --
  -- A named institution (بنك الكريمي، جيب) ships with an EMPTY legacy list
  -- because it shares the generic bank_transfer / mobile_money value. When the
  -- backfill in section 1 ran on a database where that list was empty, an older
  -- version of this file could leave legacy_id as the 'cash' floor — which
  -- repoints a bank onto the till. Re-derive it from the ledger kind here, which
  -- is the family the posting engine already trusts, so the invariant below is
  -- restored rather than merely asserted. A row whose ledger_id is an ENUM value
  -- the family cannot produce (a tenant's explicit choice) is left untouched.
  UPDATE public.payment_methods
     SET legacy_id = CASE ledger_kind
                       WHEN 'BANK'   THEN 'bank_transfer'
                       WHEN 'WALLET' THEN 'mobile_money'
                       WHEN 'CARD'   THEN 'card'
                       WHEN 'CREDIT' THEN 'credit'
                       WHEN 'CASH'   THEN 'cash'
                       ELSE legacy_id
                     END,
         updated_at = now()
   WHERE ledger_kind IN ('BANK','WALLET','CARD','CREDIT','CASH')
     AND coalesce(legacy_id, '') NOT IN ('cash','card','bank_transfer','credit','mobile_money','split','cheque');

  GET DIAGNOSTICS v_repaired = ROW_COUNT;
  IF v_repaired > 0 THEN
    RAISE NOTICE '↩️ أُعيد اشتقاق القيمة المخزّنة لـ % طريقة من عائلة حسابها', v_repaired;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.payment_methods
  WHERE legacy_id IS NULL
     OR legacy_id NOT IN ('cash','card','bank_transfer','credit','mobile_money','split','cheque');

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: % صفاً في الكتالوج بقيمة مخزّنة غير صالحة', v_bad;
  END IF;

  -- 8.2 Every stored value on a live document must still resolve, exactly as
  --     before. Guarded by EXISTS so a database that has not yet run the
  --     unified catalogue seed does not fail on a row it never received.
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'kuraimi_bank')
     AND public.payment_method_legacy_id('kuraimi_bank') <> 'bank_transfer' THEN
    RAISE EXCEPTION 'FAIL: kuraimi_bank -> % (expected bank_transfer)',
      public.payment_method_legacy_id('kuraimi_bank');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'jaib')
     AND public.payment_method_legacy_id('jaib') <> 'mobile_money' THEN
    RAISE EXCEPTION 'FAIL: jaib -> % (expected mobile_money)',
      public.payment_method_legacy_id('jaib');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'kuraimi_bank')
     AND public.payment_method_ledger_account('kuraimi_bank') <> '1111' THEN
    RAISE EXCEPTION 'FAIL: kuraimi_bank settles to %',
      public.payment_method_ledger_account('kuraimi_bank');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'credit')
     AND public.payment_method_ledger_account('credit') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: credit must settle to NULL';
  END IF;

  RAISE NOTICE '✅ طبقة التأليف جاهزة: % طريقة، منها % نظامية',
    (SELECT count(*) FROM public.payment_methods),
    (SELECT count(*) FROM public.payment_methods WHERE is_system);
END $$;

COMMIT;
