---
name: ad-generator
description: Generate premium static-ad image prompts for any brand from 40 battle-tested ad templates. Use whenever the user wants ads, static ads, ad creative, ad prompts, or advertisement images for a product or brand — "make ads", "generate an ad", "create ad creative", "ad prompt for my product". First run sets the brand up automatically from its website (or a short manual form); every ad prompt is then filled with that brand's real colors, voice, and product facts. The user takes the finished prompt plus ONE product photo into their own image tool (GPT Image works best) and generates. No CLI, no API, no dependencies.
---

# Ad Generator

Pick from 40 battle-tested ad templates. Claude fills your pick with your brand's DNA — real colors, real voice, real product facts — and hands you a finished, copy-paste image-generation prompt.

You then generate the ad in YOUR OWN image tool: attach one product photo, paste the prompt, go. GPT Image (the model behind ChatGPT's image generation) is the reference model these templates were built for; any strong image model that accepts a reference image works.

Everything runs in ONE flow: if your brand isn't set up yet, a 2-minute express setup happens first — then you land in the template menu. If your brand is already set up, you land in the menu immediately.

---

## Step 0 — Brand check

Look for existing brands: scan `./brands/` for subfolders containing a `brand-dna.md` (ignore dotfiles).

- **Found** → list them, ask which brand to use (auto-select if exactly one, but confirm it by name). Then skip to **Step 2**.
- **None** → first run. Say: "Let's set up your brand first — takes about two minutes." Continue with Step 1.

## Step 1 — Express brand setup (first run only)

Ask ONE question:

> "Give me your brand's **website URL** and I'll set everything up myself — or say **manual** if you'd rather answer a few quick questions."

### Auto path (URL)

1. Fetch the homepage with WebFetch and read it fully. Also fetch one product page, and the About page if discoverable from homepage links.
2. Extract — specific to THIS brand, never generic:
   - **Voice** — 5 precise adjectives from how they actually write
   - **Colors** — dominant, accent, background; estimate hex codes from what you observe (estimates beat blanks)
   - **Typography** — headline weight/style, body treatment (describe the style; don't guess font names)
   - **Photography** — lighting, color grade, surfaces, what's in frame
   - **Packaging** — physical form, label
   - **Target audience** — one sentence
3. Write `brands/[brand-slug]/brand-dna.md` (slug = lowercase, hyphens, drop legal suffixes) using EXACTLY this structure:

```
# [Brand Name] — Brand DNA

## Identity
**Name:** [as the brand writes it]
**Positioning:** [one sentence]
**Voice:** [five adjectives]
**Target audience:** [one sentence]

## Color System
Lead:        [name] — [hex]
Support:     [name] — [hex]
Accent:      [name] — [hex]
Background:  [name] — [hex]
Off-limits:  [what never appears]

## Typography
Headline:    [style/weight]
Body:        [style]
Treatment:   [distinctive choices]
In ads:      [how type sits in their ads]

## Photography Style
- **Lighting:** [...]
- **What's in frame:** [...]
- **Color grade:** [...]
- **Setting:** [...]
- **Composition:** [...]
- **Mood:** [3–5 adjectives]

## The Product
Form:       [form factor and material]
Label:      [label text, typography, placement]

## Ad Creative Style
Formats:      [best guess]
Text on image: [how copy sits]
Visual style:  [photo-led / product-only / lifestyle / mixed]
Current ads:   not researched (express setup)

## Voice in Practice
Sounds like: "[example sentence in brand voice]"
Never:       "[example of wrong tone]"

## Hard Rules
Always: [non-negotiable visual rule]
Always: [non-negotiable visual rule]
Never:  [visual rule]
Never:  [visual rule]
```

4. List the products you saw on the site ("Which product are we making ads for? 1. ... 2. ..."). When the user picks, fetch that product's page and write `brands/[brand-slug]/product-dna/[product-slug].md`:

```
# [Product Name] — Product DNA

## Identity
**Category:** [...]
**Sizes / flavors / scents:** [...]

## What it does
**Tagline:** [one-liner]
**Description:** [1–2 sentences]

## Key benefits
- [specific benefit]
- [...]

## Ingredients / materials
- [...]
- Notable absences: [free of X, Y]

## Positioning
[1–2 sentences vs alternatives]
```

Real facts from the page only; mark anything assumed with ⚠️.

5. Confirm in one compact message: brand name, voice line, colors, chosen product. Then continue straight to Step 3 — no approval pause.

### Manual path

Ask everything in ONE grouped message:

```
Quick brand setup — answer what you know, skip the rest:

Brand name:
Positioning (who it's for, what it does):
Brand voice (5 adjectives):
Primary / accent / background colors:
Headline typography style (e.g. bold sans-serif all-caps):
Photography style (lighting, mood, settings):
Product (name, what it is, physical form, label):
Key product facts (benefits, ingredients, real numbers you use):
```

Write `brand-dna.md` and `product-dna/[product-slug].md` from the answers (same structures; empty stays empty). Continue to Step 3.

## Step 2 — Select product (returning brands)

Read `brands/[brand]/brand-dna.md` in full — hold the color system (hex values), typography rules, and brand voice as live context. List the products that have a file in `brands/[brand]/product-dna/` plus "add a new product". If the user adds a new one: ask for the product page URL (auto-fill) or the key facts (manual), write its `product-dna/[slug].md`, continue.

## Step 3 — Show template menu

Read `.claude/skills/ad-generator/templates.md`. Display the full numbered list:

```
40 ad templates available:

  1.  Headline                         3:4   — Tests text rendering. Clean model output check.
  2.  Offer/Promotion                  9:16  — The money-maker. Test your core offer.
  3.  Testimonials                     9:16  — Real environments + text overlays.
  4.  Features/Benefits Point-Out      3:4   — Educational diagram-style layout.
  5.  Bullet-Points                    3:4   — Split composition. Product left, benefits right.
  6.  Social Proof                     3:4   — Member count + review card + press logos.
  7.  Us vs Them                       3:4   — Side-by-side comparison.
  8.  Before & After (UGC Native)      9:16  — Mirror selfie transformation.
  9.  Negative Marketing (Bait&Switch) 3:4   — Fake bad review that's actually a rave.
  10. Press/Editorial                  3:4   — Authority play. Vogue back-page energy.
  11. Pull-Quote Review Card           3:4   — Emotional quote over a review card.
  12. Lifestyle Action + Colorway      1:1   — Action hero shot + product lineup.
  13. Stat Surround / Callout Radial   1:1   — Product as hero, stats as planets.
  14. Bundle Showcase + Benefit Bar    1:1   — Product feature with benefit bar.
  15. Social Comment Screenshot        1:1   — Screenshotted comment = instant credibility.
  16. Curiosity Gap / Hook Quote       1:1   — Provocative headline forces the double-take.
  17. Verified Review Card             1:1   — Mimics real review platform UI.
  18. Stat Radial (Lifestyle Flatlay)  1:1   — Same as #13 but lifestyle background.
  19. Highlighted Testimonial          1:1   — Long-form review with highlighted phrases.
  20. Advertorial / Editorial Card     3:4   — Looks like a news post, not an ad.
  21. Bold Statement / Reaction        1:1   — Pure brand energy. Copy IS the ad.
  22. Flavor Story / "Tastes Like"     3:4   — Full-bleed food scene + product.
  23. Long-Form Manifesto              3:4   — Copy-dominant. The writing is the creative.
  24. Product + Comment Callout        3:4   — Product above a faux Facebook comment.
  25. Us vs Them Color Split           3:4   — Vivid split with checkmarks vs X marks.
  26. Stat Callout (Data-Driven)       3:4   — Statistic-led with lifestyle background.
  27. Benefit Checklist Showcase       3:4   — Product shot + benefit rows + CTA.
  28. Feature Arrow Callout            3:4   — Hand holding product with outward callouts.
  29. UGC + Viral Post Overlay         9:16  — Selfie with a Reddit/X post screenshotted.
  30. Hero Statement + Icon Bar        3:4   — Power statement + three icon benefits.
  31. Comparison Grid / Table          1:1   — Meme-style head-to-head comparison grid.
  32. UGC Story Callout                9:16  — iPhone Story with text bubble annotations.
  33. Faux Press / News Screenshot     3:4   — Looks like a real online article.
  34. Faux iPhone Notes                3:4   — iOS Notes app screenshot aesthetic.
  35. Hero Product + Stat Bar          3:4   — Superlative headline + product + stat strip.
  36. Whiteboard Before/After          3:4   — Real person photo + whiteboard drawing.
  37. Hero Statement + Offer Burst     3:4   — Promo variant with discount starburst.
  38. UGC Lifestyle + Review (Split)   3:4   — Casual photo left, product + review right.
  39. Curiosity Gap Scroll-Stopper     1:1   — Hook headline + problem photo. No product.
  40. Native Post-It Note Style       3:4   — Lifestyle photo with handwritten post-it.

Which templates do you want? Enter numbers separated by commas — e.g. "1, 7, 11"
```

Wait for selection.

## Step 4 — Campaign brief

For each selected template, auto-suggest every piece of text a viewer would read on the ad (headline, offer, benefits, quote, stats). Show ALL selected templates in one message.

**Source-of-truth rules:**
- Brand-voice slots (headlines, subheads, offers, manifesto copy) ← `brand-dna.md` Voice in Practice
- Product-claim slots (benefits, stats, ingredients, taglines, comparisons) ← the product's DNA file
- Read the template's prompt text for length/format hints and fit content to them
- Invent + mark ⚠️ ONLY when neither source has the answer (review counts, star ratings, customer names, press coverage, specific stats). Never leave `[BRACKETED PLACEHOLDERS]` — always suggest a value.

Open with:
> "Here's the campaign brief — filled from your brand and product DNA. Items marked ⚠️ are invented because neither source had the info. Say 'go' to build the prompts, or change anything."

Label every element (`Headline:`, `Claims:`, `Stats:`, `Review:`, `Offer:`, `Weaknesses:`, `Strengths:`...) with one short question per template. One-word answers work; "go" approves everything as shown. Wait for one response.

## Step 5 — Build and deliver the prompts

For each selected template, read its full text from `.claude/skills/ad-generator/templates.md` and replace every `[BRACKETED PLACEHOLDER]`:

- `[BRAND]` → brand name · `[YOUR PRODUCT]` → product name
- Color placeholders → the brand's color system (name + hex), respecting its Off-limits list
- **Contrast rule — always enforce:** light/pale background → dark text; dark background → white/light text. State the chosen text color explicitly in the prompt.
- Brief answers fill their slots; never introduce values that weren't shown in the brief.

**Product anchor — every template, no exception:** find the first `Create:` in the filled template text and replace everything before it with:

```
The provided reference image shows the exact product that must appear in this ad. Do not invent, modify, or substitute this product — it must look identical to the reference image: shape, label, colors, and packaging.

Create: [rest of filled template text]
```

**Template 14:** single product only — ignore the bundle/second-product structure.
**Aspect ratio:** the ratio stated at the end of the template's own text wins over the menu label if they differ.

Then deliver. Per template, output exactly this — the prompt in its own fenced code block so it copies in one click:

> ### [NN] — [Template name] · [ratio]
>
> ```
> [the complete filled prompt]
> ```

After the last prompt, close with the usage instructions (adapt the ratio list to what was actually delivered):

> **How to generate your ad(s):**
> 1. Open your image tool — **GPT Image** (ChatGPT → attach image) works best; any strong image model that accepts a reference image is fine.
> 2. **Attach ONE clean photo of your product** — sharp, well-lit, simple background. The prompt treats it as ground truth, so the better the photo, the truer the ad.
> 3. Paste the prompt. If your tool has an aspect-ratio setting, set it to **[ratio]** (otherwise the prompt's ratio line handles it).
> 4. Generate. Text rendering varies between runs — if a word comes out mangled, just run it again. Regenerating is normal, not a failure.
> 5. Save the ones you love. Run me again anytime for more templates or another product.

Also save each delivered prompt to `brands/[brand]/ad-prompts/[NN]-[template-slug].md` (create the folder; overwrite freely — these are regenerable) so the user can come back to them without re-running the flow.

---

## Notes

- The single biggest quality lever is the product photo the user attaches — clean packshot in, premium ad out.
- If a brand's site can't be fetched (blocked, JS-only), fall back to the manual form — never guess brand facts.
- To update brand identity later, edit `brands/[brand]/brand-dna.md` directly — every future prompt reads it.
- One prompt = one ad. For variations, the user simply regenerates in their tool — same prompt, new roll.
