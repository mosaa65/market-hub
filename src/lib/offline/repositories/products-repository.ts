/**
 * Market-Hub ERP - Products Offline Repository
 * Provides offline product search, barcode scanning, and catalog caching.
 */

import { BaseRepository } from "./base-repository";

export interface Product {
  id: string;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  name_ar?: string | null;
  category_id?: string | null;
  unit_id?: string | null;
  brand_id?: string | null;
  retail_price: number;
  wholesale_price: number;
  purchase_cost: number;
  item_nature: "physical_stock" | "service" | "non_stocked";
  is_active: boolean;
  updated_at?: string;
}

export class ProductsRepository extends BaseRepository<Product> {
  constructor() {
    super("products");
  }

  /**
   * Fast offline search by Barcode or SKU
   */
  async findByBarcodeOrSku(code: string): Promise<Product | null> {
    const cleanCode = code.trim();
    if (!cleanCode) return null;

    const products = await this.getAll();
    return products.find((p) => p.barcode === cleanCode || p.sku === cleanCode) || null;
  }

  /**
   * Search products by query term
   */
  async searchProducts(query: string): Promise<Product[]> {
    const term = query.trim().toLowerCase();
    if (!term) return this.getAll();

    return this.getAll((p) =>
      Boolean(
        p.name.toLowerCase().includes(term) ||
        (p.name_ar && p.name_ar.toLowerCase().includes(term)) ||
        (p.sku && p.sku.toLowerCase().includes(term)) ||
        (p.barcode && p.barcode.includes(term)),
      ),
    );
  }
}

export const productsRepo = new ProductsRepository();
