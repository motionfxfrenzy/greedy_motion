"use client";
import { createContext, useContext } from "react";
import type { ActionRegistry } from "../../lib/editor/actions.ts";

export const RegistryContext = createContext<ActionRegistry | null>(null);

export function useRegistry(): ActionRegistry {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error("useRegistry outside the editor");
  return registry;
}
