// Slot validation for fill-mode formats. A skill declares every piece of content it needs in references/slots.json
// (type, budget, whether it is a product fact, whether the model may write it). Everything that reaches a render goes
// through `normalizeValues`: the model's fill, the caller's values and the defaults all meet the same budgets.

export type Slot = {
  id: string;
  type: string; // text | text_list | number | logo | ...
  purpose: string;
  maxChars?: number;
  count?: { min?: number; max?: number };
  /** For a text_list of objects: each field and its maximum characters. */
  itemFields?: Record<string, number>;
  mustBeReal?: boolean;
  aiFillable?: boolean;
  default?: unknown;
  /** Where the value comes from when the caller does not supply it. */
  from?: "brand.name";
};
export type SkillSpec = { skill: string; version: string; canvas: string[]; duration?: { min: number; max: number }; clock?: string; slots: Slot[] };

export type SlotProblem = { slot: string; message: string };
/** What the template reads as HyperFrames variables: strings, numbers, and JSON text for lists. */
export type SlotValues = Record<string, string | number>;

const chars = (text: string) => Array.from(text).length;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Slots the caller or the model must supply (the logo comes from the brand kit, never from a request). */
export const writableSlots = (spec: SkillSpec) => spec.slots.filter((slot) => slot.type !== "logo");
/** Slots the model may write when the caller did not supply them. */
export const aiSlots = (spec: SkillSpec, supplied: Record<string, unknown>) =>
  writableSlots(spec).filter((slot) => slot.aiFillable && supplied[slot.id] === undefined);

export function normalizeValues(spec: SkillSpec, raw: Record<string, unknown>, context: { brandName?: string } = {}): { values: SlotValues; problems: SlotProblem[] } {
  const problems: SlotProblem[] = [];
  const values: SlotValues = {};
  const known = new Set(spec.slots.map((slot) => slot.id));
  for (const key of Object.keys(raw)) {
    if (key.startsWith("_")) continue;
    if (!known.has(key)) problems.push({ slot: key, message: "This is not a slot of this format." });
  }
  for (const slot of spec.slots) {
    let value = raw[slot.id];
    if (slot.type === "logo") {
      if (value !== undefined && value !== "") problems.push({ slot: slot.id, message: "The logo comes from the brand kit." });
      continue;
    }
    if ((value === undefined || value === null || value === "") && slot.from === "brand.name" && context.brandName) value = context.brandName;
    const missing = value === undefined || value === null || (typeof value === "string" && clean(value) === "" && slot.type === "text") || (Array.isArray(value) && value.length === 0 && slot.type === "text_list");
    if (missing) {
      if (slot.default !== undefined) { values[slot.id] = typeof slot.default === "string" || typeof slot.default === "number" ? slot.default : JSON.stringify(slot.default); continue; }
      if (slot.type === "text_list" && (slot.count?.min ?? 1) === 0) { values[slot.id] = "[]"; continue; }
      problems.push({ slot: slot.id, message: slot.mustBeReal && !slot.aiFillable ? "Needs a real value from you: it is a fact about the product." : "Missing." });
      continue;
    }
    if (slot.type === "text") {
      if (typeof value !== "string") { problems.push({ slot: slot.id, message: "Must be text." }); continue; }
      const text = clean(value);
      if (slot.maxChars !== undefined && chars(text) > slot.maxChars) problems.push({ slot: slot.id, message: `${chars(text)} characters; the limit is ${slot.maxChars}.` });
      else values[slot.id] = text;
    } else if (slot.type === "number") {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
      if (!Number.isFinite(n)) problems.push({ slot: slot.id, message: "Must be a number." });
      else values[slot.id] = n;
    } else if (slot.type === "text_list") {
      if (!Array.isArray(value)) { problems.push({ slot: slot.id, message: "Must be a list." }); continue; }
      const min = slot.count?.min ?? 0, max = slot.count?.max ?? Infinity;
      if (value.length < min || value.length > max) { problems.push({ slot: slot.id, message: `${value.length} items; need ${min === max ? min : `${min} to ${max}`}.` }); continue; }
      const items: unknown[] = [];
      let ok = true;
      value.forEach((item, index) => {
        if (slot.itemFields) {
          const fields = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const [field, limit] of Object.entries(slot.itemFields)) {
            const text = typeof fields[field] === "string" ? clean(fields[field] as string) : "";
            if (!text) { problems.push({ slot: slot.id, message: `Item ${index + 1} needs "${field}".` }); ok = false; }
            else if (chars(text) > limit) { problems.push({ slot: slot.id, message: `Item ${index + 1} "${field}" is ${chars(text)} characters; the limit is ${limit}.` }); ok = false; }
            else out[field] = text;
          }
          items.push(out);
        } else {
          const text = typeof item === "string" ? clean(item) : "";
          if (!text) { problems.push({ slot: slot.id, message: `Item ${index + 1} must be text.` }); ok = false; }
          else if (slot.maxChars !== undefined && chars(text) > slot.maxChars) { problems.push({ slot: slot.id, message: `Item ${index + 1} is ${chars(text)} characters; the limit is ${slot.maxChars}.` }); ok = false; }
          else items.push(text);
        }
      });
      if (ok) values[slot.id] = JSON.stringify(items);
    } else {
      problems.push({ slot: slot.id, message: `Slot type "${slot.type}" is not supported by the hosted builder.` });
    }
  }
  return { values, problems };
}
