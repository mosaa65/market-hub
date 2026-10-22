import { canAccessRoute, getRouteRule } from "./route-access";
import { ROUTE_REGISTRY } from "./navigation/route-registry";

const financeRoute = "/opening-balances";
const standardRoute = "/dashboard";
const platformAccess = {
  roles: [],
  isPlatformAdmin: false,
  isPlatformSuperadmin: false,
};

const cases: Array<[string, boolean]> = [
  ["empty role list is denied on financial routes", !canAccessRoute(financeRoute, platformAccess)],
  ["cashier is denied on financial routes", !canAccessRoute(financeRoute, { ...platformAccess, roles: ["cashier"] })],
  ["warehouse is denied on financial routes", !canAccessRoute(financeRoute, { ...platformAccess, roles: ["warehouse"] })],
  ["accountant is allowed on financial routes", canAccessRoute(financeRoute, { ...platformAccess, roles: ["accountant"] })],
  ["owner is allowed on financial routes", canAccessRoute(financeRoute, { ...platformAccess, roles: ["owner"] })],
  ["unrestricted routes remain accessible without roles", canAccessRoute(standardRoute, platformAccess)],
  ["platform support can access financial routes", canAccessRoute(financeRoute, { ...platformAccess, isPlatformAdmin: true })],
];

for (const entry of ROUTE_REGISTRY.filter((route) => route.category === "finance" && route.requiredRoles)) {
  const declared = [...(entry.requiredRoles ?? [])].sort().join(",");
  const guarded = [...(getRouteRule(entry.path)?.allowedRoles ?? [])].sort().join(",");
  cases.push([`navigation and direct-route roles agree for ${entry.path}`, declared === guarded]);
}

const failed = cases.filter(([, passed]) => !passed);
for (const [name, passed] of cases) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length > 0) process.exitCode = 1;