import type { StatementEntityType, StatementFieldKey } from "./types";
import { DEFAULT_REPORT_TYPE, type ReportType } from "./report-registry";

const STORAGE_KEY = "market_hub_reports_preferences_v1";
const EVENT_NAME = "market_hub_reports_preferences_changed";

export interface ReportPreferences {
  version: 1;
  reportType: ReportType;
  entityType: StatementEntityType;
  entityId: string;
  from: string;
  to: string;
  preset: string;
  includeZeroRows: boolean;
  visibleColumns: Partial<Record<StatementFieldKey, boolean>>;
}

export const DEFAULT_REPORT_PREFERENCES: ReportPreferences = {
  version: 1,
  reportType: DEFAULT_REPORT_TYPE,
  entityType: "customer",
  entityId: "",
  from: "",
  to: "",
  preset: "all",
  includeZeroRows: false,
  visibleColumns: {},
};

function normalize(raw: unknown): ReportPreferences {
  if (!raw || typeof raw !== "object") return DEFAULT_REPORT_PREFERENCES;
  const value = raw as Partial<ReportPreferences>;
  const entityType =
    value.entityType === "supplier" || value.entityType === "cash" ? value.entityType : "customer";
  return {
    ...DEFAULT_REPORT_PREFERENCES,
    ...value,
    version: 1,
    entityType,
    reportType:
      typeof value.reportType === "string" ? (value.reportType as ReportType) : DEFAULT_REPORT_TYPE,
    entityId: typeof value.entityId === "string" ? value.entityId : "",
    from: typeof value.from === "string" ? value.from : "",
    to: typeof value.to === "string" ? value.to : "",
    preset: typeof value.preset === "string" ? value.preset : "all",
    includeZeroRows: value.includeZeroRows === true,
    visibleColumns:
      value.visibleColumns && typeof value.visibleColumns === "object" ? value.visibleColumns : {},
  };
}

export function getReportPreferences(): ReportPreferences {
  if (typeof window === "undefined") return DEFAULT_REPORT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_REPORT_PREFERENCES;
  } catch {
    return DEFAULT_REPORT_PREFERENCES;
  }
}

export function saveReportPreferences(patch: Partial<ReportPreferences>): ReportPreferences {
  const next = normalize({ ...getReportPreferences(), ...patch });
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  } catch (error) {
    console.error("Failed to save report preferences:", error);
  }
  return next;
}

export function reportPreferencesEventName(): string {
  return EVENT_NAME;
}
