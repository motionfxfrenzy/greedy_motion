import { inferScriptTemplate, type Aspect, type BrandColors, type ScriptBeat, type ScriptNotes } from "@videosaas/contracts";
import { config } from "../config.ts";
import { callModel } from "../models/providers.ts";
import { routeFor } from "../models/routes.ts";
import { selectVisualWorld } from "./script-writer.ts";

/**
 * Reference frames for the script canvas: one still SVG per beat, drawn by the model in the chosen template's style (its
 * reference code is the style guide). They are sketches to judge the script by, not the film. The page shows them as
 * `<img src="data:image/svg+xml,…">`, where nothing in them can run; `cleanSvg` strips scripts and links anyway.
 */
export const FRAME_SIZE: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 1080, height: 1080 }
};

const SYSTEM = [
  "You draw one still reference frame for one beat of a short motion-graphics video, as a single SVG.",
  "Answer with the SVG only: it starts with <svg and ends with </svg>. No markdown, no prose, no comments.",
  "Rules:",
  "- Use the exact width, height and viewBox you are given. Paint the full background first.",
  "- Draw the beat's key moment: the objects the VISUAL line names, laid out as the finished frame would show them.",
  "- Compose the primary focal subject, room action, and diagrams in the upper-middle focal band (roughly 18% to 65% of frame height, i.e. Y=130..468 on 1280x720, and 14% to 86% of frame width) with balanced top headroom and bottom ground padding across all aspect ratios (16:9, 9:16, and 1:1) so the bottom 30% (Y>480 on 1280x720) remains a clean floor or dark ground for the player's subtitle overlay. Never make the frame bottom-heavy, keep complete character/prop geometry (such as a balloon and its hanging basket) above the bottom caption safe zone, and draw background hills/landscapes before foreground subjects so hills never occlude the subject.",
  "- Follow the VISUAL line's shot/role tag when present:",
  "  - [A-ROLL: HERO MEDIUM SHOT]: Frame the person chest-up / shoulders-up (head r=92..108 on 720x1280, r=74..88 on 1280x720) inside the specific real-world environment so BOTH the environment AND the Hero Object register immediately. CONTEXT-AWARE OBJECT PLACEMENT: If the Hero Object is a surface/tabletop item (bottle, thermos, mug, cup, laptop, speaker, food, microscope), place the character on the left third (X=190..230 on 720x1280, X=420..480 on 1280x720) and place the Hero Object upright on a grounded foreground table/counter/beach-table surface (#table) on the right third (X=480..530 on 720x1280, X=780..850 on 1280x720) — NEVER place a bottle, mug, or non-headwear prop over the character's head or face! Only head-worn items (headphones, glasses, helmet, crown) sit on the head. Draw the Hero Object large (180px–260px) with at least 5 distinct SVG shapes showing all of its recognizable physical parts.",
  "  - CONTEXT-AWARE DAYTIME / ENVIRONMENT LIGHTING: Match the [A-ROLL] stage window (Y=160..830 on 720x1280, Y=84..470 on 1280x720) to the scene's real time of day and weather! For daytime, morning, summer heat, beach, desert, or snow-day scenes, paint a BRIGHT sunlit stage backdrop: e.g. Sunny Beach = bright sky gradient (#38bdf8 -> #bae6fd), turquoise ocean (#06b6d4), warm golden sand (#fbbf24 -> #d97706), blazing yellow sun (#facc15), and a warm wooden foreground table (#b45309); Scorching Desert = bright golden-amber daytime sky (#fef08a -> #fb923c) and warm sunlit dunes (#f59e0b); Daytime Snow = crisp ice-blue sky (#7dd3fc -> #e0f2fe) and white snow ledge (#f8fafc); Daytime Room = bright morning sky (#bae6fd) through windows. Keep only the top title band (Y<160 on 720x1280, Y<84 on 1280x720) and bottom subtitle band (Y>830 on 720x1280, Y>470 on 1280x720) dark (#0d111a) so the top title and bottom subtitle pill stay high-contrast.",
  "  - [A-ROLL: POV HANDS]: Draw a first-person / hands-on close-up of expressive hands and forearms interacting with the physical Hero Object, button, mug, bottle, phone, card, or instrument in the center of the frame. Do NOT draw a full-body figure or a flat horizontal floor line.",
  "  - [A-ROLL: OVER-THE-SHOULDER]: Draw a large foreground silhouette of the character's head and shoulder on the left or right third (X=15%..30% or 70%..85%), looking into a deep layered background scene (an oval airplane window with a jet wing outside, a desk with a monitor, a night street).",
  "  - [A-ROLL: CUTAWAY / X-RAY]: Zoom into the exact Hero Object silhouette from the Hero Medium Shot and slice open a glowing cutaway window revealing its internal physical layers/components (e.g. outer shell, foam pad / vacuum gap, inner copper wall / speaker driver, chip) working simultaneously.",
  "  - [A-ROLL: SPLIT-SCREEN]: Draw two side-by-side or stacked panels separated by a clean divider line, contrasting two simultaneous states, temperatures, attempts, or environments.",
  "  - [A-ROLL: WIDE SCENE]: Draw a layered environmental diorama (foreground framing props like a seat, desk, or railing; midground character scaled to 35%–42% of stage height; deep background skyline/cabin/nature) — never a plain stick figure standing on a bare horizontal line. NEVER draw chart axes, dashboard cards, decorative flowchart arrows, or floating summary pills in an A-Roll story scene.",
  "  - [A-ROLL: CLOSE-UP]: Draw a deep dark radial vignette background with a subtle lighter radial back-glow behind a centered pitch-black circle head (r=118 on 1280x720, r=138 on 720x1280, fill=\"#09090f\"), a 240-degree crescent rim-light arc (stroke-width 5..6), large solid white eyes (r=22..26) with dark pupils (r=9..10) and thick floating eyebrows (stroke-width 6..7), and jacket shoulders below. NEVER draw stick-arms or hands crossing in front of the head on a close-up.",
  "- HERO OBJECT MULTI-PART CRAFT (TOPIC-AGNOSTIC): Never draw the film's central object (headphones, bottle, lens, lock, battery, etc.) as a single primitive <rect> or <circle>. Build its <g id=\"...\"> from at least 5 layered SVG shapes: (1) true recognizable outer silhouette contour, (2) inner rim/cushion/collar detail, (3) specular highlight stroke along the lit edge, (4) functional sub-parts (button, cap, grille, port, valve), and (5) active state cue (sound waves, frost/mist droplets, heat glow, LED).",
  "  - [B-ROLL: LINE GRAPH]: Draw a clean L-shaped X/Y axis on a dark vignette grid with 1 or 2 bold colored curves (stroke-width 5..6, fill=\"none\"). Wrap each curve and its text label together in the same <g id=\"curve-1\"> / <g id=\"curve-2\"> so a label never appears without its curve.",
  "  - [B-ROLL: BAR COMPARISON]: Draw 2 clean vertical bars rising from a baseline (Y=445 on 1280x720, Y=760 on 720x1280), optionally with the silhouette character standing beside the bar. Wrap each bar rect and its percentage/name text labels inside the same <g id=\"bar-1\"> / <g id=\"bar-2\"> so a percentage label never floats above an empty bar.",
  "  - [B-ROLL: DUAL CLOCK]: Draw 1 or 2 bold circular stopwatch dials with clear time readouts inside and 1 short label under each.",
  "  - [B-ROLL: COUNTER HIT]: Draw one giant glowing number (font-size 110..130, id matching the counter in OBJECTS or id=\"counter\") centered on the dark vignette with one short uppercase label underneath. No dashboard card boxes.",
  "  - [B-ROLL: VISUAL METAPHOR]: Draw one clean centered conceptual object (a paper checklist sheet, a 35mm horizontal film strip with faces and red X marks, a 1-2-3 podium with characters, a glowing brain outline, or a horizontal scale line).",
  "  - [CHAPTER CARD]: Do NOT print id=\"title\" at the top of the frame. Draw ONLY a centered rounded rectangle pill in the middle of the dark starry vignette (around Y=320 on 1280x720, Y=540 on 720x1280) with the bold uppercase chapter title (id=\"title\") centered INSIDE that pill.",
  "- SINGLE HEADER & NO SUMMARY PILLS: On every non-chapter scene, print ONLY the beat's KEY PHRASE once at the top center as id=\"title\" (uppercase, bold, font-size 26..30). NEVER draw a second sub-header pill under the title, and NEVER stamp thematic summary pills (like 'EYES OVER NUMBERS' or 'NO MORE WHITE LIES') over characters or rooms. If a character speaks a short quote or has a floating metric badge, place it strictly in the clear air 45–65px ABOVE that character's head, never across torsos, doors, or feet. Never print bracketed tags like [A-ROLL: ...] or [B-ROLL: ...].",
  "- Respect each object's role (PROP, LIVING OBJECT, or FULL CARTOON CHARACTER): never draw eyes, brows, or a mouth on a plain PROP.",
  "- Plain SVG elements only: rect, circle, ellipse, line, polyline, polygon, path, text, tspan, g, defs, linearGradient, radialGradient, stop, clipPath, marker. No script, no foreignObject, no image, no external links, no animation, no CSS @import.",
  "- Keep it under 6 KB: simple shapes, no long point lists.",
  "- Ids (the film animates from frame to frame by id, so they must be consistent across all frames):",
  "  - the key phrase text is id=\"title\"; the on-screen words (when distinct from the title and needed as a short badge) are id=\"subtitle\" placed directly beneath id=\"title\" near the top of the frame (Y=94 on 1280x720, Y=162 on 720x1280), NEVER floating in the middle of the frame over characters or props; any other line of reading text is id=\"caption\" (a second one \"caption-2\").",
  "  - every object listed in OBJECTS keeps exactly that id in every frame it appears in (e.g. <g id=\"character\">, <g id=\"office-door\">, <g id=\"coffee-cup\">, <g id=\"rewind-dial\">); never reinvent the protagonist's design from scene to scene.",
  "  - anything else gets a short unique id of its own, never one of the OBJECTS ids.",
  "- Draw pointers, arrows and markers last so they sit on top of brackets, boxes and outlines, never hidden behind them.",
  "- Follow the style guide closely: its background, palette, character rig, fonts, stroke weights, corner radii and layout habits. Use font-family stacks that end in a generic family (serif or sans-serif)."
].join("\n");

