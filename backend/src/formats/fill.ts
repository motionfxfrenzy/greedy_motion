import { anthropicMessage, responseText } from "../anthropic.ts";
// The model's part of fill mode: write the slots the caller did not supply, from the brief and the supplied facts.
// Claude can only return the skill's own slots, within their budgets (checked again here, with one repair attempt),
// and the skill's fill guidance is its system prompt. PLANNER=deterministic never calls a model: the caller must then
// supply every slot, and the route reports the missing ones.
import { config } from "../config.ts";
import type { FormatSkill } from "./bundle.ts";
import { aiSlots, normalizeValues, type Slot, type SlotProblem } from "./slots.ts";

const system = (skill: FormatSkill) => `You fill the content slots of a fixed-structure product video format.\n\n${skill.guidance}\n\nReturn only JSON that matches the schema. Every string must stay within its stated character limit.`;

function schema(slots: Slot[]) {
  const properties: Record<string, object> = {};
  for (const slot of slots) {
    const note = `${slot.purpose}${slot.maxChars ? ` At most ${slot.maxChars} characters.` : ""}`;
    properties[slot.id] = slot.type === "number" ? { type: "number", description: note }
      : slot.type === "text_list" ? { type: "array", description: note, items: slot.itemFields ? { type: "object", properties: Object.fromEntries(Object.keys(slot.itemFields).map((f) => [f, { type: "string" }])), required: Object.keys(slot.itemFields), additionalProperties: false } : { type: "string" } }
      : { type: "string", description: note };
  }
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

export type FillBrief = { story: string; brandName?: string };

/** Returns the model's values for the slots in `aiSlots(spec, supplied)`; throws with a user-safe message on failure. */
export async function fillSlots(skill: FormatSkill, brief: FillBrief, supplied: Record<string, unknown>, request = fetch): Promise<Record<string, unknown>> {
  const slots = aiSlots(skill.spec, supplied);
  if (!slots.length || config.planner !== "anthropic") return {};
  const facts = JSON.stringify(Object.fromEntries(Object.entries(supplied).filter(([key]) => !key.startsWith("_"))), null, 2);
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: `Product${brief.brandName ? ` (${brief.brandName})` : ""}:\n${brief.story}\n\nFacts already supplied by the person (do not change them):\n${facts}\n\nWrite these slots: ${slots.map((slot) => slot.id).join(", ")}.` }];
  let last: Record<string, unknown> = {};
  let problems: SlotProblem[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await requestSlots(skill, slots, messages, request);
    problems = normalizeValues({ ...skill.spec, slots }, last).problems;
    if (!problems.length) return last;
    messages.push({ role: "assistant", content: JSON.stringify(last) }, { role: "user", content: `These break the limits. Fix them and return every slot again:\n- ${problems.map((p) => `${p.slot}: ${p.message}`).join("\n- ")}` });
  }
  // Still over budget after the repair: hand back what we have; the route's validation reports the exact slots.
  return last;
}

async function requestSlots(skill: FormatSkill, slots: Slot[], messages: { role: "user" | "assistant"; content: string }[], request = fetch): Promise<Record<string, unknown>> {
  const payload = await anthropicMessage({
      model: config.anthropicModel,
      max_tokens: 2000,
      system: [{ type: "text", text: system(skill), cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { format: { type: "json_schema", schema: schema(slots) } }

    }, { request: request, timeoutMs: 60000, errorPrefix: "The slot fill request failed", includeErrorDetail: true, stopErrors: {"refusal": "The model declined to fill this format."} });
  const text = payload.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("") ?? "";
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("The model returned no usable slot values."); }
}
