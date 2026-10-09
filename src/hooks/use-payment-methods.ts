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
  hasAuthoredIdentity,
  type LedgerKind,
  type LegacyPaymentValue,
  type PaymentContext,
  type PaymentMethodDefinition,
  type PaymentMethodOverrides,
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
  /**
   * False for a method this business created. The settings screen uses it to
   * decide between Delete (tenant row) and Disable only (developer row).
   */
  isSystem: boolean;
  /**
   * True when the name or icon differs from what the developers shipped — either
   * because the business renamed it, or because it is its own method.
   * The settings screen shows "معدّلة" and offers a reset for this.
   */
  isAuthored: boolean;
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
  legacy_id: string | null;
  is_system: boolean | null;
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
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

async function fetchPaymentMethods(): Promise<{
  methods: ResolvedPaymentMethod[];
  isFallback: boolean;
}> {
  const [catalogRes, settingsRes] = await Promise.all([
    db
      .from("payment_methods")
      .select(
        "id,name_ar,name_en,icon_key,is_active,sort_order,allowed_contexts,ledger_kind,default_account_code,is_credit_term,requires_reference,legacy_values,legacy_id,is_system",
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
  if (catalogRes.error || settingsRes.error || catalogRows.length === 0) {
    // Settings are tenant-specific. Treat a failed read as fallback so the UI
    // warns that enabled contexts/order may not reflect the saved configuration.
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

  const definition: ResolvedPaymentMethod = {
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
    // The explicit column first, then the historical list. The migration
    // backfilled `legacy_id` from `legacy_ids[1]` for every pre-existing row, so
    // reading it first is a no-op for the shipped methods and the ONLY correct
    // answer for one a business created (whose list is empty on purpose).
    legacyValue: (row.legacy_id ?? row.legacy_values?.[0] ?? "cash") as LegacyPaymentValue,

    enabled: settings ? settings.enabled : true,
    effectiveSortOrder: settings ? settings.sort_order : row.sort_order,
    // The tenant narrows; they never widen. Intersecting here as well as in the
    // database trigger means a hand-edited row cannot leak a method into a
    // section the developers disallowed.
    effectiveContexts: settings
      ? tenantContexts.filter((c) => allowedContexts.includes(c))
      : allowedContexts,
    isConfigured: Boolean(settings),
    isSystem: row.is_system !== false,
    isAuthored: false,
  };

  // A tenant row is authored by definition; a developer row only when its label
  // or icon no longer matches the shipped definition.
  definition.isAuthored = definition.isSystem ? hasAuthoredIdentity(definition) : true;

  return definition;
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
      isSystem: true,
      isAuthored: false,
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
 * The business's own names and icons, keyed by catalogue id, for screens that
 * render a STORED value rather than a catalogue row.
 *
 * A report or a printed invoice reads `payment_method::text` from a document;
 * it has no join and may never have loaded the catalogue. This hook lets such a
 * screen still print the business's own wording — so the same method is not
 * «حوالات صنعاء» in the till and «تحويل بنكي» on the receipt.
 *
 * Exported separately from `usePaymentMethods` on purpose: a table cell needs
 * nothing but the lookup, and subscribing it to the full resolved list would
 * re-render every row whenever a sort order changes.
 */
export function usePaymentMethodOverrides(): PaymentMethodOverrides {
  const { methods } = usePaymentMethods();

  return useMemo(() => {
    const map: PaymentMethodOverrides = {};
    for (const method of methods) {
      // Only methods with something to say. A method still carrying the shipped
      // name is omitted entirely, so `paymentMethodLabel` keeps its own default
      // path and the map stays small.
      if (!method.isAuthored) continue;
      map[method.id] = {
        nameAr: method.nameAr,
        nameEn: method.nameEn,
        iconKey: method.iconKey,
      };
    }
    return map;
  }, [methods]);
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

/* ==========================================================================
   Authoring — a business names its own methods, and may add one
   ========================================================================== */

/**
 * The rules this section enforces are ALL enforced a second time in the
 * database (migration `20261009000000`), and that is intentional:
 *
 *   • here — so the operator gets an Arabic message and the Save button can be
 *     disabled before a round-trip;
 *   • there — because a rule that only exists in the browser is not a rule.
 *
 * The division of labour is the reason the catalogue can safely let a tenant
 * write at all: `ledger_kind` and the stored value are decided by the database
 * from the family the tenant picked, never sent by this code.
 */

/** What the settings screen sends when it renames or re-icons a method. */
export interface PaymentMethodIdentityInput {
  id: string;
  nameAr: string;
  nameEn?: string | null;
  iconKey: string;
}

/** What the settings screen sends when it creates a method of its own. */
export interface TenantPaymentMethodInput {
  nameAr: string;
  nameEn?: string | null;
  iconKey: string;
  /** Which existing stored value it settles as. The account family follows. */
  legacyValue: LegacyPaymentValue;
  contexts?: PaymentContext[];
  requiresReference?: boolean;
}

/**
 * Rename / re-icon an existing method — a shipped one or one the business made.
 *
 * Returns the row as the database wrote it rather than echoing the input, so a
 * caller cannot report success for a value the trigger trimmed or rejected.
 */
export function useUpdatePaymentMethodIdentity() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: PaymentMethodIdentityInput) => {
      const { data, error } = await db.rpc("update_payment_method_identity", {
        p_id: input.id,
        p_name_ar: input.nameAr,
        p_name_en: input.nameEn ?? null,
        p_icon_key: input.iconKey,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name_ar: string;
        name_en: string | null;
        icon_key: string;
        is_system: boolean;
      }>;
    },
    onSuccess: () => {
      // Every picker, chip and label in the application reads this one key.
      queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_QUERY_KEY });
    },
  });

  const rename = useCallback(
    (input: PaymentMethodIdentityInput) => mutation.mutateAsync(input),
    [mutation],
  );

  return {
    rename,
    isSaving: mutation.isPending,
    error: mutation.error as Error | null,
  };
}

/**
 * Create a method the developers did not ship.
 *
 * The id is generated by the database from the name. It is deliberately NOT
 * chosen here: an id is a stable key that migrations, reports and audit rows
 * address forever, so it must not be something a browser can pick or collide
 * with.
 */
export function useCreateTenantPaymentMethod() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: TenantPaymentMethodInput) => {
      const { data, error } = await db.rpc("create_tenant_payment_method", {
        p_name_ar: input.nameAr,
        p_name_en: input.nameEn ?? null,
        p_icon_key: input.iconKey,
        p_legacy_id: input.legacyValue,
        // Sent as NULL when not chosen, so the database's own default applies.
        p_ledger_kind: null,
        p_contexts: input.contexts ?? null,
        p_requires_reference: input.requiresReference ?? true,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_QUERY_KEY });
    },
  });

  const create = useCallback(
    (input: TenantPaymentMethodInput) => mutation.mutateAsync(input),
    [mutation],
  );

  return {
    create,
    isCreating: mutation.isPending,
    error: mutation.error as Error | null,
  };
}

/**
 * Remove a method the business created.
 *
 * The database refuses while a document still references it, and says so in
 * Arabic — that refusal is the feature. Disabling is what an operator almost
 * always wants; deleting is for a method typed by mistake a minute ago.
 */
export function useRemoveTenantPaymentMethod() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("remove_tenant_payment_method", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_QUERY_KEY });
    },
  });

  const remove = useCallback((id: string) => mutation.mutateAsync(id), [mutation]);

  return {
    remove,
    isRemoving: mutation.isPending,
    error: mutation.error as Error | null,
  };
}
