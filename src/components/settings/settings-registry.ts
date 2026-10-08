import React from "react";
import {
  Building2,
  Receipt,
  Printer,
  SlidersHorizontal,
  Crown,
  Languages,
  Hash,
  ShieldCheck,
  Scale,
  Boxes,
  LucideIcon,
} from "lucide-react";
import { CompanySection } from "./sections/company-section";
import { InvoicingSection } from "./sections/invoicing-section";
import { PrintingSection } from "./sections/printing-section";
import { CatalogSection } from "./sections/catalog-section";
import { StockSettingsSection } from "./sections/stock-settings-section";
import { MillingModeSection } from "./sections/milling-mode-section";
import { SubscriptionSection } from "./sections/subscription-section";
import { AppearanceSection } from "./sections/appearance-section";
import { NumberFormatSection } from "./sections/number-format-section";
import { BackupSettingsCard } from "@/components/backup-settings-card";

export type SettingsSectionId =
  | "company"
  | "invoicing"
  | "printing"
  | "catalog"
  | "stock-settings"
  | "subscription"
  | "backup"
  | "number-format"
  | "appearance"
  | string;

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: LucideIcon;
  badgeAr?: string;
  badgeEn?: string;
  component: React.ComponentType<any>;
}

const registry = new Map<SettingsSectionId, SettingsSectionMeta>();

export function registerSettingsSection(meta: SettingsSectionMeta) {
  registry.set(meta.id, meta);
}

export function getRegisteredSettingsSections(): SettingsSectionMeta[] {
  return Array.from(registry.values());
}

export function getSettingsSection(id: SettingsSectionId): SettingsSectionMeta | undefined {
  return registry.get(id);
}

// Register built-in ERP settings sections
registerSettingsSection({
  id: "company",
  titleAr: "معلومات المنشأة",
  titleEn: "Company Profile",
  descriptionAr: "الاسم التجاري، السجل الضريبي، الهاتف، والعنوان",
  descriptionEn: "Store name, tax ID, phone, and address",
  icon: Building2,
  component: CompanySection,
});

registerSettingsSection({
  id: "invoicing",
  titleAr: "الفواتير والعملة",
  titleEn: "Invoicing & POS",
  descriptionAr: "العملة والضريبة وترقيم الفواتير والشعار وخيارات السلة",
  descriptionEn: "Currency, tax, invoice numbering, logo, and POS cart options",
  icon: Receipt,
  component: InvoicingSection,
});

registerSettingsSection({
  id: "printing",
  titleAr: "الطباعة والقوالب",
  titleEn: "Printing Architecture",
  descriptionAr: "القوالب الافتراضية، حجم الورق، والطباعة التلقائية",
  descriptionEn: "Default templates, paper size, and auto print",
  icon: Printer,
  component: PrintingSection,
});

registerSettingsSection({
  id: "catalog",
  titleAr: "تخصيص النشاط",
  titleEn: "Catalog & Modules",
  descriptionAr: "نمط المتجر وتوافق القطع والموديولات المفعلة",
  descriptionEn: "Store industry profile and active catalog modules",
  icon: SlidersHorizontal,
  component: CatalogSection,
});

registerSettingsSection({
  id: "stock-settings",
  titleAr: "إعدادات المخزون والرموز (Stacks)",
  titleEn: "Stock & Stacks Settings",
  descriptionAr: "التحكم ببادئات الرموز (SKU, Stacks)، قواعد الترقيم، والتنبيهات المخزنية",
  descriptionEn: "Manage stock prefixes (SKU, Stacks), numbering rules, and stock thresholds",
  icon: Boxes,
  component: StockSettingsSection,
});

registerSettingsSection({
  id: "milling-mode",
  titleAr: "نمط تشغيل المطحنة (Super Admin)",
  titleEn: "Milling Operational Mode",
  descriptionAr: "التحكم في ظهور المطحنة: منشأة عادية (سوبرماركت)، الخطة المبسطة، أو التصنيع",
  descriptionEn: "Configure store identity: General Store, Simplified Mill, or Manufacturing",
  icon: Scale,
  badgeAr: "سوبر أدمن",
  badgeEn: "Super Admin",
  component: MillingModeSection,
});

registerSettingsSection({
  id: "subscription",
  titleAr: "الباقة والاشتراك",
  titleEn: "Subscription & Plan",
  descriptionAr: "استهلاك الموارد، حدود الباقة، وموديولات النظام",
  descriptionEn: "Resource usage, plan limits, and system modules",
  icon: Crown,
  badgeAr: "مؤسسات",
  badgeEn: "Enterprise",
  component: SubscriptionSection,
});

registerSettingsSection({
  id: "backup",
  titleAr: "النسخ الاحتياطي",
  titleEn: "Backup & Restore",
  descriptionAr: "إعدادات النسخ الاحتياطي والسجل والاستعادة",
  descriptionEn: "Backup settings, history, and restore",
  icon: ShieldCheck,
  component: BackupSettingsCard,
});

registerSettingsSection({
  id: "number-format",
  titleAr: "نظام الأرقام",
  titleEn: "Number Format",
  descriptionAr: "اختيار نمط الأرقام المستخدم في النظام",
  descriptionEn: "Choose the digit style used across the system",
  icon: Hash,
  component: NumberFormatSection,
});

registerSettingsSection({
  id: "appearance",
  titleAr: "المظهر واللغة",
  titleEn: "Appearance & Language",
  descriptionAr: "لغة الواجهة الرئيسية لبرنامج فورتيكس ERP",
  descriptionEn: "Interface language and layout direction",
  icon: Languages,
  component: AppearanceSection,
});
