import { PrintSettingsCard } from "@/components/print-settings-card";

interface PrintingSectionProps {
  canEdit: boolean;
  lang?: string;
}

export function PrintingSection({ canEdit }: PrintingSectionProps) {
  return <PrintSettingsCard canEdit={canEdit} />;
}
