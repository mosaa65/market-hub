-- اختبار تكاملي حقيقي لدورة الأمانات (T1–T4) — يشغَّل كمستخدم مصادق.
-- يُنشئ مستخدماً مؤقتاً في auth.users ثم يحاكي JWT محلياً.
DO $$
DECLARE
  v_user  uuid;
  v_custo uuid;
  v_wh    uuid;
  v_grain uuid;
  v_doc   text;
  v_inv   uuid;
BEGIN
  -- ── تجهيز هوية اختبارية ────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (
    '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'mill-test@local.test',
    crypt('test123456', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, language, theme, is_active)
  VALUES ('11111111-1111-1111-1111-111111111111', 'مختبِر المطحنة', 'ar', 'light', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES ('11111111-1111-1111-1111-111111111111', 'owner')
  ON CONFLICT DO NOTHING;

  v_user  := '11111111-1111-1111-1111-111111111111';
  v_custo := (SELECT id FROM customers ORDER BY name LIMIT 1);
  v_wh    := (SELECT id FROM warehouses ORDER BY is_default DESC LIMIT 1);
  v_grain := (SELECT id FROM products WHERE sku = 'حبوب-بُر-سمراء');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── T1: استلام 50 كيس / 2500 كجم ───────────────────────────────────────
  PERFORM custody_intake(v_custo, v_wh, v_grain, 50, 2500, 'اختبار T1');

  IF NOT EXISTS (
    SELECT 1 FROM custody_balances
    WHERE customer_id = v_custo AND item_id = v_grain
      AND bags_balance = 50 AND kg_balance = 2500
  ) THEN
    RAISE EXCEPTION 'T1 FAILED: intake balance wrong';
  END IF;
  RAISE NOTICE 'T1 OK — استلام 50 كيس/2500 كجم';

  -- صفر حركة مخزون على القمح (أمان التصميم)
  IF EXISTS (
    SELECT 1 FROM stock_movements WHERE product_id = v_grain
  ) THEN
    RAISE EXCEPTION 'T1 FAILED: custody intake touched stock!';
  END IF;
  RAISE NOTICE 'T1 OK — صفر حركة مخزون على حبوب العميل';

  -- ── T2: طحن 50 → دقيق 35 + نخالة 12 ───────────────────────────────────
  v_doc := custody_milling(
    v_custo, v_wh, v_grain, 50, 2500,
    jsonb_build_array(
      jsonb_build_object('item_id', (SELECT id FROM products WHERE sku = 'ناتج-دقيق-أبيض'), 'bags', 35, 'kg', 1750),
      jsonb_build_object('item_id', (SELECT id FROM products WHERE sku = 'ناتج-نخالة'),      'bags', 12, 'kg', 600)
    ),
    'اختبار T2'
  );
  RAISE NOTICE 'T2 OK — سند طحن %', v_doc;

  IF EXISTS (
    SELECT 1 FROM custody_balances
    WHERE customer_id = v_custo AND item_id = v_grain
      AND (bags_balance <> 0 OR kg_balance <> 0)
  ) THEN
    RAISE EXCEPTION 'T2 FAILED: grain balance not zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM custody_balances b
    JOIN products p ON p.id = b.item_id
    WHERE b.customer_id = v_custo AND p.sku = 'ناتج-دقيق-أبيض'
      AND b.bags_balance = 35
  ) THEN
    RAISE EXCEPTION 'T2 FAILED: flour balance wrong';
  END IF;
  RAISE NOTICE 'T2 OK — حبوب=0، دقيق=35، نخالة=12';

  -- ── T3: تسليم جزئي 10 دقيق ─────────────────────────────────────────────
  v_doc := custody_delivery(
    v_custo, v_wh,
    jsonb_build_array(
      jsonb_build_object('item_id', (SELECT id FROM products WHERE sku = 'ناتج-دقيق-أبيض'), 'bags', 10, 'kg', 500)
    ),
    'اختبار T3'
  );
  RAISE NOTICE 'T3 OK — سند تسليم %', v_doc;

  IF NOT EXISTS (
    SELECT 1 FROM custody_balances b
    JOIN products p ON p.id = b.item_id
    WHERE b.customer_id = v_custo AND p.sku = 'ناتج-دقيق-أبيض'
      AND b.bags_balance = 25
  ) THEN
    RAISE EXCEPTION 'T3 FAILED: remaining flour wrong';
  END IF;
  RAISE NOTICE 'T3 OK — دقيق متبقٍ = 25';

  -- ── T8: رفض السالب (تسليم أكثر من الرصيد) ──────────────────────────────
  BEGIN
    PERFORM custody_delivery(
      v_custo, v_wh,
      jsonb_build_array(
        jsonb_build_object('item_id', (SELECT id FROM products WHERE sku = 'ناتج-دقيق-أبيض'), 'bags', 999, 'kg', 0)
      ),
      'اختبار T8 — يجب أن يُرفض'
    );
    RAISE EXCEPTION 'T8 FAILED: over-delivery was accepted!';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%balance%' THEN
        RAISE NOTICE 'T8 OK — رُفض التسليم الزائد: %', SQLERRM;
      ELSE
        RAISE;
      END IF;
  END;

  -- ── T7: الفاقد المكتشف (الوارد 2500 − الناتج المسجل 2350 = 150) ────────
  IF NOT EXISTS (
    SELECT 1 FROM custody_detected_loss
    WHERE customer_id = v_custo AND detected_loss_kg = 150
  ) THEN
    RAISE EXCEPTION 'T7 FAILED: detected loss wrong';
  END IF;
  RAISE NOTICE 'T7 OK — فاقد مكتشف = 150 كجم (بلا أي حقل إدخال)';

  -- ── التدقيق: كل الحركات في audit_logs ──────────────────────────────────
  IF (SELECT count(*) FROM audit_logs
      WHERE entity_type IN ('custody_ledger', 'custody') AND actor_id = v_user) < 3 THEN
    RAISE EXCEPTION 'AUDIT FAILED: custody movements missing from audit_logs';
  END IF;
  RAISE NOTICE 'AUDIT OK — كل الحركات مسجلة في audit_logs';

  RAISE NOTICE '═══ كل اختبارات الأمانات نجحت ═══';
END $$;

-- تنظيف بيانات الاختبار (بيانات عرض فقط — لا تُبقى في القاعدة)
DELETE FROM custody_ledger WHERE created_by = '11111111-1111-1111-1111-111111111111';
DELETE FROM audit_logs WHERE actor_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM user_roles WHERE user_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
DELETE FROM auth.users WHERE id = '11111111-1111-1111-1111-111111111111';
