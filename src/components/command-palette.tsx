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
import { useMillingMode, isRouteVisibleByMillingMode } from "@/lib/milling-mode";
import { canAccessRoute } from "@/lib/route-access";
import { getVisibleRoutes, type RouteCategory } from "@/lib/navigation";
import { routeIcon, routeCategoryLabel } from "@/lib/navigation/route-icons";

/** ترتيب أقسام لوحة الأوامر. */
const GROUP_ORDER: RouteCategory[] = [
  "command_center",
  "sales",
  "inventory",
  "procurement",
  "finance",
  "milling",
  "admin",
  "settings",
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const { roles, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const { isModuleEnabled } = useModules();
  const { mode: millingMode } = useMillingMode();

  const go = (path: string) => {
    onOpenChange(false);
    const [pathname, search] = path.split("?");
    if (search) {
      navigate({ to: pathname, search: Object.fromEntries(new URLSearchParams(search)) } as never);
    } else {
      navigate({ to: pathname } as never);
    }
  };

  const entries = getVisibleRoutes({
    isModuleEnabled,
    isVisibleByMillingMode: (path) => isRouteVisibleByMillingMode(path, millingMode),
    canAccess: (entry) =>
      canAccessRoute(entry.path.split("?")[0], { roles, isPlatformAdmin, isPlatformSuperadmin }),
  });

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("common.search")} />
      <CommandList>
        <CommandEmpty>{t("common.no_results")}</CommandEmpty>
        {GROUP_ORDER.map((category, index) => {
          const group = entries.filter((entry) => entry.category === category);
          if (group.length === 0) return null;
          return (
            <div key={category}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={routeCategoryLabel(category, isAr)}>
                {group.map((entry) => {
                  const Icon = routeIcon(entry.id);
                  return (
                    <CommandItem
                      key={entry.id}
                      value={`${isAr ? entry.titleAr : entry.titleEn} ${entry.keywords.join(" ")}`}
                      onSelect={() => go(entry.path)}
                    >
                      <Icon />
                      {isAr ? entry.titleAr : entry.titleEn}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