const STYLE_LIMIT = 16_000;

/**
 * Built-in curated SVG reference guide for "What If" thought-experiment and "How Does" mechanism films.
 * Gives the SVG artist the exact locked silhouette character rig, grounded A-Roll room, A-Roll close-up reaction face,
 * and minimalist B-Roll graph/clock/counter/metaphor layouts from our reference standard.
 */
export const CURATED_THOUGHT_EXPERIMENT_STYLE_GUIDE = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <radialGradient id="bg-vig" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#141629"/>
      <stop offset="100%" stop-color="#070810"/>
    </radialGradient>
  </defs>
  <!-- 1. SHARED DARK VIGNETTE GROUND & TOP HEADER (id="title" at Y=54; keep all focal art in Y=130..468 above the Y>480 subtitle zone) -->
  <rect width="1280" height="720" fill="url(#bg-vig)"/>
  <text id="title" x="640" y="56" text-anchor="middle" fill="#fef3c7" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="800" letter-spacing="2">A FULL CUP OF COFFEE</text>

  <!-- 2. ARCHETYPE A — [A-ROLL: WIDE SCENE] Grounded architectural room (windows y=84..290 with city skyline, wall y=290..468, floor y=468..720) -->
  <g id="room-backdrop">
    <rect x="0" y="84" width="1280" height="206" fill="#64748b"/>
    <rect x="70" y="140" width="90" height="150" fill="#475569"/>
    <rect x="190" y="105" width="110" height="185" fill="#334155"/>
    <rect x="340" y="155" width="85" height="135" fill="#475569"/>
    <rect x="820" y="115" width="105" height="175" fill="#334155"/>
    <rect x="960" y="150" width="90" height="140" fill="#475569"/>
    <line x1="0" y1="290" x2="1280" y2="290" stroke="#0f172a" stroke-width="6"/>
    <line x1="320" y1="84" x2="320" y2="290" stroke="#0f172a" stroke-width="5"/>
    <line x1="640" y1="84" x2="640" y2="290" stroke="#0f172a" stroke-width="5"/>
    <line x1="960" y1="84" x2="960" y2="290" stroke="#0f172a" stroke-width="5"/>
    <rect x="0" y="290" width="1280" height="178" fill="#262338"/>
    <rect x="0" y="468" width="1280" height="252" fill="#12101b"/>
  </g>
  <g id="office-door">
    <rect x="650" y="160" width="18" height="308" fill="#181524"/>
    <rect x="668" y="172" width="190" height="296" fill="#5c432d"/>
    <circle cx="692" cy="335" r="7" fill="#eab308"/>
  </g>

  <!-- 3. CANONICAL PROTAGONIST RIG (<g id="character">): pitch-dark circle head #0d0d14, warm rim-light arc #fef3c7, white eyes/brows/mouth, #8b5cf6 hoodie profile, dark legs -->
  <g id="character" transform="translate(520 468)">
    <line x1="-6" y1="-58" x2="-10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="6" y1="-58" x2="10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="10" y1="-58" x2="14" y2="0" stroke="#fef3c7" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M -22 -128 Q -32 -122 -24 -110" fill="#6d28d9"/>
    <path d="M -16 -125 L 14 -125 L 16 -58 L -16 -58 Z" fill="#8b5cf6"/>
    <line x1="14" y1="-125" x2="16" y2="-58" stroke="#fef3c7" stroke-width="2.5"/>
    <circle cx="0" cy="-154" r="26" fill="#0d0d14"/>
    <path d="M 4 -179 A 25 25 0 0 1 4 -129" fill="none" stroke="#fef3c7" stroke-width="3" stroke-linecap="round"/>
    <path d="M 3 -164 Q 7 -168 11 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M 14 -164 Q 18 -168 22 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="7" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="18" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="13" cy="-144" r="4" fill="none" stroke="#ffffff" stroke-width="2.2"/>
    <path d="M 4 -112 L 34 -96" stroke="#8b5cf6" stroke-width="12" stroke-linecap="round"/>
  </g>
  <g id="coffee-cup" transform="translate(575 365) rotate(18)">
    <polygon points="-16,-24 16,-24 12,24 -12,24" fill="#f5f5f4"/>
    <rect x="-18" y="-29" width="36" height="6" rx="2" fill="#78716c"/>
    <path d="M 14 -10 A 9 9 0 0 1 14 10" fill="none" stroke="#f5f5f4" stroke-width="3.5"/>
  </g>

  <!-- 4. ARCHETYPE B — [A-ROLL: CLOSE-UP] Reaction shot on dark vignette: giant head cx=640 cy=290 r=120 with rim-light & big eyes/brows/mouth -->
  <!-- <g id="character"><path d="M 490 468 Q 640 385 790 468 Z" fill="#8b5cf6"/><circle cx="640" cy="285" r="118" fill="#0d0d14"/><path d="M 640 167 A 118 118 0 0 1 640 403" fill="none" stroke="#67e8f9" stroke-width="6"/><circle cx="600" cy="270" r="22" fill="#fef3c7"/><circle cx="600" cy="272" r="10" fill="#0d0d14"/><circle cx="680" cy="270" r="22" fill="#fef3c7"/><circle cx="680" cy="272" r="10" fill="#0d0d14"/><path d="M 582 232 Q 600 218 618 232" fill="none" stroke="#fef3c7" stroke-width="7" stroke-linecap="round"/><path d="M 662 232 Q 680 218 698 232" fill="none" stroke="#fef3c7" stroke-width="7" stroke-linecap="round"/><circle cx="640" cy="332" r="16" fill="none" stroke="#fef3c7" stroke-width="7"/></g> -->

  <!-- 5. ARCHETYPE C — [B-ROLL: LINE GRAPH] Clean L-axis (x=280..1000, y=150..440) + 2 bold curves + 2 labels -->
  <!-- <polyline points="280,150 280,440 1000,440" fill="none" stroke="#fef3c7" stroke-width="3"/><path id="curve-short" d="M 280 210 L 680 315" fill="none" stroke="#f87171" stroke-width="6" stroke-linecap="round"/><path id="curve-life" d="M 280 370 L 460 335 L 460 275" fill="none" stroke="#eab308" stroke-width="6" stroke-linecap="round"/><text x="340" y="466" text-anchor="middle" fill="#cbd5e1" font-size="20" font-weight="700">SHORT TERM</text><text x="940" y="466" text-anchor="middle" fill="#cbd5e1" font-size="20" font-weight="700">LIFETIME</text> -->

  <!-- 6. ARCHETYPE D — [B-ROLL: DUAL CLOCK] Two circular stopwatches at (420, 285) and (860, 285), r=105 -->
  <!-- <g id="clock-5m"><circle cx="420" cy="285" r="105" fill="#0d131f" stroke="#4ade80" stroke-width="8"/><line x1="420" y1="285" x2="465" y2="205" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/><text x="420" y="325" text-anchor="middle" fill="#ffffff" font-size="34" font-weight="800">5 MIN</text><text x="420" y="445" text-anchor="middle" fill="#4ade80" font-size="24" font-weight="800">THE CHAT</text></g> -->
