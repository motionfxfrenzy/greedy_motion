# Greedy Motion — Brand and Product Direction

> Make motion they cannot ignore.

Greedy Motion is an AI motion-graphics studio for product teams. It turns real product screenshots, approved copy, and a brand kit into high-impact animated videos. It keeps the generosity, clarity, airy sky canvas, and typography-first discipline of the Genie reference, then adds appetite: hotter color, oversized type, bold 2D motion marks, and movement that earns attention.

## 1. The feeling

**Bold, hungry, glossy, and precise.**

Greedy Motion should feel like a bright creative studio with the volume turned up: a pale sky-blue canvas, generous white space, friendly rounded forms, and sudden bursts of hot orange, acid lime, and magenta. The work is playful, but never childish; maximal, but never messy. It celebrates the fact that product marketing has to compete for attention.

The word **greedy** means greedy for momentum, polish, and attention — not greed for money. Copy should make that meaning explicit through confident, playful lines such as:

- More motion. More attention.
- Feed your product's appetite for attention.
- Make every frame hit.
- Your product has something to say. Make it move.
- Take up the whole screen.

## 2. Visual reference translated

The Genie reference succeeds because it starts with a strong visual system, ample space, a focused hero, playful illustrations, and a single clear action. Greedy Motion preserves that hierarchy and replaces the execution:

| Genie reference | Greedy Motion translation |
| --- | --- |
| Pale daylight canvas | Keep the pale sky canvas; introduce dark stage moments for video preview and impact |
| Gentle pastel objects | Keep soft rounded 2D/3D forms; add clean speed trails and animated product planes |
| Calm mid-weight display type | Keep the spacious type-first hierarchy; make the key lines denser and more oversized |
| Soft blue accent | Retain sky blue; add hot orange, magenta, acid lime, and electric violet as sharp punctuation |
| Friendly magic | Playful confidence with controlled visual excess |
| “Start with style” | “Start with a hit” |

Do not copy Genie’s illustrations, imagery, logo, copy, or interface. Use it only as a reference for clarity of storytelling and page rhythm.

## 3. Brand system

### Color

| Name | Value | Role |
| --- | --- | --- |
| Sky Canvas | `#EBF5FF` | Default page canvas; the airy, optimistic foundation |
| Paper White | `#FAFDFF` | Primary cards, modal surfaces, and breathable space |
| Void | `#08080B` | Dark video preview, motion stage, and high-impact bands |
| Ink | `#13131A` | Navigation, headings, elevated dark panels, and controls |
| Bone | `#F6F2EA` | Light editorial sections and text on bright surfaces |
| Signal Orange | `#FF4D00` | Main CTA and the brand’s hottest punctuation |
| Laser Magenta | `#FF16B8` | Gradient energy, hover state, graphic accents |
| Acid Lime | `#C7FF00` | Unexpected highlights, status, and sharp contrast |
| Electric Violet | `#6657FF` | Motion trails, timelines, and secondary accents |
| Soft Gray | `#D7D5E5` | Fine outlines, muted UI details, and light-mode contrast |

Use color in decisive blocks. The default should be sky canvas and paper white, as in the Genie reference; void creates contrast around actual video work. Bright hues arrive as high-value moments, never as decorative noise.

```css
:root {
  --gm-void: #08080B;
  --gm-ink: #13131A;
  --gm-sky: #EBF5FF;
  --gm-paper: #FAFDFF;
  --gm-bone: #F6F2EA;
  --gm-orange: #FF4D00;
  --gm-magenta: #FF16B8;
  --gm-lime: #C7FF00;
  --gm-violet: #6657FF;
  --gm-soft-gray: #D7D5E5;
  --gm-heat: linear-gradient(120deg, #FF4D00 0%, #FF16B8 48%, #C7FF00 100%);
}
```

### Typography

