-- ============================================================================
-- 44_form_fix_forward.sql
--
-- لماذا هجرة جديدة بدل تعديل 38–43؟
--
--   `supabase db push` رفض التطبيق:
--     "Found local migration files to be inserted before the last migration on
--      remote database."
--   أي أن البعيد يحمل هجرة لا توجد محليًا، وتطبيق 38–43 بترتيبها الزمني كان
--   سيُقحم تاريخًا في وسط تاريخ البعيد. والحل المطلوب في هذه الحالة هو هجرة
--   **لاحقة** تُصلح ما تحتاج إصلاحه على حالة البعيد — لا --include-all فوق
--   تاريخ متعارض.
--
-- ما يُصلحه هذا الملف (كل بند كان عطلًا فعليًا، لا تحسينًا):
--
--   P0-1  كمية المرتجع كانت تُقاس على مجموع الفاتورة للصنف كله (SUM over
--         product_id)، فلا يمكن رد جزئي لبند معين حين يتكرر الصنف، ويُخلط
--         السعر بين بنود مختلفة. الآن العمود invoice_item_id يُحدد البند،
--         فيمكن النشر التدريجي (يُقبل NULL للمرتجعات القديمة).
--
--   P0-2  مسار صرف المستهلكات كان يسجّل حركة بـ movement_type = 'adjustment'
--         ثم يعتمد على UPDATE لاحق لملء adjustment_reason؛ ولو فات ذلك
--         رفضها القيد stock_movements_adjustment_reason_required. الآن السبب
--         يُكتب في نفس الإدراج داخل post_stock_delta، وكل حركة جديدة
--         تحمل total_cost (وهو ما يقرأه تقييد COGS). لا اعتماد على مُستدعٍ
--         لتصحيح الحركة بعدها.
--
--   P0-3  apply_cost_movement يقيّم الحركة بالاكتساب/الطبقة، لكن المسار
--         كان يترك stock_movements.total_cost فارغًا. post_sales_invoice يقرأ
--         sm.total_cost لتقييد COGS، فتنزل الفاتورة بلا تكلفة والهامش يظهر
--         100٪. الآن total_cost يُكتب على الحركة في نفس المعاملة.
--
--   P1-7  platform_admin_audit() كانت SECURITY DEFINER وتمنح authenticated
--         قراءة auth.users للجميع. تُقيَّد الآن بمسؤول منصة نشط، وتُسحب من
--         authenticated، ويُضاف غلاف platform_admin_audit_self() للواجهة.
--
--   P1-8  دوال الحُرّاس والمحروّكات الداخلية بلا EXECUTE لـ authenticated.
--
-- ثابت: idempotent، لا بيانات، ولا حذف. كل كائن يعتمد على كائن قد لا يكون
-- موجودًا على البعيد (أصلًا من 38–43) يُنفَّذ داخل IF to_regprocedure.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- P0-3 — القيمة الفعلية على حركة المخزون (مصدر قيود COGS)
-- ════════════════════════════════════════════════════════════════════════════
-- apply_cost_movement يحسب out_cost داخليًا ثم لا يصدّره. أفضل ما يمكن فعله
-- داخل post_stock_delta دون نسخة ثانية من محرّك التقييم هو قياس الطبقة نفسها
-- بفرق (before − after): الحساب مركزي في apply_cost_movement، والقراءة هنا
-- للتحقق لا للتقييم.
CREATE OR REPLACE FUNCTION public.post_stock_delta(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_signed_qty numeric,
  p_unit_cost numeric DEFAULT NULL::numeric,
  p_movement_kind public.stock_movement_kind DEFAULT 'ADJUSTMENT'::public.stock_movement_kind,
  p_source_type text DEFAULT NULL::text,
  p_source_id uuid DEFAULT NULL::uuid,
  p_note text DEFAULT NULL::text,
  p_owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_movement_type_legacy public.movement_type DEFAULT NULL::public.movement_type
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_mt      public.movement_type;
  v_policy  public.inventory_policy;
  v_nature  public.item_nature;
  v_before  numeric;
  v_after   numeric;
  v_val0    numeric;
  v_val1    numeric;
  v_value   numeric;
  v_movement_id uuid;
BEGIN
  IF v_user IS NOT NULL AND NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RETURN;
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and warehouse are required for a stock movement';
  END IF;

  v_mt := coalesce(
    p_movement_type_legacy,
    CASE p_movement_kind
      WHEN 'RECEIPT'      THEN 'purchase'::public.movement_type
      WHEN 'ISSUE'        THEN 'sale'::public.movement_type
      WHEN 'TRANSFER_IN'  THEN 'transfer_in'::public.movement_type
      WHEN 'TRANSFER_OUT' THEN 'transfer_out'::public.movement_type
      ELSE 'adjustment'::public.movement_type
    END
  );

  SELECT p.item_nature, public.item_effective_policy(p.id)
    INTO v_nature, v_policy
  FROM public.products p WHERE p.id = p_product_id;

  IF v_nature = 'SERVICE' OR v_policy <> 'TRACKED' THEN
    RAISE EXCEPTION
      'Item % does not hold company stock (nature %, policy %)',
      p_product_id, coalesce(v_nature::text, '?'), coalesce(v_policy::text, '?');
  END IF;

  SELECT i.quantity INTO v_before
  FROM public.inventory i
  WHERE i.product_id = p_product_id
    AND i.warehouse_id = p_warehouse_id
    AND i.owner_type = p_owner_type
    AND i.owner_id IS NOT DISTINCT FROM p_owner_id
  FOR UPDATE;

  v_before := coalesce(v_before, 0);
  v_after  := round(v_before + p_signed_qty, 3);

  IF v_after < 0 AND p_owner_type = 'COMPANY' THEN
    RAISE EXCEPTION
      'Insufficient stock for item % in warehouse %: available %, requested %',
      p_product_id, p_warehouse_id, v_before, abs(p_signed_qty)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.inventory
    (product_id, warehouse_id, owner_type, owner_id, quantity)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_after)
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  -- قيمة الطبقة قبل الحركة (للقراءة فقط؛ القيمة التي ستُكتب تأتي من المحرّك)
  SELECT cl.total_value INTO v_val0
  FROM public.item_cost_layers cl
  WHERE cl.product_id = p_product_id
    AND cl.warehouse_id = p_warehouse_id
    AND cl.owner_type = p_owner_type
    AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;

  v_val0 := coalesce(v_val0, 0);

  PERFORM set_config('app.stock_engine', 'on', true);

  INSERT INTO public.stock_movements
    (product_id, warehouse_id, movement_type, quantity, unit_cost, reference,
     note, created_by, movement_kind, source_type, source_id, owner_type, owner_id,
     adjustment_reason)
  VALUES
    (p_product_id, p_warehouse_id, v_mt, p_signed_qty, p_unit_cost,
     coalesce(p_source_type, '') || coalesce(':' || p_source_id::text, ''),
     p_note, v_user, p_movement_kind, p_source_type, p_source_id, p_owner_type,
     p_owner_id,
     CASE WHEN v_mt = 'adjustment'::public.movement_type
          THEN coalesce(nullif(btrim(p_note), ''), nullif(btrim(p_source_type), ''), 'Stock adjustment')
          ELSE NULL END)
  RETURNING id INTO v_movement_id;

  -- التقييم في نفس المعاملة — الكمية والقيمة لا تنفصلان.
  PERFORM public.apply_cost_movement(
    p_product_id => p_product_id,
    p_warehouse_id => p_warehouse_id,
    p_signed_qty => p_signed_qty,
    p_incoming_cost => p_unit_cost,
    p_source_type => p_source_type,
    p_source_id => p_source_id,
    p_note => p_note,
    p_owner_type => p_owner_type,
    p_owner_id => p_owner_id);

  -- P0-3: القيمة الفعلية للحركة تُكتب على الصف نفسه. الوارد يأخذ تكلفته
  -- الممرَّرة؛ الصادر يأخذ ما نقصت به الطبقة فعلاً (لا سعر الكرت).
  SELECT cl.total_value INTO v_val1
  FROM public.item_cost_layers cl
  WHERE cl.product_id = p_product_id
    AND cl.warehouse_id = p_warehouse_id
    AND cl.owner_type = p_owner_type
    AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;

  v_val1 := coalesce(v_val1, 0);

  IF p_signed_qty > 0 AND p_unit_cost IS NOT NULL THEN
    v_value := round(p_signed_qty * p_unit_cost, 2);
  ELSE
    v_value := round(greatest(v_val0 - v_val1, 0), 2);
  END IF;

  -- الصف بالمعرّف الذي أعاده الإدراج نفسه — لا بحث «آخر حركة» ولا نافذة زمنية.
  UPDATE public.stock_movements
     SET total_cost = v_value,
         unit_cost  = CASE
                        WHEN p_signed_qty <> 0 AND v_value IS NOT NULL
                        THEN round(v_value / abs(p_signed_qty), 4)
                        ELSE unit_cost END
   WHERE id = v_movement_id;

  PERFORM set_config('app.stock_engine', 'off', true);
