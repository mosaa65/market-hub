## Table `profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `full_name` | `text` |  Nullable |
| `avatar_url` | `text` |  Nullable |
| `phone` | `text` |  Nullable |
| `language` | `text` |  |
| `theme` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `user_roles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `role` | `app_role` |  
| `created_at` | `timestamptz` |  |

## Table `company_settings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int4` | Primary |
| `name` | `text` |  |
| `legal_name` | `text` |  Nullable |
| `tax_number` | `text` |  Nullable |
| `currency` | `text` |  |
| `currency_symbol` | `text` |  |
| `tax_rate` | `numeric` |  |
| `logo_url` | `text` |  Nullable |
| `address` | `text` |  Nullable |
| `phone` | `text` |  Nullable |
| `email` | `text` |  Nullable |
| `invoice_prefix` | `text` |  |
| `barcode_enabled` | `bool` |  |
| `updated_at` | `timestamptz` |  |
| `enforce_customer_credit_limit` | `bool` |  |
| `catalog_modules` | `jsonb` |  |

## Table `warehouses`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `code` | `text` |  Nullable Unique |
| `address` | `text` |  Nullable |
| `is_default` | `bool` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `name_ar` | `text` |  Nullable |

## Table `categories`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `name_ar` | `text` |  Nullable |
| `parent_id` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `brands`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `created_at` | `timestamptz` |  |
| `name_ar` | `text` |  Nullable |

## Table `units`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `short_name` | `text` |  |
| `created_at` | `timestamptz` |  |
| `name_ar` | `text` |  Nullable |

## Table `products`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `sku` | `text` |  Nullable Unique |
| `barcode` | `text` |  Nullable Unique |
| `name` | `text` |  |
| `name_ar` | `text` |  Nullable |
| `description` | `text` |  Nullable |
| `image_url` | `text` |  Nullable |
| `category_id` | `uuid` |  Nullable |
| `brand_id` | `uuid` |  Nullable |
| `unit_id` | `uuid` |  Nullable |
| `cost_price` | `numeric` |  |
| `sale_price` | `numeric` |  |
| `tax_rate` | `numeric` |  |
| `min_stock` | `numeric` |  |
| `track_expiry` | `bool` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `shelf_location` | `text` |  Nullable |
| `is_service` | `bool` |  |
| `origin_id` | `uuid` |  Nullable |
| `quality_grade_id` | `uuid` |  Nullable |

## Table `inventory`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `product_id` | `uuid` |  |
| `warehouse_id` | `uuid` |  |
| `quantity` | `numeric` |  |
| `updated_at` | `timestamptz` |  |

## Table `stock_movements`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `product_id` | `uuid` |  |
| `warehouse_id` | `uuid` |  |
| `movement_type` | `movement_type` |  |
| `quantity` | `numeric` |  |
| `unit_cost` | `numeric` |  Nullable |
| `reference` | `text` |  Nullable |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `reference_type` | `text` |  Nullable |
| `reference_id` | `uuid` |  Nullable |

## Table `customers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `phone` | `text` |  Nullable |
| `email` | `text` |  Nullable |
| `address` | `text` |  Nullable |
| `credit_limit` | `numeric` |  |
| `balance` | `numeric` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `loyalty_points` | `numeric` |  |

## Table `suppliers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `phone` | `text` |  Nullable |
| `email` | `text` |  Nullable |
| `address` | `text` |  Nullable |
| `balance` | `numeric` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `sales_invoices`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `invoice_number` | `text` |  Unique |
| `customer_id` | `uuid` |  Nullable |
| `warehouse_id` | `uuid` |  Nullable |
| `status` | `invoice_status` |  |
| `subtotal` | `numeric` |  |
| `discount` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |
| `paid` | `numeric` |  |
| `payment_method` | `payment_method` |  Nullable |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `sales_invoice_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `invoice_id` | `uuid` |  |
| `product_id` | `uuid` |  Nullable |
| `quantity` | `numeric` |  |
| `unit_price` | `numeric` |  |
| `discount` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |
| `description` | `text` |  Nullable |

## Table `purchase_invoices`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `invoice_number` | `text` |  Unique |
| `supplier_id` | `uuid` |  Nullable |
| `warehouse_id` | `uuid` |  Nullable |
| `status` | `invoice_status` |  |
| `subtotal` | `numeric` |  |
| `discount` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |
| `paid` | `numeric` |  |
| `payment_method` | `payment_method` |  Nullable |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `purchase_invoice_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `invoice_id` | `uuid` |  |
| `product_id` | `uuid` |  |
| `quantity` | `numeric` |  |
| `unit_cost` | `numeric` |  |
| `discount` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |

