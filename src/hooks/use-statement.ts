/**
 * useStatement — الجسر الوحيد بين الواجهة و Statement Engine
 *
 * كل شاشة كشوف تستخدم هذا الـ hook. لا تحسب أي شاشة رصيدًا بنفسها.
 *
 * الأداء (Phase 12 في الخطة):
 *   - React Query cache بمفتاح الكشف الكامل → لا إعادة جلب عند التنقل.
 *   - Engine نقي يُنفَّذ في useMemo لا في render مباشر.
 *   - الحركات تُجلَب مفلترة بمعرّف الجهة (لا جلب زائد).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildStatement } from "@/lib/statements/engine";
import { loadStatementSource } from "@/lib/statements/adapters";
import { loadStatementCompany } from "@/lib/statements/company";
import { resolveStatementLayout, defaultTemplateFor } from "@/lib/statements/templates";
import { getStatementSettings, useStatementSettings } from "@/lib/statements/settings";
import type {
  StatementEntityType,
  StatementLayout,
  StatementRequest,
  StatementResult,
  StatementTemplateId,
} from "@/lib/statements/types";
import type { StatementCompanyInfo } from "@/lib/statements/company";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Query keys — نقطة واحدة لإبطال الكاش
// ---------------------------------------------------------------------------

export const statementKeys = {
  all: ["statements"] as const,
  source: (entityType: StatementEntityType, entityId: string) =>
    [...statementKeys.all, "source", entityType, entityId] as const,
  company: () => [...statementKeys.all, "company"] as const,
  debts: (entityType: StatementEntityType) => [...statementKeys.all, "debts", entityType] as const,
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UseStatementOptions {
  entityType: StatementEntityType;
  entityId: string;
  from?: string | null;
  to?: string | null;
  includeZeroRows?: boolean;
  /** قالب صريح — وإلا يُستخدم الافتراضي من الإعدادات */
  templateId?: StatementTemplateId;
  /** تعطيل الجلب حتى يضغط المستخدم «إنشاء الكشف» */
  enabled?: boolean;
}

export interface UseStatementReturn {
  result: StatementResult | null;
  layout: StatementLayout | null;
  company: StatementCompanyInfo | null;
  hasSourceData: boolean;
  derived: boolean;
  breakdown?: { collections: number; supplierPayments: number; expenses: number };
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStatement(options: UseStatementOptions): UseStatementReturn {
  const { lang } = useI18n();
  const { settings } = useStatementSettings();

  const {
    entityType,
    entityId,
    from = null,
    to = null,
    includeZeroRows,
    templateId,
    enabled = true,
  } = options;

  const effectiveIncludeZeroRows = includeZeroRows ?? settings.includeZeroRowsDefault;

  // 1) قراءة المصدر (adapters) — مخزّنة بمفتاح الجهة فقط
  const sourceQuery = useQuery({
    queryKey: statementKeys.source(entityType, entityId),
    queryFn: () => loadStatementSource(entityType, entityId, lang),
    enabled: enabled && Boolean(entityId),
    staleTime: 30_000,
  });

  // 2) بيانات المنشأة للطباعة — مخزّنة بمفتاح عام
  const companyQuery = useQuery({
    queryKey: statementKeys.company(),
    queryFn: () => loadStatementCompany(),
    staleTime: 5 * 60_000,
  });

  // 3) الحساب — نقي ومحسوب محليًا في useMemo (لا رحلة شبكة)
  const request: StatementRequest = useMemo(
    () => ({
      entityType,
      entityId,
      from,
      to,
      includeZeroRows: effectiveIncludeZeroRows,
    }),
    [entityType, entityId, from, to, effectiveIncludeZeroRows],
  );

  const result = useMemo<StatementResult | null>(() => {
    const source = sourceQuery.data;
    if (!source) return null;
    return buildStatement({
      request,
      entity: source.entity,
      entries: source.entries,
      cachedBalance: source.cachedBalance,
      lang,
    });
  }, [sourceQuery.data, request, lang]);

  // 4) الوصف البصري (Layout) — يستهلك نتيجة الحساب + إعدادات المستخدم
  const resolvedTemplate = templateId ?? settings.defaultTemplate ?? defaultTemplateFor(entityType);

  const layout = useMemo<StatementLayout | null>(() => {
    if (!result) return null;
    return resolveStatementLayout({ result, settings, templateId: resolvedTemplate, lang });
  }, [result, settings, resolvedTemplate, lang]);

  return {
    result,
    layout,
    company: companyQuery.data ?? null,
    hasSourceData: sourceQuery.data?.hasSourceData ?? false,
    derived: sourceQuery.data?.derived ?? false,
    breakdown: sourceQuery.data?.breakdown,
    isLoading: sourceQuery.isLoading || companyQuery.isLoading,
    isError: sourceQuery.isError || companyQuery.isError,
    error: (sourceQuery.error as Error | null) ?? null,
    refetch: () => {
      void sourceQuery.refetch();
    },
  };
}

/**
 * إعدادات الكشف الحالية بشكل متزامن (للاستخدام في المكوّنات التي لا تحتاج Hook).
 * مُغلَّف لتفادي استيراد قابل للخطأ في مسارات SSR.
 */
export function currentStatementSettings() {
  return getStatementSettings();
}