Use a blunt geometric sans for display copy — `Archivo Black` or `Space Grotesk` 700/800 — with `Inter` or `Geist` for UI and body. The headline should be big enough to feel like a title card in a motion reel, not like conventional SaaS copy.

| Role | Family | Weight | Guidance |
| --- | --- | --- | --- |
| Hero | Archivo Black / Space Grotesk | 700–800 | 96–160px desktop, tight tracking, uppercase only for a short impact line |
| Section title | Space Grotesk | 700 | 48–72px, compact line-height |
| UI and body | Geist / Inter | 500–600 | 14–18px, plain language, generous contrast |
| Labels | Geist / Inter | 700 | 11–12px, uppercase, wide tracking |

### Shape and texture

- Use 20–28px radii for standard panels and 9999px only for tags and compact controls.
- Let large surfaces feel crisp, rounded, and almost editorial; reserve the boldest forms for the motion system and logo.
- Use thin sky-blue keylines, soft glow, grain, and halftone sparingly to create depth.
- Retain a restrained set of soft pastel cards from the Genie language, then sharpen the system with a hot accent, colored outline, or motion reveal. Avoid generic AI sparkles and decorative blobs.

## 4. Logo

The logo system translates a **G in motion** into one compact forward-motion symbol. Its refined signature mark represents a product that takes stillness and turns it into movement.

- Primary compact mark: sky-blue motion droplet, three short blue speed dashes, and a signal-orange forward wedge.
- Default lockup: icon left, `Greedy Motion` wordmark in Space Grotesk 700; use title case to retain Genie’s approachable feel.
- Dark mode: place the flat blue-and-orange mark against void; do not add chrome, glass, neon, or metallic effects.
- Light mode: use the full-color mark on the sky canvas; use a flat near-black mark only where one-color printing requires it.
- Favicon: use the abstract signature mark at 24px and above; simplify its open aperture silhouette below that.

### Refined signature mark

The refined signature mark keeps the blue inner motion droplet and orange forward wedge, while removing the heavy outer ring. Three short sky-blue dashes make its direction clear without enclosing the symbol. It reads as a moving shape, a play action, and a forward path at once. Use it where the brand needs to be recognized in a single small shape: favicons, app icons, loading states, profile avatars, watermarks, and motion end-cards.

The final delivery uses PNG assets. At small sizes, retain the orange wedge and the blue droplet, and remove the speed dashes below 20px.

### Blue-first wordmark

The wordmark now leads with blue: `Greedy` uses deep ink blue and `Motion` uses vivid sky blue, with the **Greedy Slice** as the `i` dot: a compact blue motion seed cut by a signal-orange forward slice. This preserves the bold, friendly weight of the approved wordmark while making blue the recognizable brand color. Use `docs/brand/assets/greedy-motion-wordmark-blue.png`.

### Final PNG logo assets

| Variant | Asset | Best use |
| --- | --- | --- |
| Greedy Slice | `docs/brand/assets/greedy-motion-slice.png` | The `i` dot in the wordmark; small decorative motion cue |
| Blue-first wordmark | `docs/brand/assets/greedy-motion-wordmark-blue.png` | Marketing masthead, invoices, legal/footer contexts, narrow horizontal spaces |
| Final blue logo lockup | `docs/brand/assets/greedy-motion-logo-final.png` | Preferred website header, product navigation, launch material |

All variants keep the same 2D sky-blue, peach, and signal-orange language. The blue-first wordmark is the preferred textual identifier, and the final blue logo lockup is the recommended website-header direction.

## 4a. Mascot — Momo

**Momo** is Greedy Motion's friendly studio sprite: a looping sky-blue motion ribbon with a warm peach face, tiny dark eyes, rosy cheeks, and a short orange trail. Momo carries a blank product card as if pulling an idea into motion. The character gives the product its warmth while the logo handles recognition.

