/**
 * Market-Hub ERP - Reference Data Repositories
 * Provides data access abstraction for Categories, Brands, Units, and Warehouses.
 */

import { BaseRepository } from "./base-repository";

export interface Category {
  id: string;
  name: string;
  name_ar?: string | null;
  created_at?: string;
}

export interface Brand {
  id: string;
  name: string;
  name_ar?: string | null;
  created_at?: string;
}

export interface Unit {
  id: string;
  name: string;
  name_ar?: string | null;
  short_name?: string | null;
  created_at?: string;
}

export interface Warehouse {
  id: string;
  name: string;
  name_ar?: string | null;
  is_active?: boolean;
  created_at?: string;
}

export class CategoriesRepository extends BaseRepository<Category> {
  constructor() {
    super("categories");
  }
}

export class BrandsRepository extends BaseRepository<Brand> {
  constructor() {
    super("brands");
  }
}

export class UnitsRepository extends BaseRepository<Unit> {
  constructor() {
    super("units");
  }
}

export class WarehousesRepository extends BaseRepository<Warehouse> {
  constructor() {
    super("warehouses");
  }

  async getActiveWarehouses(): Promise<Warehouse[]> {
    return this.getAll((w) => w.is_active !== false);
  }
}

export const categoriesRepo = new CategoriesRepository();
export const brandsRepo = new BrandsRepository();
export const unitsRepo = new UnitsRepository();
export const warehousesRepo = new WarehousesRepository();