END $function$;

COMMENT ON FUNCTION public.post_stock_delta(uuid, uuid, numeric, numeric, public.stock_movement_kind, text, uuid, text, public.owner_type, uuid, public.movement_type) IS
  'P0-3: المسار الوحيد لحركة المخزون — الكمية والقيمة في معاملة واحدة، وtotal_cost مكتوب على الحركة.';

-- ════════════════════════════════════════════════════════════════════════════
-- P0-2 — المستهلكات: السبب في نفس الإدراج
-- ════════════════════════════════════════════════════════════════════════════
-- صادر المستهلكات يُسجَّل كـ movement_type = 'adjustment'، والقيد على الجدول
-- stock_movements_adjustment_reason_required يرفضه بلا سبب. post_stock_delta
-- أعلاه يكتب السبب من الملاحظة داخل نفس INSERT، فلا يعتمد المسار على UPDATE
-- لاحق يقوم به المُستدعي (وقد لا يقوم). لا شيء يُضاف هنا؛ الإصلاح داخل الدالة.

-- ════════════════════════════════════════════════════════════════════════════
-- P0-1 — مرتجع المبيعات: مطابقة البند + قيمة المرتجع الفعلية
-- ════════════════════════════════════════════════════════════════════════════
-- sales_return_items تحتفظ بـ product_id فقط. نضيف invoice_item_id ليكون
-- المرتجع الجزئي لبندٍ بعينه محددًا، ونتركه NULL للمرتجع القديم (التوافق).
ALTER TABLE public.sales_return_items
  ADD COLUMN IF NOT EXISTS invoice_item_id uuid;

