import { canAccessRoute, getRouteRule, type TenantRole } from "./route-access";
import { ROUTE_REGISTRY } from "./navigation/route-registry";

const baseContext = {
  roles: ["cashier"] as TenantRole[],
  isPlatformAdmin: false,
  isPlatformSuperadmin: false,
  isActive: true,
};

const cases: Array<[string, boolean]> = [
  ["signed-in active staff can open the dashboard", canAccessRoute("/dashboard", baseContext)],
  [
    "active but unassigned users are denied on all staff routes",
    !canAccessRoute("/dashboard", { ...baseContext, roles: [] }),
  ],
  ["unknown direct routes are denied", !canAccessRoute("/unregistered-secret", baseContext)],
  [
    "inactive accounts cannot open even public staff routes",
    !canAccessRoute("/dashboard", { ...baseContext, isActive: false }),
  ],
  [
    "unassigned users are denied on finance routes",
    !canAccessRoute("/opening-balances", baseContext),
  ],
  [
    "cashier is denied on finance routes",
    !canAccessRoute("/opening-balances", { ...baseContext, roles: ["cashier"] }),
  ],
  [
    "accountant is allowed on finance routes",
    canAccessRoute("/opening-balances", { ...baseContext, roles: ["accountant"] }),
  ],
  [
    "support admin does not bypass tenant roles",
    !canAccessRoute("/opening-balances", { ...baseContext, isPlatformAdmin: true }),
  ],
  [
    "support admin cannot open superadmin-only pages",
    !canAccessRoute("/platform-admin", { ...baseContext, isPlatformAdmin: true }),
  ],
  [
    "platform superadmin can open superadmin-only pages",
    canAccessRoute("/platform-admin", { ...baseContext, isPlatformSuperadmin: true }),
  ],
  [
    "store owner cannot open the host infrastructure console",
    !canAccessRoute("/infrastructure", { ...baseContext, roles: ["owner"] }),
  ],
  [
    "active platform superadmin can open the host infrastructure console",
    canAccessRoute("/infrastructure", { ...baseContext, isPlatformSuperadmin: true }),
  ],
  [
    "settings query parameters keep their registered access rule",
    JSON.stringify(getRouteRule("/settings", { section: "backup" })) ===
      JSON.stringify(getRouteRule("/settings?section=backup")),
  ],
];

for (const entry of ROUTE_REGISTRY) {
  const rule = getRouteRule(entry.path);
  const expected = [...(entry.requiredRoles ?? [])].sort();
  const actual = [...(rule?.allowedRoles ?? [])].sort();
  cases.push([
    `registered role rules match the direct-route guard for ${entry.path}`,
    Boolean(rule) &&
      Boolean(entry.superadminOnly) === Boolean(rule?.superadminOnly) &&
      JSON.stringify(actual) === JSON.stringify(expected),
  ]);

  for (const role of entry.requiredRoles ?? []) {
    cases.push([
      `${role} can open assigned route ${entry.path}`,
      canAccessRoute(entry.path, { ...baseContext, roles: [role] }),
    ]);
  }
}

const failed = cases.filter(([, passed]) => !passed);
for (const [name, passed] of cases) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length > 0) process.exitCode = 1;
