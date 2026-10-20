import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Search as SearchIcon } from "lucide-react";
import { getSettingsSection, SettingsSectionId } from "./settings-registry";

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
   *
   * Sidebar links point at a specific settings screen (e.g.
   * `/settings?section=printing`). Without this the layout always started on the
   * hub, so every one of those links landed on the same list and the operator
   * had to find the section again — the parameter was accepted and ignored.
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
  /*
   * Open the section named in the URL, but only if it actually exists in the
   * registry — an unknown `?section=` falls back to the hub instead of showing
   * "القسم غير موجود" for a hand-typed link.
   */
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId | null>(() =>
    initialSectionId && getSettingsSection(initialSectionId) ? initialSectionId : null,
  );

  /*
   * React to later in-page navigation as well (jumping from one settings link
   * to another while already on /settings): a `useState` initialiser runs once,
   * so without this effect the second link would change the URL and nothing
   * else.
   */
  useEffect(() => {
    if (!initialSectionId) return;
    if (!getSettingsSection(initialSectionId)) return;
    setActiveSectionId(initialSectionId);
  }, [initialSectionId]);

  const activeMeta = activeSectionId ? getSettingsSection(activeSectionId) : undefined;
  const SectionComponent = activeMeta?.component;

  const renderSectionComponent = () =>
    SectionComponent ? (
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
    ) : (
      <div className="text-center py-12 text-muted-foreground text-sm">
        {isAr ? "القسم غير موجود" : "Section not found"}
      </div>
    );

  return (
    <div className="min-w-0">
      {activeSectionId ? (
        <div className="min-w-0 space-y-4">{renderSectionComponent()}</div>
      ) : (
        <div className="rounded-3xl border border-dashed border-border/70 p-8 text-center text-muted-foreground">
          <SearchIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />
          <p className="mb-1 text-sm font-bold text-foreground">
            {isAr ? "اختر إعداداً من القائمة الجانبية" : "Choose a setting from the sidebar"}
          </p>
          <p className="text-xs">
            {isAr
              ? "ستظهر شاشة الإعداد هنا بعد اختيارها."
              : "The selected settings screen will appear here."}
          </p>
        </div>
      )}
    </div>
  );
}
