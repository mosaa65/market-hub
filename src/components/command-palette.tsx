import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useModules } from "@/lib/modules";
import {
  LayoutDashboard,
  ScanBarcode,
  Package,
  Warehouse,
  Receipt,
  Truck,
  Users,
  Building2,
  Wallet,
  BarChart3,
  Settings,
  Bell,
  ShieldCheck,
  RotateCcw,
  ArrowRightLeft,
  CalendarClock,
  Barcode,
  Gift,
  History,
  Layers,
  Boxes,
  HandCoins,
  AlertTriangle,
  FileText,
  BookOpen,
  Scale,
  Landmark,
  PieChart,
  LineChart,
  Crown,
  ClipboardList,
} from "lucide-react";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { isPlatformAdmin } = useAuth();
  const { isModuleEnabled } = useModules();
  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("common.search")} />
      <CommandList>
        <CommandEmpty>{t("common.no_results")}</CommandEmpty>

        {/* Operations */}
        <CommandGroup heading={t("common.navigate")}>
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard /> {t("nav.dashboard")}
          </CommandItem>
          {isModuleEnabled("analytics") && (
            <CommandItem onSelect={() => go("/analytics")}>
              <LineChart /> {t("nav.analytics")}
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/plans")}>
            <Crown className="text-amber-500" /> {t("nav.plans")}
          </CommandItem>
          {isModuleEnabled("pos") && (
            <CommandItem onSelect={() => go("/pos")}>
              <ScanBarcode /> {t("nav.pos")}
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/products")}>
            <Package /> {t("nav.products")}
          </CommandItem>
          <CommandItem onSelect={() => go("/inventory")}>
            <Warehouse /> {t("nav.inventory")}
          </CommandItem>
          {isModuleEnabled("multi_warehouse") && (
            <CommandItem onSelect={() => go("/warehouses")}>
              <Boxes /> {t("nav.warehouses")}
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/catalog")}>
            <Layers /> {t("nav.catalog")}
          </CommandItem>
          <CommandItem onSelect={() => go("/sales")}>
            <Receipt /> {t("nav.sales")}
          </CommandItem>
          {isModuleEnabled("returns") && (
            <CommandItem onSelect={() => go("/sales-returns")}>
              <RotateCcw /> {t("nav.sales_returns")}
            </CommandItem>
          )}
          {isModuleEnabled("purchases") && (
            <CommandItem onSelect={() => go("/purchases")}>
              <Truck /> {t("nav.purchases")}
            </CommandItem>
          )}
          {isModuleEnabled("returns") && (
            <CommandItem onSelect={() => go("/purchase-returns")}>
              <RotateCcw /> {t("nav.purchase_returns")}
            </CommandItem>
          )}
          {isModuleEnabled("multi_warehouse") && (
            <CommandItem onSelect={() => go("/transfers")}>
              <ArrowRightLeft /> {t("nav.transfers")}
            </CommandItem>
          )}
          {isModuleEnabled("batches") && (
            <CommandItem onSelect={() => go("/batches")}>
              <CalendarClock /> {t("nav.batches")}
            </CommandItem>
          )}
          {isModuleEnabled("barcode") && (
            <CommandItem onSelect={() => go("/barcodes")}>
              <Barcode /> {t("nav.barcodes")}
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/customers")}>
            <Users /> {t("nav.customers")}
          </CommandItem>
          {isModuleEnabled("loyalty") && (
            <CommandItem onSelect={() => go("/loyalty")}>
              <Gift /> {t("nav.loyalty")}
            </CommandItem>
          )}
          {isModuleEnabled("purchases") && (
            <CommandItem onSelect={() => go("/suppliers")}>
              <Building2 /> {t("nav.suppliers")}
            </CommandItem>
          )}
        </CommandGroup>

        {/* Accounting & Finance */}
        {(isModuleEnabled("payments") ||
          isModuleEnabled("expenses") ||
          isModuleEnabled("advanced_accounting") ||
          isModuleEnabled("analytics")) && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("common.accounting")}>
              {isModuleEnabled("payments") && (
                <CommandItem onSelect={() => go("/payments")}>
                  <HandCoins /> {t("nav.payments")}
                </CommandItem>
              )}
              {isModuleEnabled("payments") && (
                <CommandItem onSelect={() => go("/debts")}>
                  <AlertTriangle /> {t("nav.debts")}
                </CommandItem>
              )}
              {isModuleEnabled("payments") && (
                <CommandItem onSelect={() => go("/account-statement")}>
                  <FileText /> {t("nav.account_statement")}
                </CommandItem>
              )}
              {isModuleEnabled("expenses") && (
                <CommandItem onSelect={() => go("/finance")}>
                  <Wallet /> {t("nav.finance")}
                </CommandItem>
              )}
              {isModuleEnabled("advanced_accounting") && (
                <>
                  <CommandItem onSelect={() => go("/daily-journal")}>
                    <BookOpen /> {t("nav.daily_journal")}
                  </CommandItem>
                  <CommandItem onSelect={() => go("/trial-balance")}>
                    <Scale /> {t("nav.trial_balance")}
                  </CommandItem>
                  <CommandItem onSelect={() => go("/income-statement")}>
                    <PieChart /> {t("nav.income_statement")}
                  </CommandItem>
                  <CommandItem onSelect={() => go("/balance-sheet")}>
                    <Landmark /> {t("nav.balance_sheet")}
                  </CommandItem>
                </>
              )}
              {isModuleEnabled("analytics") && (
                <CommandItem onSelect={() => go("/reports")}>
                  <BarChart3 /> {t("nav.reports")}
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Admin */}
        <CommandSeparator />
        <CommandGroup heading={t("common.admin")}>
          <CommandItem onSelect={() => go("/users")}>
            <ShieldCheck /> {t("nav.users")}
          </CommandItem>
          {isModuleEnabled("audit") && (
            <CommandItem onSelect={() => go("/audit")}>
              <History /> {t("nav.audit")}
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/settlements")}>
            <ClipboardList /> {t("nav.settlements")}
          </CommandItem>
          <CommandItem onSelect={() => go("/notifications")}>
            <Bell /> {t("nav.notifications")}
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings /> {t("nav.settings")}
          </CommandItem>
          {isPlatformAdmin && (
            <CommandItem onSelect={() => go("/platform-admin")}>
              <Crown className="text-amber-500" /> {t("nav.platform_admin")}
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