</svg>`;

export function curatedThoughtExperimentGuide(aspect: Aspect = "16:9", topic = ""): string {
  const world = selectVisualWorld(topic);
  const jacketHex =
    world.id === "cosmic-teal-coral"
      ? "#fb7185"
      : world.id === "cobalt-amber-cutaway"
        ? "#f59e0b"
        : world.id === "espresso-terracotta-editorial"
          ? "#10b981"
          : world.id === "emerald-gold-cinema"
            ? "#eab308"
            : "#8b5cf6";
  const rimHex =
    world.id === "cobalt-amber-cutaway"
      ? "#67e8f9"
      : world.id === "cosmic-teal-coral"
        ? "#fde68a"
        : "#fef3c7";
  const bgInner =
    world.id === "cobalt-amber-cutaway"
      ? "#0d1b33"
      : world.id === "espresso-terracotta-editorial"
        ? "#1c1512"
        : world.id === "emerald-gold-cinema"
          ? "#0d211f"
          : "#141629";
  if (aspect === "9:16") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs>
    <radialGradient id="bg-vig" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="${bgInner}"/>
      <stop offset="100%" stop-color="#070810"/>
    </radialGradient>
    <radialGradient id="head-backlight" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${jacketHex}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#070810" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- 1. SHARED DARK VIGNETTE GROUND & SINGLE TOP HEADER (id="title" at Y=110; NEVER add a second sub-header pill under id="title") -->
  <rect width="720" height="1280" fill="url(#bg-vig)"/>
  <text id="title" x="360" y="110" text-anchor="middle" fill="#fef3c7" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" letter-spacing="2">ONE FLICK OF A SWITCH</text>

  <!-- 2. CAMERA SHOT A — [A-ROLL: HERO MEDIUM SHOT] Side-by-side spatial separation + bright daytime environment when outdoors/morning:
       Character on left (X=210), grounded foreground table (#table at Y=720..830), and surface-resting Hero Object (bottle, mug, device) sitting upright on the table on the right (X=495, Y_base=720) — NEVER overlapping the character's head! (For head-worn items like headphones, place on the head): -->
  <!-- <g id="room-backdrop"><rect x="0" y="160" width="720" height="360" fill="#38bdf8"/><circle cx="580" cy="255" r="54" fill="#facc15"/><rect x="0" y="440" width="720" height="90" fill="#06b6d4"/><path d="M 0 520 Q 360 495 720 530 L 720 830 L 0 830 Z" fill="#fbbf24"/><rect id="table" x="340" y="710" width="330" height="24" rx="6" fill="#b45309"/><rect x="370" y="734" width="24" height="96" fill="#78350f"/><rect x="610" y="734" width="24" height="96" fill="#78350f"/></g><g id="character" transform="translate(205 830)"><path d="M -145 0 Q -105 -195 0 -205 Q 105 -195 145 0 Z" fill="${jacketHex}"/><circle cx="0" cy="-310" r="92" fill="#09090f"/><path d="M 20 -398 A 92 92 0 0 1 20 -222" fill="none" stroke="${rimHex}" stroke-width="5"/><circle cx="32" cy="-320" r="16" fill="#ffffff"/><circle cx="35" cy="-320" r="7" fill="#09090f"/><path d="M 18 -278 Q 34 -266 48 -278" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/></g><g id="bottle" transform="translate(500 710)"><rect x="-26" y="-255" width="52" height="28" rx="6" fill="#1e293b" stroke="#cbd5e1" stroke-width="2.5"/><rect x="-32" y="-227" width="64" height="18" rx="4" fill="#94a3b8"/><path d="M -32 -209 L -46 -175 L -46 -14 Q -46 0 -32 0 L 32 0 Q 46 0 46 -14 L 46 -175 L 32 -209 Z" fill="#64748b" stroke="#e2e8f0" stroke-width="3"/><line x1="-26" y1="-170" x2="-26" y2="-20" stroke="#f8fafc" stroke-width="4" stroke-linecap="round"/></g> -->

  <!-- 3. CAMERA SHOT B — [A-ROLL: POV HANDS] First-person hands interacting with a central multi-part device/bottle/prop (no full-body stick figure or floor line) -->
  <!-- <g id="focal-device" transform="translate(360 470)"><rect x="-110" y="-150" width="220" height="300" rx="110" fill="#1e293b" stroke="${rimHex}" stroke-width="5"/><circle id="power-btn" cx="72" cy="20" r="24" fill="${jacketHex}"/></g><g id="character-hand" transform="translate(480 680)"><path d="M 80 150 L -20 -20 Q -48 -55 -22 -75 Q 4 -90 32 -45 L 140 120 Z" fill="${jacketHex}" stroke="${rimHex}" stroke-width="3"/><circle cx="-26" cy="-54" r="22" fill="#09090f" stroke="${rimHex}" stroke-width="3"/></g> -->

  <!-- 4. CAMERA SHOT C — [A-ROLL: CUTAWAY / X-RAY] Profile silhouette with a glowing X-ray cutaway window revealing internal mechanism -->
  <!-- 5. CAMERA SHOT D — [A-ROLL: SPLIT-SCREEN] Top panel (Y=160..480) vs. Bottom panel (Y=500..820) or Left vs. Right contrasting two states -->

  <!-- 6. CAMERA SHOT E — [A-ROLL: WIDE SCENE] Layered diorama with contoured furniture/vehicles and character at scale(1.68) in ${jacketHex} jacket: -->
  <g id="room-backdrop">
    <rect x="0" y="180" width="720" height="360" fill="#334155"/>
    <rect x="55" y="260" width="95" height="280" fill="#1e293b"/>
    <rect x="180" y="210" width="120" height="330" fill="#0f172a"/>
    <rect x="440" y="230" width="110" height="310" fill="#0f172a"/>
    <line x1="0" y1="540" x2="720" y2="540" stroke="#090d16" stroke-width="6"/>
    <rect x="0" y="540" width="720" height="290" fill="#1e1b2e"/>
    <rect x="0" y="830" width="720" height="450" fill="#0d0b14"/>
  </g>
  <g id="character" transform="translate(230 830) scale(1.68)">
    <line x1="-6" y1="-58" x2="-10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="6" y1="-58" x2="10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="10" y1="-58" x2="14" y2="0" stroke="${rimHex}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M -16 -125 L 14 -125 L 16 -58 L -16 -58 Z" fill="${jacketHex}"/>
    <line x1="14" y1="-125" x2="16" y2="-58" stroke="${rimHex}" stroke-width="2.5"/>
    <circle cx="0" cy="-154" r="26" fill="#0d0d14"/>
    <path d="M 4 -179 A 25 25 0 0 1 4 -129" fill="none" stroke="${rimHex}" stroke-width="3" stroke-linecap="round"/>
    <path d="M 3 -164 Q 7 -168 11 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M 14 -164 Q 18 -168 22 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="7" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="18" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="13" cy="-144" r="4" fill="none" stroke="#ffffff" stroke-width="2.2"/>
    <path d="M 4 -112 L 34 -96" stroke="${jacketHex}" stroke-width="12" stroke-linecap="round"/>
  </g>

  <!-- 7. CAMERA SHOT F — [A-ROLL: CLOSE-UP] Reaction shot on dark vignette (NO arms crossing face; backlight glow + r=138 pitch-black head + 240-deg rim light + solid r=24 white eyes):
       <circle cx="360" cy="520" r="220" fill="url(#head-backlight)"/><g id="character"><path d="M 140 830 Q 220 675 360 665 Q 500 675 580 830 Z" fill="${jacketHex}"/><circle cx="360" cy="520" r="138" fill="#09090f"/><path d="M 275 412 A 138 138 0 1 1 275 628" fill="none" stroke="${rimHex}" stroke-width="6" stroke-linecap="round"/><circle cx="312" cy="505" r="24" fill="#ffffff"/><circle cx="312" cy="507" r="10" fill="#09090f"/><circle cx="408" cy="505" r="24" fill="#ffffff"/><circle cx="408" cy="507" r="10" fill="#09090f"/><path d="M 288 462 Q 312 446 336 462" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/><path d="M 384 462 Q 408 446 432 462" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/><circle cx="360" cy="575" r="16" fill="none" stroke="#ffffff" stroke-width="6.5"/></g> -->
  <!-- 8. [B-ROLL: LINE GRAPH / BAR COMPARISON / DUAL CLOCK / COUNTER HIT / VISUAL METAPHOR] & [CHAPTER CARD] -->
</svg>`;
  }
  return CURATED_THOUGHT_EXPERIMENT_STYLE_GUIDE;
}

