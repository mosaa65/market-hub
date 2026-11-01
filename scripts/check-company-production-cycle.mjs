// End-to-end local acceptance: purchase tracked raw stock, post an eligible
// expense, produce two outputs, sell them, and verify valuation + journals.
// This script is hard-pinned to localhost and rolls every fixture back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client("postgresql://postgres:postgres@127.0.0.1:5432/postgres");
await client.connect();
const q = (sql, params = []) => client.query(sql, params);
const closeEnough = (actual, expected, label) => {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) < 0.011,
    `${label}: got ${actual}, expected ${expected}`,
  );
  console.log(`PASS ${label}: ${actual}`);
};
const closeUnitCost = (actual, expected, label) => {
  assert.ok(
    Math.abs(Number(actual) - expected) < 0.00011,
    `${label}: got ${actual}, expected ${expected}`,
  );
  console.log(`PASS ${label}: ${actual}`);
};

const token = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
const ownerId = randomUUID();
const email = `production-accept-${token.toLowerCase()}@local.test`;
const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

try {
  await q("BEGIN");
  await q("SET LOCAL ROLE postgres");

  await q(
    `INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
       created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
     VALUES($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now(),
       '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb)`,
    [ownerId, email],
  );
  await q(
    "INSERT INTO public.profiles(id,full_name,language,theme,is_active) VALUES($1,'Production acceptance','ar','light',true)",
    [ownerId],
  );
  await q("INSERT INTO public.user_roles(user_id,role) VALUES($1,'owner')", [ownerId]);

  const kg = (
    await q(
      "SELECT id,factor_to_reference FROM public.units WHERE lower(short_name)='kg' AND dimension_code='MASS' LIMIT 1",
    )
  ).rows[0];
  assert.ok(kg, "seeded kilogram unit must exist");
  const warehouseId = (
    await q(
      "INSERT INTO public.warehouses(name,name_ar,code,is_active,is_default) VALUES($1,$2,$3,true,true) RETURNING id",
      [`Production test ${token}`, `مستودع اختبار ${token}`, `TP-${token}`],
    )
  ).rows[0].id;
  const centerId = (
    await q(
      "INSERT INTO public.expense_cost_centers(code,name,name_ar,is_active) VALUES($1,$2,$3,true) RETURNING id",
      [`TPC-${token}`, `Production acceptance ${token}`, `مركز اختبار ${token}`],
    )
  ).rows[0].id;
  const administrativeCenterId = (
    await q(
      "INSERT INTO public.expense_cost_centers(code,name,name_ar,is_active) VALUES($1,$2,$3,true) RETURNING id",
      [`TAC-${token}`, `Administrative acceptance ${token}`, `مركز الإدارة للاختبار ${token}`],
    )
  ).rows[0].id;
  const supplierId = (
    await q("INSERT INTO public.suppliers(name,is_active) VALUES($1,true) RETURNING id", [
      `Supplier ${token}`,
    ])
  ).rows[0].id;
  const customerId = (
    await q(
      "INSERT INTO public.customers(name,credit_limit,is_active) VALUES($1,10000,true) RETURNING id",
      [`Customer ${token}`],
    )
  ).rows[0].id;
  const expenseAccount = async (code) => {
    const row = (
      await q(
        "SELECT id FROM public.accounts WHERE code=$1 AND account_type='EXPENSE' AND is_active AND is_postable LIMIT 1",
        [code],
      )
    ).rows[0];
    assert.ok(row, `active postable expense account ${code} must exist`);
    return row.id;
  };
  const createCategory = async (key, name, accountCode) =>
    (
      await q(
        `INSERT INTO public.expense_categories(name,name_ar,account_id,is_active)
         VALUES($1,$2,$3,true) RETURNING id`,
        [key + token, `${name} ${token}`, await expenseAccount(accountCode)],
      )
    ).rows[0].id;
  const laborCategoryId = await createCategory("Production labor ", "أجور إنتاج", "5211");
  const energyCategoryId = await createCategory("Production energy ", "طاقة إنتاج", "5311");
  const packagingCategoryId = await createCategory("Production packaging ", "تعبئة إنتاج", "5316");
  const adminCategoryId = await createCategory("Office administration ", "إدارة ومكتب", "5317");

  const rawId = (
    await q(
      `INSERT INTO public.products(sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
       costing_method,cost_price,sale_price,unit_id,base_uom_id,is_purchasable,is_sellable,track_expiry)
     VALUES($1,$2,$3,'GOOD','RAW_MATERIAL','TRACKED','BATCH','MOVING_AVERAGE',0,0,$4,$4,true,false,false)
     RETURNING id`,
      [`T-RAW-${token}`, `Raw material ${token}`, `مادة خام ${token}`, kg.id],
    )
  ).rows[0].id;
  const bagUnitId = (
    await q(
      `INSERT INTO public.units(name,short_name,name_ar,dimension_code,factor_to_reference)
       VALUES($1,$2,$3,'PACKAGING',NULL) RETURNING id`,
      [`Test 50kg bag ${token}`, `bag-${token}`, `كيس اختبار 50 كجم ${token}`],
    )
  ).rows[0].id;
  await q(
    `INSERT INTO public.product_uoms(product_id,unit_id,factor_to_base,conversion_basis,
       conversion_note,quantity_increment,can_purchase,is_default_purchase,is_active)
     VALUES($1,$2,50,'FIXED_PACKAGE','Test sack contains 50 kg',1,true,false,true)`,
    [rawId, bagUnitId],
  );
  const finishedId = (
    await q(
      `INSERT INTO public.products(sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
       costing_method,cost_price,sale_price,unit_id,base_uom_id,is_purchasable,is_sellable,track_expiry)
     VALUES($1,$2,$3,'GOOD','FINISHED_GOOD','TRACKED','BATCH','MOVING_AVERAGE',0,5,$4,$4,true,true,true)
     RETURNING id`,
      [`T-FG-${token}`, `Finished good ${token}`, `منتج تام ${token}`, kg.id],
    )
  ).rows[0].id;
  const byproductId = (
    await q(
      `INSERT INTO public.products(sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
       costing_method,cost_price,sale_price,unit_id,base_uom_id,is_purchasable,is_sellable,track_expiry)
     VALUES($1,$2,$3,'GOOD','BY_PRODUCT','TRACKED','BATCH','MOVING_AVERAGE',0,2,$4,$4,true,true,true)
     RETURNING id`,
      [`T-BY-${token}`, `By-product ${token}`, `ناتج جانبي ${token}`, kg.id],
    )
  ).rows[0].id;

  const asOwner = async (sql, params = []) => {
    await q("SET LOCAL ROLE authenticated");
    await q("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role: "authenticated", sub: ownerId }),
    ]);
    let succeeded = false;
    try {
      const result = await q(sql, params);
      succeeded = true;
      return result;
    } finally {
      if (succeeded) await q("SET LOCAL ROLE postgres");
    }
  };

  // 1. Purchase 200 batch-tracked sacks, each normalized to 50 kg, at 1,000
  //    per sack (10,000 kg total at 20 per kg).
  const purchaseId = (
    await asOwner(
      `SELECT public.create_purchase($1,NULLIF($2::text,'')::uuid,'credit',0,0,$3,$4::jsonb,'[]'::jsonb) AS id`,
      [
        warehouseId,
        supplierId,
        `Production-cycle purchase ${token}`,
        JSON.stringify([
          {
            product_id: rawId,
            quantity: 200,
            unit_cost: 1000,
            tax_rate: 0,
            batch_number: `RAW-LOT-${token}`,
            expiry_date: expires,
            uom_id: bagUnitId,
          },
        ]),
      ],
    )
  ).rows[0].id;
  await q("SET CONSTRAINTS ALL IMMEDIATE");
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
        [rawId, warehouseId],
      )
    ).rows[0].quantity,
    10000,
    "purchased base quantity from 200 bags",
  );
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.product_batches WHERE product_id=$1 AND warehouse_id=$2 AND batch_number=$3",
        [rawId, warehouseId, `RAW-LOT-${token}`],
      )
    ).rows[0].quantity,
    10000,
    "purchased batch balance in kg",
  );
  closeEnough(
    (
      await q(
        "SELECT total_cost FROM public.stock_movements WHERE source_type='purchase_invoice' AND source_id=$1 AND movement_type='purchase'",
        [purchaseId],
      )
    ).rows[0].total_cost,
    200000,
    "purchase valuation at 1,000 per bag",
  );

  // Prove that an untouched posting can be reversed atomically and restores
  // the exact source stock, batch quantities, valuation and journal balance.
  const reversibleOrderId = (
    await asOwner(
      `SELECT public.create_and_post_production_order($1,$2,$3,$4,$5::jsonb,$6::jsonb,'[]'::jsonb,$7::jsonb) AS id`,
      [
        warehouseId,
        centerId,
        today,
        `Reversal acceptance ${token}`,
        JSON.stringify([{ product_id: rawId, quantity: 1, uom_id: bagUnitId }]),
        JSON.stringify([
          {
            product_id: finishedId,
            quantity: 45,
            uom_id: kg.id,
            allocation_value_per_base: 10,
            batch_number: `FG-REV-${token}`,
            expiry_date: expires,
          },
        ]),
        JSON.stringify([
          { loss_type: "NORMAL", quantity: 5, uom_id: kg.id, reason: "Reversal test natural loss" },
        ]),
      ],
    )
  ).rows[0].id;
  await asOwner("SELECT public.reverse_production_order($1,$2)", [
    reversibleOrderId,
    "Acceptance test reversal before any downstream movement",
  ]);
  assert.equal(
    (await q("SELECT status FROM public.production_orders WHERE id=$1", [reversibleOrderId])).rows[0]
      .status,
    "REVERSED",
  );
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
        [rawId, warehouseId],
      )
    ).rows[0].quantity,
    10000,
    "production reversal restores raw stock quantity",
  );
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
        [finishedId, warehouseId],
      )
    ).rows[0].quantity,
    0,
    "production reversal removes untouched finished goods",
  );
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.product_batches WHERE product_id=$1 AND warehouse_id=$2 AND batch_number=$3",
        [finishedId, warehouseId, `FG-REV-${token}`],
      )
    ).rows[0].quantity,
    0,
    "production reversal closes its output batch",
  );
  closeEnough(
    (
      await q(
        "SELECT total_value FROM public.item_cost_layers WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
        [rawId, warehouseId],
      )
    ).rows[0].total_value,
    200000,
    "production reversal restores raw inventory value",
  );
  const reversedJournals = (
    await q(
      `SELECT count(*)::int count FROM public.journal_entries
        WHERE source_type IN ('production_material_issue','production_completion')
          AND source_id=$1 AND status='REVERSED'`,
      [reversibleOrderId],
    )
  ).rows[0].count;
  assert.equal(reversedJournals, 2, "reversal marks both original production journals reversed");
  closeEnough(
    (
      await q(
        `SELECT coalesce(sum(jl.debit-jl.credit),0) amount
           FROM public.journal_entries je JOIN public.journal_lines jl ON jl.entry_id=je.id
           JOIN public.accounts a ON a.id=jl.account_id
          WHERE a.code='1312' AND (
            (je.source_type IN ('production_material_issue','production_completion') AND je.source_id=$1)
            OR (je.source_type='journal_reversal' AND je.source_id IN (
              SELECT id FROM public.journal_entries
               WHERE source_type IN ('production_material_issue','production_completion') AND source_id=$1
            ))
          )`,
        [reversibleOrderId],
      )
    ).rows[0].amount,
    0,
    "production reversal clears WIP through balanced journal reversals",
  );
  console.log("PASS untouched production order reversal restores stock, batches and accounting");

  // 2. Enable direct-cost categories and post labor, energy, packaging and an
  //    administrative expense. Eligibility is explicit, off by default.
  const eligibleCategoryIds = [laborCategoryId, energyCategoryId, packagingCategoryId];
  for (const categoryId of eligibleCategoryIds) {
    const result = await asOwner(
      "SELECT public.set_production_expense_category_eligibility($1,true) AS enabled",
      [categoryId],
    );
    assert.equal(result.rows[0].enabled, true, "owner can explicitly enable direct-cost category");
  }
  const createPostedExpense = async ({ categoryId, description, netAmount, expenseCostCenterId = centerId }) => {
    const expenseId = randomUUID();
    const expenseLineId = randomUUID();
    const taxAmount = netAmount * 0.1;
    const grossAmount = netAmount + taxAmount;
    const reference = `PE-${token}-${expensesPosted.length + 1}`;
    await q(
      `INSERT INTO public.expense_entries(id,reference,status,payee_type,expense_date,posting_date,
         total_amount,paid_amount,line_count,cost_center_id,created_by,approved_by,approved_at)
       VALUES($1,$2,'APPROVED','NONE',$3,$3,$4,0,1,$5,$6,$6,now())`,
      [expenseId, reference, today, grossAmount, expenseCostCenterId, ownerId],
    );
    await q(
      `INSERT INTO public.expense_lines(id,entry_id,line_no,description,category_id,quantity,unit_price,
         net_amount,tax_rate,tax_amount,gross_amount,cost_center_id)
       VALUES($1,$2,1,$3,$4,1,$5,$5,10,$6,$7,$8)`,
      [expenseLineId, expenseId, description, categoryId, netAmount, taxAmount, grossAmount, expenseCostCenterId],
    );
    await asOwner("SELECT public.post_expense($1,1,false,'cash',NULL,$2,$3,NULL,NULL,NULL,NULL)", [
      expenseId,
      today,
      `post-${reference}`,
    ]);
    const posted = { expenseId, expenseLineId, netAmount, reference };
    expensesPosted.push(posted);
    return posted;
  };
  const expensesPosted = [];
  const laborExpense = await createPostedExpense({
    categoryId: laborCategoryId,
    description: "Direct production labor",
    netAmount: 30000,
  });
  const energyExpense = await createPostedExpense({
    categoryId: energyCategoryId,
    description: "Production electricity",
    netAmount: 15000,
  });
  const packagingExpense = await createPostedExpense({
    categoryId: packagingCategoryId,
    description: "Production bags and packaging",
    netAmount: 5000,
  });
  const adminExpense = await createPostedExpense({
    categoryId: adminCategoryId,
    description: "Office administration and rent",
    netAmount: 20000,
  });
  const otherCenterExpense = await createPostedExpense({
    categoryId: laborCategoryId,
    description: "Labor incorrectly assigned to admin center",
    netAmount: 12000,
    expenseCostCenterId: administrativeCenterId,
  });
  const eligibleSources = (
    await asOwner("SELECT * FROM public.production_cost_sources() WHERE expense_entry_id=ANY($1::uuid[])", [
      expensesPosted.map((expense) => expense.expenseId),
    ])
  ).rows;
  assert.equal(eligibleSources.length, 4, "only production-eligible categories are listed across centers");
  assert.ok(
    eligibleSources.every((source) => source.expense_line_id !== adminExpense.expenseLineId),
    "administrative expense must not be an eligible source",
  );
  for (const expense of [laborExpense, energyExpense, packagingExpense]) {
    const source = eligibleSources.find((item) => item.expense_line_id === expense.expenseLineId);
    assert.ok(source, `eligible source ${expense.reference} should be visible`);
    closeEnough(source.available_amount, expense.netAmount, `${expense.reference} net amount excludes VAT`);
  }

  // Bypass the UI and try to capitalize the admin expense. The database must
  // reject it and atomically undo the material issue/order created beforehand.
  const adminNote = `Rejected administrative expense ${token}`;
  await q("SAVEPOINT production_admin_cost");
  await q("SET LOCAL ROLE authenticated");
  await q("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ role: "authenticated", sub: ownerId }),
  ]);
  let adminRejected = false;
  try {
    await q(
      `SELECT public.create_and_post_production_order($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'[]'::jsonb)`,
      [
        warehouseId,
        centerId,
        today,
        adminNote,
        JSON.stringify([{ product_id: rawId, quantity: 1, uom_id: kg.id }]),
        JSON.stringify([
          {
            product_id: finishedId,
            quantity: 1,
            uom_id: kg.id,
            batch_number: `ADMIN-REJECT-${token}`,
            expiry_date: expires,
          },
        ]),
        JSON.stringify([
          {
            expense_line_id: adminExpense.expenseLineId,
            amount: adminExpense.netAmount,
            basis: "Office administration allocation attempt",
          },
        ]),
      ],
    );
  } catch (error) {
    adminRejected = error.message.includes("تصنيف المصروف غير مؤهل");
  }
  await q("ROLLBACK TO SAVEPOINT production_admin_cost");
  await q("RELEASE SAVEPOINT production_admin_cost");
  await q("SET LOCAL ROLE postgres");
  assert.equal(adminRejected, true, "the database rejects an unqualified administrative category");
  assert.equal(
    Number(
      (
        await q("SELECT count(*)::int n FROM public.production_orders WHERE notes=$1", [adminNote])
      ).rows[0].n,
    ),
    0,
    "rejected administrative capitalization leaves no production order",
  );
  console.log("PASS administrative expense is excluded and direct RPC capitalization is rejected");

  const centerNote = `Rejected mismatched cost center ${token}`;
  await q("SAVEPOINT production_center_guard");
  await q("SET LOCAL ROLE authenticated");
  await q("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ role: "authenticated", sub: ownerId }),
  ]);
  let centerMismatchRejected = false;
  try {
    await q(
      `SELECT public.create_and_post_production_order($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'[]'::jsonb)`,
      [
        warehouseId,
        centerId,
        today,
        centerNote,
        JSON.stringify([{ product_id: rawId, quantity: 1, uom_id: kg.id }]),
        JSON.stringify([
          {
            product_id: finishedId,
            quantity: 1,
            uom_id: kg.id,
            batch_number: `CENTER-REJECT-${token}`,
            expiry_date: expires,
          },
        ]),
        JSON.stringify([
          {
            expense_line_id: otherCenterExpense.expenseLineId,
            amount: otherCenterExpense.netAmount,
            basis: "Cost center mismatch test",
          },
        ]),
      ],
    );
  } catch (error) {
    centerMismatchRejected = error.message.includes("مركز تكلفة المصروف لا يطابق مركز تكلفة التشغيلة");
  }
  await q("ROLLBACK TO SAVEPOINT production_center_guard");
  await q("RELEASE SAVEPOINT production_center_guard");
  await q("SET LOCAL ROLE postgres");
  assert.equal(centerMismatchRejected, true, "eligible expense in another center cannot be allocated");
  assert.equal(
    Number((await q("SELECT count(*)::int n FROM public.production_orders WHERE notes=$1", [centerNote])).rows[0].n),
    0,
    "cost-center rejection rolls back the attempted production order",
  );
  console.log("PASS production expense must match the production order cost center");

  // A failed physical balance check happens after the RPC has begun issue and
  // journal work. The savepoint proves that the atomic entry point rolls all
  // those intermediate writes back together.
  const badNote = `Rejected mass-balance run ${token}`;
  await q("SAVEPOINT production_atomicity");
  await q("SET LOCAL ROLE authenticated");
  await q("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ role: "authenticated", sub: ownerId }),
  ]);
  let rejected = false;
  try {
    await q(
      `SELECT public.create_and_post_production_order($1,$2,$3,$4,$5::jsonb,$6::jsonb,'[]'::jsonb,'[]'::jsonb)`,
      [
        warehouseId,
        centerId,
        today,
        badNote,
        JSON.stringify([{ product_id: rawId, quantity: 1, uom_id: kg.id }]),
        JSON.stringify([
          {
            product_id: finishedId,
            quantity: 0.5,
            uom_id: kg.id,
            batch_number: `BAD-${token}`,
            expiry_date: expires,
          },
        ]),
      ],
    );
  } catch (error) {
    rejected = error.message.includes("ميزان الكتلة غير متزن");
  }
  await q("ROLLBACK TO SAVEPOINT production_atomicity");
  await q("RELEASE SAVEPOINT production_atomicity");
  await q("SET LOCAL ROLE postgres");
  assert.equal(rejected, true, "unbalanced kg conversion must be rejected by the database");
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
        [rawId, warehouseId],
      )
    ).rows[0].quantity,
    10000,
    "failed production did not change raw inventory",
  );
  assert.equal(
    (await q("SELECT count(*)::int n FROM public.production_orders WHERE notes=$1", [badNote]))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await q(
        `SELECT count(*)::int n FROM public.stock_movements sm
          WHERE sm.source_type='production_material' AND sm.source_id IN (
            SELECT m.id FROM public.production_order_materials m
            JOIN public.production_orders o ON o.id=m.production_order_id WHERE o.notes=$1
          )`,
        [badNote],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await q(
        `SELECT count(*)::int n FROM public.journal_entries
          WHERE source_type='production_material_issue'
            AND source_id=(SELECT id FROM public.production_orders WHERE notes=$1)`,
        [badNote],
      )
    ).rows[0].n,
    0,
  );
  console.log("PASS failed mass-balance production left no order or stock movement");

  // 3. Consume the purchased 200 sacks (10,000 kg), capitalize 50,000 of
  //    direct production costs, and verify both normal and abnormal process loss.
  const orderId = (
    await asOwner(
      `SELECT public.create_and_post_production_order($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) AS id`,
      [
        warehouseId,
        centerId,
        today,
        `Full-cycle production ${token}`,
        JSON.stringify([{ product_id: rawId, quantity: 200, uom_id: bagUnitId }]),
        JSON.stringify([
          {
            product_id: finishedId,
            quantity: 8700,
            uom_id: kg.id,
            allocation_value_per_base: 10,
            batch_number: `FG-LOT-${token}`,
            expiry_date: expires,
          },
          {
            product_id: byproductId,
            quantity: 1000,
            uom_id: kg.id,
            allocation_value_per_base: 4,
            batch_number: `BY-LOT-${token}`,
            expiry_date: expires,
          },
        ]),
        JSON.stringify([
          {
            expense_line_id: laborExpense.expenseLineId,
            amount: 30000,
            basis: "Direct labor hours",
          },
          {
            expense_line_id: energyExpense.expenseLineId,
            amount: 15000,
            basis: "Production machine energy use",
          },
          {
            expense_line_id: packagingExpense.expenseLineId,
            amount: 5000,
            basis: "Packaging consumed for output",
          },
        ]),
        JSON.stringify([
          {
            loss_type: "NORMAL",
            quantity: 200,
            uom_id: kg.id,
            reason: "Recorded natural process loss",
          },
          {
            loss_type: "ABNORMAL",
            quantity: 100,
            uom_id: kg.id,
            reason: "Recorded abnormal process loss",
          },
        ]),
      ],
    )
  ).rows[0].id;
  const order = (await q("SELECT * FROM public.production_orders WHERE id=$1", [orderId])).rows[0];
  assert.equal(order.status, "POSTED");
  closeEnough(order.material_cost, 200000, "production material cost from 200 sacks");
  closeEnough(order.conversion_cost, 50000, "eligible labor, energy and packaging capitalized");
  closeEnough(order.total_cost, 250000, "production order total cost excludes office expense");
  closeEnough(order.abnormal_loss_cost, 2500, "abnormal loss is expensed outside inventory");
  closeEnough(order.output_cost, 247500, "good finished and by-product inventory receipt value");
  const lossRows = (
    await q(
      "SELECT loss_type,sum(mass_kg) mass_kg FROM public.production_order_losses WHERE production_order_id=$1 GROUP BY loss_type",
      [orderId],
    )
  ).rows;
  closeEnough(
    lossRows.find((row) => row.loss_type === "NORMAL")?.mass_kg,
    200,
    "natural loss is retained in good-output cost",
  );
  closeEnough(
    lossRows.find((row) => row.loss_type === "ABNORMAL")?.mass_kg,
    100,
    "abnormal loss quantity is recorded separately",
  );
  closeEnough(
    (
      await q(
        `SELECT coalesce(sum(jl.debit),0) amount
           FROM public.journal_entries je
           JOIN public.journal_lines jl ON jl.entry_id=je.id
           JOIN public.accounts a ON a.id=jl.account_id
          WHERE je.source_type='production_completion' AND je.source_id=$1 AND a.code='5911'`,
        [orderId],
      )
    ).rows[0].amount,
    2500,
    "abnormal loss posts to the production-loss expense account",
  );
  closeEnough(
    (
      await q(
        "SELECT sum(total_cost) amount FROM public.production_order_materials WHERE production_order_id=$1",
        [orderId],
      )
    ).rows[0].amount,
    200000,
    "material issue snapshot",
  );
  closeEnough(
    (
      await q(
        "SELECT sum(amount) amount FROM public.production_order_cost_allocations WHERE production_order_id=$1",
        [orderId],
      )
    ).rows[0].amount,
    50000,
    "eligible expense allocation snapshot excludes administration",
  );
  closeEnough(
    (
      await q(
        "SELECT sum(a.base_quantity) amount FROM public.production_order_batch_allocations a JOIN public.production_order_materials m ON m.id=a.material_id WHERE m.production_order_id=$1",
        [orderId],
      )
    ).rows[0].amount,
    10000,
    "raw batch quantity consumed in kg",
  );
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.product_batches WHERE product_id=$1 AND warehouse_id=$2",
        [rawId, warehouseId],
      )
    ).rows[0].quantity,
    0,
    "raw lot after production issue",
  );

  const finishedQty = (
    await q(
      "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
      [finishedId, warehouseId],
    )
  ).rows[0].quantity;
  const byproductQty = (
    await q(
      "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
      [byproductId, warehouseId],
    )
  ).rows[0].quantity;
  closeEnough(finishedQty, 8700, "flour received in kg");
  closeEnough(byproductQty, 1000, "bran received in kg");

  const outputCosts = (
    await q(
      `SELECT product_id,base_quantity,allocated_cost,actual_stock_cost,unit_cost
         FROM public.production_order_outputs WHERE production_order_id=$1`,
      [orderId],
    )
  ).rows;
  const flourCost = outputCosts.find((line) => line.product_id === finishedId);
  const branCost = outputCosts.find((line) => line.product_id === byproductId);
  const expectedFlourCost = Math.round(((247500 * 87000) / 91000) * 100) / 100;
  const expectedBranCost = 247500 - expectedFlourCost;
  closeEnough(flourCost.allocated_cost, expectedFlourCost, "flour receives joint-cost share by value");
  closeEnough(branCost.allocated_cost, expectedBranCost, "bran receives remaining joint-cost share");
  closeEnough(flourCost.actual_stock_cost, flourCost.allocated_cost, "flour inventory preserves allocated cost");
  closeEnough(branCost.actual_stock_cost, branCost.allocated_cost, "bran inventory preserves allocated cost");
  closeUnitCost(flourCost.unit_cost, expectedFlourCost / 8700, "final flour cost per kg");
  closeUnitCost(branCost.unit_cost, expectedBranCost / 1000, "final bran cost per kg");

  // 4. Sell a portion of both outputs. The sales COGS journal must credit the
  // inventory account matching each item's class, from movement costs.
  await q(
    "SET CONSTRAINTS sales_invoice_item_batch_allocations_sales_invoice_item_id_fkey DEFERRED",
  );
  const saleId = (
    await asOwner(
      `SELECT public.create_sale($1,$2,'credit',0,0,$3,$4::jsonb,$5,'[]'::jsonb) AS id`,
      [
        warehouseId,
        customerId,
        `Production-cycle sale ${token}`,
        JSON.stringify([
          { product_id: finishedId, quantity: 100, unit_price: 50, tax_rate: 0, uom_id: kg.id },
          { product_id: byproductId, quantity: 20, unit_price: 10, tax_rate: 0, uom_id: kg.id },
        ]),
        today,
      ],
    )
  ).rows[0].id;
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
        [finishedId, warehouseId],
      )
    ).rows[0].quantity,
    8600,
    "finished goods after sale",
  );
  closeEnough(
    (
      await q(
        "SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2 AND owner_type='COMPANY' AND owner_id IS NULL",
        [byproductId, warehouseId],
      )
    ).rows[0].quantity,
    980,
    "by-product after sale",
  );
  closeEnough(
    (
      await q(
        "SELECT coalesce(sum(quantity),0) quantity FROM public.product_batches WHERE product_id=$1 AND warehouse_id=$2",
        [finishedId, warehouseId],
      )
    ).rows[0].quantity,
    8600,
    "finished lot after sale",
  );

  await q("SAVEPOINT production_reversal_after_sale");
  await q("SET LOCAL ROLE authenticated");
  await q("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ role: "authenticated", sub: ownerId }),
  ]);
  let downstreamReverseError = "";
  try {
    await q("SELECT public.reverse_production_order($1,$2)", [
      orderId,
      "Must reject reversal after downstream sale",
    ]);
  } catch (error) {
    downstreamReverseError = error.message;
  }
  await q("ROLLBACK TO SAVEPOINT production_reversal_after_sale");
  await q("RELEASE SAVEPOINT production_reversal_after_sale");
  await q("SET LOCAL ROLE postgres");
  assert.equal(
    downstreamReverseError.includes("حركة مخزون لاحقة") ||
      downstreamReverseError.includes("دفعة الناتج") ||
      downstreamReverseError.includes("رصيد الناتج"),
    true,
    "production reversal is blocked after output stock has moved",
  );
  assert.equal(
    (await q("SELECT status FROM public.production_orders WHERE id=$1", [orderId])).rows[0].status,
    "POSTED",
    "a rejected reversal leaves the posted order unchanged",
  );
  console.log("PASS production reversal is blocked safely after downstream sales");

  const cogsEntries = (
    await q(
      `SELECT a.code,sum(jl.debit) debit,sum(jl.credit) credit
       FROM public.journal_entries je JOIN public.journal_lines jl ON jl.entry_id=je.id
       JOIN public.accounts a ON a.id=jl.account_id
      WHERE je.source_type='sales_invoice_cogs' AND je.source_id=$1 GROUP BY a.code`,
      [saleId],
    )
  ).rows;
  const cogs = Object.fromEntries(
    cogsEntries.map((row) => [row.code, { debit: Number(row.debit), credit: Number(row.credit) }]),
  );
  const soldFinishedCost = Number(
    (
      await q(
        "SELECT sum(total_cost) amount FROM public.stock_movements WHERE source_type='sales_invoice' AND source_id=$1 AND movement_type='sale' AND product_id=$2",
        [saleId, finishedId],
      )
    ).rows[0].amount,
  );
  const soldByproductCost = Number(
    (
      await q(
        "SELECT sum(total_cost) amount FROM public.stock_movements WHERE source_type='sales_invoice' AND source_id=$1 AND movement_type='sale' AND product_id=$2",
        [saleId, byproductId],
      )
    ).rows[0].amount,
  );
  closeEnough(
    cogs["5111"]?.debit,
    soldFinishedCost + soldByproductCost,
    "COGS debit from actual issue movements",
  );
  closeEnough(cogs["1313"]?.credit, soldFinishedCost, "finished goods inventory credited on sale");
  closeEnough(cogs["1314"]?.credit, soldByproductCost, "by-product inventory credited on sale");

  for (const source of [
    "purchase_invoice",
    "expense",
    "production_material_issue",
    "production_expense_allocation",
    "production_completion",
    "sales_invoice",
    "sales_invoice_cogs",
  ]) {
    const totals = (
      await q(
        `SELECT coalesce(sum(total_debit),0) debit,coalesce(sum(total_credit),0) credit
         FROM public.journal_entries WHERE source_type=$1 AND source_id=ANY($2::uuid[])`,
        [
          source,
          source === "production_material_issue" || source === "production_completion"
            ? [orderId]
            : source === "production_expense_allocation"
              ? (
                  await q(
                    "SELECT id FROM public.production_order_cost_allocations WHERE production_order_id=$1",
                    [orderId],
                  )
                ).rows.map((row) => row.id)
              : source === "purchase_invoice"
                ? [purchaseId]
                : source === "expense"
                  ? expensesPosted.map((expense) => expense.expenseId)
                  : [saleId],
        ],
      )
    ).rows[0];
    closeEnough(totals.debit, totals.credit, `${source} journal balances`);
  }
  const wipNet = (
    await q(
      `SELECT coalesce(sum(jl.debit-jl.credit),0) amount
       FROM public.journal_entries je JOIN public.journal_lines jl ON jl.entry_id=je.id
       JOIN public.accounts a ON a.id=jl.account_id
      WHERE je.source_type IN ('production_material_issue','production_expense_allocation','production_completion')
        AND (je.source_id=$1 OR je.source_id IN (SELECT id FROM public.production_order_cost_allocations WHERE production_order_id=$1))
        AND a.code='1312'`,
      [orderId],
    )
  ).rows[0].amount;
  closeEnough(wipNet, 0, "WIP cleared at completion");

  await q("ROLLBACK");
  console.log("PASS full local production accounting cycle; all fixture data rolled back.");
} catch (error) {
  await q("ROLLBACK").catch(() => undefined);
  console.error(
    "FAIL local production cycle:",
    error.message,
    error.detail ?? "",
    error.where ?? "",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