## Table `expense_categories`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  Unique |
| `name_ar` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `expenses`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `category_id` | `uuid` |  Nullable |
| `amount` | `numeric` |  |
| `payment_method` | `payment_method` |  |
| `expense_date` | `date` |  |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `sales_returns`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `return_number` | `text` |  Unique |
| `invoice_id` | `uuid` |  Nullable |
| `customer_id` | `uuid` |  Nullable |
| `warehouse_id` | `uuid` |  |
| `subtotal` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |
| `refund_method` | `payment_method` |  Nullable |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `sales_return_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `return_id` | `uuid` |  |
| `product_id` | `uuid` |  |
| `quantity` | `numeric` |  |
| `unit_price` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |

## Table `purchase_returns`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `return_number` | `text` |  Unique |
| `invoice_id` | `uuid` |  Nullable |
| `supplier_id` | `uuid` |  Nullable |
| `warehouse_id` | `uuid` |  |
| `subtotal` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |
| `refund_method` | `payment_method` |  Nullable |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `purchase_return_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `return_id` | `uuid` |  |
| `product_id` | `uuid` |  |
| `quantity` | `numeric` |  |
| `unit_cost` | `numeric` |  |
| `tax` | `numeric` |  |
| `total` | `numeric` |  |

## Table `stock_transfers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `transfer_number` | `text` |  Unique |
| `from_warehouse_id` | `uuid` |  |
| `to_warehouse_id` | `uuid` |  |
| `status` | `text` |  |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `stock_transfer_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `transfer_id` | `uuid` |  |
| `product_id` | `uuid` |  |
| `quantity` | `numeric` |  |

## Table `product_batches`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `product_id` | `uuid` |  |
| `warehouse_id` | `uuid` |  |
| `batch_number` | `text` |  |
| `expiry_date` | `date` |  Nullable |
| `quantity` | `numeric` |  |
| `unit_cost` | `numeric` |  |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `audit_logs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `actor_id` | `uuid` |  Nullable |
| `action` | `text` |  |
| `entity_type` | `text` |  |
| `entity_id` | `uuid` |  Nullable |
| `payload` | `jsonb` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `loyalty_transactions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `customer_id` | `uuid` |  |
| `points` | `numeric` |  |
| `kind` | `text` |  |
| `reference_type` | `text` |  Nullable |
| `reference_id` | `uuid` |  Nullable |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `customer_payments`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `customer_id` | `uuid` |  |
| `invoice_id` | `uuid` |  Nullable |
| `amount` | `numeric` |  |
| `payment_method` | `payment_method` |  |
| `payment_date` | `date` |  |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `countries_of_origin`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `code` | `bpchar` |  Unique |
| `name` | `text` |  |
| `name_ar` | `text` |  |

## Table `quality_grades`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `code` | `text` |  Unique |
| `name` | `text` |  |
| `name_ar` | `text` |  |
| `sort_order` | `int4` |  |

## Table `vehicle_makes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  Unique |
| `name_ar` | `text` |  |

## Table `vehicle_models`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `make_id` | `uuid` |  |
| `name` | `text` |  |
| `name_ar` | `text` |  Nullable |

## Table `product_compatibilities`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `product_id` | `uuid` | Primary |
| `vehicle_model_id` | `uuid` | Primary |

## Table `customer_ledger`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `customer_id` | `uuid` |  |
| `entry_type` | `text` |  |
| `debit` | `numeric` |  |
| `credit` | `numeric` |  |
| `reference_id` | `uuid` |  Nullable |
| `reference_type` | `text` |  Nullable |
| `occurred_at` | `timestamptz` |  |
| `created_by` | `uuid` |  Nullable |
| `note` | `text` |  Nullable |
| `source_key` | `text` |  Nullable Unique |

## Table `platform_modules`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `name` | `jsonb` |  |
| `description` | `jsonb` |  Nullable |
| `category` | `text` |  |
| `dependencies` | `_text` |  |
| `nav_items` | `_text` |  |
| `routes` | `_text` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |

## Table `platform_plans`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `name` | `jsonb` |  |
| `description` | `jsonb` |  Nullable |
| `modules` | `_text` |  |
| `max_users` | `int4` |  |
| `max_warehouses` | `int4` |  |
| `max_products` | `int4` |  Nullable |
| `price_monthly` | `numeric` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |

## Table `tenant_subscriptions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `text` |  Unique |
| `plan_id` | `text` |  |
| `extra_modules` | `_text` |  |
| `disabled_modules` | `_text` |  |
| `status` | `text` |  |
| `started_at` | `timestamptz` |  |
| `expires_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `platform_admins`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Unique |
| `role` | `text` |  |
| `is_active` | `bool` |  |
| `mfa_required` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `last_login` | `timestamptz` |  Nullable |

## Table `platform_audit_logs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `admin_id` | `uuid` |  Nullable |
| `user_id` | `uuid` |  Nullable |
| `action` | `text` |  |
| `target_tenant_id` | `text` |  Nullable |
| `payload` | `jsonb` |  Nullable |
| `ip_address` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Custom Types / Enums

### `app_role`

`owner` | `manager` | `accountant` | `cashier` | `warehouse`

### `invoice_status`

`draft` | `confirmed` | `paid` | `partial` | `cancelled` | `returned` | `received` | `completed` | `unpaid`

### `payment_method`

