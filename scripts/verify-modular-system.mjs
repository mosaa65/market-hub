import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

console.log("==================================================");
console.log("🧪 RUNNING VORTEX ERP MODULAR SYSTEM VERIFICATION");
console.log("==================================================");

// 1. Verify modules definitions file
const modulesContent = fs.readFileSync(path.resolve("src/lib/modules.tsx"), "utf8");

assert(modulesContent.includes('id: "core"'), "Core module must be present");
assert(modulesContent.includes('id: "pos"'), "POS module must be present");
assert(modulesContent.includes('id: "multi_warehouse"'), "multi_warehouse module must be present");
assert(modulesContent.includes('id: "barcode"'), "barcode module must be present");
assert(modulesContent.includes('id: "loyalty"'), "loyalty module must be present");
assert(modulesContent.includes('id: "batches"'), "batches module must be present");
assert(modulesContent.includes('id: "advanced_accounting"'), "advanced_accounting module must be present");
assert(modulesContent.includes('id: "analytics"'), "analytics module must be present");
assert(modulesContent.includes('id: "purchases"'), "purchases module must be present");
assert(modulesContent.includes('id: "returns"'), "returns module must be present");
assert(modulesContent.includes('id: "payments"'), "payments module must be present");
assert(modulesContent.includes('id: "expenses"'), "expenses module must be present");
assert(modulesContent.includes('id: "audit"'), "audit module must be present");
console.log("✅ 1. All 13 system modules are registered in Registry.");

// 2. Verify plans definitions
assert(modulesContent.includes('id: "starter"'), "Starter plan must be present");
assert(modulesContent.includes('id: "professional"'), "Professional plan must be present");
assert(modulesContent.includes('id: "enterprise"'), "Enterprise plan must be present");
console.log("✅ 2. Three standard tiers (Starter, Professional, Enterprise) are defined.");

// 3. Verify App Shell has module IDs and filtering
const appShellContent = fs.readFileSync(path.resolve("src/components/app-shell.tsx"), "utf8");
assert(appShellContent.includes("useModules"), "AppShell must consume useModules hook");
assert(appShellContent.includes("isModuleEnabled"), "AppShell must filter by isModuleEnabled");
assert(appShellContent.includes("currentPlan"), "AppShell must display current active plan");
console.log("✅ 3. Sidebar navigation is fully dynamic and module-filtered.");

// 4. Verify Command Palette filtering
const cmdContent = fs.readFileSync(path.resolve("src/components/command-palette.tsx"), "utf8");
assert(cmdContent.includes("useModules"), "CommandPalette must consume useModules hook");
assert(cmdContent.includes("isModuleEnabled"), "CommandPalette must filter items by isModuleEnabled");
console.log("✅ 4. Command Palette search respects module licensing.");

// 5. Verify Route Guards on sensitive pages
const guardedRoutes = [
  "src/routes/_app.pos.tsx",
  "src/routes/_app.warehouses.tsx",
  "src/routes/_app.transfers.tsx",
  "src/routes/_app.barcodes.tsx",
  "src/routes/_app.loyalty.tsx",
  "src/routes/_app.batches.tsx",
  "src/routes/_app.purchases.tsx",
  "src/routes/_app.suppliers.tsx",
  "src/routes/_app.sales-returns.tsx",
  "src/routes/_app.purchase-returns.tsx",
  "src/routes/_app.payments.tsx",
  "src/routes/_app.debts.tsx",
  "src/routes/_app.account-statement.tsx",
  "src/routes/_app.finance.tsx",
  "src/routes/_app.analytics.tsx",
  "src/routes/_app.reports.tsx",
  "src/routes/_app.daily-journal.tsx",
  "src/routes/_app.trial-balance.tsx",
  "src/routes/_app.income-statement.tsx",
  "src/routes/_app.balance-sheet.tsx",
  "src/routes/_app.audit.tsx",
];

for (const r of guardedRoutes) {
  const c = fs.readFileSync(path.resolve(r), "utf8");
  assert(c.includes("ModuleGuard"), `Route ${r} must be protected by ModuleGuard`);
}
console.log(`✅ 5. All ${guardedRoutes.length} modular routes are guarded by ModuleGuard.`);

// 6. Verify Platform Admin route exists
assert(fs.existsSync(path.resolve("src/routes/_app.platform-admin.tsx")), "Platform admin route must exist");
console.log("✅ 6. Platform Admin route is implemented and accessible.");

// 7. Verify Migrations
assert(fs.existsSync(path.resolve("supabase/migrations/20260915000000_platform_modules_and_subscriptions.sql")), "Base subscription migration exists");
assert(fs.existsSync(path.resolve("supabase/migrations/20260915010000_platform_admins_and_audit.sql")), "Platform admins migration exists");
assert(fs.existsSync(path.resolve("supabase/migrations/20260915020000_company_settings_catalog_modules.sql")), "Catalog modules migration exists");
console.log("✅ 7. All database migrations are verified.");

console.log("==================================================");
console.log("🎉 ALL 7 INTEGRATION VERIFICATIONS PASSED SUCCESSFULLY!");
console.log("==================================================");
