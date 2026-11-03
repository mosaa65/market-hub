import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search as SearchIcon, Settings2 } from "lucide-react";
import { VortexSearchInput } from "@/components/vortex-ui/inputs/vortex-search-input";
import {
  getRegisteredSettingsSections,
  getSettingsSection,
  SettingsSectionId,
} from "./settings-registry";
import { SettingsSidebar } from "./settings-sidebar";

interface SettingsLayoutProps {
  form: any;
  setForm: Dispatch<SetStateAction<any>>;
  enablePosServiceFee: boolean;
  setEnablePosServiceFee: (v: boolean) => void;
  printMode: "auto" | "ask" | "off";
  setPrintMode: (v: "auto" | "ask" | "off") => void;
  defaultPrintTemplate: any;
  setDefaultPrintTemplate: (v: any) => void;
  canEdit: boolean;
  lang: string;
  /**
   * Section to open on arrival, from `?section=` in the URL.
   */
  initialSectionId?: string;
}

export function SettingsLayout({
  form,
  setForm,
  enablePosServiceFee,
  setEnablePosServiceFee,
  printMode,
  setPrintMode,
  defaultPrintTemplate,
  setDefaultPrintTemplate,
  canEdit,
  lang,
  initialSectionId,
}: SettingsLayoutProps) {
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const sections = useMemo(() => getRegisteredSettingsSections(), []);

  const activeSectionId =
    initialSectionId && getSettingsSection(initialSectionId) ? initialSectionId : null;
  const activeMeta = activeSectionId ? getSettingsSection(activeSectionId) : undefined;
  const SectionComponent = activeMeta?.component;

  const [search, setSearch] = useState("");

  const filteredSections = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(isAr ? "ar" : "en");
    if (!query) return sections;
    return sections.filter((section) =>
      [section.titleAr, section.titleEn, section.descriptionAr, section.descriptionEn].some(
        (text) => text.toLocaleLowerCase(isAr ? "ar" : "en").includes(query),
      ),
    );
  }, [isAr, search, sections]);

  useEffect(() => {
    if (initialSectionId && !getSettingsSection(initialSectionId)) {
      void navigate({ to: "/settings", search: { section: undefined } as any, replace: true });
    }
  }, [initialSectionId, navigate]);

  const selectSection = (id: SettingsSectionId) => {
    setSearch("");
    void navigate({ to: "/settings", search: { section: id } as any });
  };

  const returnToHub = () => {
    void navigate({ to: "/settings", search: { section: undefined } as any });
  };

  return (
    <div className="min-w-0 space-y-4">
      {activeMeta ? (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/70 p-3 sm:p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <activeMeta.icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">
                {isAr ? activeMeta.titleAr : activeMeta.titleEn}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {isAr ? activeMeta.descriptionAr : activeMeta.descriptionEn}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={returnToHub}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {isAr ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}
            <span className="hidden sm:inline">{isAr ? "كل الإعدادات" : "All settings"}</span>
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Settings2 className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {isAr ? "مركز الإعدادات" : "Settings center"}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isAr
                  ? "ابحث عن الإعداد الذي تريد تغييره أو اختر قسمًا."
                  : "Search for a setting or choose a category."}
              </p>
            </div>
          </div>
          <VortexSearchInput
            value={search}
            onValueChange={setSearch}
            enableSlashShortcut={false}
            placeholder={
              isAr ? "ابحث باسم القسم أو وصفه..." : "Search settings by name or description..."
            }
            aria-label={isAr ? "ابحث في الإعدادات" : "Search settings"}
            className="w-full"
          />
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(245px,310px)_minmax(0,1fr)] lg:items-start">
        <aside
          className={
            activeMeta ? "hidden lg:sticky lg:top-4 lg:block" : "min-w-0 lg:sticky lg:top-4"
          }
          aria-label={isAr ? "أقسام الإعدادات" : "Settings categories"}
        >
          <div className="max-h-[min(72vh,760px)] space-y-1 overflow-y-auto rounded-2xl border border-border/70 bg-card/50 p-2">
            <SettingsSidebar
              sections={filteredSections}
              activeSectionId={activeSectionId}
              onSelectSection={selectSection}
              lang={lang}
            />
            {filteredSections.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {isAr ? "لا توجد أقسام تطابق البحث." : "No settings match your search."}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-64 min-w-0" aria-live="polite">
          {SectionComponent ? (
            <div className="min-w-0 space-y-4">
              <SectionComponent
                form={form}
                setForm={setForm}
                enablePosServiceFee={enablePosServiceFee}
                setEnablePosServiceFee={setEnablePosServiceFee}
                printMode={printMode}
                setPrintMode={setPrintMode}
                defaultPrintTemplate={defaultPrintTemplate}
                setDefaultPrintTemplate={setDefaultPrintTemplate}
                canEdit={canEdit}
                lang={lang}
              />
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-border/70 bg-card/30 p-6 text-center text-muted-foreground">
              <div>
                <SearchIcon className="mx-auto mb-3 size-8 opacity-40" aria-hidden="true" />
                <p className="mb-1 text-sm font-bold text-foreground">
                  {isAr ? "اختر قسمًا لعرض إعداداته" : "Choose a category to view its settings"}
                </p>
                <p className="text-xs">
                  {isAr
                    ? "يمكنك البحث باسم القسم أو جزء من وصفه."
                    : "Search by category name or description."}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
