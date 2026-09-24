import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  getRegisteredSettingsSections,
  SettingsSectionId,
  SettingsSectionMeta,
} from "./settings-registry";

interface SettingsSidebarProps {
  activeSectionId: SettingsSectionId;
  onSelectSection: (id: SettingsSectionId) => void;
  lang: string;
}

export function SettingsSidebar({
  activeSectionId,
  onSelectSection,
  lang,
}: SettingsSidebarProps) {
  const isAr = lang === "ar";
  const sections = getRegisteredSettingsSections();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSections = sections.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.titleAr.toLowerCase().includes(q) ||
      s.titleEn.toLowerCase().includes(q) ||
      s.descriptionAr.toLowerCase().includes(q) ||
      s.descriptionEn.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-3">
      {/* Search Input for Settings Sections */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={isAr ? "بحث في الإعدادات..." : "Search settings..."}
          className="ps-9 rounded-2xl bg-surface/80 border-border/80 text-xs h-9"
        />
      </div>

      {/* Desktop Vertical Navigation Menu */}
      <div className="hidden md:flex flex-col space-y-1.5">
        {filteredSections.map((sec: SettingsSectionMeta) => {
          const Icon = sec.icon;
          const isActive = activeSectionId === sec.id;
          const title = isAr ? sec.titleAr : sec.titleEn;
          const desc = isAr ? sec.descriptionAr : sec.descriptionEn;
          const badge = isAr ? sec.badgeAr : sec.badgeEn;

          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => onSelectSection(sec.id)}
              className={`w-full text-start p-3 rounded-2xl border transition-all duration-200 group flex items-start gap-3 ${
                isActive
                  ? "border-primary/50 bg-primary/10 text-primary shadow-xs ring-1 ring-primary/20"
                  : "border-border/60 bg-surface/60 text-muted-foreground hover:bg-surface-2 hover:text-foreground hover:border-border"
              }`}
            >
              <div
                className={`p-2 rounded-xl transition-colors ${
                  isActive ? "bg-primary text-primary-foreground" : "bg-muted/80 text-muted-foreground group-hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold truncate">{title}</span>
                  {badge && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      {badge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground/80 line-clamp-1 mt-0.5 font-normal">
                  {desc}
                </p>
              </div>
            </button>
          );
        })}

        {filteredSections.length === 0 && (
          <div className="text-center py-6 text-xs text-muted-foreground">
            {isAr ? "لا توجد أقسام مطابقة للبحث" : "No matching settings sections"}
          </div>
        )}
      </div>

      {/* Mobile Horizontal Scrollable Tab Bar */}
      <div className="flex md:hidden overflow-x-auto gap-2 pb-2 scrollbar-none">
        {filteredSections.map((sec: SettingsSectionMeta) => {
          const Icon = sec.icon;
          const isActive = activeSectionId === sec.id;
          const title = isAr ? sec.titleAr : sec.titleEn;

          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => onSelectSection(sec.id)}
              className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-full border text-xs font-semibold transition-all ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-border/80 bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
