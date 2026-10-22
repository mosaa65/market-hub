import type { PaperSize } from "./types";

export type PaperProfileId = "a4" | "a5" | "thermal-80" | "thermal-58";

export interface PaperProfile {
  id: PaperProfileId;
  nameAr: string;
  nameEn: string;
  widthMm: number;
  heightMm: number | null;
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number };
  legacySize: PaperSize;
}

export const PAPER_PROFILES: Record<PaperProfileId, PaperProfile> = {
  a4: {
    id: "a4",
    nameAr: "A4",
    nameEn: "A4",
    widthMm: 210,
    heightMm: 297,
    orientation: "portrait",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    legacySize: "A4",
  },
  a5: {
    id: "a5",
    nameAr: "A5",
    nameEn: "A5",
    widthMm: 148,
    heightMm: 210,
    orientation: "portrait",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    legacySize: "A5",
  },
  "thermal-80": {
    id: "thermal-80",
    nameAr: "حراري 80mm",
    nameEn: "Thermal 80mm",
    widthMm: 80,
    heightMm: null,
    orientation: "portrait",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    legacySize: "80mm",
  },
  "thermal-58": {
    id: "thermal-58",
    nameAr: "حراري 58mm",
    nameEn: "Thermal 58mm",
    widthMm: 58,
    heightMm: null,
    orientation: "portrait",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    legacySize: "58mm",
  },
};

export function getPaperProfile(id: PaperProfileId): PaperProfile {
  return PAPER_PROFILES[id];
}

export function paperProfileForLegacySize(size: PaperSize): PaperProfileId {
  if (size === "A5") return "a5";
  if (size === "A4") return "a4";
  return size === "58mm" ? "thermal-58" : "thermal-80";
}

export function paperCss(profile: PaperProfile): string {
  const size = profile.heightMm
    ? `${profile.widthMm}mm ${profile.heightMm}mm`
    : `${profile.widthMm}mm auto`;
  const { top, right, bottom, left } = profile.margins;
  return `@page{size:${size};margin:${top}mm ${right}mm ${bottom}mm ${left}mm;}html,body{--print-paper-width:${profile.widthMm}mm;}`;
}
