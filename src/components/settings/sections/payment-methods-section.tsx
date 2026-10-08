/**
 * إعدادات طرق الدفع — للاختيار من كتالوج المطورين، لا لإنشاء طرق.
 *
 * WHAT THE OPERATOR CAN DO HERE
 *   • enable / disable a method
 *   • reorder it
 *   • choose which sections it appears in
 *
 * WHAT THEY CANNOT DO, BY DESIGN
 *   • create a method
 *   • upload or link an icon
 *   • widen a method into a section the developers disallowed
 *
 * The screen is therefore a list of switches, not a form: there is nothing to
 * type, so there is nothing to validate beyond the contexts the catalogue
 * already permits.
 *
 * SAVING
 * ------
 * Edits are local until Save. A settings screen that wrote on every toggle
 * would make an accidental tap in a noisy shop irreversible, and the operator
 * is changing several rows in one sitting. The draft is diffed against the
 * loaded state so Save only sends rows that actually changed — a screen opened
 * and closed writes nothing.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CreditCard,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  PAYMENT_CONTEXTS,
  PAYMENT_CONTEXT_LABELS,
  type PaymentContext,
} from "@/lib/payments/payment-methods";
import {
  usePaymentMethods,
  useUpdatePaymentMethodSettings,
  type ResolvedPaymentMethod,
} from "@/hooks/use-payment-methods";
import { PaymentMethodIcon } from "@/components/ui/payment-method/payment-method-icon";

/** The editable shape of one method. */
interface DraftRow {
  id: string;
  enabled: boolean;
  contexts: PaymentContext[];
}

/**
 * The whole editable state: the rows plus their order.
 *
 * Order is a separate array rather than a field on each row because that is what
 * it actually is — one sequence the operator manipulates — and it makes
 * "did the order change?" a single array comparison instead of a scan for a
 * monotonicity violation.
 */
interface DraftState {
  rows: Record<string, DraftRow>;
  order: string[];
}

function buildDraft(methods: ResolvedPaymentMethod[]): DraftState {
  const rows: Record<string, DraftRow> = {};
  const order: string[] = [];

  for (const method of methods) {
    // A method the developers retired is not offered at all; showing it as a
    // switch the operator cannot use would be noise.
    if (!method.isActive) continue;
    rows[method.id] = {
      id: method.id,
      enabled: method.enabled,
      contexts: [...method.effectiveContexts],
    };
    // `methods` already arrives in effective presentation order.
    order.push(method.id);
  }

  return { rows, order };
}

