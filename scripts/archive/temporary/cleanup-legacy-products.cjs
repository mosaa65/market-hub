/**
 * حذف المنتجات القديمة المتبقية (legacy) وتحديث الأسماء العربية للمنتجات القائمة.
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kwzqvgdyadylwnvjghqn.supabase.co';
const SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false },
});

// المنتجات التي نريد الاحتفاظ بها (SKU)
const KEEP_SKUS = [
  'RM-WHEAT-HARD', 'RM-WHEAT-LOCAL', 'RM-WHEAT-SOFT',
  'RM-CORN-YELLOW', 'RM-CORN-WHITE', 'RM-BARLEY',
  'FP-FLOUR-G1', 'FP-FLOUR-G2', 'FP-SEMOLINA', 'FP-BRAN', 'FP-CRACKED',
  'SRV-MILL-BAG50', 'SRV-MILL-BAG25', 'SRV-MILL-TON',
  'PKG-BAG-50', 'PKG-BAG-25', 'PKG-BAG-10', 'PKG-THREAD',
];

async function run() {
  console.log('🧹 تنظيف المنتجات القديمة المتبقية...\n');

  // 1. حذف stock_opening_items أولاً (لإزالة القيود)
  {
    const { error } = await supabase.from('stock_opening_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) console.log(`   ⚠️  stock_opening_items: ${error.message}`);
    else console.log('   ✅ stock_opening_items cleaned');
  }

  // 2. حذف stock_openings
  {
    const { error } = await supabase.from('stock_openings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) console.log(`   ⚠️  stock_openings: ${error.message}`);
    else console.log('   ✅ stock_openings cleaned');
  }

  // 3. حذف cost_layers
  {
    const { error } = await supabase.from('cost_layers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) console.log(`   ⚠️  cost_layers: ${error.message}`);
    else console.log('   ✅ cost_layers cleaned');
  }

  // 4. حذف المنتجات القديمة (غير المطلوبة)
  const { data: allProducts } = await supabase.from('products').select('id, sku, name_ar');
  const toDelete = (allProducts || []).filter(p => !KEEP_SKUS.includes(p.sku));
  
  console.log(`\n   📋 منتجات للحذف: ${toDelete.length}`);
  for (const p of toDelete) {
    console.log(`      🗑️  ${p.sku} — ${p.name_ar}`);
  }

  if (toDelete.length > 0) {
    const idsToDelete = toDelete.map(p => p.id);
    
    // حذف أي مرجع متبقي في inventory
    for (const id of idsToDelete) {
      await supabase.from('inventory').delete().eq('product_id', id);
    }
    
    // حذف المنتجات
    for (const p of toDelete) {
      const { error } = await supabase.from('products').delete().eq('id', p.id);
      if (error) {
        console.log(`   ⚠️  فشل حذف ${p.sku}: ${error.message}`);
        // تعطيل بدل الحذف
        await supabase.from('products').update({ is_active: false }).eq('id', p.id);
        console.log(`   🔒 تم تعطيل ${p.sku} بدل الحذف`);
      } else {
        console.log(`   ✅ حذف ${p.sku}`);
      }
    }
  }

  // 5. تحديث الأسماء العربية للمنتجات القائمة (التي لم تُحذف)
  console.log('\n── تحديث الأسماء العربية ──');
  const updates = [
    { sku: 'RM-WHEAT-HARD', name: 'قمح صلب مستورد', name_ar: 'قمح صلب مستورد (درجة أولى)' },
    { sku: 'RM-WHEAT-LOCAL', name: 'قمح بلدي محلي', name_ar: 'قمح بلدي محلي' },
    { sku: 'RM-WHEAT-SOFT', name: 'قمح طري للمخبوزات', name_ar: 'قمح طري (للمخبوزات)' },
    { sku: 'RM-CORN-YELLOW', name: 'ذرة صفراء خام', name_ar: 'ذرة صفراء خام' },
    { sku: 'RM-CORN-WHITE', name: 'ذرة بيضاء بلدية', name_ar: 'ذرة بيضاء بلدية' },
    { sku: 'RM-BARLEY', name: 'شعير حبوب خام', name_ar: 'شعير حبوب خام' },
    { sku: 'SRV-MILL-BAG50', name: 'أجرة طحن شوال 50 كجم', name_ar: 'أجرة طحن شوال 50 كجم' },
    { sku: 'SRV-MILL-TON', name: 'أجرة طحن بالطن', name_ar: 'أجرة طحن بالطن الواحد' },
  ];

  for (const u of updates) {
    const { error } = await supabase.from('products').update({ name: u.name, name_ar: u.name_ar }).eq('sku', u.sku);
    if (error) console.log(`   ⚠️  ${u.sku}: ${error.message}`);
    else console.log(`   ✅ ${u.sku} — ${u.name_ar}`);
  }

  // 6. ربط المنتجات بالتصنيفات الصحيحة
  console.log('\n── ربط التصنيفات ──');
  const { data: cats } = await supabase.from('categories').select('id, name');
  const catMap = {};
  for (const c of (cats || [])) catMap[c.name] = c.id;

  const catLinks = [
    { skus: ['RM-WHEAT-HARD', 'RM-WHEAT-LOCAL', 'RM-WHEAT-SOFT', 'RM-CORN-YELLOW', 'RM-CORN-WHITE', 'RM-BARLEY'], cat: 'حبوب ومواد خام' },
    { skus: ['FP-FLOUR-G1', 'FP-FLOUR-G2', 'FP-SEMOLINA', 'FP-BRAN', 'FP-CRACKED'], cat: 'منتجات مطحونة' },
    { skus: ['SRV-MILL-BAG50', 'SRV-MILL-BAG25', 'SRV-MILL-TON'], cat: 'خدمات طحن وتشغيل' },
    { skus: ['PKG-BAG-50', 'PKG-BAG-25', 'PKG-BAG-10', 'PKG-THREAD'], cat: 'مستلزمات تعبئة وتغليف' },
  ];

  for (const link of catLinks) {
    const catId = catMap[link.cat];
    if (!catId) { console.log(`   ⚠️ تصنيف "${link.cat}" غير موجود`); continue; }
    for (const sku of link.skus) {
      const { error } = await supabase.from('products').update({ category_id: catId }).eq('sku', sku);
      if (error) console.log(`   ⚠️  ${sku}: ${error.message}`);
    }
    console.log(`   ✅ ${link.cat}: ${link.skus.length} منتج`);
  }

  // التحقق النهائي
  console.log('\n── التحقق النهائي ──');
  const { data: finalProducts } = await supabase.from('products').select('id, sku, name_ar, is_active')
    .eq('is_active', true)
    .order('sku');
  
  console.log(`   📦 منتجات نشطة: ${finalProducts?.length || 0}`);
  for (const p of (finalProducts || [])) {
    console.log(`      • ${p.sku} — ${p.name_ar}`);
  }

  console.log('\n✅ التنظيف النهائي مكتمل!');
}

run().catch(err => {
  console.error('❌ فشل:', err.message);
  process.exit(1);
});
