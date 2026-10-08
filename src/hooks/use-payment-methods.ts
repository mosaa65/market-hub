/**
 * مصدر واحد لطرق الدفع في الواجهة، مع تخزين مؤقت وتحديث معرفي.
 *
 * WHY A HOOK AND NOT A CONTEXT PROVIDER
 * -------------------------------------
 * A React context would need a provider wrapped around every route, and any
 * screen used outside that provider would silently render an empty picker. React
 * Query already gives us the sharing we need: one cache entry keyed
 * `["payment-methods","catalog"]`, read by every component that asks. Ten
 * pickers on ten screens issue ONE request.
 *
 * WHAT IT MERGES
 * --------------
 *   payment_methods          the developers' catalogue (identity, icon, ledger kind)
 *   payment_method_settings  the tenant's own enabled / order / contexts
 *
 * A method with no settings row has never been touched by the business, so the
 * catalogue's own defaults apply — that is why adding a Yemeni method in a
 * migration makes it visible without a data backfill.
 *
 * FAILURE BEHAVIOUR
 * -----------------
 * If the query fails (offline, RLS not yet applied, a project that has not run
 * the migration), the hook falls back to the developer catalogue as shipped.
 * A cashier must never be unable to take money because a settings table was
 * unreachable. `isFallback` reports that honestly so the settings screen can
 * warn instead of silently pretending the tenant's choices were loaded.
 */

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  PAYMENT_METHOD_CATALOG,
  PAYMENT_CONTEXTS,
  type LedgerKind,
  type PaymentContext,
  type PaymentMethodDefinition,
} from "@/lib/payments/payment-methods";

/** One cache entry for the whole application. Exported so invalidation is by name, not by string literal. */
export const PAYMENT_METHODS_QUERY_KEY = ["payment-methods", "catalog"] as const;

/** A catalogue row joined with this business's configuration. */
export interface ResolvedPaymentMethod extends PaymentMethodDefinition {
  /** Is this business offering the method at all. */
  enabled: boolean;
  /** Presentation order after the tenant's override. */
  effectiveSortOrder: number;
  /** Effective contexts: the tenant's set when they chose one, the catalogue's otherwise. */
  effectiveContexts: readonly PaymentContext[];
  /** Whether the tenant has configured this row (vs. inheriting the catalogue default). */
  isConfigured: boolean;
}

interface CatalogRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  icon_key: string;
  is_active: boolean;
  sort_order: number;
  allowed_contexts: string[] | null;
  ledger_kind: string;
  default_account_code: string | null;
  is_credit_term: boolean;
  requires_reference: boolean;
  legacy_values: string[] | null;
}

interface SettingsRow {
  payment_method_id: string;
  enabled: boolean;
  sort_order: number;
  enabled_contexts: string[] | null;
  default_account_id: string | null;
}

function isLedgerKind(value: string): value is LedgerKind {
  return ["CASH", "BANK", "WALLET", "CARD", "CREDIT", "OTHER"].includes(value);
}

function isContext(value: string): value is PaymentContext {
  return (PAYMENT_CONTEXTS as readonly string[]).includes(value);
}

/** Narrow a `text[]` column to the contexts we actually know about. */
function toContexts(values: string[] | null | undefined): PaymentContext[] {
  return (values ?? []).filter(isContext);
}

const db = supabase as unknown as {
  from: (table: string) => any;
};

async function fetchPaymentMethods(): Promise<{
  methods: ResolvedPaymentMethod[];
  isFallback: boolean;
}> {
  const [catalogRes, settingsRes] = await Promise.all([
    db
      .from("payment_methods")
      .select(
        "id,name_ar,name_en,icon_key,is_active,sort_order,allowed_contexts,ledger_kind,default_account_code,is_credit_term,requires_reference,legacy_values",
      )
      .order("sort_order"),
    db
      .from("payment_method_settings")
      .select("payment_method_id,enabled,sort_order,enabled_contexts,default_account_id"),
  ]);

  // The settings table is not the source of truth for whether a method EXISTS,
  // so its failure alone must not blank the catalogue — it only means nobody has
  // configured anything yet.
  const catalogRows: CatalogRow[] = Array.isArray(catalogRes.data) ? catalogRes.data : [];
  if (catalogRes.error || catalogRows.length === 0) {
    return { methods: fallbackMethods(), isFallback: true };
  }

  const settingsById = new Map<string, SettingsRow>();
  for (const row of (settingsRes.data ?? []) as SettingsRow[]) {
    settingsById.set(row.payment_method_id, row);
  }

  const methods = catalogRows.map((row) => resolveRow(row, settingsById.get(row.id)));

  return { methods: methods.sort(byEffectiveOrder), isFallback: false };
}

