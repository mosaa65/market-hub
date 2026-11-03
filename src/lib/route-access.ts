/**
 * مصدر واحد لصلاحيات الصفحات.
 * القائمة الجانبية (app-shell) وحارس الصفحات في _app.tsx يقرآن من هذا الملف،
 * فلا يمكن أن تُخفى صفحة من القائمة وتبقى مفتوحة بالرابط المباشر.
 *
 * القواعد:
 * - superadminOnly: لسوبر أدمن المنصة فقط. المالك ودعم المنصة لا يدخلانها.
 * - allowedRoles: أدوار المنشأة؛ دعم المنصة لا يرث صلاحيات المتجر.
 * - سجل التنقل هو مصدر صلاحيات الصفحات المسجلة؛ القواعد أدناه للتوافق مع
 *   صفحات تشغيلية قديمة لم تدخل السجل بعد.
 * - أي مسار غير معروف يُرفض افتراضيًا.
 */
import { ROUTE_REGISTRY } from "./navigation/route-registry";

export type TenantRole = "owner" | "manager" | "accountant" | "cashier" | "warehouse";

export type RouteAccessRule = {
  superadminOnly?: boolean;
  allowedRoles?: TenantRole[];
};

const FINANCE: TenantRole[] = ["owner", "manager", "accountant"];
const STOCK: TenantRole[] = ["owner", "manager", "accountant", "warehouse"];
const STOCK_OPS: TenantRole[] = ["owner", "manager", "warehouse"];
const SALES: TenantRole[] = ["owner", "manager", "accountant", "cashier"];

export const ROUTE_ACCESS: Record<string, RouteAccessRule> = {
  // لوحة القيادة
  "/analytics": { allowedRoles: FINANCE },
  "/reports": { allowedRoles: FINANCE },
  "/statements": { allowedRoles: FINANCE },

  // المبيعات
  "/pos": { allowedRoles: ["owner", "manager", "cashier"] },
  "/sales": { allowedRoles: SALES },
  "/sales-invoice": { allowedRoles: SALES },
  "/sales-returns": { allowedRoles: SALES },
  "/returns": { allowedRoles: SALES },
  "/customers": { allowedRoles: SALES },
  "/payments": { allowedRoles: FINANCE },
  "/debts": { allowedRoles: FINANCE },
  "/loyalty": { allowedRoles: ["owner", "manager", "cashier"] },

  // المنتجات والمخزون
  "/products": { allowedRoles: STOCK },
  "/inventory": { allowedRoles: STOCK },
  "/catalog": { allowedRoles: STOCK },
  "/barcodes": { allowedRoles: ["owner", "manager", "warehouse", "cashier"] },
  "/settlements": { allowedRoles: STOCK },
  "/transfers": { allowedRoles: STOCK_OPS },
  "/warehouses": { allowedRoles: STOCK_OPS },
  "/batches": { allowedRoles: STOCK_OPS },

  // المطبعة المبسطة: الطحن موقع عمل — القبّان والمستودع والصندوق يحتاجونه.
  "/milling/milling": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse", "cashier"],
  },
  "/milling/manufacture": {
    allowedRoles: ["owner", "manager", "warehouse"],
  },
  "/milling/production-orders": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse"],
  },
  // تقرير أداء القسم: قراءة مالية — المالك والمدير والمحاسب.
  "/milling/performance": {
    allowedRoles: ["owner", "manager", "accountant"],
  },
  // استلام وفواتير: موقع عمل وخدمات وفواتير أجور الطحن — مفتوح للكاشير والمستودع والمحاسبة.
  "/milling/intake": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse", "cashier"],
  },
  // التسليم وكشف الأمانات: تسليم نواتج ومستندات أمانات العميل.
  "/milling/delivery": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse", "cashier"],
  },
  "/milling/customer-statement": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse", "cashier"],
  },
  "/milling/custody-delivery": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse", "cashier"],
  },
  "/milling/products": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse", "cashier"],
  },
  "/purchase-pos": { allowedRoles: STOCK },
  "/purchase-invoice": { allowedRoles: STOCK },
  "/purchases": { allowedRoles: STOCK },
  "/suppliers": { allowedRoles: STOCK },
  "/purchase-returns": { allowedRoles: STOCK },

  // المالية والمحاسبة
  "/expenses": { allowedRoles: FINANCE },
  "/expenses/setup": { allowedRoles: FINANCE },
  "/finance": { allowedRoles: FINANCE },
  "/daily-journal": { allowedRoles: FINANCE },
  "/general-ledger": { allowedRoles: FINANCE },
  "/trial-balance": { allowedRoles: FINANCE },
  "/income-statement": { allowedRoles: FINANCE },
  "/balance-sheet": { allowedRoles: FINANCE },
  // صفحات المحاسبة المتقدمة كانت غائبة كلياً — أي موظف نشط يفتحها بالرابط
  // المباشر رغم أنها مالية بحتة. قواعدها FINANCE صراحةً: المالك والمدير
  // والمحاسب.
  "/opening-balances": { allowedRoles: FINANCE },
  "/supplier-ledger": { allowedRoles: FINANCE },
  "/fiscal-periods": { allowedRoles: FINANCE },
  "/fiscal-year-close": { allowedRoles: FINANCE },
  "/fixed-assets": { allowedRoles: FINANCE },
  "/prepayments": { allowedRoles: FINANCE },
  "/tax-declarations": { allowedRoles: FINANCE },
  "/chart-of-accounts": { allowedRoles: FINANCE },

  // الإدارة
  "/users": { allowedRoles: ["owner"] },
  "/audit": { allowedRoles: ["owner", "manager"] },
  "/settings": {
    allowedRoles: ["owner", "manager", "accountant", "cashier", "warehouse"],
  },
  "/plans": { allowedRoles: ["owner"] },

  // المنصة
  "/platform-admin": { superadminOnly: true },
  "/vortex-ui": { superadminOnly: true },
};

