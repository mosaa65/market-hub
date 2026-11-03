/**
 * Market-Hub ERP - React Hook for Offline & Sync Status
 */

import { useState, useEffect } from "react";
import { globalSyncEngine, SyncEngineStatus } from "@/lib/offline";

export function useOfflineSync() {
  const [status, setStatus] = useState<SyncEngineStatus>(globalSyncEngine.getStatus());

  useEffect(() => {
    const unsubscribe = globalSyncEngine.subscribe((newStatus) => {
      setStatus(newStatus);
    });
    return unsubscribe;
  }, []);

  return {
    ...status,
    triggerSync: () => globalSyncEngine.triggerSync(),
  };
}
