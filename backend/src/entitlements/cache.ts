// Per-replica cache of a user's entitlement rows. It holds rows, not the verdict, so a plan that ends is noticed at its
// exact expires_at even inside the TTL. Other replicas learn of a change within the TTL (ENTITLEMENT_CACHE_SECONDS).
import type { EntitlementRow } from "./plans.ts";

export class EntitlementCache {
  private readonly entries = new Map<string, { rows: readonly EntitlementRow[]; at: number }>();
  get(userId: string, now: number, ttlMs: number): readonly EntitlementRow[] | undefined {
    const hit = this.entries.get(userId);
    if (!hit) return undefined;
    if (now - hit.at >= ttlMs) {
      this.entries.delete(userId);
      return undefined;
    }
    return hit.rows;
  }
  set(userId: string, rows: readonly EntitlementRow[], now: number) {
    this.entries.set(userId, { rows, at: now });
    // Bounded: a long-running replica must not remember every user it ever saw.
    if (this.entries.size > 5000) this.entries.delete(this.entries.keys().next().value as string);
  }
  delete(userId: string) { this.entries.delete(userId); }
  clear() { this.entries.clear(); }
}

/** The cache the running backend uses; the store invalidates it after every committed write. */
export const entitlementCache = new EntitlementCache();
