-- Seed data for Yemeni Grocery & Wholesale Trading POS/ERP schema (المواد الغذائية والتجارة بالجملة)
-- Reset existing operational data & seed realistic Food & Wholesale data in Yemeni Rial (YER)

BEGIN;

-- Truncate existing transactional & reference data (preserving profiles & user_roles)
TRUNCATE TABLE 
  stock_movements, 
  sales_invoice_items, 
  sales_invoices, 
  purchase_invoice_items, 
  purchase_invoices, 
  sales_return_items, 
  sales_returns, 
  purchase_return_items, 
  purchase_returns, 
  customer_payments, 
  loyalty_transactions, 
  expenses, 
  expense_categories, 
  product_batches, 
  inventory, 
  products, 
  customers, 
  suppliers, 
  warehouses, 
  units, 
  brands, 
  categories, 
  company_settings,
  audit_logs
CASCADE;

-- 1. Company Settings
INSERT INTO company_settings (id, name, legal_name, tax_number, currency, currency_symbol, tax_rate, logo_url, address, phone, email, invoice_prefix, barcode_enabled, updated_at) VALUES
  (1, 'الرواد لتجارة المواد الغذائية بالجملة', 'مؤسسة الرواد التجارية للتجارة والتوزيع', 'YEM-TAX-99882', 'YER', '﷼', 0, NULL, 'صنعاء - شارع الستين الجنوبي - مقابل سوق الجملة', '777554433', 'info@alrawad-grocery.com', 'INV-', TRUE, NOW());

-- 2. Categories
INSERT INTO categories (id, name, name_ar, parent_id, created_at) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Food & Commodities', 'المواد الغذائية والتموين', NULL, NOW()),
  ('c1000000-0000-0000-0000-000000000002', 'Rice & Grains', 'الأرز والحبوب والدقيق', 'c1000000-0000-0000-0000-000000000001', NOW()),
  ('c1000000-0000-0000-0000-000000000003', 'Oils & Ghee', 'الزيوت والسمن النباتي', 'c1000000-0000-0000-0000-000000000001', NOW()),
  ('c1000000-0000-0000-0000-000000000004', 'Sugar & Sweeteners', 'السكر والحلاوة', 'c1000000-0000-0000-0000-000000000001', NOW()),
  ('c1000000-0000-0000-0000-000000000005', 'Milk & Dairy Products', 'الحليب ومستلزمات الألبان', 'c1000000-0000-0000-0000-000000000001', NOW()),
  ('c1000000-0000-0000-0000-000000000006', 'Canned Foods & Sauces', 'المعلبات والصلصات', 'c1000000-0000-0000-0000-000000000001', NOW()),
  ('c1000000-0000-0000-0000-000000000007', 'Tea, Coffee & Beverages', 'الشاي والقهوة والمشروبات', 'c1000000-0000-0000-0000-000000000001', NOW()),
  ('c1000000-0000-0000-0000-000000000008', 'Detergents & Household', 'المنظفات والمستلزمات المنزلية', NULL, NOW());

-- 3. Brands
INSERT INTO brands (id, name, name_ar, created_at) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'Al-Saeed Group', 'مجموعة السعيد (هائل سعيد)', NOW()),
  ('b1000000-0000-0000-0000-000000000002', 'Al-Kabous', 'الكبوس', NOW()),
  ('b1000000-0000-0000-0000-000000000003', 'Afia', 'عافية', NOW()),
  ('b1000000-0000-0000-0000-000000000004', 'Rainbow / Abukaoos', 'أبو قوس', NOW()),
  ('b1000000-0000-0000-0000-000000000005', 'Almarai', 'المراعي', NOW()),
  ('b1000000-0000-0000-0000-000000000006', 'Al-Ghazal', 'الغزال', NOW()),
  ('b1000000-0000-0000-0000-000000000007', 'Nestle', 'نستله', NOW()),
  ('b1000000-0000-0000-0000-000000000008', 'Local Wholesale', 'إنتاج محلي ممتاز', NOW());

-- 4. Units
INSERT INTO units (id, name, short_name, name_ar, created_at) VALUES
  ('u1000000-0000-0000-0000-000000000001', 'Bag 50kg', 'كيس 50كجم', 'كيس 50 كجم', NOW()),
  ('u1000000-0000-0000-0000-000000000002', 'Bag 10kg', 'قطمة 10كجم', 'قطمة 10 كجم', NOW()),
  ('u1000000-0000-0000-0000-000000000003', 'Carton', 'كرتون', 'كرتون كامل', NOW()),
  ('u1000000-0000-0000-0000-000000000004', 'Box / Pack', 'باكيت', 'باكيت / علبة', NOW()),
  ('u1000000-0000-0000-0000-000000000005', 'Piece', 'حبة', 'حبة مفرقة', NOW()),
  ('u1000000-0000-0000-0000-000000000006', 'Dozen', 'درزن', 'درزن (12 حبة)', NOW());