export function PaymentMethodsSection() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { methods, isLoading, isFallback, refetch } = usePaymentMethods();
  const { save, isSaving } = useUpdatePaymentMethodSettings();

  const [draft, setDraft] = useState<DraftState>({ rows: {}, order: [] });
  const [savedSnapshot, setSavedSnapshot] = useState<DraftState>({ rows: {}, order: [] });

  // Seed the draft from the loaded configuration. `savedSnapshot` is what Save
  // diffs against, so re-seeding on refetch keeps both in step.
  useEffect(() => {
    if (methods.length === 0) return;
    const next = buildDraft(methods);
    setDraft(next);
    setSavedSnapshot(next);
  }, [methods]);

  /** Methods in draft order, resolved back to their definitions for display. */
  const ordered = useMemo(
    () =>
      draft.order
        .map((id) => methods.find((m) => m.id === id))
        .filter((m): m is ResolvedPaymentMethod => Boolean(m)),
    [draft.order, methods],
  );

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedSnapshot),
    [draft, savedSnapshot],
  );

  const toggleEnabled = useCallback((id: string, enabled: boolean) => {
    setDraft((prev) =>
      prev.rows[id]
        ? { ...prev, rows: { ...prev.rows, [id]: { ...prev.rows[id], enabled } } }
        : prev,
    );
  }, []);

  const toggleContext = useCallback((id: string, context: PaymentContext, on: boolean) => {
    setDraft((prev) => {
      const row = prev.rows[id];
      if (!row) return prev;
      const contexts = on
        ? Array.from(new Set([...row.contexts, context]))
        : row.contexts.filter((c) => c !== context);
      return { ...prev, rows: { ...prev.rows, [id]: { ...row, contexts } } };
    });
  }, []);

  /**
   * Move a method one slot. Order is stored as an array index when saved, so a
   * gap left by a disabled method cannot make the picker render in a sequence
   * the operator did not choose.
   */
  const move = useCallback((id: string, direction: -1 | 1) => {
    setDraft((prev) => {
      const index = prev.order.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.order.length) return prev;

      const order = [...prev.order];
      [order[index], order[target]] = [order[target], order[index]];
      return { ...prev, order };
    });
  }, []);

  const reset = useCallback(() => setDraft(savedSnapshot), [savedSnapshot]);

  const handleSave = useCallback(async () => {
    // Order is written as the array index times ten. Ten, not one, so a future
    // hand-inserted catalogue row can be placed between two existing methods
    // without renumbering every business's configuration.
    const payload = draft.order.map((id, index) => ({
      payment_method_id: id,
      enabled: draft.rows[id].enabled,
      sort_order: index * 10,
      enabled_contexts: draft.rows[id].contexts,
    }));

    if (payload.length === 0) {
      toast.info(isAr ? "لا توجد تغييرات لحفظها" : "Nothing to save");
      return;
    }

    try {
      await save(payload);
      // Snapshot exactly what was sent, so the next edit diffs against the
      // persisted state rather than against the pre-save draft.
      setSavedSnapshot(draft);
      toast.success(isAr ? "تم حفظ إعدادات طرق الدفع" : "Payment methods saved");
    } catch (error) {
      console.error("Failed to save payment method settings", error);
      toast.error(
        isAr
          ? "تعذّر حفظ إعدادات طرق الدفع. تحقق من صلاحياتك."
          : "Could not save payment methods. Check your permissions.",
      );
    }
  }, [draft, save, isAr]);

  if (isLoading) {
    return (
      <Card className="rounded-3xl border-border/80">
        <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {isAr ? "جارٍ تحميل طرق الدفع..." : "Loading payment methods..."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* The catalogue is ours; say so, so nobody hunts for an "add" button. */}
      <div className="rounded-2xl border border-border/70 bg-surface/60 p-3.5 text-[11px] leading-relaxed text-muted-foreground">
        {isAr
          ? "طرق الدفع معرّفة مسبقاً من طرف النظام، والأيقونات جاهزة ومدارة مركزياً. لا حاجة لإنشاء طريقة أو رفع أيقونة — فعّل ما تحتاجه، رتّبه، وحدّد الأقسام التي تظهر فيها."
          : "Payment methods are pre-defined by the system and their icons are managed centrally. There is nothing to create and no icon to upload — enable what you need, order it, and choose where it appears."}
      </div>

      {/* A configuration that could not be read must never look like a choice. */}
      {isFallback && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {isAr
              ? "تعذّر قراءة إعداداتك من الخادم، والمعروض هو الكتالوج الافتراضي. الحفظ قد لا يعمل قبل استعادة الاتصال."
              : "Your configuration could not be read; this is the default catalogue. Saving may fail until the connection is restored."}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            className="shrink-0 underline decoration-dotted"
          >
            {isAr ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      )}

      <Card className="rounded-3xl border-border/80 shadow-xs">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <span className="rounded-xl bg-primary/10 p-2 text-primary">
              <CreditCard className="h-5 w-5" />
            </span>
            {isAr ? "طرق الدفع" : "Payment methods"}
          </CardTitle>
          <CardDescription className="text-xs">
            {isAr
              ? "الطريقة غير المفعّلة لا تظهر في أي شاشة. وتخصيص الأقسام مستقل لكل طريقة."
              : "A disabled method appears nowhere. Section scoping is independent per method."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-2.5 pt-5">
          {ordered.map((method, index) => {
            const row = draft.rows[method.id];
            if (!row) return null;
            const isCredit = Boolean(method.isCreditTerm);

            return (
              <div
                key={method.id}
                className={cn(
                  "rounded-2xl border p-3 transition-colors",
                  row.enabled
                    ? "border-border/70 bg-surface/70"
                    : "border-border/50 bg-muted/20 opacity-70",
                )}
              >
                {/* ── Row 1: identity, order, master switch ── */}
                <div className="flex items-center gap-3">
                  <PaymentMethodIcon
                    iconKey={method.iconKey}
                    ledgerKind={method.ledgerKind}
                    className="h-5 w-5"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold">
                        {isAr ? method.nameAr : (method.nameEn ?? method.nameAr)}
                      </span>
                      {isCredit && (
                        <Badge
                          variant="outline"
                          className="h-5 border-amber-500/40 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                        >
                          {isAr ? "لا يُحصَّل الآن" : "No collection"}
                        </Badge>
                      )}
                      {method.requiresReference && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {isAr ? "يتطلب مرجعاً" : "Ref. required"}
                        </Badge>
                      )}
                    </div>
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                      {method.id}
                    </span>
                  </div>

                  {/* Order — the picker's sequence is this list, top to bottom. */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(method.id, -1)}
                      disabled={index === 0}
                      aria-label={isAr ? "تحريك لأعلى" : "Move up"}
                      className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(method.id, 1)}
                      disabled={index === ordered.length - 1}
                      aria-label={isAr ? "تحريك لأسفل" : "Move down"}
                      className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center font-mono text-[10px] text-muted-foreground">
                      {index + 1}
                    </span>
                  </div>

                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(checked) => toggleEnabled(method.id, checked)}
                    aria-label={
                      isAr ? `تفعيل ${method.nameAr}` : `Enable ${method.nameEn ?? method.nameAr}`
                    }
                  />
                </div>

                {/* ── Row 2: contexts. Only those the developers allow. ── */}
                {row.enabled && (
                  <div className="mt-2.5 border-t border-border/40 pt-2.5">
                    <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">
                      {isAr ? "يظهر في:" : "Appears in:"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {PAYMENT_CONTEXTS.filter((c) => method.allowedContexts.includes(c)).map(
                        (context) => {
                          const on = row.contexts.includes(context);
                          const label = PAYMENT_CONTEXT_LABELS[context];
                          return (
                            <button
                              key={context}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggleContext(method.id, context, !on)}
                              className={cn(
                                "inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium transition-all",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                                on
                                  ? "border-primary/60 bg-primary/10 text-foreground"
                                  : "border-border/60 bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                              )}
                            >
                              {on && <Check className="h-3 w-3" />}
                              {isAr ? label.ar : label.en}
                            </button>
                          );
                        },
                      )}
                    </div>
                    {method.allowedContexts.length < PAYMENT_CONTEXTS.length && (
                      <p className="mt-1.5 text-[10px] text-muted-foreground/80">
                        {isAr
                          ? `غير متاح في ${PAYMENT_CONTEXTS.length - method.allowedContexts.length} أقسام بحسب تعريف النظام.`
                          : `Not available in ${PAYMENT_CONTEXTS.length - method.allowedContexts.length} sections by system definition.`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Sticky action bar, matching the rest of Settings ── */}
      {(isDirty || isSaving) && (
        <div className="sticky bottom-4 z-30 flex items-center gap-2 rounded-2xl border border-border/70 bg-card/95 p-2.5 shadow-lg backdrop-blur-md">
          <span className="flex-1 ps-1 text-[11px] font-medium text-muted-foreground">
            {isAr ? "لديك تغييرات غير محفوظة" : "You have unsaved changes"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={isSaving}
            className="h-8 gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {isAr ? "تراجع" : "Revert"}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="h-8 gap-1.5 text-xs"
          >
            {isSaving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {isAr ? "حفظ" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

