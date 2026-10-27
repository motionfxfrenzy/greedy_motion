// Writes the script draft for a few briefs and prints the opening, its alternatives and the caption. Needs ANTHROPIC_API_KEY.
process.env.APP_ENV ??= "local"; process.env.PLANNER ??= "anthropic";
const { briefs } = await import("./briefs.mjs");
const { draftScript } = await import("../../backend/src/plan/script-draft.ts");
const { inferVideoType } = await import("../../packages/contracts/src/index.ts");
const extra = [{ id: "v1-verse", text: "Love Your Enemies. Matthew 5:43-48. You have heard it said love your neighbour and hate your enemy, but I say to you, love your enemies and pray for those who persecute you.", seconds: 40, theme: "neutral", styleNote: "oil paint, warm and reverent", screens: [] }];
for (const brief of [...briefs.filter((b) => ["p1-ad", "e1-binary-search", "s1-story"].includes(b.id)), ...extra]) {
  const spec = { scriptMode: "problem", text: brief.text, durationSeconds: brief.seconds, aspect: "16:9", motionProfile: "smooth", pace: "balanced", audio: { mode: "voiceover", voice: "Kore" }, captions: "key-phrases", template: null, theme: brief.theme, ...(brief.styleNote ? { styleNote: brief.styleNote } : {}), ...(brief.product ? { productName: brief.product } : {}) };
  const context = { brandName: brief.product ?? "Your product", productNamed: Boolean(brief.product), ...(brief.description ? { brandDescription: brief.description } : {}), screenshots: [] };
  const { script, ms } = await draftScript(spec, context);
  console.log(`\n=== ${brief.id} (${inferVideoType({ text: brief.text })}, ${Math.round(ms / 1000)}s)  "${script.title}"  type=${script.videoType}`);
  console.log("OPEN :", script.lines[0].voiceover, "|", script.lines[0].visual);
  for (const hook of script.hooks ?? []) console.log("  alt :", hook);
  console.log("CAPTION:", script.caption);
  console.log("ROLES:", script.lines.map((l) => l.role).join(" > "), "| last:", script.lines.at(-1).voiceover);
}
