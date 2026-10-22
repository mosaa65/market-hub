export type PrintOrientation = "portrait" | "landscape";
export type PrintPaperId = "a4" | "a5" | "thermal-80" | "thermal-58";

export interface PrintPaperProfile {
  id: PrintPaperId;
  nameAr: string;
  nameEn: string;
  widthMm: number;
  heightMm: number | null;
  orientation: PrintOrientation;
  marginsMm: { top: number; right: number; bottom: number; left: number };
  thermal: boolean;
}

export const PRINT_PAPERS: Record<PrintPaperId, PrintPaperProfile> = {
  a4: {
    id: "a4",
    nameAr: "A4",
    nameEn: "A4",
    widthMm: 210,
    heightMm: 297,
    orientation: "portrait",
    marginsMm: { top: 10, right: 10, bottom: 12, left: 10 },
    thermal: false,
  },
  a5: {
    id: "a5",
    nameAr: "A5",
    nameEn: "A5",
    widthMm: 148,
    heightMm: 210,
    orientation: "portrait",
    marginsMm: { top: 8, right: 8, bottom: 10, left: 8 },
    thermal: false,
  },
  "thermal-80": {
    id: "thermal-80",
    nameAr: "حراري 80mm",
    nameEn: "Thermal 80mm",
    widthMm: 80,
    heightMm: null,
    orientation: "portrait",
    marginsMm: { top: 3, right: 4, bottom: 4, left: 4 },
    thermal: true,
  },
  "thermal-58": {
    id: "thermal-58",
    nameAr: "حراري 58mm",
    nameEn: "Thermal 58mm",
    widthMm: 58,
    heightMm: null,
    orientation: "portrait",
    marginsMm: { top: 2, right: 3, bottom: 3, left: 3 },
    thermal: true,
  },
};

export function paperCss(profile: PrintPaperProfile, orientation = profile.orientation): string {
  const width =
    orientation === "landscape" && profile.heightMm ? profile.heightMm : profile.widthMm;
  const height =
    orientation === "landscape" && profile.heightMm ? profile.widthMm : profile.heightMm;
  const size = height ? `${width}mm ${height}mm` : `${width}mm auto`;
  const m = profile.marginsMm;
  return `@page{size:${size};margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;} :root{--print-width:${width}mm;}`;
}
