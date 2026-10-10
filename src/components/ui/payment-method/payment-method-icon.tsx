/**
 * أيقونة طريقة الدفع الموحّدة.
 *
 * Provider marks use a small, closed local asset registry; other icons are
 * bundled components. No URL or base64 supplied by a tenant is ever rendered.
 * A missing local asset falls back to the method's ledger-family icon.
 *
 * The fallback chain (iconKey -> ledger kind -> wallet) means a method added by
 * a future migration still renders sensibly on an older client bundle.
 */

import { useState } from "react";
import {
  paymentMethodIcon,
  paymentMethodIconAsset,
  paymentMethodIconTone,
  type LedgerKind,
} from "@/lib/payments/payment-methods";
import { cn } from "@/lib/utils";

export interface PaymentMethodIconProps {
  iconKey: string;
  methodId?: string | null;
  ledgerKind?: LedgerKind;
  className?: string;
  /** Set false to render the glyph in the inherited colour instead of its ledger tone. */
  tone?: boolean;
  strokeWidth?: number;
}

export function PaymentMethodIcon({
  iconKey,
  methodId,
  ledgerKind,
  className,
  tone = true,
  strokeWidth = 2,
}: PaymentMethodIconProps) {
  const [failedAsset, setFailedAsset] = useState<string | null>(null);
  const Icon = paymentMethodIcon(iconKey, ledgerKind);
  const asset = methodId && failedAsset !== methodId ? paymentMethodIconAsset(methodId) : undefined;

  return asset ? (
    <img
      src={asset.src}
      alt={asset.alt}
      loading="lazy"
      onError={() => setFailedAsset(methodId ?? null)}
      className={cn("h-4 w-4 shrink-0 rounded-full object-contain", className)}
    />
  ) : (
    <Icon
      aria-hidden="true"
      strokeWidth={strokeWidth}
      className={cn("h-4 w-4 shrink-0", tone && paymentMethodIconTone(ledgerKind), className)}
    />
  );
}
