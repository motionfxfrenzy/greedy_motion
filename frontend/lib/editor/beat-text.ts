/**
 * The words of a film that was opened from a storyboard. Its scenes are drawn by the film's own script from a plan, so
 * the words are not elements the clips list can select: they live in the page's one JSON block (`hf-variables`), as the
 * plan and as per-frame overrides (`b1.keyword`, `b1.on_screen`). Reading and writing that block is all this does.
 */
const BLOCK = /(<script id="hf-variables" type="application\/json">)([\s\S]*?)(<\/script>)/;
const EDITABLE = /^b\d+\.(keyword|on_screen)$/;

export type BeatText = { id: string; role: string; keyword: string; onScreen: string };

type Block = Record<string, unknown>;

function parseBlock(html: string): { block: Block; match: RegExpExecArray } | null {
  const match = BLOCK.exec(html);
  if (!match) return null;
  try {
    const block = JSON.parse(match[2] || "{}") as unknown;
    return block && typeof block === "object" && !Array.isArray(block) ? { block: block as Block, match } : null;
  } catch {
    return null;
  }
}

const planOf = (block: Block): { beats?: { id?: string; role?: string; keyword?: string; on_screen?: string }[] } | null => {
  const raw = block.plan;
  try {
    const plan = typeof raw === "string" ? JSON.parse(raw) : raw;
    return plan && typeof plan === "object" ? plan : null;
  } catch {
    return null;
  }
};

/** The frames and their words, or null when this composition is not a storyboard film. */
export function readBeatText(html: string): BeatText[] | null {
  const parsed = parseBlock(html);
  const plan = parsed && planOf(parsed.block);
  if (!parsed || !plan || !Array.isArray(plan.beats) || plan.beats.length === 0) return null;
  const text = (key: string, fallback: unknown) => (typeof parsed.block[key] === "string" ? (parsed.block[key] as string) : typeof fallback === "string" ? fallback : "");
  return plan.beats.filter((beat) => typeof beat.id === "string").map((beat) => ({
    id: beat.id as string,
    role: beat.role ?? "",
    keyword: text(`${beat.id}.keyword`, beat.keyword),
    onScreen: text(`${beat.id}.on_screen`, beat.on_screen)
  }));
}

/** Sets one frame's word (`b1.keyword`, `b1.on_screen`). Anything else is refused and the page returned unchanged. */
export function writeBeatText(html: string, key: string, value: string): string {
  const parsed = parseBlock(html);
  if (!parsed || !EDITABLE.test(key)) return html;
  const json = JSON.stringify({ ...parsed.block, [key]: value }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return html.replace(BLOCK, (_all, open: string, _old: string, close: string) => open + json + close);
}