export type FrameBrand = { name: string; colors: BrandColors; mode?: "light" | "dark" | undefined; /** The kit's logo as a small PNG data URI; placed on the frame by us, never drawn by the model. */ logoDataUri?: string | undefined };

export type FrameRequest = { beat: ScriptBeat; index: number; count: number; aspect: Aspect; topic: string; style: { name: string; code: string } | null; look: string; notes?: ScriptNotes | null; brand?: FrameBrand | null };

const HEX = /^#[0-9a-f]{6}$/i;

/** Relative luminance (0 black .. 1 white) of a #rrggbb colour. */
const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Whether the brand's frames sit on a light or a dark ground: its background colour, else the opposite of its text colour, else its mode; light when nothing says (the site is light by default). */
export function brandGround(brand: FrameBrand): "light" | "dark" {
  const { background, text } = brand.colors;
  if (background && HEX.test(background)) return lightness(background) > 0.45 ? "light" : "dark";
  if (text && HEX.test(text)) return lightness(text) < 0.4 ? "light" : "dark";
  return brand.mode ?? "light";
}

/**
 * Where the brand's logo goes on a frame. Not on every frame: large and centred ("focus") on the closing call-to-action frame
 * and on a frame whose VISUAL is about the logo itself; small at the side ("side") on a frame that names the brand; otherwise none.
 */
