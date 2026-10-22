import { SubscriptionSettingsCard } from "@/components/subscription-settings-card";

interface SubscriptionSectionProps {
  canEdit?: boolean;
  lang?: string;
}

export function SubscriptionSection() {
  return <SubscriptionSettingsCard />;
}
