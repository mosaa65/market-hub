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
  // تقرير أداء القسم: قراءة مالية — المالك والمدير والمحاسب.
  "/milling/performance": {
    allowedRoles: ["owner", "manager", "accountant"],
  },
  // استلام وفواتير: الاستلام للمستودع، وفاتورة أجور الطحن عمل مالي —
  // المحاسب كان محجوباً عنها رغم أنها إصدار فواتير.
  "/milling/intake": {
    allowedRoles: ["owner", "manager", "accountant", "warehouse"],
  },
  // التسليم وكشف الأمانات: موقع عمل يخص المستودع والمالية معاً.
  "/milling/delivery": {
    allowedRoles: ["owner", "manager", "warehouse"],
  },
  "/milling/customer-statement": {
    allowedRoles: STOCK,
  },
  "/milling/custody-delivery": {
    allowedRoles: STOCK,
  },
  "/purchase-pos": { allowedRoles: STOCK },
  "/purchases": { allowedRoles: STOCK },
  "/suppliers": { allowedRoles: STOCK },
  "/purchase-returns": { allowedRoles: STOCK },

  // المالية والمحاسبة
  "/expenses": { allowedRoles: FINANCE },
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
  // Role lookup failures and unassigned users must fail closed on restricted routes.
  if (ctx.roles.length === 0) return false;
  return rule.allowedRoles.some((role) => ctx.roles.includes(role));
}