export type LogoPlacement = "focus" | "side" | "none";

export function logoPlacement(request: Pick<FrameRequest, "beat" | "index" | "count" | "brand">): LogoPlacement {
  const brand = request.brand;
  if (!brand?.logoDataUri) return "none";
  const { beat, index, count } = request;
  const visual = beat.visual ?? "";
  if (/\blogo\b/i.test(visual) || (count > 1 && index === count - 1)) return "focus";
  const name = brand.name.trim().toLowerCase();
  const words = name.length >= 3 ? name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const squashed = name.replace(/\s+/g, "");
  const text = `${beat.keyword} ${beat.onScreen ?? ""} ${beat.visual ?? ""} ${beat.line ?? ""}`.toLowerCase();
  if (words && (new RegExp(`\\b${words}\\b`).test(text) || (squashed.length >= 4 && text.replace(/\s+/g, "").includes(squashed)))) return "side";
  return "none";
}

/** The brand kit's colours as a prompt block: the brand overrides the style's palette; the style keeps its layout, shapes and motion. */
export function brandColorBlock(brand: FrameRequest["brand"], placement: LogoPlacement = "none"): string | null {
  const colors = brand?.colors;
  if (!brand || !colors || !HEX.test(colors.primary ?? "")) return null;
  const ground = brandGround(brand);
  const roles = [
    ["primary (main accent: headline word, key shapes, active states)", colors.primary],
    ["accent (second highlight: callouts, a cursor, one small detail)", colors.accent],
    ["background (the frame's ground)", colors.background],
    ["text (all type)", colors.text]
  ].filter((entry): entry is [string, string] => HEX.test(entry[1] ?? ""));
  return [
    `BRAND COLOURS for ${brand.name || "this brand"} (these REPLACE the style guide's palette and any colour named in the reference code or the VISUAL line; keep the style's layout, shapes and motion):`,
    ...roles.map(([role, hex]) => `- ${role}: ${hex}`),
    ground === "light"
      ? "GROUND: this brand is LIGHT. Draw every frame on a light ground (the background colour above, else white or a very pale tint of the primary) with dark type. Never a black or dark-navy background, even if the style guide's reference is dark."
      : "GROUND: this brand is DARK. Draw every frame on a dark ground with light type.",
    "Use only these colours plus tints and shades of them, white or near-black for contrast, and keep text readable on its ground. Never use another hue (no neon green, pink or purple unless it is a listed colour).",
    placement === "focus"
      ? "LOGO: the brand's logo is added afterwards, large and centred in the upper middle (the zone from 34% to 66% of the width and 12% to 42% of the height). Keep that zone empty, compose the rest of the frame (the call to action, the address) below it, and never draw a logo or brand mark yourself."
      : placement === "side"
        ? "LOGO: the brand's logo is added afterwards in the bottom-right corner (the last 16% of the width and 12% of the height). Keep that corner empty and never draw a logo or brand mark yourself."
        : "Do not draw a logo or brand mark on this frame."
  ].filter(Boolean).join("\n");
}

