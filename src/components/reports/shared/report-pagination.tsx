import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ReportPaginationProps {
  page: number;
  pageSize: number;
  totalPages: number;
  totalRowCount: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newPageSize: number) => void;
}

export function ReportPagination({
  page,
  pageSize,
  totalPages,
  totalRowCount,
  onPageChange,
  onPageSizeChange,
}: ReportPaginationProps) {
  const from = totalRowCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRowCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/20 p-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>عرض الصفوف:</span>
        <Select value={String(pageSize)} onValueChange={(val) => onPageSizeChange(Number(val))}>
          <SelectTrigger className="h-7 w-16 border-border text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
          </SelectContent>
        </Select>

        <span className="mr-2">
          إظهار <span className="font-mono font-medium text-foreground">{from}</span> -{" "}
          <span className="font-mono font-medium text-foreground">{to}</span> من إجمالي{" "}
          <span className="font-mono font-medium text-foreground">{totalRowCount}</span> سجل
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          className="h-7 w-7 p-0"
          title="الصفحة الأولى"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="h-7 w-7 p-0"
          title="الصفحة السابقة"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        <span className="px-2 font-mono text-xs">
          صفحة <span className="font-bold text-foreground">{page}</span> من{" "}
          <span className="font-bold text-foreground">{totalPages || 1}</span>
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="h-7 w-7 p-0"
          title="الصفحة التالية"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          className="h-7 w-7 p-0"
          title="الصفحة الأخيرة"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
