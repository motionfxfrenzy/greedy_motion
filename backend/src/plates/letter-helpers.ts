/**
 * Per-module table of functions in `packages/plate-engine/src/canvas-core/*.ts` that draw
 * letters, words, numbers, glyphs, captions, labels, or stamps with text.
 *
 * Built by reading every plate, kit, and shared module under `canvas-core/*.ts`.
 * Every top-level module in `canvas-core/*.ts` has an explicit entry (possibly `[]`)
 * so a newly added engine module cannot be forgotten.
 */
export const LETTER_HELPERS: Record<string, string[]> = {
  // balloon.ts: crayon hot-air balloon, sky, clouds, and hills; draws no letters or glyphs.
  balloon: [],

  // blueprint.ts: cyanotype watch-train plate; local part helpers that draw gothic labels, dimensions, tables, notes, and title block:
  // - detailRing: draws detail reference rings on the plan and letters "C" and "D" via k.text
  // - dims: draws cutting-plane "A" labels, linear dimensions (k.dim), and "SECTION A-A" via k.text
  // - table: rules and letters the going-train specification table ("NO.", "PART", "T", "MOD.", "C.D.") and "0".."5 MM" scale bar via k.text
  // - notes: draws numbered part balloons (k.balloon), section callouts (k.callout), and the NOTE_LINES text block via k.text
  // - title: letters the title block ("PLATE IV", "SCALE", "SHEET", "DRAWN", "DIMENSIONS", "DATE", "GOING TRAIN") via k.text
  blueprint: ["detailRing", "dims", "table", "notes", "title"],

  // blueprintKit.ts: cyanotype drafting kit:
  // - k0text: local helper inside kit(g) that draws single-stroke inclined gothic capitals in #eef6fb via drafting.letter
  // - text: kit(g) method that draws single-stroke inclined gothic capitals on the sheet via drafting.letter
  // - balloon: kit(g) method that draws a ringed part-number callout balloon with text(n, ...) and leader line
  // - callout: kit(g) method that draws a lettered note label with text(t, ...), underline rule, and leader line
  // - dim: kit(g) method that draws witness lines, dimension line, arrowheads, and the dimension figure via k0text(label, ...)
  // - border: rules the drawing border and letters the "A".."D" and "1".."4" zone marks around the margin via k.text
  blueprintKit: ["k0text", "text", "balloon", "callout", "dim", "border"],

  // brokenColour.ts: plein-air oil-dab harbour at sunrise; draws no letters or glyphs.
  brokenColour: [],

  // brokenColourKit.ts: loaded flat/rigger/scrubbed oil brush dabs and linen weave; draws no letters or glyphs.
  brokenColourKit: [],

  // charcoalErasure.ts: willow vine and compressed charcoal oak tree across four seasons; draws no letters or glyphs.
  charcoalErasure: [],

  // charcoalErasureKit.ts: charcoal stick ribbons, side-stick drags, stump/eraser rubs, and dabs; draws no letters or glyphs.
  charcoalErasureKit: [],

  // colouredPencil.ts: wax coloured-pencil tin robot, music box, and crow; draws no letters or glyphs.
  colouredPencil: [],

  // colouredPencilCrow.ts: coloured-pencil carrion crow geometry and feather hatching passes; draws no letters or glyphs.
  colouredPencilCrow: [],

  // colouredPencilKit.ts: coloured-pencil hatching, contours, construction lines, paper tooth, and sheet replay; draws no letters or glyphs.
  colouredPencilKit: [],

  // core.ts: portable 2D art core (Gfx, pen, hatch, wash, form, glow, paper, vignette, geometry, noise); draws no letters or glyphs.
  core: [],

  // drafting.ts: single-stroke inclined gothic engineering lettering (glyph table G):
  // - letter: draws single-stroke inclined gothic capital letters, numerals, and signs stroke by stroke with g.pen
  drafting: ["letter"],

  // embroidery.ts: hand-embroidered botanical wreath and honeybee in a wooden hoop; draws no letters or glyphs.
  embroidery: [],

  // embroideryKit.ts: plain-weave linen and floss stitch generators (stem, split, running, satin, fishbone, long-short, knots); draws no letters or glyphs.
  embroideryKit: [],

  // film.ts: film runtime contract, shot validation, and frame context reset; draws no letters or glyphs.
  film: [],

  // flatVector.ts: flat editorial vector sailboat regatta with pen-tool anchor handles and grain brush; draws no letters or glyphs.
  flatVector: [],

  // folkTale.ts: Russian folk-tale gouache-and-pencil village garden and boy with rooster; draws no letters or glyphs.
  folkTale: [],

  // folkTaleKit.ts: HB pencil sketch, gouache body colour, wet reveal, faded mask, foliage, flowers, grass, and pumpkins; draws no letters or glyphs.
  folkTaleKit: [],

  // fox.ts: cut-and-torn paper collage fox at dusk; draws no letters or glyphs.
  fox: [],

  // gallery.ts: shared spline geometry, colour mixing, spine bodies, ink ribbons, blobs, and scanline hatching; draws no letters or glyphs.
  gallery: [],

  // halftone.ts: two-colour web-offset newsprint halftone make-ready sheets; draws no letters or glyphs.
  halftone: [],

  // halftoneKit.ts: continuous-tone separations, AM halftone screen dots, newsprint fibres, and ink-starve mottle; draws no letters or glyphs.
  halftoneKit: [],

  // halftoneScene.ts: 3D stone viaduct and steam locomotive continuous-tone separation builder; draws no letters or glyphs.
  halftoneScene: [],

  // isometric.ts: 2:1 isometric cutaway night bakery lit by its brick oven; draws no letters or glyphs.
  isometric: [],

  // isometricKit.ts: 2:1 isometric projection and cube-rule box/plane builders; draws no letters or glyphs.
  isometricKit: [],

  // koi.ts: marker-comic koi, lily pads, water lily, and pond ripples; draws no letters or glyphs.
  koi: [],

  // koiDrawKit.ts: chisel-marker streak fills, arc-length polyline cut, and cue-table clock; draws no letters or glyphs.
  koiDrawKit: [],

  // lighthouse.ts: three-drum risograph lighthouse at sunset; draws no letters or glyphs.
  lighthouse: [],

  // lowPoly.ts: flat-shaded 3D low-poly mountain lake and canoe at dawn; draws no letters or glyphs.
  lowPoly: [],

  // mellan.ts: single continuous Archimedean spiral burin engraving of a lit moon; draws no letters or glyphs.
  mellan: [],

  // midCentury.ts: 1950s designer's gouache hillside village and girl flying a kite with off-register ink line; draws no letters or glyphs.
  midCentury: [],

  // moonPhases.ts: chalkboard moon-phases plate (chalk words on the slate are drawn through drafting.letter); no separate local glyph helper.
  moonPhases: [],

  // paintedOil.ts: Chardin-palette oil-on-canvas still life of two pears and a copper pot; draws no letters or glyphs.
  paintedOil: [],

  // paintedOilKit.ts: linen weave tile, ridged hog-bristle oilStroke, and directional region fill; draws no letters or glyphs.
  paintedOilKit: [],

  // paperCraft.ts: stop-motion cardboard toy-theatre paper collage on twos; draws no letters or glyphs.
  paperCraft: [],

  // pixelArt.ts: 120x120 16-colour pixel-art cat pouncing on fireflies; draws no letters or glyphs.
  pixelArt: [],

  // pixelArtKit.ts: palette-indexed PixelDraft grid recorder, Bresenham line, polygon cover, Bayer dither, and integer blit; draws no letters or glyphs.
  pixelArtKit: [],

  // pocketWatch.ts: ballpoint-pen pocket-watch sketch:
  // - numeral: draws radial Roman numeral glyphs ("I", "V", "X") on the watch dial from a local stroke table
  pocketWatch: ["numeral"],

  // ranunculus.ts: pencil-and-watercolour ranunculus flower and lobed leaves; draws no letters or glyphs.
  ranunculus: [],

  // riso.ts: risograph multiply drums, angled halftone screens, shore distance field, and registration marks; draws no letters or glyphs.
  riso: [],

  // rubberHose.ts: 1930s rubber-hose cartoon coffee pot dancing on a kitchen counter; draws no letters or glyphs.
  rubberHose: [],

  // rubberHoseKit.ts: cel parts, uniform ink outlines with interior knockout, flat fills, and vintage film print grain/gate; draws no letters or glyphs.
  rubberHoseKit: [],

  // scrapbook.ts: archival scrapbook honeybee plate; local helpers that build or draw ransom-note letter tiles, typed slips, and rubber stamps:
  // - ransom: builds a row of scissor-cut ransom-note letter tiles (Tile[]) for a word from GLYPHS
  // - drawTile: draws one pasted ransom-note cut-paper letter tile with scrapbookKit.glyph
  // - drawStrip: draws a torn paper slip and types st.text across it with scrapbookKit.typed
  // - drawStamp: rocks on the rectangular red rubber stamp with "SPECIMEN" and "APIS MELLIFERA · L." via scrapbookKit.glyph
  scrapbook: ["ransom", "drawTile", "drawStrip", "drawStamp"],

  // scrapbookEngraving.ts: copperplate burin spot engravings of the worker honeybee and wild dog rose; draws no letters or glyphs.
  scrapbookEngraving: [],

  // scrapbookKit.ts: archival scrapbook kit with stroke glyph table GLYPHS:
  // - handWrite: writes a hand-lettered annotation string stroke by stroke with g.pen using GLYPHS
  // - typed: strikes a typewriter string character by character in TYPEWRITER monospace face with double-ribbon ghosting via glyph
  // - glyph: strokes a single character glyph from GLYPHS in a Face (weight, slab serifs, slant, outline) on Ctx
  scrapbookKit: ["handWrite", "typed", "glyph"],

  // scratchboard.ts: white-on-black china-clay scratchboard portrait of a lynx in moonlight; draws no letters or glyphs.
  scratchboard: [],

  // scratchboardKit.ts: lynx anatomical height, moonlight tone, and fur-flow fields; draws no letters or glyphs.
  scratchboardKit: [],

  // stipple.ts: 0.25 mm technical-pen Poisson-disk stippled nautilus shell on bristol; draws no letters or glyphs.
  stipple: [],

  // stippleKit.ts: median-sectioned Nautilus pompilius 3D tone field; draws no letters or glyphs.
  stippleKit: [],

  // storybook.ts: pencil-and-watercolour robot character Bit waving in a meadow; draws no letters or glyphs.
  storybook: [],

  // sumiE.ts: sumi-e ink bamboo and tree sparrow on xuan paper (seal stamps an invented non-text mark); draws no letters or words.
  sumiE: [],

  // sumiEKit.ts: progressive runProcess runner and multi-hair sumi brush with flying-white and fibre bleed; draws no letters or glyphs.
  sumiEKit: [],

  // toyBrick.ts: orthographic ABS toy-brick harbour tugboat built step by step; draws no letters or glyphs.
  toyBrick: [],

  // toyBrickKit.ts: orthographic LDU brick/cylinder/stud renderer and painter's-order sort; draws no letters or glyphs.
  toyBrickKit: [],

  // woodcut.ts: ukiyo-e colour woodblock print of two grey herons in rain on a drum bridge; draws no letters or glyphs.
  woodcut: [],

  // woodcutKit.ts: knife-carved keylines, gouged solids, plank grain tile, kozo washi paper, baren rub mask, and bokashi wipe; draws no letters or glyphs.
  woodcutKit: [],

  // wren.ts: loose ink-and-wash Eurasian wren singing on a hawthorn twig; draws no letters or glyphs.
  wren: []
};