/** Puts the brand's logo on a drawn frame: large and centred for "focus", small in the bottom-right corner for "side". The model never draws the logo (it cannot embed images); this is ours. */
export function withBrandLogo(svg: string, logoDataUri: string, aspect: Aspect, placement: Exclude<LogoPlacement, "none"> = "side"): string {
  const { width, height } = FRAME_SIZE[aspect];
  const margin = Math.round(Math.min(width, height) * 0.035);
  const box = placement === "focus"
    ? { w: Math.round(width * 0.3), h: Math.round(height * 0.28) }
    : { w: Math.round(width * 0.13), h: Math.round(height * 0.085) };
  const x = placement === "focus" ? Math.round((width - box.w) / 2) : width - box.w - margin;
  const y = placement === "focus" ? Math.round(height * 0.13) : height - box.h - margin;
  const fit = placement === "focus" ? "xMidYMid meet" : "xMaxYMax meet";
  const image = `<image id="brand-logo" href="${logoDataUri}" x="${x}" y="${y}" width="${box.w}" height="${box.h}" preserveAspectRatio="${fit}"/>`;
  return svg.replace(/<\/svg>\s*$/i, `${image}</svg>`);
}

/** The part every beat shares (style guide, topic, size), cached, then the beat itself. */
function prompt(request: FrameRequest) {
  const { beat, index, count, aspect, topic, style, look, notes, brand } = request;
  const placement = logoPlacement(request);
  const { width, height } = FRAME_SIZE[aspect];
  const scriptTemplate = inferScriptTemplate({ text: topic, look });
  const hasARollBRollTag = /^\s*\[(?:A-ROLL|B-ROLL|CHAPTER CARD)/i.test(beat.visual ?? "");
  const useCuratedThoughtGuide =
    (scriptTemplate === "what-if" || scriptTemplate === "how-does" || hasARollBRollTag) &&
    (look === "clean" || !look || look === "illus-flat-vector");
  const effectiveStyle = useCuratedThoughtGuide
    ? {
        name: scriptTemplate === "how-does" ? "How-Does Mechanism Explainer" : "What-If Thought Experiment",
        code: curatedThoughtExperimentGuide(aspect, topic)
      }
    : style;
  const shared = [
    effectiveStyle
      ? `Style guide: the template "${effectiveStyle.name}". Its reference code (an animated HyperFrames composition; draw in its visual language, character rig, and shot archetypes, not its literal words):\n<reference>\n${effectiveStyle.code.slice(0, STYLE_LIMIT)}\n</reference>`
      : `Style guide: a clean, modern "${look}" motion-graphics look: one flat background, one accent colour, a geometric sans-serif.`,
    ...(brandColorBlock(brand, placement) ? [brandColorBlock(brand, placement)!] : []),
    `What the film is about: ${topic.slice(0, 600)}`,
    ...(notes?.idea ? [`The film's one idea: ${notes.idea}`] : []),
    ...(notes?.objects ? [`OBJECTS (the film's recurring objects; use these exact ids on <g> or leaf elements every time they appear): ${notes.objects}`] : []),
    ...(notes?.example ? [`The film's worked example and locked character/cast visual spec. Every frame that shows the character or data MUST use these exact colours, head/body design, and values so all frames match each other:\n${notes.example}`] : []),
    `Frame size: width="${width}" height="${height}" viewBox="0 0 ${width} ${height}".`
  ].join("\n\n");
  const own = [
    `Beat ${index + 1} of ${count}:`,
    `KEY PHRASE: ${beat.keyword}`,
    `VISUAL: ${beat.visual ?? "(none given: show the key phrase with one simple supporting shape)"}`,
    `ON SCREEN: ${useCuratedThoughtGuide ? "- (print only KEY PHRASE at the top as id=\"title\" and the short labels explicitly named in VISUAL; do NOT draw a separate id=\"subtitle\" banner)" : (beat.onScreen ?? "-")}`,
    `VOICEOVER at this moment: ${beat.line ?? "-"}`,
    "The frame shows what this voiceover line is saying as it is said (if it talks about a million, show the million)."
  ].join("\n");
  return [{ type: "text", text: shared, cache_control: { type: "ephemeral" } }, { type: "text", text: own }];
}

const HTML_ENTITIES: Record<string, string> = { nbsp: "\u00a0", ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201a", bdquo: "\u201e", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", bull: "\u2022", middot: "\u00b7", rarr: "\u2192", larr: "\u2190", uarr: "\u2191", darr: "\u2193", harr: "\u2194", times: "\u00d7", divide: "\u00f7", minus: "\u2212", plusmn: "\u00b1", deg: "\u00b0", copy: "\u00a9", reg: "\u00ae", trade: "\u2122", euro: "\u20ac", pound: "\u00a3", yen: "\u00a5", cent: "\u00a2", laquo: "\u00ab", raquo: "\u00bb", check: "\u2713", infin: "\u221e", ne: "\u2260", le: "\u2264", ge: "\u2265", approx: "\u2248", frac12: "\u00bd", frac14: "\u00bc", sect: "\u00a7", para: "\u00b6", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200c", shy: "\u00ad" };

/**
 * An SVG shown as an <img> is parsed as strict XML, which knows only five named entities. Models write HTML ones (&ldquo; &mdash; &nbsp;),
 * and a single one makes the browser drop the whole picture. Named HTML entities become their characters, unknown ones are dropped,
 * and a bare "&" becomes "&amp;". Saved frames go through this too, so frames drawn before this fix show up as well.
 */
export function xmlSafeSvg(svg: string): string {
  return svg.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (match, name: string) => {
    if (name.startsWith("#")) return match.endsWith(";") ? match : `${match};`;
    if (["amp", "lt", "gt", "quot", "apos"].includes(name)) return match.endsWith(";") ? match : `&${name};`;
    const char = HTML_ENTITIES[name];
    if (char) return char;
    return match.endsWith(";") ? "" : `&amp;${name}`;
  }).replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, "&amp;");
}

