import type { Aspect } from "@videosaas/contracts";

const CANVAS: Record<Aspect, { width: number; height: number }> = { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 }, "1:1": { width: 1080, height: 1080 } };

/** A starting composition for a pro project: one stage, one paused GSAP timeline, one text clip. Renderable as is. */
export function blankComposition(aspect: Aspect = "16:9", durationSeconds = 10) {
  const { width, height } = CANVAS[aspect];
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #ffffff; }
  #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #f4f8fd; font-family: Inter, Helvetica, Arial, sans-serif; }
  .clip { position: absolute; }
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="${width}" data-height="${height}" data-duration="${durationSeconds}">
  <div id="title" class="clip" data-start="0" data-duration="${durationSeconds}" data-track-index="0" style="left:0; right:0; top:${Math.round(height * 0.42)}px; text-align:center; font:600 72px Inter,sans-serif; color:#0a0d12">Your title</div>
</div>
<script src="vendor/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  tl.fromTo("#title", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 0);
  window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
  return { html, canvas: { width, height }, durationSeconds };
}
