import type { CutoutAspect, CutoutDraft, CutoutSpec, SentenceTiming } from "@videosaas/contracts";
import { cutoutPlannerBrief, normalizeDraftCoverage, resolveCutoutTimings } from "@videosaas/contracts";
import { llmJson } from "../llm.ts";

/**
 * Deliberately small: providers refuse deeply nested, enum-heavy schemas ("too many states for serving"), but an empty `{type: "object"}` makes them emit `{}`, so every field is declared (no enums). The vocabulary of
 * every field is enforced by cutoutSpecProblems() after resolving, with one repair round, and the vocabulary is in the prompt.
 * Every `required` key must still be declared under `properties`.
 */
export const DRAFT_SCHEMA = {
  type: "object", required: ["aspect", "shots"],
  properties: {
    aspect: { type: "string" },
    shots: { type: "array", items: {
      type: "object", required: ["sentences", "set", "cast"],
      properties: {
        sentences: { type: "array", items: { type: "integer" } },
        set: { type: "string" }, mood: { type: "string" },
        props: { type: "array", items: { type: "string" } },
        cast: { type: "array", items: { type: "object", required: ["archetype"], properties: {
          archetype: { type: "string" }, name: { type: "string" }, x: { type: "number" }, scale: { type: "number" }, pose: { type: "string" }, expr: { type: "string" }, flip: { type: "boolean" },
          talkSentences: { type: "array", items: { type: "integer" } },
          gestures: { type: "array", items: { type: "object", required: ["atSentence", "pose"], properties: { atSentence: { type: "integer" }, offset: { type: "number" }, pose: { type: "string" }, hold: { type: "number" } } } },
          expressions: { type: "array", items: { type: "object", required: ["atSentence", "expr"], properties: { atSentence: { type: "integer" }, offset: { type: "number" }, expr: { type: "string" } } } },
          look: { type: "object", properties: { skin: { type: "string" }, hair: { type: "string" }, hairColor: { type: "string" }, shirt: { type: "string" }, jacket: { type: "string" }, pants: { type: "string" }, shoes: { type: "string" }, stetson: { type: "string" }, bandana: { type: "string" }, female: { type: "boolean" }, glasses: { type: "boolean" }, mustache: { type: "boolean" }, stubble: { type: "boolean" } } }
        } } },
        overlays: { type: "array", items: { type: "object", required: ["type", "text"], properties: {
          type: { type: "string" }, text: { type: "string" }, sub: { type: "string" }, target: { type: "integer" }, speaker: { type: "integer" },
          atSentence: { type: "integer" }, offset: { type: "number" }, forSentences: { type: "integer" }, stars: { type: "integer" }, think: { type: "boolean" }
        } } }
      }
    } }
  }
};

export async function planDraft(sentences: SentenceTiming[], aspect: CutoutAspect, characters: { id: string; description: string }[] = []): Promise<{ spec: CutoutSpec; draft: CutoutDraft } | { error: string }> {
  const cast = characters.length
    ? `Story characters (keep each one the SAME archetype, name and look in every shot they appear in; invent an original cutout name if the description names a famous character; match the description with archetype, hair, and colours in \`look\`):\n${characters.map((c) => `- ${c.id}: ${c.description}`).join("\n")}\n\n`
    : "";
  const user = `${cast}Voiceover sentences (index: text):\n${sentences.map((s, i) => `${i}: ${s.text}`).join("\n")}\n\nAspect: ${aspect}. The last sentence index is ${sentences.length - 1}: the final shot must end there. Return the CutoutDraft JSON.`;
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await llmJson({ step: "script", system: cutoutPlannerBrief, user: attempt === 0 ? user : `${user}\n\nYour previous draft was rejected: ${last}\nFix exactly those problems and return the full draft again.`, history: attempt === 0 ? [] : history, schema: DRAFT_SCHEMA, maxTokens: 6000 });
    let draft: CutoutDraft;
    try { draft = JSON.parse(result.text) as CutoutDraft; } catch { last = "the answer was not valid JSON"; continue; }
    draft.aspect = aspect;
    const resolved = resolveCutoutTimings(normalizeDraftCoverage(draft, sentences.length), sentences);
    if ("spec" in resolved) {
      const wanted = Math.ceil(sentences.length / 3);
      if (resolved.spec.shots.length < wanted) { last = `only ${resolved.spec.shots.length} shot(s): use at least ${wanted} shots of 1 to 3 sentences each, with a different set, mood or cast where the story moves`; continue; }
      return { spec: resolved.spec, draft: normalizeDraftCoverage(draft, sentences.length) };
    }
    last = resolved.error;
  }
  return { error: last };
}