export type AccessContext = {
  roles: TenantRole[];
  isPlatformAdmin: boolean;
  isPlatformSuperadmin: boolean;
  isActive?: boolean;
};

export function normalizeTenantRole(value: unknown): TenantRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "owner" ||
    normalized === "manager" ||
    normalized === "accountant" ||
    normalized === "cashier" ||
    normalized === "warehouse"
  ) {
    return normalized as TenantRole;
  }
  return null;
}

function normalize(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

function queryFromPath(pathname: string): URLSearchParams {
  const query = pathname.split("?")[1];
  return new URLSearchParams(query ?? "");
}

function normalizeSearch(search?: Record<string, unknown>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, String(item));
    } else {
      result.set(key, String(value));
    }
  }
  return result;
}

function combineRegistryRules(entries: typeof ROUTE_REGISTRY): RouteAccessRule {
  if (entries.some((entry) => entry.superadminOnly)) return { superadminOnly: true };
  const roleSets = entries
    .map((entry) => entry.requiredRoles)
    .filter((roles): roles is TenantRole[] => Array.isArray(roles));
  if (roleSets.length === 0) return {};
  const allowedRoles = roleSets.reduce((intersection, roles) =>
    intersection.filter((role) => roles.includes(role)),
  );
  return { allowedRoles };
}

function findRegistryRule(pathname: string, search: URLSearchParams): RouteAccessRule | null {
  const path = normalize(pathname);
  const entries = ROUTE_REGISTRY.filter((entry) => normalize(entry.path) === path);
  if (entries.length === 0) return null;

  const queryEntries = entries.filter((entry) => entry.path.includes("?"));
  const matchingQueryEntries = queryEntries.filter((entry) => {
    const expected = queryFromPath(entry.path);
    return Array.from(expected.entries()).every(([key, value]) => search.get(key) === value);
  });
  if (matchingQueryEntries.length > 0) return combineRegistryRules(matchingQueryEntries);

  const baseEntries = entries.filter((entry) => !entry.path.includes("?"));
  if (baseEntries.length > 0) {
    // For an unrecognized query value, take the stricter rule from the
    // registered query pages so changing a query string cannot shed access checks.
    if (search.size > 0 && queryEntries.length > 0) {
      return combineRegistryRules([...baseEntries, ...queryEntries]);
    }
    return combineRegistryRules(baseEntries);
  }
  return combineRegistryRules(queryEntries);
}

export function getRouteRule(
  pathname: string,
  routeSearch?: Record<string, unknown>,
): RouteAccessRule | undefined {
  const search = queryFromPath(pathname);
  for (const [key, value] of normalizeSearch(routeSearch)) search.set(key, value);
  const registeredRule = findRegistryRule(pathname, search);
  if (registeredRule) return registeredRule;

  const path = normalize(pathname);
  if (ROUTE_ACCESS[path]) return ROUTE_ACCESS[path];
  // أطول بادئة مطابقة لدعم الصفحات الفرعية مثل /expenses/123
  const match = Object.keys(ROUTE_ACCESS)
    .filter((key) => path.startsWith(key + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_ACCESS[match] : undefined;
}

export function canAccessRoute(
  pathname: string,
  ctx: AccessContext,
  routeSearch?: Record<string, unknown>,
): boolean {
  if (ctx.isActive === false) return false;
  const rule = getRouteRule(pathname, routeSearch);
  if (!rule) return false;
  if (rule.superadminOnly) return ctx.isPlatformSuperadmin;
  if (ctx.isPlatformSuperadmin) return true;

  const normalizedRoles = Array.from(
    new Set(
      (ctx.roles ?? [])
        .map((role) => normalizeTenantRole(role))
        .filter((role): role is TenantRole => role !== null),
    ),
  );

  // Role lookup failures and unassigned users must fail closed on restricted routes.
  if (normalizedRoles.length === 0) return false;
  if (!rule.allowedRoles) return true;

  // المالك يملك حق الوصول لجميع صفحات المتجر التشغيلية دون استثناء
  if (normalizedRoles.includes("owner")) return true;

  // المدير يرث صلاحية الوصول لصفحات الكاشير وأمين المستودع
  if (
    normalizedRoles.includes("manager") &&
    (rule.allowedRoles.includes("cashier") || rule.allowedRoles.includes("warehouse"))
  ) {
    return true;
  }

  return rule.allowedRoles.some((role) => normalizedRoles.includes(role));
}
