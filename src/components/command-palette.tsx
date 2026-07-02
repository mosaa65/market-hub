import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import {
  LayoutDashboard, ScanBarcode, Package, Warehouse, Receipt, Truck,
  Users, Building2, Wallet, BarChart3, Settings, Bell, ShieldCheck,
  RotateCcw, ArrowRightLeft, CalendarClock, Barcode, Gift, History, Layers, Boxes,
} from "lucide-react";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const go = (to: string) => { onOpenChange(false); navigate({ to }); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("common.search")} />
      <CommandList>
        <CommandEmpty>{t("common.no_results")}</CommandEmpty>
        <CommandGroup heading={t("common.navigate")}>
          <CommandItem onSelect={() => go("/dashboard")}><LayoutDashboard /> {t("nav.dashboard")}</CommandItem>
          <CommandItem onSelect={() => go("/pos")}><ScanBarcode /> {t("nav.pos")}</CommandItem>
          <CommandItem onSelect={() => go("/products")}><Package /> {t("nav.products")}</CommandItem>
          <CommandItem onSelect={() => go("/inventory")}><Warehouse /> {t("nav.inventory")}</CommandItem>
          <CommandItem onSelect={() => go("/sales")}><Receipt /> {t("nav.sales")}</CommandItem>
          <CommandItem onSelect={() => go("/purchases")}><Truck /> {t("nav.purchases")}</CommandItem>
          <CommandItem onSelect={() => go("/returns")}><RotateCcw /> {t("nav.returns")}</CommandItem>
          <CommandItem onSelect={() => go("/transfers")}><ArrowRightLeft /> {t("nav.transfers")}</CommandItem>
          <CommandItem onSelect={() => go("/batches")}><CalendarClock /> {t("nav.batches")}</CommandItem>
          <CommandItem onSelect={() => go("/barcodes")}><Barcode /> {t("nav.barcodes")}</CommandItem>
          <CommandItem onSelect={() => go("/customers")}><Users /> {t("nav.customers")}</CommandItem>
          <CommandItem onSelect={() => go("/loyalty")}><Gift /> {t("nav.loyalty")}</CommandItem>
          <CommandItem onSelect={() => go("/suppliers")}><Building2 /> {t("nav.suppliers")}</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("common.accounting")}>
          <CommandItem onSelect={() => go("/finance")}><Wallet /> {t("nav.finance")}</CommandItem>
          <CommandItem onSelect={() => go("/reports")}><BarChart3 /> {t("nav.reports")}</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("common.admin")}>
          <CommandItem onSelect={() => go("/users")}><ShieldCheck /> {t("nav.users")}</CommandItem>
          <CommandItem onSelect={() => go("/audit")}><History /> {t("nav.audit")}</CommandItem>
          <CommandItem onSelect={() => go("/notifications")}><Bell /> {t("nav.notifications")}</CommandItem>
          <CommandItem onSelect={() => go("/settings")}><Settings /> {t("nav.settings")}</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
