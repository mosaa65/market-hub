/**
 * Market-Hub ERP - Offline-First Hybrid Core Architecture Index
 */

export * from "./types";
export * from "./idempotency";
export * from "./storage-adapter";
export * from "./sync-engine";
export * from "./auth-snapshot";
export * from "./db/schema";

// Repositories
export * from "./repositories/base-repository";
export * from "./repositories/reference-repository";
export * from "./repositories/products-repository";
export * from "./repositories/contacts-repository";
export * from "./repositories/inventory-repository";

// Domain Services
export * from "./services/pos-offline-service";
export * from "./services/inventory-offline-service";
export * from "./services/finance-offline-service";
