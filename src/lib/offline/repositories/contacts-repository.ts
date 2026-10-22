/**
 * Market-Hub ERP - Contacts Offline Repository (Customers & Suppliers)
 */

import { BaseRepository } from "./base-repository";

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  credit_limit: number;
  balance: number;
  is_active: boolean;
  updated_at?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
  balance: number;
  is_active: boolean;
  updated_at?: string;
}

export class CustomersRepository extends BaseRepository<Customer> {
  constructor() {
    super("customers");
  }

  async searchCustomers(query: string): Promise<Customer[]> {
    const term = query.trim().toLowerCase();
    if (!term) return this.getAll();
    return this.getAll((c) =>
      Boolean(c.name.toLowerCase().includes(term) || (c.phone && c.phone.includes(term))),
    );
  }
}

export class SuppliersRepository extends BaseRepository<Supplier> {
  constructor() {
    super("suppliers");
  }

  async searchSuppliers(query: string): Promise<Supplier[]> {
    const term = query.trim().toLowerCase();
    if (!term) return this.getAll();
    return this.getAll((s) =>
      Boolean(s.name.toLowerCase().includes(term) || (s.phone && s.phone.includes(term))),
    );
  }
}

export const customersRepo = new CustomersRepository();
export const suppliersRepo = new SuppliersRepository();