COMMENT ON COLUMN public.sales_return_items.invoice_item_id IS
  'P0-1: بند الفاتورة الأصلية الذي يُرجع منه. NULL يعني «أي بند لنفس الصنف» (توافق مع المرتجعات القديمة).';

CREATE INDEX IF NOT EXISTS idx_sales_return_items_invoice_item
  ON public.sales_return_items (invoice_item_id)
  WHERE invoice_item_id IS NOT NULL;

-- ⚠️ لا يُضاف مفتاح أجنبي هنا: المفاتيح كلها في 13 (القرار 1 في README)،
-- وإضافتها في هجرة لاحقة تُخفيها عن خريطة المفاتيح. العمود والفهرس يكفيان
-- للربط، والتحقق من وجود البند يتم داخل create_sales_return قبل الإدراج.

-- فهرس الربط: كل نداء يُقيّم حركة يقرأ حركاتها بمصدرها (COGS، عكس المرتجع،
-- تقرير التصنيع). بلا هذا الفهرس يفك كل استعلام مسحًا كاملًا للجدول.
CREATE INDEX IF NOT EXISTS idx_stock_movements_source
  ON public.stock_movements (source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- P1-7 — platform_admin_audit: بيانات auth.users ليست لكل موظف
-- ════════════════════════════════════════════════════════════════════════════
-- الدالة تقرأ auth.users و auth.identities وهي SECURITY DEFINER، فيكفيها
-- EXECUTE من authenticated لتُعرض لموظف عادي. التعريف التالي يرفض غير مسؤول
-- المنصة، ويُعاد تعريف تعريفها الحالي كغلاف إن وُجد بلا هذا الفحص.
--
-- (الاسم والتوقيع كما هما، فلا يتغير أي مستدعٍ.)
DO $$
BEGIN
  IF to_regprocedure('public.platform_admin_audit()') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.platform_admin_audit()
      RETURNS TABLE (
        user_id uuid, email text, platform_role text, is_active boolean,
        has_email_id boolean, has_phone_id boolean, has_profile boolean,
        has_store_role boolean, is_superadmin boolean, problems text[]
      )
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $body$
        SELECT
          pa.user_id,
          u.email::text,
          pa.role,
          pa.is_active,
          EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'email'),
          EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'phone'),
          EXISTS (SELECT 1 FROM public.profiles p       WHERE p.id      = pa.user_id),
          EXISTS (SELECT 1 FROM public.user_roles r     WHERE r.user_id = pa.user_id),
          public.is_platform_superadmin(pa.user_id),
          array_remove(ARRAY[
            CASE WHEN u.id IS NULL                THEN 'missing auth.users'                END,
            CASE WHEN u.deleted_at IS NOT NULL     THEN 'auth user deleted'                 END,
            CASE WHEN u.email_confirmed_at IS NULL THEN 'email not confirmed'                END,
            CASE WHEN u.banned_until > now()       THEN 'auth user banned'                  END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'email')
                                                   THEN 'missing email identity'            END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'phone')
                                                   THEN 'missing phone identity'            END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pa.user_id)
                                                   THEN 'missing profile'                   END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pa.user_id AND p.is_active)
                                                   THEN 'profile inactive (is_staff = false)' END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pa.user_id)
                                                   THEN 'missing store role (RLS hides everything)' END,
            CASE WHEN pa.role = 'superadmin' AND NOT public.is_platform_superadmin(pa.user_id)
                                                   THEN 'superadmin row does not satisfy the predicate' END,
            CASE WHEN pa.role = 'support' AND public.is_platform_superadmin(pa.user_id)
                                                   THEN 'support account satisfies superadmin predicate' END
          ], NULL) AS problems
        FROM public.platform_admins pa
        LEFT JOIN auth.users u ON u.id = pa.user_id
        -- P1-7: صلاحية القراءة داخل الدالة، لا بالاعتماد على منحة EXECUTE.
        WHERE public.is_platform_admin(auth.uid())
        ORDER BY pa.role DESC, u.email
      $body$;
    $fn$;
  END IF;
