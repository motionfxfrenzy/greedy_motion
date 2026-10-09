// The capability the Pro editor's mutating code requires. A route gets one only from requireProEdit(request), which
// checks the entitlement the gate resolved for this request; helpers that change Pro state (open a project, write
// files, queue a render) take it as a parameter, so a new code path cannot mutate Pro state without going through the
// check: it does not compile.
import type { FastifyRequest } from "fastify";
import type { ProEditorAccess } from "./plans.ts";

declare const proEditBrand: unique symbol;
export type ProEditAccess = { readonly [proEditBrand]: true; readonly userId: string };

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the Pro gate: what this caller may do in the Pro editor. */
    proAccess?: ProEditorAccess;
    proUserId?: string;
  }
  interface FastifyContextConfig {
    /** Required on every route in the Pro plugin (pro/routes.ts): `view` is allowed for a lapsed plan, `edit` is not. */
    proAccess?: "view" | "edit";
  }
}

export class NotEntitled extends Error {}

/** Throws unless the gate resolved full access for this request. */
export function requireProEdit(request: FastifyRequest): ProEditAccess {
  if (request.proAccess !== "edit" || !request.proUserId) throw new NotEntitled("Editing in the Pro editor needs an active plan.");
  return { userId: request.proUserId } as ProEditAccess;
}
