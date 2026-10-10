/**
 * مصدر واحد لصلاحيات الصفحات.
 * القائمة الجانبية (app-shell) وحارس الصفحات في _app.tsx يقرآن من هذا الملف،
 * فلا يمكن أن تُخفى صفحة من القائمة وتبقى مفتوحة بالرابط المباشر.
 *
 * القواعد:
 * - superadminOnly: لمدراء المنصة فقط. المالك لا يدخلها.
 * - allowedRoles: أدوار المنشأة المسموح لها. مدير المنصة يتجاوزها لأغراض الدعم.
 * - صفحة غير مذكورة هنا = مفتوحة لكل موظف نشط (لوحة التحكم، الإشعارات).
 */
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

  // المبيعات
  "/pos": { allowedRoles: ["owner", "manager", "cashier"] },
  "/sales": { allowedRoles: SALES },
  "/sales-invoice": { allowedRoles: SALES },
  "/sales-returns": { allowedRoles: SALES },
  "/returns": { allowedRoles: SALES },
  "/customers": { allowedRoles: SALES },
  "/payments": { allowedRoles: FINANCE },
  "/debts": { allowedRoles: FINANCE },
  "/account-statement": { allowedRoles: FINANCE },
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

  // The express counter is a gate position: whoever weighs and receives grain
  // needs it, which includes the cashier, so it is deliberately wider than the
  // rest of the milling module.
  "/milling-counter": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse", "cashier"],
  },
  "/purchase-pos": { allowedRoles: STOCK },
  "/purchases": { allowedRoles: STOCK },
  "/suppliers": { allowedRoles: STOCK },
  "/purchase-returns": { allowedRoles: STOCK },

  // المالية والمحاسبة
  "/expenses": { allowedRoles: FINANCE },
  "/finance": { allowedRoles: FINANCE },
  "/daily-journal": { allowedRoles: FINANCE },
  "/trial-balance": { allowedRoles: FINANCE },
  "/income-statement": { allowedRoles: FINANCE },
  "/balance-sheet": { allowedRoles: FINANCE },

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
};

function normalize(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

export function getRouteRule(pathname: string): RouteAccessRule | undefined {
  const path = normalize(pathname);
  if (ROUTE_ACCESS[path]) return ROUTE_ACCESS[path];
  // أطول بادئة مطابقة لدعم الصفحات الفرعية مثل /expenses/123
  const match = Object.keys(ROUTE_ACCESS)
    .filter((key) => path.startsWith(key + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_ACCESS[match] : undefined;
}

export function canAccessRoute(pathname: string, ctx: AccessContext): boolean {
  const rule = getRouteRule(pathname);
  if (!rule) return true;
  const isPlatform = ctx.isPlatformAdmin || ctx.isPlatformSuperadmin;
  if (rule.superadminOnly) return isPlatform;
  if (!rule.allowedRoles) return true;
  if (isPlatform) return true;
  // If user has no roles assigned yet (e.g. dev mode or new user), allow access to standard routes
  if (ctx.roles.length === 0) return true;
  return rule.allowedRoles.some((role) => ctx.roles.includes(role));
}
