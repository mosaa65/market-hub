import { PrintSettingsCard } from "@/components/print-settings-card";
import { useAuth } from "@/lib/auth";

interface PrintingSectionProps {
  canEdit: boolean;
  lang?: string;
}

export function PrintingSection({ canEdit }: PrintingSectionProps) {
  const { hasRole, isPlatformSuperadmin } = useAuth();
  const canEditPrinting = canEdit && (hasRole("owner") || isPlatformSuperadmin);

  return <PrintSettingsCard canEdit={canEditPrinting} />;
}
