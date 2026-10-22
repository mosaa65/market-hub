/**
 * Market-Hub ERP - Offline Auth Snapshot & Device Security Vault
 */

import { AuthSnapshot, OfflineAuthorityGrant } from "./types";

const AUTH_SNAPSHOT_KEY = "markethub_offline_auth_snapshot";
const AUTHORITY_GRANT_KEY = "markethub_offline_authority_grant";

export class AuthSnapshotManager {
  /**
   * Save online authenticated session snapshot for offline usage
   */
  static saveSnapshot(snapshot: AuthSnapshot): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(AUTH_SNAPSHOT_KEY, JSON.stringify(snapshot));
  }

  /**
   * Retrieve cached auth snapshot when offline
   */
  static getSnapshot(): AuthSnapshot | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(AUTH_SNAPSHOT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Verifies if local offline authority grant is valid and unexpired
   */
  static verifyOfflineGrant(): boolean {
    if (typeof window === "undefined") return false;
    try {
      const raw = localStorage.getItem(AUTHORITY_GRANT_KEY);
      if (!raw) return false;
      const grant: OfflineAuthorityGrant = JSON.parse(raw);

      const now = new Date().getTime();
      const expiration = new Date(grant.expires_at).getTime();

      return now < expiration;
    } catch {
      return false;
    }
  }

  static clearSnapshot(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(AUTH_SNAPSHOT_KEY);
    localStorage.removeItem(AUTHORITY_GRANT_KEY);
  }
}
