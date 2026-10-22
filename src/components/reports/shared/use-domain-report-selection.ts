import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ReportRegistry } from "@/lib/reports/registry";
import type { ReportDomain } from "@/lib/reports/types";
import { REPORT_DOMAINS_CONFIG } from "./domain-report-shell";
import {
  getCustomTemplates,
  customTemplateToReportDefinition,
} from "@/lib/reports/custom-templates-store";

/** يحفظ التقرير النشط في الرابط ويدعم القوالب القياسية والمخصصة. */
export function useDomainReportSelection(domain: ReportDomain, defaultReportId: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeReportId, setActiveReportId] = useState(defaultReportId);

  // تسجيل أي قوالب مخصصة محفوظة في السجل المركزي
  useEffect(() => {
    const customs = getCustomTemplates(domain);
    for (const cst of customs) {
      ReportRegistry.register(customTemplateToReportDefinition(cst));
    }
  }, [domain]);

  useEffect(() => {
    const requested = new URLSearchParams(location.searchStr ?? "").get("report");
    if (!requested) {
      setActiveReportId(defaultReportId);
      return;
    }

    let definition = ReportRegistry.get(requested);
    if (!definition) {
      const custom = getCustomTemplates(domain).find((t) => t.id === requested);
      if (custom) {
        definition = customTemplateToReportDefinition(custom);
        ReportRegistry.register(definition);
      }
    }

    setActiveReportId(definition && definition.domain === domain ? definition.id : defaultReportId);
  }, [location.searchStr, domain, defaultReportId]);

  const selectReport = (reportId: string) => {
    let definition = ReportRegistry.get(reportId);
    if (!definition) {
      const custom = getCustomTemplates(domain).find((t) => t.id === reportId);
      if (custom) {
        definition = customTemplateToReportDefinition(custom);
        ReportRegistry.register(definition);
      }
    }

    if (!definition || definition.domain !== domain) return;
    setActiveReportId(reportId);
    const path = REPORT_DOMAINS_CONFIG.find((entry) => entry.id === domain)?.path;
    if (!path) return;
    navigate({ to: path as never, search: { report: reportId } as never });
  };

  return { activeReportId, selectReport };
}
