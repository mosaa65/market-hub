/**
 * Market-Hub ERP - Sync Status Indicator Component
 * Visual status indicator displaying network state and Outbox queue count.
 */

import React from "react";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { Wifi, WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function SyncStatusBadge({ className }: { className?: string }) {
  const { is_online, is_syncing, pending_count, rejected_count, triggerSync } = useOfflineSync();

  return (
    <div className={cn("flex items-center gap-2 text-xs font-medium", className)}>
      {is_online ? (
        <Badge
          variant="outline"
          className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 flex items-center gap-1.5 px-2.5 py-1"
        >
          <Wifi className="w-3.5 h-3.5" />
          <span>متصل</span>
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="bg-amber-500/10 text-amber-500 border-amber-500/20 flex items-center gap-1.5 px-2.5 py-1"
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>غير متصل (Offline)</span>
        </Badge>
      )}

      {pending_count > 0 && (
        <Badge
          variant="secondary"
          className="bg-blue-500/10 text-blue-400 border-blue-500/20 px-2 py-0.5"
        >
          {pending_count} معلقة
        </Badge>
      )}

      {rejected_count > 0 && (
        <Badge variant="destructive" className="flex items-center gap-1 px-2 py-0.5">
          <AlertCircle className="w-3 h-3" />
          <span>{rejected_count} متعارضة</span>
        </Badge>
      )}

      {is_online && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => triggerSync()}
          disabled={is_syncing}
          title="مزامنة فورية"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", is_syncing && "animate-spin text-primary")} />
        </Button>
      )}
    </div>
  );
}
