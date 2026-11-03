// P0 — اختبارات الجرد الداخلي (تصنيع/مستهلكات/كلفة المخزون/مرتجعات) قبل التسليم.
//
// كل خطوة تعمل داخل SAVEPOINT خاص بها، والمعاملة كلها تُلغى في النهاية
// (ROLLBACK) فلا يبقى أي أثر في القاعدة المتصلة. الاستخدام:
//   node scripts/db-verify-inventory.mjs
import { connect } from './db-run.mjs';

const client = await connect();
await client.connect();

const results = [];
let failures = 0;

const q = async (sql, params) => (await client.query(sql, params)).rows;
const first = async (sql, params) => (await q(sql, params))[0];

/** ينفّذ خطوة داخل SAVEPOINT ويرجع {ok, value, error}. */
async function step(fn) {
  await client.query('SAVEPOINT step');
  try {
    const value = await fn();
    await client.query('RELEASE SAVEPOINT step');
    return { ok: true, value };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT step');
    await client.query('RELEASE SAVEPOINT step');
    return { ok: false, error: error.message };
  }
}

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
}

await client.query('BEGIN');

try {
  const wh = (await first(`SELECT id FROM public.warehouses WHERE is_active ORDER BY created_at LIMIT 1`))?.id;
  if (!wh) throw new Error('لا يوجد مستودع نشط لتنفيذ الاختبارات');

  const mkItem = async (name, cls, extra = {}) => {
    const r = await first(
      `INSERT INTO public.products
         (name, name_ar, item_class, item_nature, inventory_policy, is_active, is_sellable,
          is_purchasable, cost_price, sale_price)
       VALUES ($1, $1, $2::public.item_class, $3::public.item_nature, $4::public.inventory_policy,
               true, coalesce($5, true), coalesce($6, false), coalesce($7, 0), coalesce($8, 0))
       RETURNING id`,
      [
        name,
        cls,
        extra.nature ?? (cls === 'SERVICE' ? 'SERVICE' : 'GOOD'),
        extra.policy ?? (cls === 'SERVICE' ? 'UNTRACKED' : 'TRACKED'),
        extra.sellable,
        extra.purchasable,
        extra.cost,
        extra.price,
      ],
    );
    return r.id;
  };

  const post = (productId, qty, cost, kind, type, note) =>
    q(
      `SELECT public.post_stock_delta($1,$2,$3,$4,$5::public.stock_movement_kind,
         'test_40', gen_random_uuid(), $7, 'COMPANY'::public.owner_type, NULL,
         $6::public.movement_type)`,
      [productId, wh, qty, cost, kind, type, note],
    );

  // ── تجهيز الأصناف ────────────────────────────────────────────────────────
  const ids = {};
  ids.grain = await mkItem('TEST 40 GRAIN', 'RAW_MATERIAL', { purchasable: true, cost: 100 });
  ids.finished = await mkItem('TEST 40 FLOUR', 'FINISHED_GOOD', { purchasable: true, price: 200 });
  ids.bran = await mkItem('TEST 40 BRAN', 'BY_PRODUCT', { purchasable: true, price: 50 });
  ids.good = await mkItem('TEST 40 GOOD', 'FINISHED_GOOD', { purchasable: true, cost: 10, price: 30 });
  ids.bag = await mkItem('TEST 40 BAG', 'PACKAGING', { purchasable: true, cost: 5 });
  ids.supplier = (
    await first(`INSERT INTO public.suppliers (name) VALUES ('TEST 40 SUPPLIER') RETURNING id`)
  ).id;

  const layer = async (productId) =>
    first(
      `SELECT quantity, total_value FROM public.item_cost_layers
        WHERE product_id = $1 AND warehouse_id = $2 AND owner_type = 'COMPANY'`,
      [productId, wh],
    );

  // ── 1) P0-3: الاستلام يملأ طبقة التكلفة ──────────────────────────────────
  {
    const r = await step(() => post(ids.grain, 100, 100, 'RECEIPT', 'purchase', 'opening 1'));
    const l = r.ok ? await layer(ids.grain) : null;
    record(
      'P0-3: الاستلام يقيّم المخزون (100 × 100)',
      Boolean(l) && Number(l.total_value) === 10000,
      r.error ?? JSON.stringify(l),
    );
  }

  // ── 2) P0-3: متوسط التكلفة المتحرك ──────────────────────────────────────
  {
    const r = await step(() => post(ids.grain, 100, 120, 'RECEIPT', 'purchase', 'opening 2'));
    const l = r.ok ? await layer(ids.grain) : null;
    record(
      'P0-3: المتوسط المتحرك بعد استلامين (200 / 22,000)',
      Boolean(l) && Number(l.quantity) === 200 && Number(l.total_value) === 22000,
      r.error ?? JSON.stringify(l),
    );
  }

  // ── 3) P0-2: دفعتان تصنيع لنفس القمح ─────────────────────────────────────
  {
    const setup = await step(async () => {
      await client.query(
        `SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000"}', true)`,
      );
      await client.query(
        `INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000000','test40@local.invalid')
         ON CONFLICT (id) DO NOTHING`,
      );
      await client.query(
        `INSERT INTO public.profiles (id, full_name) VALUES ('00000000-0000-0000-0000-000000000000','TEST 40')
         ON CONFLICT (id) DO NOTHING`,
      );
      await client.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-000000000000','owner')
         ON CONFLICT DO NOTHING`,
      );
    });
    const outputs = JSON.stringify([
      { item_id: ids.finished, qty: 40 },
      { item_id: ids.bran, qty: 10 },
    ]);
    const a = setup.ok
      ? await step(() =>
          first(`SELECT public.smart_manufacture($1,$2,50,$3::jsonb,'batch 1') AS r`, [wh, ids.grain, outputs]),
        )
      : { ok: false, error: setup.error };
    const b = a.ok
      ? await step(() =>
          first(`SELECT public.smart_manufacture($1,$2,50,$3::jsonb,'batch 2') AS r`, [wh, ids.grain, outputs]),
        )
      : { ok: false, error: a.error };
    record(
      'P0-2: دفعتان تصنيع لنفس القمح بلا تصادم',
      a.ok && b.ok && a.value.r !== b.value.r,
      a.error ?? b.error ?? `${a.value?.r} / ${b.value?.r}`,
    );
  }

  // ── 4) P0-2: صرفان متتاليان من نفس المستودع ─────────────────────────────
  {
    const open = await step(() => post(ids.bag, 100, 5, 'RECEIPT', 'purchase', 'pack opening'));
    const lines = JSON.stringify([{ item_id: ids.bag, qty: 10 }]);
    const a = open.ok
      ? await step(() => first(`SELECT public.consume_internal_supplies($1,$2::jsonb,'first') AS r`, [wh, lines]))
      : { ok: false, error: open.error };
    const b = a.ok
      ? await step(() => first(`SELECT public.consume_internal_supplies($1,$2::jsonb,'second') AS r`, [wh, lines]))
      : { ok: false, error: a.error };
    record(
      'P0-2: صرفان متتاليان من نفس المستودع',
      a.ok && b.ok && a.value.r !== b.value.r,
      a.error ?? b.error ?? `${a.value?.r} / ${b.value?.r}`,
    );
  }

  // ── 5) P0-3: بيع — COGS بالتكلفة الفعلية ────────────────────────────────
  let saleInvoice = null;
  {
    const open = await step(() => post(ids.good, 10, 40, 'RECEIPT', 'purchase', 'good opening'));
    const sale = open.ok
      ? await step(() =>
          first(`SELECT public.create_sale($1,NULL,'cash',60,0,'test 40',$2::jsonb) AS id`, [
            wh,
            JSON.stringify([{ product_id: ids.good, quantity: 2, unit_price: 30, tax_rate: 0 }]),
          ]),
        )
      : { ok: false, error: open.error };
    saleInvoice = sale.ok ? sale.value.id : null;
    const cogs = saleInvoice
      ? await step(() =>
          first(
            `SELECT sum(jl.debit) AS d
               FROM public.journal_lines jl
               JOIN public.accounts a ON a.id = jl.account_id
               JOIN public.journal_entries je ON je.id = jl.entry_id
              WHERE je.source_type = 'sales_invoice' AND je.source_id = $1 AND a.code = '5111'`,
            [saleInvoice],
          ),
        )
      : { ok: false };
    record(
      'P0-3: COGS بالتكلفة الفعلية (2 × 40 = 80)',
      cogs.ok && Number(cogs.value.d) === 80,
      sale.error ?? JSON.stringify(cogs.value),
    );
  }

  // ── 6) P0-1: مرتجع أكبر من المبيع يُرفض ─────────────────────────────────
  if (saleInvoice) {
    const r = await step(() =>
      q(`SELECT public.create_sales_return($1,$2,NULL,'cash','too much',$3::jsonb)`, [
        saleInvoice,
        wh,
        JSON.stringify([{ product_id: ids.good, quantity: 3 }]),
      ]),
    );
    record(
      'P0-1: مرتجع أكبر من المبيع يُرفض',
      !r.ok && /exceeds what was sold/i.test(r.error ?? ''),
      r.error ?? 'accepted!',
    );
  } else {
    record('P0-1: مرتجع أكبر من المبيع يُرفض', false, 'لا توجد فاتورة اختبار');
  }

  // ── 7) P0-1: مرتجع نقدي بلا عميل ينتج قيداً ─────────────────────────────
  if (saleInvoice) {
    const r = await step(async () => {
      const ret = await first(
        `SELECT public.create_sales_return($1,$2,NULL,'cash','partial',$3::jsonb) AS id`,
        [saleInvoice, wh, JSON.stringify([{ product_id: ids.good, quantity: 1 }])],
      );
      const entry = await first(
        `SELECT id FROM public.journal_entries
          WHERE source_type = 'sales_return' AND source_id = $1 AND status <> 'REVERSED'`,
        [ret.id],
      );
      if (!entry) throw new Error('لا يوجد قيد للمرتجع النقدي');
      return ret.id;
    });
    record('P0-1: المرتجع النقدي بلا عميل له قيد', r.ok, r.error ?? '');
  }

  // ── 8) P0-4: خدمة حرة تُرحَّل ───────────────────────────────────────────
  {
    const r = await step(() =>
      first(`SELECT public.create_sale($1,NULL,'cash',500,0,'adhoc',$2::jsonb) AS id`, [
        wh,
        JSON.stringify([
          { product_id: null, name: 'خدمة اختبار حرة', quantity: 1, unit_price: 500, is_service: true },
        ]),
      ]),
    );
    record('P0-4: فاتورة خدمة حرة فقط تُرحَّل', r.ok && Boolean(r.value.id), r.error ?? '');
  }

  // ── 9) P0-3: الشراء يقيّم المخزون ───────────────────────────────────────
  {
    const r = await step(() =>
      q(`SELECT public.create_purchase($1,$2,'cash',1300,0,'test',$3::jsonb)`, [
        wh,
        ids.supplier,
        JSON.stringify([{ product_id: ids.grain, quantity: 10, unit_cost: 130, tax_rate: 0 }]),
      ]),
    );
    const l = r.ok ? await layer(ids.grain) : null;
    record('P0-3: الشراء يحدّث طبقة التكلفة', r.ok && Boolean(l), r.error ?? JSON.stringify(l));
  }

  // ── 10) P0-3: الكتابة المباشرة على الحركات مرفوضة ───────────────────────
  {
    const r = await step(() =>
      q(
        `INSERT INTO public.stock_movements (product_id, warehouse_id, movement_type, quantity)
         VALUES ($1,$2,'adjustment',1)`,
        [ids.good, wh],
      ),
    );
    record(
      'P0-3: الكتابة المباشرة على stock_movements مرفوضة',
      !r.ok && /post_stock_delta/i.test(r.error ?? ''),
      r.error ?? 'accepted!',
    );
  }

  // ── 11) P1-6: كيان نظامي محمي ───────────────────────────────────────────
  {
    const rename = await step(() => q(`UPDATE public.customers SET name = name || ' X' WHERE is_system`));
    record('P1-6: إعادة تسمية العميل النقدي مرفوضة', !rename.ok, rename.error ?? 'accepted!');

    const deactivate = await step(() => q(`UPDATE public.suppliers SET is_active = false WHERE is_system`));
    record('P1-6: تعطيل المورد النقدي مرفوض', !deactivate.ok, deactivate.error ?? 'accepted!');

    const credit = await step(() =>
      q(`SELECT public.create_sale($1,(SELECT id FROM public.customers WHERE is_system LIMIT 1),
           'credit',0,0,'credit on cash customer',$2::jsonb)`, [
        wh,
        JSON.stringify([{ product_id: ids.good, quantity: 1, unit_price: 30, tax_rate: 0 }]),
      ]),
    );
    record(
      'P1-6: البيع الآجل على العميل النقدي مرفوض',
      !credit.ok && /cash customer/i.test(credit.error ?? ''),
      credit.error ?? 'accepted!',
    );
  }

  // ── 12) P1-8: المحرّكات الداخلية غير مكشوفة ─────────────────────────────
  {
    const r = await first(
      `SELECT count(*)::int AS n FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND p.proname IN ('apply_cost_movement','next_journal_number','product_delete_guard')`,
    );
    record('P1-8: لا محرّكات داخلية مكشوفة لـ authenticated', Number(r.n) === 0, `مكشوف: ${r.n}`);
  }
} finally {
  await client.query('ROLLBACK');
  await client.end();
}

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
}
console.log(`\n${results.length - failures}/${results.length} passed (rolled back)`);
process.exitCode = failures === 0 ? 0 : 1;
