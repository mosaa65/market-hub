/**
 * Script v2: تنظيف وبذر البيانات بالأعمدة الصحيحة.
 * يعمل عبر Supabase client (service_role).
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kwzqvgdyadylwnvjghqn.supabase.co';
const SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false },
});

async function run() {
  console.log('🧹 بدء تنظيف وبذر البيانات...\n');

  // ── تنظيف الجداول بترتيب العلاقات ──
  const cleanupTables = [
    // Milling
    'milling_delivery_items',
    'milling_delivery_notes',
    'milling_job_outputs',     // الاسم الصحيح (ليس milling_outputs)
    'milling_jobs',
    'milling_service_agreements', // حذف العقود أولاً (FK على intake_receipts)
    'milling_intake_receipts',
    'milling_grain_grades',
    // Invoices
    'sales_invoice_items',
    'sales_invoices',
    // Purchases (FK على products)
    'purchase_invoice_items',
    'purchase_invoices',
    // Production
    'production_orders',
    // Stock
    'stock_movements',
    'inventory',
    // Products & Categories
    'products',
    'categories',
  ];

  console.log('── تنظيف الجداول ──');
  for (const table of cleanupTables) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.log(`   ⚠️  ${table}: ${error.message}`);
    } else {
      console.log(`   ✅ ${table}`);
    }
  }

  // ── بذر التصنيفات ──
  console.log('\n── بذر التصنيفات ──');
  const categoryNames = [
    'حبوب ومواد خام',
    'منتجات مطحونة',
    'خدمات طحن وتشغيل',
    'مستلزمات تعبئة وتغليف',
    'مصروفات تشغيلية',
  ];

  for (const name of categoryNames) {
    const { error } = await supabase.from('categories').insert({ name, name_ar: name });
    if (error) console.log(`   ⚠️  ${name}: ${error.message}`);
    else console.log(`   ✅ ${name}`);
  }

  // Fetch category IDs
  const { data: cats } = await supabase.from('categories').select('id, name');
  const catMap = {};
  for (const c of (cats || [])) {
    catMap[c.name] = c.id;
  }
  console.log(`   📋 تصنيفات: ${Object.keys(catMap).length}`);

  // ── بذر المنتجات ──
  console.log('\n── بذر المنتجات ──');

  // الأعمدة الصحيحة: sku, barcode, name, name_ar, description, category_id, cost_price, sale_price, min_stock, is_active
  const products = [
    // حبوب ومواد خام
    { sku: 'RM-WHEAT-HARD', name: 'قمح صلب مستورد', name_ar: 'قمح صلب مستورد (درجة أولى)', barcode: '6001000001', category_id: catMap['حبوب ومواد خام'], description: 'حبوب قمح صلب مستوردة درجة أولى للطحن', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'RM-WHEAT-LOCAL', name: 'قمح بلدي محلي', name_ar: 'قمح بلدي محلي', barcode: '6001000002', category_id: catMap['حبوب ومواد خام'], description: 'حبوب قمح بلدي محلي', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'RM-WHEAT-SOFT', name: 'قمح طري للمخبوزات', name_ar: 'قمح طري (للمخبوزات)', barcode: '6001000003', category_id: catMap['حبوب ومواد خام'], description: 'قمح طري مناسب للمخابز والمعجنات', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'RM-CORN-YELLOW', name: 'ذرة صفراء خام', name_ar: 'ذرة صفراء خام', barcode: '6001000004', category_id: catMap['حبوب ومواد خام'], description: 'حبوب ذرة صفراء خام مستوردة', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'RM-CORN-WHITE', name: 'ذرة بيضاء بلدية', name_ar: 'ذرة بيضاء بلدية', barcode: '6001000005', category_id: catMap['حبوب ومواد خام'], description: 'ذرة بيضاء بلدية محلية', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'RM-BARLEY', name: 'شعير حبوب خام', name_ar: 'شعير حبوب خام', barcode: '6001000006', category_id: catMap['حبوب ومواد خام'], description: 'حبوب شعير خام للطحن أو العلف', sale_price: 0, cost_price: 0, min_stock: 0 },

    // منتجات مطحونة
    { sku: 'FP-FLOUR-G1', name: 'دقيق ناعم نمرة 1', name_ar: 'دقيق ناعم زيرو (نمرة 1)', barcode: '6002000001', category_id: catMap['منتجات مطحونة'], description: 'دقيق أبيض ناعم درجة أولى', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'FP-FLOUR-G2', name: 'دقيق بر نمرة 2', name_ar: 'دقيق بر بلدي كامل (نمرة 2)', barcode: '6002000002', category_id: catMap['منتجات مطحونة'], description: 'دقيق بلدي كامل الحبة', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'FP-SEMOLINA', name: 'سميد فاخر', name_ar: 'سميد فاخر ناعم', barcode: '6002000003', category_id: catMap['منتجات مطحونة'], description: 'سميد فاخر ناعم من القمح الصلب', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'FP-BRAN', name: 'نخالة قمح', name_ar: 'نخالة قمح (ردة)', barcode: '6002000004', category_id: catMap['منتجات مطحونة'], description: 'نخالة قمح - ناتج ثانوي للطحن', sale_price: 0, cost_price: 0, min_stock: 0 },
    { sku: 'FP-CRACKED', name: 'جرش خشن', name_ar: 'جرش خشن (برغل)', barcode: '6002000005', category_id: catMap['منتجات مطحونة'], description: 'جرش خشن برغل', sale_price: 0, cost_price: 0, min_stock: 0 },

    // خدمات طحن
    { sku: 'SRV-MILL-BAG50', name: 'أجرة طحن شوال 50 كجم', name_ar: 'أجرة طحن شوال 50 كجم', barcode: '6003000001', category_id: catMap['خدمات طحن وتشغيل'], description: 'رسوم خدمة طحن كيس بوزن 50 كجم', sale_price: 1000, cost_price: 0, min_stock: 0 },
    { sku: 'SRV-MILL-BAG25', name: 'أجرة طحن كيس 25 كجم', name_ar: 'أجرة طحن كيس 25 كجم', barcode: '6003000002', category_id: catMap['خدمات طحن وتشغيل'], description: 'رسوم خدمة طحن كيس بوزن 25 كجم', sale_price: 500, cost_price: 0, min_stock: 0 },
    { sku: 'SRV-MILL-TON', name: 'أجرة طحن بالطن', name_ar: 'أجرة طحن بالطن الواحد', barcode: '6003000003', category_id: catMap['خدمات طحن وتشغيل'], description: 'رسوم خدمة طحن بالطن الواحد', sale_price: 20000, cost_price: 0, min_stock: 0 },

    // مستلزمات تعبئة
    { sku: 'PKG-BAG-50', name: 'كيس تعبئة 50 كجم', name_ar: 'كيس (شوال) تعبئة دقيق 50 كجم', barcode: '6004000001', category_id: catMap['مستلزمات تعبئة وتغليف'], description: 'شوال تعبئة دقيق 50 كيلو', sale_price: 500, cost_price: 350, min_stock: 100 },
    { sku: 'PKG-BAG-25', name: 'كيس تعبئة 25 كجم', name_ar: 'كيس تعبئة دقيق 25 كجم', barcode: '6004000002', category_id: catMap['مستلزمات تعبئة وتغليف'], description: 'كيس تعبئة دقيق 25 كيلو', sale_price: 300, cost_price: 200, min_stock: 50 },
    { sku: 'PKG-BAG-10', name: 'كيس تعبئة 10 كجم', name_ar: 'كيس تعبئة صغير 10 كجم', barcode: '6004000003', category_id: catMap['مستلزمات تعبئة وتغليف'], description: 'كيس تعبئة صغير 10 كيلو', sale_price: 150, cost_price: 100, min_stock: 50 },
    { sku: 'PKG-THREAD', name: 'خيط خياطة أكياس', name_ar: 'خيط خياطة وتغليق أكياس', barcode: '6004000004', category_id: catMap['مستلزمات تعبئة وتغليف'], description: 'خيط خياطة أكياس الدقيق', sale_price: 200, cost_price: 120, min_stock: 20 },
  ];

  for (const prod of products) {
    const { error } = await supabase.from('products').insert(prod);
    if (error) {
      console.log(`   ⚠️  ${prod.sku} (${prod.name_ar}): ${error.message}`);
    } else {
      console.log(`   ✅ ${prod.sku} — ${prod.name_ar}`);
    }
  }

  // ── بذر درجات الحبوب ──
  console.log('\n── بذر درجات الحبوب ──');

  const { data: prods } = await supabase.from('products').select('id, sku').in('sku', [
    'RM-WHEAT-HARD', 'RM-WHEAT-LOCAL', 'RM-WHEAT-SOFT', 'RM-CORN-YELLOW', 'RM-CORN-WHITE', 'RM-BARLEY'
  ]);
  const prodMap = {};
  for (const p of (prods || [])) {
    prodMap[p.sku] = p.id;
  }
  console.log(`   📋 منتجات حبوب: ${Object.keys(prodMap).length}`);

  const grades = [
    { product_id: prodMap['RM-WHEAT-HARD'], grade_code: 'HARD_IMPORT', grade_name_ar: 'قمح صلب مستورد (درجة أولى)', origin: 'IMPORTED', max_moisture: 14, max_impurities: 2, default_bag_size_kg: 50, default_service_sku: 'SRV-MILL-BAG50' },
    { product_id: prodMap['RM-WHEAT-LOCAL'], grade_code: 'LOCAL', grade_name_ar: 'قمح بلدي محلي', origin: 'LOCAL', max_moisture: 14, max_impurities: 2, default_bag_size_kg: 50, default_service_sku: 'SRV-MILL-BAG50' },
    { product_id: prodMap['RM-WHEAT-SOFT'], grade_code: 'SOFT', grade_name_ar: 'قمح طري (للمخبوزات)', origin: 'IMPORTED', max_moisture: 14, max_impurities: 1.5, default_bag_size_kg: 50, default_service_sku: 'SRV-MILL-BAG50' },
    { product_id: prodMap['RM-CORN-YELLOW'], grade_code: 'CORN_YELLOW', grade_name_ar: 'ذرة صفراء خام', origin: 'IMPORTED', max_moisture: 15, max_impurities: 3, default_bag_size_kg: 50, default_service_sku: 'SRV-MILL-BAG50' },
    { product_id: prodMap['RM-CORN-WHITE'], grade_code: 'CORN_WHITE', grade_name_ar: 'ذرة بيضاء بلدية', origin: 'LOCAL', max_moisture: 15, max_impurities: 3, default_bag_size_kg: 50, default_service_sku: 'SRV-MILL-BAG50' },
    { product_id: prodMap['RM-BARLEY'], grade_code: 'BARLEY', grade_name_ar: 'شعير حبوب خام', origin: 'LOCAL', max_moisture: 14, max_impurities: 2.5, default_bag_size_kg: 50, default_service_sku: 'SRV-MILL-BAG50' },
  ];

  for (const grade of grades) {
    if (!grade.product_id) {
      console.log(`   ⚠️  ${grade.grade_code} — المنتج غير موجود`);
      continue;
    }
    const { error } = await supabase.from('milling_grain_grades').insert(grade);
    if (error) {
      console.log(`   ⚠️  ${grade.grade_code}: ${error.message}`);
    } else {
      console.log(`   ✅ ${grade.grade_code} — ${grade.grade_name_ar}`);
    }
  }

  // ── التحقق النهائي ──
  console.log('\n── التحقق النهائي ──');
  const { data: finalProducts } = await supabase.from('products').select('id, sku, name_ar').eq('is_active', true);
  const { data: finalGrades } = await supabase.from('milling_grain_grades').select('id, grade_name_ar').eq('is_active', true);
  const { data: finalCats } = await supabase.from('categories').select('id, name');

  console.log(`   📦 منتجات نشطة: ${finalProducts?.length || 0}`);
  if (finalProducts) {
    for (const p of finalProducts) {
      console.log(`      • ${p.sku} — ${p.name_ar}`);
    }
  }
  console.log(`   🌾 درجات حبوب: ${finalGrades?.length || 0}`);
  if (finalGrades) {
    for (const g of finalGrades) {
      console.log(`      • ${g.grade_name_ar}`);
    }
  }
  console.log(`   📁 تصنيفات: ${finalCats?.length || 0}`);
  if (finalCats) {
    for (const c of finalCats) {
      console.log(`      • ${c.name}`);
    }
  }
  console.log('\n✅ تم تنظيف وبذر البيانات بنجاح!');
}

run().catch(err => {
  console.error('❌ فشل:', err.message);
  process.exit(1);
});