/** Removes anything that could run or load: the frame is shown as an image, and this keeps it inert even if pasted elsewhere. */
export function cleanSvg(text: string): string | null {
  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  const svg = xmlSafeSvg(text.slice(start, end + 6))
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<(?:image|use|animate\w*|set)\b[^>]*\/?>/gi, "")
    .replace(/\s(?:on\w+|(?:xlink:)?href)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/@import[^;]*;/gi, "")
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none");
  // An SVG shown as an <img> renders only with its namespace; models sometimes leave it out.
  const named = /^<svg[^>]*\sxmlns\s*=/.test(svg) ? svg : svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return named.length <= 40_000 ? named : null;
}

/**
 * Draws one frame. An answer with no usable SVG (usually a drawing cut off by the token limit, or too big) is retried once
 * with a larger budget and an instruction to keep it compact, so the person never has to press retry. Throws on an API error
 * or if the second answer is not an SVG either.
 */
export async function sketchFrame(request: FrameRequest, signal: AbortSignal, http: typeof fetch = fetch): Promise<string> {
  let svg: string;
  try {
    svg = await drawFrame(request, signal, http, 1);
  } catch (error) {
    if (signal.aborted || !(error instanceof Error) || !/usable SVG/.test(error.message)) throw error;
    svg = await drawFrame(request, signal, http, 2);
  }
  const placement = logoPlacement(request);
  return request.brand?.logoDataUri && placement !== "none" ? withBrandLogo(svg, request.brand.logoDataUri, request.aspect, placement) : svg;
}