`cash` | `card` | `bank_transfer` | `credit` | `mobile_money`

### `movement_type`

`purchase` | `sale` | `adjustment` | `transfer_in` | `transfer_out` | `return_in` | `return_out` | `opening` | `purchase_return` | `sale_return`

## RLS Policies

### `profiles`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `profiles_self_update` | UPDATE | authenticated | PERMISSIVE | `(id = auth.uid())` | — |
| `profiles_self_insert` | INSERT | authenticated | PERMISSIVE | — | `(id = auth.uid())` |
| `profiles read` | SELECT | authenticated | PERMISSIVE | `((id = auth.uid()) OR has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | — |

### `user_roles`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `roles_self_view` | SELECT | authenticated | PERMISSIVE | `((user_id = auth.uid()) OR has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | — |
| `owner manage roles ins` | INSERT | authenticated | PERMISSIVE | — | `has_role(auth.uid(), 'owner'::app_role)` |
| `owner manage roles upd` | UPDATE | authenticated | PERMISSIVE | `has_role(auth.uid(), 'owner'::app_role)` | `has_role(auth.uid(), 'owner'::app_role)` |
| `owner manage roles del` | DELETE | authenticated | PERMISSIVE | `has_role(auth.uid(), 'owner'::app_role)` | — |

### `company_settings`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `company_view` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `company_update` | UPDATE | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | — |
| `company insert` | INSERT | authenticated | PERMISSIVE | — | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `warehouses`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `wh_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `wh_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `categories`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cat_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `cat_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `expenses`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff write expenses` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |
| `staff read expenses` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |

### `brands`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `brand_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `brand_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `units`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `unit_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `unit_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `products`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `prod_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `prod_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` |

### `sales_returns`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff read sret` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `staff write sret` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `inventory`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `inv_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `inv_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` |

### `stock_movements`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `mv_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `mv_insert` | INSERT | authenticated | PERMISSIVE | — | `is_staff(auth.uid())` |

### `customers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cust_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `cust_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))` |

### `suppliers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `supp_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `supp_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))` |

### `sales_return_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff read sret_i` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `staff write sret_i` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `sales_invoices`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `sale_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |

### `sales_invoice_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `sale_item_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |

### `purchase_invoices`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `pur_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `pur_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` |

### `purchase_invoice_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `pur_item_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `pur_item_manage` | ALL | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))` |

### `expense_categories`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff read expense cats` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `staff write expense cats` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `purchase_returns`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff read pret` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `staff write pret` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `purchase_return_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff read pret_i` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `staff write pret_i` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `stock_transfers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff read xfer` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `staff write xfer` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `stock_transfer_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff read xfer_i` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `staff write xfer_i` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `product_batches`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Staff read batches` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `Staff write batches` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `is_staff(auth.uid())` |

### `audit_logs`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Staff insert audit` | INSERT | authenticated | PERMISSIVE | — | `is_staff(auth.uid())` |
| `Owners/managers read audit` | SELECT | authenticated | PERMISSIVE | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` | — |

### `loyalty_transactions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Staff read loyalty` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |
| `Staff write loyalty` | INSERT | authenticated | PERMISSIVE | — | `is_staff(auth.uid())` |

### `customer_payments`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff_view_customer_payments` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |

### `countries_of_origin`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `origin_staff` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `quality_grades`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `quality_staff` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `vehicle_makes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `make_staff` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `vehicle_models`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `model_staff` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `product_compatibilities`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `fitment_staff` | ALL | authenticated | PERMISSIVE | `is_staff(auth.uid())` | `(has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role))` |

### `customer_ledger`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `customer_ledger_view` | SELECT | authenticated | PERMISSIVE | `is_staff(auth.uid())` | — |

### `platform_modules`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `platform_modules_read` | SELECT | authenticated | PERMISSIVE | `true` | — |

### `platform_plans`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `platform_plans_read` | SELECT | authenticated | PERMISSIVE | `true` | — |

### `tenant_subscriptions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `tenant_subscriptions_read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `tenant_subscriptions_update` | UPDATE | authenticated | PERMISSIVE | `is_platform_admin(auth.uid())` | `is_platform_admin(auth.uid())` |
| `tenant_subscriptions_insert` | INSERT | authenticated | PERMISSIVE | — | `is_platform_admin(auth.uid())` |

### `platform_admins`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `platform_admins_select` | SELECT | authenticated | PERMISSIVE | `is_platform_admin(auth.uid())` | — |
| `platform_admins_manage` | ALL | authenticated | PERMISSIVE | `is_platform_superadmin(auth.uid())` | `is_platform_superadmin(auth.uid())` |

### `platform_audit_logs`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `platform_audit_logs_select` | SELECT | authenticated | PERMISSIVE | `is_platform_admin(auth.uid())` | — |
| `platform_audit_logs_insert` | INSERT | authenticated | PERMISSIVE | — | `(is_platform_admin(auth.uid()) OR (auth.uid() IS NOT NULL))` |

