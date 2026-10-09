// entitlementsFor(userId): what the backend enforces. Reads the user's rows (cached briefly per replica), judges them
// with evaluate() at the current time, and fails closed: a database error never grants anything, it rejects.
import { config } from "../config.ts";
import { entitlementCache, type EntitlementCache } from "./cache.ts";
import { evaluate, localEntitlements } from "./evaluate.ts";
import type { EntitlementRow, Entitlements } from "./plans.ts";
import { listEntitlements } from "./store.ts";

/** The entitlement lookup failed (database down). Callers answer 503, never "allowed" and never "not on your plan". */
export class EntitlementsUnavailable extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Could not check your plan right now.", options);
  }
}

export type ResolverOptions = {
  load: (userId: string) => Promise<readonly EntitlementRow[]>;
  cache: EntitlementCache;
  ttlMs: number;
  /** AUTH_MODE=none: everyone is the local user and everything is on. */
  local: boolean;
  now?: () => number;
};

export function createResolver(options: ResolverOptions) {
  const now = options.now ?? Date.now;
  return {
    /** `fresh` skips the cache (and refreshes it): used by GET /v1/me/entitlements. */
    async entitlementsFor(userId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<Entitlements> {
      const at = now();
      if (options.local) return localEntitlements(new Date(at));
      let rows = !fresh && options.ttlMs > 0 ? options.cache.get(userId, at, options.ttlMs) : undefined;
      if (!rows) {
        try {
          rows = await options.load(userId);
        } catch (error) {
          throw new EntitlementsUnavailable({ cause: error });
        }
        if (options.ttlMs > 0) options.cache.set(userId, rows, at);
      }
      return evaluate(rows, new Date(at));
    }
  };
}

const resolver = createResolver({ load: listEntitlements, cache: entitlementCache, ttlMs: config.entitlementCacheSeconds * 1000, local: config.auth.mode === "none" });
export const entitlementsFor = resolver.entitlementsFor;
