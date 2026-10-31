import type { FastifyReply } from "fastify";
import { config } from "../config.ts";

export class PromptRejectedError extends Error {
  readonly code: "prompt_rejected" | "prompt_flagged";
  constructor(decision: "deny" | "flag") {
    super(
      decision === "deny"
        ? "Your prompt was rejected because it violates our Acceptable Use Policy (no NSFW, sexual, deepfake, or harmful content). Please revise and try again."
        : "Your prompt could not be processed under our Acceptable Use Policy. Please revise and try again."
    );
    this.code = decision === "deny" ? "prompt_rejected" : "prompt_flagged";
  }
}

export class ModerationUnavailableError extends Error {
  readonly code = "moderation_unavailable";
  constructor() {
    super("Content moderation screening is temporarily unavailable. Please try again in a moment.");
  }
}

type CreemModerationResponse = {
  id?: string;
  object?: string;
  decision?: "allow" | "flag" | "deny";
};

/**
 * Screens user-supplied prompt text against the Creem Content Moderation API (`POST /v1/moderation/prompt`)
 * before any script, storyboard, scene, or media generation runs.
 *
 * - Blocks both `deny` and `flag` decisions (`PromptRejectedError` -> 400).
 * - Fails closed on network/HTTP timeouts or unexpected responses (`ModerationUnavailableError` -> 503).
 * - No-ops only in local/test environments when `CREEM_API_KEY` is not set.
 */
export async function screenPromptWithCreem(promptText: string, externalId: string): Promise<void> {
  const key = config.creemApiKey.trim();
  const cleaned = promptText.replace(/\s+/g, " ").trim();
  if (!key || !cleaned) return;

  const baseUrl = key.startsWith("creem_test_") ? "https://test-api.creem.io" : "https://api.creem.io";
  let data: CreemModerationResponse;
  try {
    const response = await fetch(`${baseUrl}/v1/moderation/prompt`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        prompt: cleaned.slice(0, 4000),
        external_id: externalId.slice(0, 120)
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      throw new Error(`creem_moderation_http_${response.status}`);
    }
    data = (await response.json()) as CreemModerationResponse;
  } catch (error) {
    if (error instanceof PromptRejectedError) throw error;
    throw new ModerationUnavailableError();
  }

  if (data.decision === "deny" || data.decision === "flag") {
    throw new PromptRejectedError(data.decision);
  }
  if (data.decision !== "allow") {
    throw new ModerationUnavailableError();
  }
}

/**
 * Helper for Fastify routes: screens one or more user-supplied text parts before proceeding.
 * Returns `false` and sends the HTTP 400/503 response if rejected or unavailable; returns `true` if allowed.
 */
export async function ensurePromptAllowed(
  reply: FastifyReply,
  parts: (string | null | undefined)[],
  externalId: string
): Promise<boolean> {
  const combined = parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join("\n");
  if (!combined) return true;
  try {
    await screenPromptWithCreem(combined, externalId);
    return true;
  } catch (error) {
    if (error instanceof PromptRejectedError) {
      reply.code(400).send({ error: { code: error.code, message: error.message } });
      return false;
    }
    reply.code(503).send({
      error: {
        code: "moderation_unavailable",
        message: error instanceof Error ? error.message : "Content moderation is temporarily unavailable."
      }
    });
    return false;
  }
}