-- 5. Warehouses
INSERT INTO warehouses (id, name, name_ar, code, address, is_default, is_active, created_at, updated_at) VALUES
  ('w1000000-0000-0000-0000-000000000001', 'Sanaa Main Central Warehouse', 'المستودع المركزي الرئيسي - صنعاء', 'WH-SAN-01', 'صنعاء - المنطقة الصناعية - جولة المصباحي', TRUE, TRUE, NOW(), NOW()),
  ('w1000000-0000-0000-0000-000000000002', 'Aden Port Branch Warehouse', 'مستودع ميناء المعلا - عدن', 'WH-ADN-01', 'عدن - المعلا - خلف الرصيف الرئيسي', FALSE, TRUE, NOW(), NOW()),
  ('w1000000-0000-0000-0000-000000000003', 'Taiz Hawban Depot', 'مستودع فرع الحوبان - تعز', 'WH-TAZ-01', 'تعز - خط الحوبان الرئيسي', FALSE, TRUE, NOW(), NOW());

-- 6. Suppliers
INSERT INTO suppliers (id, name, phone, email, address, balance, is_active, created_at, updated_at) VALUES
  ('s1000000-0000-0000-0000-000000000001', 'مجموعة هائل سعيد أنعم للتجارة والتوزيع', '01-200300', 'info@hsa-group.com', 'صنعاء - الصافية - المقر الرئيسي', 4500000, TRUE, NOW(), NOW()),
  ('s1000000-0000-0000-0000-000000000002', 'شركة الكبوس للمواد الغذائية والشاي', '01-400500', 'sales@alkabous.com', 'صنعاء - شارع الزبيري', 1200000, TRUE, NOW(), NOW()),
  ('s1000000-0000-0000-0000-000000000003', 'شركة شهاب للتجارة والملاحة (وكيل عافية)', '02-300400', 'contact@shehab-trade.com', 'عدن - التواهي', 2800000, TRUE, NOW(), NOW()),
  ('s1000000-0000-0000-0000-000000000004', 'شركة ناتكو للاستيراد والأغذية (وكيل أبو قوس)', '01-500600', 'foods@natco.com.ye', 'صنعاء - شارع التحرير', 0, TRUE, NOW(), NOW()),
  ('s1000000-0000-0000-0000-000000000005', 'مؤسسة فاهم لاستيراد القمح والسكر', '03-600700', 'import@fahem-co.com', 'الحديدة - الكورنيش', 6200000, TRUE, NOW(), NOW());

-- 7. Customers
INSERT INTO customers (id, name, phone, email, address, credit_limit, balance, is_active, created_at, updated_at, loyalty_points) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'سوبرماركت البركة بالجملة والتجزئة', '777112233', 'albaraka@grocery.com', 'صنعاء - حدة - شارع الأربعين', 5000000, 1450000, TRUE, NOW(), NOW(), 340),
  ('c2000000-0000-0000-0000-000000000002', 'أسواق الهدى مHypermarket', '771223344', 'alhuda@hyper.com', 'صنعاء - شارع تعز', 10000000, 3200000, TRUE, NOW(), NOW(), 820),
  ('c2000000-0000-0000-0000-000000000003', 'مركز الخير للمواد الغذائية', '773334455', 'alkhair@store.com', 'عمران - شارع خط صنعاء', 3000000, 850000, TRUE, NOW(), NOW(), 120),
  ('c2000000-0000-0000-0000-000000000004', 'مطاعم ومعامل الشيباني السياحية', '774445566', 'alshaibani@restaurants.com', 'صنعاء - حدة', 8000000, 2100000, TRUE, NOW(), NOW(), 550),
  ('c2000000-0000-0000-0000-000000000005', 'بقالة وماركت السلام', '775556677', 'alsalam@market.com', 'ذمار - السوق المركزي', 2000000, 0, TRUE, NOW(), NOW(), 90);

