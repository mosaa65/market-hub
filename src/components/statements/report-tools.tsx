import { FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function exportReportRows(filename: string, headers: string[], rows: string[][]): void {
  const csv =
    "\ufeff" +
    [headers, ...rows]
      .map((row) => row.map((value) => JSON.stringify(value ?? "")).join(","))
      .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function printReportRows(
  title: string,
  headers: string[],
  rows: string[][],
  ar: boolean,
): void {
  const table = `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) return;
  win.document.write(
    `<html dir="${ar ? "rtl" : "ltr"}"><head><title>${escapeHtml(title)}</title><style>body{font-family:Arial;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;text-align:start}th{background:#eee}</style></head><body><h1>${escapeHtml(title)}</h1>${table}<script>window.onload=()=>window.print()</script></body></html>`,
  );
  win.document.close();
}

export function ReportRowDetails({
  open,
  onOpenChange,
  title,
  values,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  values: Array<[string, string]>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 rounded-lg border-border p-3">
          {values.map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between gap-4 border-b border-border/50 py-2 text-xs last:border-0"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="text-end font-medium">{value || "—"}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReportOutputButtons({
  ar,
  onExport,
  onPrint,
}: {
  ar: boolean;
  onExport: () => void;
  onPrint: () => void;
}) {
  return (
    <>
      <Button variant="outline" size="sm" onClick={onExport}>
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {ar ? "تصدير" : "Export"}
      </Button>
      <Button variant="outline" size="sm" onClick={onPrint}>
        <Printer className="h-3.5 w-3.5" />
        {ar ? "طباعة" : "Print"}
      </Button>
    </>
  );
}

function escapeHtml(value: string): string {
  return String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char,
  );
}
