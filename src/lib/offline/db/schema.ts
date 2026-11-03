/**
 * Market-Hub ERP - Local Database Schema & DDL Definitions (SQLite WAL Mode / IndexedDB)
 * Phase 3 Architecture
 */

export const LOCAL_DB_VERSION = 1;

export const LOCAL_SCHEMA_DDL = `
-- Local System Tables
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_registration (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  assigned_warehouse_id TEXT,
  registered_at TEXT NOT NULL
);

-- Operational Outbox & Inbox
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  operation_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  dependencies TEXT NOT NULL DEFAULT '[]',
  origin_device_id TEXT NOT NULL,
  client_timestamp TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  local_document_ref TEXT,
  server_document_number TEXT
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  table_name TEXT PRIMARY KEY,
  last_synced_at TEXT NOT NULL,
  last_server_version INTEGER NOT NULL DEFAULT 0
);

-- Local Entity Tables
CREATE TABLE IF NOT EXISTS local_products (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  name_ar TEXT,
  category_id TEXT,
  unit_id TEXT,
  brand_id TEXT,
  retail_price REAL NOT NULL DEFAULT 0,
  wholesale_price REAL NOT NULL DEFAULT 0,
  purchase_cost REAL NOT NULL DEFAULT 0,
  item_nature TEXT NOT NULL DEFAULT 'physical_stock', -- 'physical_stock', 'service', 'non_stocked'
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  balance REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_inventory (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS local_sales_invoices (
  id TEXT PRIMARY KEY,
  local_document_ref TEXT UNIQUE NOT NULL,
  server_document_number TEXT,
  customer_id TEXT,
  warehouse_id TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'pending_sync', -- 'pending_sync', 'synced', 'rejected'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_sales_invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY(invoice_id) REFERENCES local_sales_invoices(id) ON DELETE CASCADE
);

-- Indexes for lightning fast offline POS barcode lookups
CREATE INDEX IF NOT EXISTS idx_products_barcode ON local_products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON local_products(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_lookup ON local_inventory(product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status, priority);
`;