-- 8. Products
INSERT INTO products (
  id, sku, barcode, name, name_ar, category_id, brand_id, unit_id, cost_price, sale_price, tax_rate, min_stock, track_expiry, is_active, created_at, updated_at
) VALUES
  ('p1000000-0000-0000-0000-000000000001', 'RIC-BAS-50', '629100100101', 'Basmati Rice Al-Ghazal 50kg Bag', 'أرز بسمتي أبيض الغزال كيس 50 كجم', 'c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006', 'u1000000-0000-0000-0000-000000000001', 32000, 35500, 0, 20, FALSE, TRUE, NOW(), NOW()),
  ('p1000000-0000-0000-0000-000000000002', 'RIC-MAS-10', '629100100102', 'Mazaa Rice Al-Saeed 10kg Bag', 'أرز مزة السعيد قطمة 10 كجم', 'c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'u1000000-0000-0000-0000-000000000002', 8200, 9300, 0, 30, FALSE, TRUE, NOW(), NOW()),
  ('p1000000-0000-0000-0000-000000000003', 'SUG-WHT-50', '629100200201', 'White Refined Sugar 50kg Bag', 'سكر أبيض نقي السعيد كيس 50 كجم', 'c1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'u1000000-0000-0000-0000-000000000001', 29500, 32000, 0, 25, FALSE, TRUE, NOW(), NOW()),
  ('p1000000-0000-0000-0000-000000000004', 'OIL-AFI-1.5', '629100300301', 'Afia Corn Oil 1.5L Carton (12 Bottles)', 'زيت عافية ذرة 1.5 لتر كرتون (12 قارورة)', 'c1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', 'u1000000-0000-0000-0000-000000000003', 44000, 48500, 0, 15, TRUE, TRUE, NOW(), NOW()),
  ('p1000000-0000-0000-0000-000000000005', 'GHE-SAE-4KG', '629100300302', 'Al-Saeed Vegetable Ghee 4kg Tin', 'سمن نباتي السعيد علبة 4 كجم', 'c1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'u1000000-0000-0000-0000-000000000005', 9800, 11200, 0, 20, TRUE, TRUE, NOW(), NOW()),
  ('p1000000-0000-0000-0000-000000000006', 'TEA-KAB-225', '629100400401', 'Al-Kabous Red Loose Tea 225g Carton (24 Packs)', 'شاي الكبوس أحمر فاخر 225 جرام كرتون (24 بكيت)', 'c1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000002', 'u1000000-0000-0000-0000-000000000003', 38000, 42000, 0, 10, TRUE, TRUE, NOW(), NOW()),
  ('p1000000-0000-0000-0000-000000000007', 'MLK-ABU-170', '629100500501', 'Rainbow Evaporated Milk 170g Carton (48 Cans)', 'حليب أبو قوس مبخر 170 جرام كرتون (48 علبة)', 'c1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000004', 'u1000000-0000-0000-0000-000000000003', 26000, 29000, 0, 15, TRUE, TRUE, NOW(), NOW()),
  ('p1000000-0000-0000-0000-000000000008', 'FLR-RED-50', '629100600601', 'Al-Saeed Red Wheat Flour 50kg Bag', 'دقيق السعيد أحمر ممتازة كيس 50 كجم', 'c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'u1000000-0000-0000-0000-000000000001', 19500, 21800, 0, 40, FALSE, TRUE, NOW(), NOW());

-- 9. Initial Inventory for Sanaa Main Warehouse
INSERT INTO inventory (id, product_id, warehouse_id, quantity, updated_at) VALUES
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000001', 'w1000000-0000-0000-0000-000000000001', 150, NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000002', 'w1000000-0000-0000-0000-000000000001', 220, NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000003', 'w1000000-0000-0000-0000-000000000001', 300, NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000004', 'w1000000-0000-0000-0000-000000000001', 85, NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000005', 'w1000000-0000-0000-0000-000000000001', 140, NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000006', 'w1000000-0000-0000-0000-000000000001', 95, NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000007', 'w1000000-0000-0000-0000-000000000001', 180, NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000008', 'w1000000-0000-0000-0000-000000000001', 400, NOW());

-- 10. Product Batches with Expiry Dates
INSERT INTO product_batches (id, product_id, warehouse_id, batch_number, quantity, unit_cost, expiry_date, note, created_at, updated_at) VALUES
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000004', 'w1000000-0000-0000-0000-000000000001', 'BATCH-AFI-2026-01', 85, 44000, '2027-06-30', 'دفعة زيت عافية جديدة', NOW(), NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000006', 'w1000000-0000-0000-0000-000000000001', 'BATCH-KAB-2026-05', 95, 38000, '2028-01-15', 'دفعة شاي الكبوس النقي', NOW(), NOW()),
  (gen_random_uuid(), 'p1000000-0000-0000-0000-000000000007', 'w1000000-0000-0000-0000-000000000001', 'BATCH-ABU-2026-03', 180, 26000, '2027-03-31', 'دفعة حليب أبو قوس قشطة', NOW(), NOW());

-- 11. Expense Categories & Sample Expenses
INSERT INTO expense_categories (id, name, name_ar, created_at) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'Transport & Delivery Freight', 'أجور النقل والشحن والديزل', NOW()),
  ('e1000000-0000-0000-0000-000000000002', 'Store Rent & Warehouse', 'إيجارات المستودعات والمخازن', NOW()),
  ('e1000000-0000-0000-0000-000000000003', 'Electricity & Generator Fuel', 'كهرباء ومحروقات المولدات', NOW()),
  ('e1000000-0000-0000-0000-000000000004', 'Staff Salaries & Meals', 'مرتبات وإعاشة العمال', NOW());

INSERT INTO expenses (id, category_id, amount, payment_method, expense_date, note, created_at, updated_at) VALUES
  (gen_random_uuid(), 'e1000000-0000-0000-0000-000000000001', 185000, 'cash', '2026-07-20', 'نقل دينا سكر وأرز من ميناء الحديدة إلى صنعاء', NOW(), NOW()),
  (gen_random_uuid(), 'e1000000-0000-0000-0000-000000000003', 95000, 'cash', '2026-07-25', 'ديزل المولد الكهربائي للمستودع الرئيسي', NOW(), NOW());

COMMIT;