/** What a scene shows if both drawing attempts fail: a plain card with its key phrase, so the storyboard never shows a broken image. Never saved, so the next open draws it again. */
export function placeholderFrame(beat: ScriptBeat, aspect: Aspect): string {
  const { width, height } = FRAME_SIZE[aspect];
  const text = (beat.keyword ?? "").slice(0, 60).replace(/[<>&"']/g, " ").trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#10121a"/><rect x="${width * 0.08}" y="${height * 0.42}" width="${width * 0.84}" height="${height * 0.16}" rx="24" fill="#1a1d29" stroke="#2c3142" stroke-width="3"/><text x="${width / 2}" y="${height * 0.5}" fill="#e8ebf5" font-family="sans-serif" font-size="${Math.round(Math.min(width, height) * 0.06)}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
}

const COMPACT_NOTE = "Keep this drawing compact: at most about 40 shapes, simple paths, no long path data, no repeated detail. Answer with only the SVG and always finish with </svg>.";

async function drawFrame(request: FrameRequest, signal: AbortSignal, http: typeof fetch, attempt: 1 | 2): Promise<string> {
  const route = routeFor("frameSketch");
  const parts = prompt(request);
  if (attempt === 2) parts.push({ type: "text", text: COMPACT_NOTE });
  const maxTokens = attempt === 1 ? route.maxTokens : Math.max(route.maxTokens * 2, 12000);
  if (route.provider !== "anthropic") {
    // Another provider (MODEL_FRAME_SKETCH): the shared provider layer.
    const result = await callModel({ step: "frameSketch", route, system: SYSTEM, messages: [{ role: "user", content: parts.map((part) => ({ type: "text" as const, text: part.text, ...(part.cache_control ? { cache: true } : {}) })) }], maxTokens, effort: "low", signal, errorPrefix: "Frame request failed", includeErrorDetail: true, ...(http !== fetch ? { request: http } : {}) });
    const svg = cleanSvg(result.text);
    if (!svg) throw new Error("The frame came back without a usable SVG.");
    return svg;
  }
  const response = await http("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: route.model,
      max_tokens: maxTokens,
      output_config: { effort: route.effort ?? "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: parts }]
    }),
    signal
  });
  const payload = await response.json().catch(() => ({})) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(`Frame request failed (${response.status})${payload.error?.message ? `: ${payload.error.message}` : "."}`);
  const text = (payload.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  const svg = cleanSvg(text);
  if (!svg) throw new Error("The frame came back without a usable SVG.");
  return svg;
}
