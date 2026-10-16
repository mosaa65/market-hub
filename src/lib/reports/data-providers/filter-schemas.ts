/**
 * Vortex ERP — مخططات التحقق من فلاتر التقارير باستخدام Zod
 * المرحلة 2: REP-011
 */

import { z } from 'zod';

export const DateRangeFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50),
});

export const SortSchema = z.object({
  field: z.string(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const SalesRegisterFilterSchema = DateRangeFilterSchema.extend({
  customerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.string().optional(),
  paymentMethod: z.string().optional(),
  search: z.string().optional(),
});

export type SalesRegisterFilters = z.infer<typeof SalesRegisterFilterSchema>;

export const InventoryMovementsFilterSchema = DateRangeFilterSchema.extend({
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  movementType: z.string().optional(),
  search: z.string().optional(),
});

export type InventoryMovementsFilters = z.infer<typeof InventoryMovementsFilterSchema>;

export const PurchaseRegisterFilterSchema = DateRangeFilterSchema.extend({
  supplierId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

export type PurchaseRegisterFilters = z.infer<typeof PurchaseRegisterFilterSchema>;
