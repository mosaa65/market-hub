import { useState } from "react";
import { SettingsSidebar } from "./settings-sidebar";
import {
  getSettingsSection,
  SettingsSectionId,
} from "./settings-registry";

interface SettingsLayoutProps {
  form: any;
  setForm: (form: any) => void;
  enablePosServiceFee: boolean;
  setEnablePosServiceFee: (v: boolean) => void;
  printMode: "auto" | "ask" | "off";
  setPrintMode: (v: "auto" | "ask" | "off") => void;
  defaultPrintTemplate: any;
  setDefaultPrintTemplate: (v: any) => void;
  canEdit: boolean;
  lang: string;
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
}: SettingsLayoutProps) {
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>("company");
  const activeMeta = getSettingsSection(activeSectionId);

  const SectionComponent = activeMeta?.component;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
      {/* Sidebar / Tabs Navigation Column */}
      <div className="md:col-span-4 lg:col-span-3 space-y-4 sticky top-4">
        <SettingsSidebar
          activeSectionId={activeSectionId}
          onSelectSection={setActiveSectionId}
          lang={lang}
        />
      </div>

      {/* Main Settings Content Area Column */}
      <div className="md:col-span-8 lg:col-span-9 space-y-6">
        {SectionComponent ? (
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
            {lang === "ar" ? "القسم غير موجود" : "Section not found"}
          </div>
        )}
      </div>
    </div>
  );
}
