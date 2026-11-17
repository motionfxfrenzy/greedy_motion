// The storyboard cards of a template whose storyboardPreviews is "cast": the set pictures arrive from the backend (the only paid part), the page draws the
// cast on them with the film's own kit. See cast.ts (who and how) and draw.ts (the drawing).
import { getStoryboardKit } from "../api";
import { type CardBeat, type CardPlan, cardSignature, namesFrom, planCard } from "./cast";
import { type CardAspect, type Kit, drawCard, loadKit } from "./draw";

export { CAST_PREVIEW_TEMPLATES } from "./cast";

const kits = new Map<string, Promise<Kit>>();
/** The pack's kit, fetched once per page (the backend serves it transpiled, with an ETag). */
export function kitFor(packId: string): Promise<Kit> {
  let kit = kits.get(packId);
  if (!kit) {
    kit = getStoryboardKit(packId).then((js) => loadKit(js));
    kit.catch(() => kits.delete(packId));
    kits.set(packId, kit);
  }
  return kit;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("set picture")); img.src = src; });

/** Holds the set pictures of one project and draws a card from them. */
export class CardMaker {
  private sets = new Map<string, { image: HTMLImageElement; version: number }>();
  private kit: Kit | null = null;
  private version = 0;
  constructor(private readonly packId: string) {}

  /** Ready once the kit is loaded. A kit that cannot load leaves every card a key-phrase card. */
  async ready(): Promise<boolean> {
    if (this.kit) return true;
    try { this.kit = await kitFor(this.packId); return true; } catch { return false; }
  }
  async addSet(name: string, dataUrl: string): Promise<void> {
    const image = await loadImage(dataUrl);
    this.sets.set(name, { image, version: ++this.version });
  }
  knownSets(): string[] { return [...this.sets.keys()]; }
  hasSet(name: string | null): boolean { return Boolean(name && this.sets.has(name)); }

  /** The card of beat `index` (a JPEG data URL) and what it was drawn from, or null while its set or the kit is missing. */
  card(index: number, beats: readonly CardBeat[], aspect: CardAspect, notes?: { idea?: string | null } | null): { url: string; signature: string; plan: CardPlan } | null {
    if (!this.kit) return null;
    const plan = planCard(index, beats, namesFrom(beats, notes), this.knownSets());
    const set = plan.set ? this.sets.get(plan.set) : undefined;
    if (!plan.set || !set) return null;
    const url = drawCard({ kit: this.kit, setImage: set.image, place: plan.set.slice(4), aspect, plan, caption: beats[index]?.keyword ?? null });
    return { url, signature: cardSignature(plan, aspect, String(set.version)), plan };
  }
  /** The signature a card would have now, without drawing it. */
  signature(index: number, beats: readonly CardBeat[], aspect: CardAspect, notes?: { idea?: string | null } | null): string | null {
    const plan = planCard(index, beats, namesFrom(beats, notes), this.knownSets());
    const set = plan.set ? this.sets.get(plan.set) : undefined;
    return plan.set && set ? cardSignature(plan, aspect, String(set.version)) : null;
  }
  /** The set a beat stands in (null when the script names none and no set is known yet). */
  setOf(index: number, beats: readonly CardBeat[], notes?: { idea?: string | null } | null): string | null {
    return planCard(index, beats, namesFrom(beats, notes), this.knownSets()).set;
  }
}