END $$;

-- وسحب التنفيذ العام: يبقى لـ service_role (CI / CLI) ولمسؤول المنصة عبر
-- الدالة نفسها، بلا منح authenticated أعمى.
DO $$
BEGIN
  IF to_regprocedure('public.platform_admin_audit()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.platform_admin_audit() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.platform_admin_audit() TO service_role;
    -- المسؤول يحتاجها من الواجهة: يحصل عليها عبر غلاف يتحقق أولاً.
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.platform_admin_audit_self()
      RETURNS TABLE (
        user_id uuid, email text, platform_role text, is_active boolean,
        has_email_id boolean, has_phone_id boolean, has_profile boolean,
        has_store_role boolean, is_superadmin boolean, problems text[]
      )
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $body$
        SELECT * FROM public.platform_admin_audit()
        WHERE public.is_platform_admin(auth.uid())
      $body$;
    $fn$;
    REVOKE ALL ON FUNCTION public.platform_admin_audit_self() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.platform_admin_audit_self() TO authenticated, service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.platform_admin_audit() IS
  'تقرير اكتمال حسابات المنصة — service_role فقط (يقرأ auth.users). للواجهة استخدم platform_admin_audit_self().';

-- ════════════════════════════════════════════════════════════════════════════
-- P1-8 (تكملة) — المحرّكات الداخلية الجديدة لا تُمنح
-- ════════════════════════════════════════════════════════════════════════════
-- 43 عكس القاعدة إلى قائمة سماح. أي دالة أُنشئت بعده أو عُرّفت هنا تحتاج
-- إسقاط المنح احتياطًا (الدوال المساعدة الداخلية فقط، لا RPC الواجهة).
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN ('tg_customers_system_guard', 'tg_suppliers_system_guard',
                        'tg_stock_movements_engine_only', 'tg_customer_ledger_system_guard',
                        'apply_cost_movement', 'balance_and_post_return')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn.sig);
  END LOOP;
