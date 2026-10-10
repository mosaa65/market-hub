import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  Hash,
  LoaderCircle,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DATE_PART_PRESETS,
  NUMBERING_PRESETS,
  NUMBERING_TOKENS,
  PADDING_OPTIONS,
  applyDatePreset,
  detectPreset,
  formatHasToken,
  parseFormatParts,
  previewDocumentNumber,
  type DocumentNumberingRow,
  type NumberingDatePart,
} from "@/lib/document-numbering";

interface DocumentNumberingCardProps {
  isAr: boolean;
  canEdit: boolean;
}

/** Sample counter used ONLY for the live preview — never presented as real. */
const PREVIEW_SEQ = 125;
const DEMO_SEQ = 1;

const DATE_TOKEN_SET = ["{YYYY}", "{YY}", "{MM}", "{DD}"];

export function DocumentNumberingCard({ isAr, canEdit }: DocumentNumberingCardProps) {
  const [rows, setRows] = useState<DocumentNumberingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>("sales_invoice");

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("document_numbering")
      .select("*")
      .eq("scope", "global")
      .order("section")
      .order("document_type")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // The engine may not be deployed yet — fail softly, never crash Settings.
          setLoading(false);
          return;
        }
        setRows((data as DocumentNumberingRow[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeRow = useMemo(
    () => rows.find((r) => r.document_type === activeType) ?? rows[0],
    [rows, activeType],
  );

  const label = useCallback(
    (row: DocumentNumberingRow) => (isAr ? row.label_ar : row.label_en) || row.document_type,
    [isAr],
  );

  /** Optimistic local edit — nothing is persisted until Save is pressed. */
  const patchRow = useCallback((documentType: string, patch: Partial<DocumentNumberingRow>) => {
    setRows((current) =>
      current.map((r) => (r.document_type === documentType ? { ...r, ...patch } : r)),
    );
  }, []);

  const persist = useCallback(
    async (row: DocumentNumberingRow, nextValue?: number) => {
      setSavingType(row.document_type);
      const { error } = await supabase.rpc("fn_set_document_numbering", {
        p_document_type: row.document_type,
        p_prefix: row.prefix,
        p_format_tokens: row.format_tokens,
        p_padding: row.padding,
        p_date_part: row.date_part,
        p_separator: row.separator,
        p_reset_policy: row.reset_policy,
        p_next_value: nextValue ?? null,
      });
      setSavingType(null);

      if (error) {
        toast.error(error.message);
        return false;
      }
      toast.success(isAr ? "تم حفظ إعداد الترقيم" : "Numbering settings saved");
      return true;
    },
    [isAr],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        {isAr ? "جارٍ تحميل إعدادات الترقيم..." : "Loading numbering settings..."}
      </div>
    );
  }

  if (!activeRow) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-5 text-center text-xs text-muted-foreground">
        {isAr
          ? "لم يتم العثور على إعدادات الترقيم. تأكد من تطبيق ترحيل قاعدة البيانات."
          : "No numbering configuration found. Make sure the database migration is applied."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SectionHeader isAr={isAr} count={rows.length} />

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
        <DocumentPicker
          rows={rows}
          activeType={activeRow.document_type}
          label={label}
          isAr={isAr}
          onSelect={setActiveType}
        />

        <DocumentEditor
          row={activeRow}
          isAr={isAr}
          canEdit={canEdit}
          saving={savingType === activeRow.document_type}
          onPatch={(patch) => patchRow(activeRow.document_type, patch)}
          onPersist={(nextValue) => persist(activeRow, nextValue)}
        />
      </div>
    </div>
  );
}

/* ────────────────────────────── header ────────────────────────────── */

function SectionHeader({ isAr, count }: { isAr: boolean; count: number }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <Hash className="h-4 w-4 text-primary" />
      <span>{isAr ? "ترقيم المستندات" : "Document numbering"}</span>
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
        {count} {isAr ? "نوع مستند" : "document types"}
      </span>
    </div>
  );
}

/* ─────────────────────── document type selector ─────────────────────── */

