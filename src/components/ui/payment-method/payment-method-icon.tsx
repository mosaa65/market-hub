/**
 * أيقونة طريقة الدفع الموحّدة.
 *
 * The icon is resolved from the developer's catalogue, never from a URL and
 * never from base64 stored on a record. Consequences that matter:
 *
 *   • zero network requests — the component is in the bundle already
 *   • identical light and dark behaviour, because tone comes from design tokens
 *   • it cannot fail to load, so no broken-image placeholder is needed
 *   • updating an icon is a one-line change here, not a data migration
 *
 * The fallback chain (iconKey -> ledger kind -> wallet) means a method added by
 * a future migration still renders sensibly on an older client bundle.
 */

import {
  paymentMethodIcon,
  paymentMethodIconTone,
  type LedgerKind,
} from "@/lib/payments/payment-methods";
import { cn } from "@/lib/utils";

export interface PaymentMethodIconProps {
  iconKey: string;
  ledgerKind?: LedgerKind;
  className?: string;
  /** Set false to render the glyph in the inherited colour instead of its ledger tone. */
  tone?: boolean;
  strokeWidth?: number;
}

export function PaymentMethodIcon({
  iconKey,
  ledgerKind,
  className,
  tone = true,
  strokeWidth = 2,
}: PaymentMethodIconProps) {
  const Icon = paymentMethodIcon(iconKey, ledgerKind);

  return (
    <Icon
      aria-hidden="true"
      strokeWidth={strokeWidth}
      className={cn("h-4 w-4 shrink-0", tone && paymentMethodIconTone(ledgerKind), className)}
    />
  );
}