END $$;

-- طبيعتان متعمدتان في هذا الملف:
--   • NO_DATA على الصفوف القائمة: قاعدة حيّة قد تحمل صفوفًا موضوعها قديم قبل
--     هذا الإصلاح؛ قصر الملف على البنية الجديدة يمنع توقف النشر. النشر الصحيح
--     لا يترك تسويات بلا سبب ولا حركات بلا قيمة، والاستعلامات أعلاه للتحقق.
--   • من الناحية البنيوية كل ما يمكن التعريف هنا يُعرَّف، وكل ما يعتمد على
--     كائن قد لا يكون موجودًا على البعيد (POSTGRES_FUNCTIONS الأخرى في 43/46)
--     يُنفّذ داخل IF to_regprocedure/IF NOT EXISTS، فلا تتوقف السلسلة.

-- قيد إثبات مكاني: لا يمس أي صف، ويتحقق أن post_stock_delta السارية تحمل
-- إصلاح P0-3 (نص total_cost في تعريفها)، فلا يُطبع «تم» على نسخة قديمة.
DO $$
BEGIN
  IF to_regprocedure('public.post_stock_delta(uuid,uuid,numeric,numeric,public.stock_movement_kind,text,uuid,text,public.owner_type,uuid,public.movement_type)') IS NULL THEN
    RAISE EXCEPTION 'post_stock_delta غير موجود بهذا التوقيع بعد 44';
  END IF;

  IF position('total_cost' IN pg_get_functiondef(
       'public.post_stock_delta(uuid,uuid,numeric,numeric,public.stock_movement_kind,text,uuid,text,public.owner_type,uuid,public.movement_type)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'post_stock_delta ما زال لا يكتب total_cost — 44 لم تُطبَّق فعليًا';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- التحقق بعد التطبيق (كلها يجب أن ترجع صفرًا على قاعدة سليمة):
--
--   1) حركة قيمة بلا total_cost:
--      SELECT count(*) FROM public.stock_movements
--       WHERE movement_kind IN ('ISSUE','RECEIPT','PRODUCTION') AND total_cost IS NULL;
--
--   2) تسوية بلا سبب:
--      SELECT count(*) FROM public.stock_movements
--       WHERE movement_type = 'adjustment' AND coalesce(btrim(adjustment_reason),'') = '';
--
--   3) coworker calling platform_admin_audit() → يجب أن يُرفض بلا صلاحية،
--      و platform_admin_audit_self() يعيد صفرًا لغير مسؤول المنصة.
--
-- ROLLBACK: هذا الملف يعيد تعريف دوال ويزيد عمودًا. الإرجاع اليدوي:
--   ALTER TABLE public.sales_return_items DROP COLUMN IF EXISTS invoice_item_id;
--   DROP INDEX IF EXISTS public.idx_stock_movements_source;
--   وإعادة تعريف post_stock_delta من 43. لا تُرجِع على قاعدة إنتاج حيّة.
-- ============================================================================