function DocumentPicker({
  rows,
  activeType,
  label,
  isAr,
  onSelect,
}: {
  rows: DocumentNumberingRow[];
  activeType: string;
  label: (row: DocumentNumberingRow) => string;
  isAr: boolean;
  onSelect: (type: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, DocumentNumberingRow[]>();
    rows.forEach((r) => {
      const list = map.get(r.section) ?? [];
      list.push(r);
      map.set(r.section, list);
    });
    return Array.from(map.entries());
  }, [rows]);

  return (
    <div className="rounded-2xl border border-border/80 bg-surface/50 p-1.5 max-h-[420px] overflow-y-auto">
      {grouped.map(([section, items]) => (
        <div key={section} className="mb-1.5 last:mb-0">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {section}
          </div>
          <div className="space-y-0.5">
            {items.map((row) => {
              const active = row.document_type === activeType;
              return (
                <button
                  key={row.document_type}
                  type="button"
                  onClick={() => onSelect(row.document_type)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-xs transition",
                    active ? "bg-primary/10 text-primary font-semibold" : "hover:bg-surface-2",
                  )}
                >
                  <span className="min-w-0 truncate">{label(row)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0" dir="ltr">
                    {previewDocumentNumber(row, DEMO_SEQ)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── per document editor ─────────────────────────── */

function DocumentEditor({
  row,
  isAr,
  canEdit,
  saving,
  onPatch,
  onPersist,
}: {
  row: DocumentNumberingRow;
  isAr: boolean;
  canEdit: boolean;
  saving: boolean;
  onPatch: (patch: Partial<DocumentNumberingRow>) => void;
  onPersist: (nextValue?: number) => Promise<boolean>;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [nextValue, setNextValue] = useState<string>("");

  const presetId = detectPreset(row.format_tokens);
  const preview = previewDocumentNumber(row, PREVIEW_SEQ);
  const hasDate = DATE_TOKEN_SET.some((t) => formatHasToken(row.format_tokens, t));

  return (
    <div className="rounded-2xl border border-border/80 bg-surface/50 p-3 space-y-3">
      {/* ── Row 1: prefix + format + padding + separator, inline and compact ── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1 w-[92px]">
          <Label className="text-[10px] font-semibold text-muted-foreground">
            {isAr ? "البادئة" : "Prefix"}
          </Label>
          <Input
            value={row.prefix}
            onChange={(e) => onPatch({ prefix: e.target.value })}
            disabled={!canEdit}
            placeholder="INV"
            className="h-8 rounded-lg font-mono text-xs px-2"
            dir="ltr"
          />
        </div>

        <div className="grid gap-1 min-w-[190px] flex-1">
          <Label className="text-[10px] font-semibold text-muted-foreground">
            {isAr ? "طريقة الرقم" : "Number format"}
          </Label>
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={!canEdit}
                className="h-8 w-full justify-between rounded-lg px-2 text-xs font-normal"
              >
                <span className="truncate">
                  {presetId
                    ? (NUMBERING_PRESETS.find((p) => p.id === presetId)?.[
                        isAr ? "labelAr" : "labelEn"
                      ] ?? presetId)
                    : isAr
                      ? "تخصيص"
                      : "Custom"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0" dir="ltr">
                  {row.format_tokens}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[300px] p-1.5">
              <FormatChooser
                row={row}
                isAr={isAr}
                onPick={(patch) => {
                  onPatch(patch);
                  setCustomOpen(false);
                }}
                onCustom={() => setCustomOpen(false)}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid gap-1 w-[86px]">
          <Label className="text-[10px] font-semibold text-muted-foreground">
            {isAr ? "الأصفار" : "Padding"}
          </Label>
          <select
            value={String(row.padding)}
            onChange={(e) => onPatch({ padding: Number(e.target.value) })}
            disabled={!canEdit}
            className="h-8 rounded-lg border border-input bg-background px-1.5 text-xs font-mono disabled:opacity-50"
            dir="ltr"
          >
            {PADDING_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p === 0 ? "0 - 125" : `${p} - ${String(125).padStart(p, "0")}`}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1 w-[104px]">
          <Label className="text-[10px] font-semibold text-muted-foreground">
            {isAr ? "الفاصل" : "Separator"}
          </Label>
          <Input
            value={row.separator}
            onChange={(e) => onPatch({ separator: e.target.value })}
            disabled={!canEdit}
            placeholder="-"
            className="h-8 rounded-lg font-mono text-xs px-2 text-center"
            dir="ltr"
            maxLength={2}
          />
        </div>
      </div>

      {/* ── Row 2: token builder (only while "Custom") ── */}
      {!presetId && (
        <TokenBuilder row={row} isAr={isAr} canEdit={canEdit} hasDate={hasDate} onPatch={onPatch} />
      )}

      {/* ── Row 3: live preview ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <Eye className="h-3.5 w-3.5 text-primary" />
          {isAr ? "معاينة (رقم تجريبي)" : "Preview (sample number)"}
        </span>
        <strong className="font-mono text-sm tracking-wide" dir="ltr">
          {preview}
        </strong>
      </div>

      {/* ── Row 4: continuation / current sequence ── */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 bg-background px-3 py-2">
        <div className="grid gap-1 flex-1 min-w-[150px]">
          <Label className="text-[10px] font-semibold text-muted-foreground">
            {isAr ? "أول رقم قادم (اختياري)" : "Next number (optional)"}
          </Label>
          <Input
            type="number"
            min={1}
            value={nextValue}
            onChange={(e) => setNextValue(e.target.value)}
            disabled={!canEdit}
            placeholder={
              isAr ? "اتركه فارغاً للإبقاء على التسلسل" : "Leave empty to keep the sequence"
            }
            className="h-8 rounded-lg font-mono text-xs px-2"
            dir="ltr"
          />
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1 pb-1.5">
          <Hash className="h-3 w-3" />
          {isAr ? "الحالي:" : "Current:"} <span className="font-mono">{row.current_value}</span>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!canEdit || saving}
          onClick={async () => {
            const parsed = nextValue.trim() === "" ? undefined : Number(nextValue);
            const ok = await onPersist(parsed);
            if (ok) setNextValue("");
          }}
          className="h-8 rounded-lg gap-1.5 text-xs"
        >
          {saving ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {saving ? (isAr ? "جارٍ الحفظ" : "Saving") : isAr ? "حفظ" : "Save"}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
        {isAr
          ? "الأرقام الممنوحة سابقاً لا تتغير عند تعديل التنسيق، وكل نوع مستند له تسلسل مستقل."
          : "Changing the format never rewrites already-issued numbers, and each document type has its own independent sequence."}
      </p>
    </div>
  );
}

/* ─────────────────────────── preset chooser ─────────────────────────── */

function FormatChooser({
  row,
  isAr,
  onPick,
  onCustom,
}: {
  row: DocumentNumberingRow;
  isAr: boolean;
  onPick: (patch: Partial<DocumentNumberingRow>) => void;
  onCustom: () => void;
}) {
  const current = detectPreset(row.format_tokens);

  return (
    <div className="space-y-2">
      <div className="px-1.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {isAr ? "التنسيقات الجاهزة" : "Presets"}
      </div>
      <div className="space-y-0.5">
        {NUMBERING_PRESETS.map((preset) => {
          const selected = current === preset.id;
          // Preview each preset with this row's own prefix / padding / separator
          const sample = previewDocumentNumber(
            { ...row, format_tokens: preset.format },
            PREVIEW_SEQ,
          );
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                onPick({
                  format_tokens: preset.format,
                  date_part: datePartForFormat(preset.format),
                })
              }
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-xs transition",
                selected ? "bg-primary/10 text-primary font-semibold" : "hover:bg-surface-2",
              )}
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-border">
                  {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="truncate">{isAr ? preset.labelAr : preset.labelEn}</span>
              </span>
              <span className="font-mono text-[10px] text-muted-foreground shrink-0" dir="ltr">
                {sample}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-border/60 pt-1.5">
        <button
          type="button"
          onClick={onCustom}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs transition hover:bg-surface-2",
            !current && "bg-primary/10 text-primary font-semibold",
          )}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {isAr ? "تخصيص" : "Custom"}
        </button>
      </div>

      {/* Date shortcuts — presets over the very same token system */}
      <div className="border-t border-border/60 pt-1.5">
        <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {isAr ? "التاريخ" : "Date"}
        </div>
        <div className="grid grid-cols-2 gap-0.5">
          {DATE_PART_PRESETS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() =>
                onPick({
                  date_part: d.id,
                  format_tokens: applyDatePreset(row.format_tokens, d.id),
                })
              }
              className={cn(
                "rounded-md px-2 py-1 text-start text-[11px] transition hover:bg-surface-2",
                row.date_part === d.id && "bg-primary/10 text-primary font-semibold",
              )}
            >
              {isAr ? d.labelAr : d.labelEn}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── token builder ─────────────────────────── */

function TokenBuilder({
  row,
  isAr,
  canEdit,
  hasDate,
  onPatch,
}: {
  row: DocumentNumberingRow;
  isAr: boolean;
  canEdit: boolean;
  hasDate: boolean;
  onPatch: (patch: Partial<DocumentNumberingRow>) => void;
}) {
  const parts = parseFormatParts(row.format_tokens);
  const tokens = parts.filter((p) => NUMBERING_TOKENS.some((t) => t.token === p));

  const addToken = (token: string) => onPatch({ format_tokens: [...parts, token].join("") });

  const removeToken = (token: string) => {
    // Remove only the first occurrence, keeping the rest of the template intact.
    const index = parts.indexOf(token);
    if (index === -1) return;
    onPatch({ format_tokens: [...parts.slice(0, index), ...parts.slice(index + 1)].join("") });
  };

  const move = (token: string, direction: -1 | 1) => {
    const index = parts.indexOf(token);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= parts.length) return;
    const next = [...parts];
    [next[index], next[target]] = [next[target], next[index]];
    onPatch({ format_tokens: next.join("") });
  };

  return (
    <div className="rounded-xl border border-border/70 bg-background p-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {isAr ? "عناصر الرقم" : "Number elements"}
        </span>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onPatch({ format_tokens: "{PREFIX}-{SEQ}" })}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition hover:text-primary disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          {isAr ? "استعادة" : "Reset"}
        </button>
      </div>

      {/* Active tokens, reorderable */}
      <div className="flex flex-wrap gap-1">
        {tokens.length === 0 && (
          <span className="text-[11px] text-muted-foreground">
            {isAr ? "أضف عناصر من الأسفل" : "Add elements below"}
          </span>
        )}
        {tokens.map((token) => (
          <span
            key={token}
            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/70 ps-1.5 pe-0.5 py-0.5 text-[11px] font-mono"
            dir="ltr"
          >
            {token}
            <span className="inline-flex">
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => move(token, -1)}
                className="p-0.5 text-muted-foreground transition hover:text-primary disabled:opacity-40"
                aria-label="move up"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => move(token, 1)}
                className="p-0.5 text-muted-foreground transition hover:text-primary disabled:opacity-40"
                aria-label="move down"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => removeToken(token)}
                className="p-0.5 text-muted-foreground transition hover:text-destructive disabled:opacity-40"
                aria-label="remove"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </span>
        ))}
      </div>

      {/* Available tokens */}
      <div className="flex flex-wrap gap-1 border-t border-border/60 pt-2">
        {NUMBERING_TOKENS.filter((t) => t.token !== "{PREFIX}" || !row.prefix).map((t) => {
          const disabled =
            !canEdit ||
            t.token === "{SEQ}" ||
            parts.includes(t.token) ||
            (DATE_TOKEN_SET.includes(t.token) && hasDate);
          return (
            <button
              key={t.token}
              type="button"
              disabled={disabled}
              onClick={() => addToken(t.token)}
              className="rounded-md border border-dashed border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isAr ? t.labelAr : t.labelEn}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {isAr
          ? "التسلسل {SEQ} إلزامي، وبقية العناصر قابلة للترتيب والحذف."
          : "{SEQ} is required; every other element can be reordered or removed."}
      </p>
    </div>
  );
}

/* ────────────────────────────── helpers ────────────────────────────── */

function datePartForFormat(format: string): NumberingDatePart {
  const hasY = formatHasToken(format, "{YYYY}") || formatHasToken(format, "{YY}");
  const hasM = formatHasToken(format, "{MM}");
  const hasD = formatHasToken(format, "{DD}");
  if (hasY && hasM && hasD) return "full";
  if (hasY && hasM) return "year_month";
  if (hasY) return "year";
  return "none";
}
