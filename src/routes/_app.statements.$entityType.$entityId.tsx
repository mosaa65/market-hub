/**
 * /statements/$entityType/$entityId — مستند الكشف النهائي
 *
 * ⚠️ هذا هو أول مسار يصل إليه المستخدم بعد «إنشاء الكشف».
 * لا شاشة معاينة وسيطة (Phase 8 في الخطة).
 *
 * الفلاتر تُنقل بالكامل في search params → الرابط قابل للمشاركة وإعادة التحميل
 * بدون إعادة اختيار أي شيء.
 */

import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { useStatement } from "@/hooks/use-statement";
import { StatementDocument } from "@/components/statements/statement-document";
import { useStatementSettings } from "@/lib/statements/settings";
import {
  DEFAULT_COMPANY_INFO,
  resolveCurrencySymbol,
  type StatementCompanyInfo,
} from "@/lib/statements/company";
import { TEMPLATE_ORDER, defaultTemplateFor } from "@/lib/statements/templates";
import { CASH_ENTITY_ID } from "@/lib/statements/adapters/cash";
import type { StatementEntityType, StatementTemplateId } from "@/lib/statements/types";

const statementSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  template: z.string().optional(),
  includeZero: z.string().optional(),
});

const ENTITY_TYPES: StatementEntityType[] = ["customer", "supplier", "cash"];

export const Route = createFileRoute("/_app/statements/$entityType/$entityId")({
  validateSearch: (search: Record<string, unknown>) => statementSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "كشف الحساب — Market Hub" }] }),
  component: () => (
    <ModuleGuard moduleId="payments">
      <StatementDocumentPage />
    </ModuleGuard>
  ),
});

function StatementDocumentPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const params = Route.useParams();
  const search = Route.useSearch();
  const { settings } = useStatementSettings();

  const entityType = (
    ENTITY_TYPES.includes(params.entityType as StatementEntityType) ? params.entityType : "customer"
  ) as StatementEntityType;
  const entityId = params.entityId || CASH_ENTITY_ID;

  const settingsTemplate = settings.defaultTemplate ?? defaultTemplateFor(entityType);
  const [templateId, setTemplateId] = useState<StatementTemplateId>(settingsTemplate);

  // مزامنة القالب: ما وصل في الرابط، وإلا الافتراضي من الإعدادات
  useEffect(() => {
    const requested = search.template as StatementTemplateId | undefined;
    if (requested && TEMPLATE_ORDER.includes(requested)) {
      setTemplateId(requested);
      return;
    }
    setTemplateId(settingsTemplate);
  }, [search.template, settingsTemplate]);

  const includeZeroRows = search.includeZero === "1";

  const { result, layout, company, isLoading, hasSourceData, derived, refetch } = useStatement({
    entityType,
    entityId,
    from: search.from ?? null,
    to: search.to ?? null,
    includeZeroRows,
    templateId,
    enabled: Boolean(entityId),
  });

  const currencySymbol = useMemo(
    () =>
      resolveCurrencySymbol(
        settings.currencySymbolOverride,
        company?.currencySymbol ?? DEFAULT_COMPANY_INFO.currencySymbol,
      ),
    [settings.currencySymbolOverride, company?.currencySymbol],
  );

  // تغيير القالب من داخل المستند يُحدّث الرابط ليصبح قابلًا للمشاركة
  function handleTemplateChange(id: StatementTemplateId) {
    setTemplateId(id);
    void navigate({
      to: "/statements/$entityType/$entityId",
      params: { entityType, entityId },
      search: { ...search, template: id } as never,
      replace: true,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">
          {ar ? "كشف حساب" : "Account statement"} —{" "}
          {entityType === "supplier"
            ? ar
              ? "مورد"
              : "Supplier"
            : entityType === "cash"
              ? ar
                ? "الخزينة"
                : "Treasury"
              : ar
                ? "عميل"
                : "Customer"}
        </h1>
        {result?.entity?.name && (
          <span className="text-sm text-muted-foreground">{result.entity.name}</span>
        )}
      </div>

      <StatementDocument
        result={result}
        layout={layout}
        company={company as StatementCompanyInfo | null}
        currencySymbol={currencySymbol}
        templateId={templateId}
        onTemplateChange={handleTemplateChange}
        isLoading={isLoading}
        hasSourceData={hasSourceData}
        derived={derived}
        onRefetch={refetch}
        filtersLink={{
          to: "/account-statement",
          search:
            entityType === "cash"
              ? ({ entityType } as Record<string, unknown>)
              : ({ entityType, entityId } as Record<string, unknown>),
        }}
      />
    </div>
  );
}