function resolveRow(row: CatalogRow, settings?: SettingsRow): ResolvedPaymentMethod {
  const allowedContexts = toContexts(row.allowed_contexts);
  const tenantContexts = toContexts(settings?.enabled_contexts);

  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en ?? undefined,
    iconKey: row.icon_key,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    allowedContexts,
    ledgerKind: isLedgerKind(row.ledger_kind) ? row.ledger_kind : "OTHER",
    defaultAccountCode: row.default_account_code ?? undefined,
    isCreditTerm: row.is_credit_term,
    requiresReference: row.requires_reference,
    legacyValue: (row.legacy_values?.[0] ?? "cash") as PaymentMethodDefinition["legacyValue"],

    enabled: settings ? settings.enabled : true,
    effectiveSortOrder: settings ? settings.sort_order : row.sort_order,
    // The tenant narrows; they never widen. Intersecting here as well as in the
    // database trigger means a hand-edited row cannot leak a method into a
    // section the developers disallowed.
    effectiveContexts: settings
      ? tenantContexts.filter((c) => allowedContexts.includes(c))
      : allowedContexts,
    isConfigured: Boolean(settings),
  };
}

function byEffectiveOrder(a: ResolvedPaymentMethod, b: ResolvedPaymentMethod): number {
  if (a.effectiveSortOrder !== b.effectiveSortOrder) {
    return a.effectiveSortOrder - b.effectiveSortOrder;
  }
  return a.id.localeCompare(b.id);
}

/** The developer catalogue as shipped, used before the query resolves and on failure. */
function fallbackMethods(): ResolvedPaymentMethod[] {
  return [...PAYMENT_METHOD_CATALOG]
    .map((def) => ({
      ...def,
      enabled: true,
      effectiveSortOrder: def.sortOrder,
      effectiveContexts: def.allowedContexts,
      isConfigured: false,
    }))
    .sort(byEffectiveOrder);
}

/**
 * Read the catalogue. Safe to call from every screen and every picker: they all
 * share one cache entry, one request, and one re-render source.
 */
export function usePaymentMethods() {
  const query = useQuery({
    queryKey: PAYMENT_METHODS_QUERY_KEY,
    queryFn: fetchPaymentMethods,
    // Payment methods change when an owner edits Settings — a handful of times a
    // year, not a handful of times an hour.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  const methods = query.data?.methods ?? fallbackMethods();
  const isFallback = query.data?.isFallback ?? true;

  return {
    /** Every method, enabled or not, in presentation order. */
    methods,
    isLoading: query.isLoading,
    /** True when the tenant's own configuration could not be read. */
    isFallback,
    refetch: query.refetch,
  };
}

/**
 * The methods a given section may offer, in the tenant's order.
 *
 * This is the function every picker calls. It returns nothing that is disabled,
 * nothing outside the tenant's contexts, and nothing outside the developers'
 * contexts — so a screen cannot accidentally offer a method the business turned
 * off.
 */
export function usePaymentMethodsForContext(
  context: PaymentContext,
  options?: { includeCredit?: boolean },
) {
  const { methods, isLoading, isFallback } = usePaymentMethods();
  const includeCredit = options?.includeCredit ?? true;

  const available = useMemo(
    () =>
      methods.filter(
        (m) =>
          m.isActive &&
          m.enabled &&
          m.effectiveContexts.includes(context) &&
          (includeCredit || !m.isCreditTerm),
      ),
    [methods, context, includeCredit],
  );

  return { methods: available, isLoading, isFallback };
}

/**
 * Write the tenant configuration. One mutation for both the bulk save the
 * settings screen performs and any future single-method toggle.
 */
export function useUpdatePaymentMethodSettings() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (
      rows: Array<{
        payment_method_id: string;
        enabled: boolean;
        sort_order: number;
        enabled_contexts: PaymentContext[];
      }>,
    ) => {
      if (rows.length === 0) return;
      const { error } = await db
        .from("payment_method_settings")
        .upsert(rows, { onConflict: "payment_method_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      // One key, therefore one invalidation, therefore every mounted picker in
      // the application re-renders from the new configuration.
      queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_QUERY_KEY });
    },
  });

  const save = useCallback(
    (rows: Parameters<typeof mutation.mutateAsync>[0]) => mutation.mutateAsync(rows),
    [mutation],
  );

  return {
    save,
    isSaving: mutation.isPending,
    error: mutation.error as Error | null,
  };
}