- Use Momo in the landing-page hero, onboarding, generation progress, empty states, successful exports, and playful social posts.
- Keep the character small-to-medium in the interface so the project work remains central. Let the card show a user’s thumbnail, template preview, or a short friendly status when appropriate.
- Place Momo on sky canvas, paper white, or a very soft pastel surface. Preserve the transparent asset edges; do not put the character in a dark chrome, cyberpunk, or 3D setting.
- Do not use Momo as the app icon or primary logo. Use the abstract signature mark for those moments.

The approved character direction is `docs/brand/assets/greedy-motion-mascot-momo.png`. It is a transparent RGBA raster reference for the brand system. Build future poses from the same blue ribbon body, peach face, orange trail, and gentle 2D shading.

## 5. Landing page

### Navigation

```text
[G mark] Greedy Motion      Workflows   Styles   Pricing      [Make something move →]
```

The nav sits on the sky canvas with a quiet dark wordmark and one Signal Orange action. Keep it quiet; the hero carries the energy.

### Hero

```text
MAKE YOUR PRODUCT
IMPOSSIBLE TO IGNORE.

Turn screenshots, a message, and your brand kit into motion that hits.

[Make something move →]     [Watch the reel]
```

Show one oversized, slow-turning 2.5D product-card composition behind or beside the copy. It should sit in Genie-like open sky space, surrounded by a few soft rounded objects, heat-gradient light trails, and depth layers. Use a real app screen; do not use a generic generated person or stock video.

### Core sections

1. **Still is expensive.** Explain the cost of static product updates with a short before/after motion moment.
2. **Give it something to eat.** Screenshot upload, approved copy, brand kit, and format selector.
3. **Pick your appetite.** Style cards: Soft Gradient, Glass and Depth, Bold Kinetic, Editorial Texture, 3D Showcase.
4. **Watch it move.** Live storyboard and scene-editing preview.
5. **Take the cut.** Render, approve, download, and create another format.

## 6. Product language

Use active, visual verbs. A user is not “generating a video”; they are making their product move.

| Generic product language | Greedy Motion language |
| --- | --- |
| Create project | Start a motion |
| Generate storyboard | Build the cut |
| Template | Motion recipe |
| Style | Appetite |
| Render | Cook the cut |
| Draft ready | Ready to hit |
| AI revision | Tune the motion |
| Export | Take the cut |

Keep usability clear. These phrases are brand layers, not replacements for essential status information. For example: **Rendering — cooking the cut** is useful; **cooking** alone is not.

## 7. Motion behavior

Motion is the brand proof. It should feel intentional and expensive:

- Hero objects drift, rotate, and reveal in slow 2.5D layers (800–1400ms).
- Interaction feedback is quick and physical (160–240ms) with a slight overshoot only where it communicates selection.
- Scene changes use color wipes, speed trails, light leaks, or perspective turns; never use random dissolves.
- Text enters with masked clips, scale, and small position shifts; not typewriter effects.
- Respect `prefers-reduced-motion`: show the final state without autonomous movement.

## 8. Do and do not

### Do

- Use real product screenshots as the visual hero.
- Keep the sky canvas, white cards, rounded forms, and breathing room that make the Genie reference feel inviting.
- Make a single orange action button unmistakable.
- Let the heat gradient, colored outlines, and occasional dark stage create contrast.
- Use oversized typography and concise copy.
- Give every animation a reason: reveal, direct attention, establish hierarchy, or show a product transformation.

### Do not

- Do not reuse Genie’s cloud characters, illustrations, logo, copy, or interface components.
- Do not cover every surface in gradients or neon.
- Do not make Greedy Motion feel like a gambling, financial, or get-rich-quick product.
- Do not hide product controls behind personality language.
- Do not use generic AI-video imagery when a real screenshot can carry the story.

## 9. Product positioning

**Greedy Motion is for product teams that want more attention from the work they already ship.**

It is not a general prompt-to-video toy. Its input is the product itself: screenshots, product copy, launch goals, and a brand kit. Its output is a controlled, editable motion system that can become a launch video, social clip, feature spotlight, or reusable brand template.
