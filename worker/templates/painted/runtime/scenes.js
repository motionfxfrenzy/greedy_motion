/*
 * Scenes from words: a shot is described by what is in it (place, time of day, weather, who is there, what stands in the
 * picture), never by code. This file is the only place that knows how to draw each of those. The director fills the
 * description from the line being spoken; an unknown value falls back to a sensible default, so a shot always draws.
 */
(function () {
  const { mix, lerp } = window.PaintedKit;

  const TIMES = {
    dawn:    { sky: ["#3b4a8a", "#c8758a", "#f6c27a"], sun: { x: 0.5, y: 0.6, color: "#fff0c0", glow: "#ffb878", a: 0.6 }, shade: "#4b3f74", amt: 0.38, back: true, rim: "#ffc48a" },
    morning: { sky: ["#8dbbe6", "#f8edc8"], sun: { x: 0.72, y: 0.3, color: "#fff4cc", glow: "#ffe0a0", a: 0.45 }, shade: "#e8c27a", amt: 0.1 },
    day:     { sky: ["#4f84c4", "#a8cdea", "#f7efd0"], sun: { x: 0.5, y: 0.27, color: "#fffbe0", glow: "#fff0b0", a: 0.45 }, shade: "#ffffff", amt: 0 },
    sunset:  { sky: ["#3b3a78", "#b04f6f", "#f08a4b", "#f7c873"], sun: { x: 0.5, y: 0.54, color: "#ffe9a8", glow: "#ffb067", a: 0.6 }, shade: "#4a2f5a", amt: 0.42, back: true, rim: "#ffb36b" },
    dusk:    { sky: ["#232a5c", "#6a4f86", "#d98a78"], sun: null, shade: "#1f2347", amt: 0.58, back: true, rim: "#c98fb0", stars: 30 },
    night:   { sky: ["#0a0e2c", "#252a60", "#4a4a80"], sun: null, shade: "#0b0f2e", amt: 0.78, back: true, rim: "#9db6f0", stars: 90, moon: true }
  };
  const WEATHER = { clear: { clouds: 0 }, cloudy: { clouds: 8, gray: 0.35 }, rain: { clouds: 9, gray: 0.5, rain: 240, haze: 0.3, rough: 0.35 }, sandstorm: { clouds: 0, gray: 0, fog: 0.8, fogColor: "#c98f4c", sand: true, wind: 1 }, blizzard: { clouds: 9, gray: 0.55, snow: 620, wind: 1, whiteout: 0.6, bolts: false, haze: 0.5, shake: true }, storm: { clouds: 11, gray: 0.6, rain: 380, haze: 0.25, rough: 1, bolts: true, slant: 0.3 }, fog: { clouds: 4, gray: 0.3, haze: 0.8, fog: 1 }, snow: { clouds: 8, gray: 0.3, snow: 170 } };
  // what a person's age and build do to the drawing (the library in people.json sets age, build and dress; the painter only draws them)
  const bodyOf = (s) => ({ build: { slim: 0.85, average: 1, stocky: 1.22 }[s.build] ?? 1, headScale: s.age === "child" ? 1.3 : 1, stoop: s.age === "old" ? 0.04 : 0, dress: Boolean(s.dress) });
  const SIZES = { tiny: 0.09, small: 0.17, medium: 0.27, large: 0.45, huge: 0.62 };
  const BASE = { meadow: 0.82, hills: 0.78, lake: 0.9, sea: 0.92, forest: 0.92, city: 0.96, street: 0.94, village: 0.86, mountains: 0.84, desert: 0.84, field: 0.84, shore: 0.9, road: 0.86, sky: 0.9, river: 0.88, interior: 0.9, custom: 0.88 };

  const place0 = (shot) => shot.place === "interior" && shot.room === "lighthouse";
  function draw(k, shot) {
    const indoors = shot.place === "interior" || (shot.place === "custom" && Boolean(shot.recipe && shot.recipe.indoors));
    const T = TIMES[shot.time] || TIMES.day, Wt = indoors ? WEATHER.clear : WEATHER[shot.weather] || WEATHER.clear, place = BASE[shot.place] ? shot.place : "meadow";
    // climbing the lighthouse stair: the camera follows him. Once his feet reach mid-frame he stays there and the stair and wall scroll down (k.stairShift in kit.room)
    const climbU = 0.5 + 6 * k.p, climbStep = Math.floor(climbU), climbFr = climbU - climbStep, climbWorldY = 0.76 - 0.06 * (climbStep + climbFr * climbFr * (3 - 2 * climbFr));
    const climbShift = place0(shot) && (shot.subjects || []).some((s) => s.pose === "climb") ? Math.max(0, 0.62 - climbWorldY) : 0;
    k.stairShift = climbShift;
    const season = shot.season, gray = (Wt.gray || 0) + (season === "winter" ? 0.22 : 0), tint = (c, extra) => mix(mix(c, "#8e98a4", gray * 0.6), T.shade, Math.min(0.92, T.amt + (extra || 0)));
    const sky = T.sky.map((c) => mix(c, "#9aa6b2", gray * 0.7));
    if (!indoors) k.sky({ stops: sky });
    if (T.stars && !indoors && !Wt.fog) k.stars({ n: T.stars, y1: 0.5 });
    const hasProp = (kind) => (shot.props || []).some((p) => p.kind === kind);   // a moon or sun the director placed replaces the sky's own: never two
    if (!indoors && T.sun && !Wt.rain && !Wt.fog && !hasProp("sun")) k.sun({ x: T.sun.x, y: T.sun.y, r: 0.065, color: T.sun.color, glow: T.sun.glow, glowSize: 0.5, glowAlpha: T.sun.a * (1 - gray) });
    if (!indoors && T.moon && !Wt.rain && !Wt.fog && !hasProp("moon")) k.moon({ x: 0.72, y: 0.27 });
    if (!indoors && Wt.clouds > 0 && (!T.stars || Wt.clouds > 3)) k.clouds({ y: 0.2, band: 0.16, n: Wt.clouds, size: 0.15, color: tint("#ffffff", 0.05), shade: tint("#d6dee6", 0.1), drift: 0.012, seed: 3 });
    const sun = T.sun || { x: 0.5, y: 0.5 };
    const ground = (y, a, b, o) => k.ground({ y, color: tint(a), far: tint(b), stripes: place === "desert" ? 0 : 14, flowers: snowy || dry || season === "autumn" ? 0 : ((o && o.flowers) || 0) * (season === "spring" ? 2.2 : 1), flower: tint("#fff7e0") });
    const snowy = shot.weather === "snow" || shot.weather === "blizzard" || season === "winter";   // winter: the ground is white even when no snow is falling
    const dry = shot.ground === "dry";                                  // drought, dust, barren: the green of the grass and hills turns to ochre and sand
    const gc = (day) => (snowy ? "#e9eff4" : dry ? mix(day, "#c9a566", 0.78) : season === "autumn" ? mix(day, "#c9843a", 0.6) : day);

    switch (place) {
      case "meadow": k.ridge({ y: 0.56, amp: 0.035, freq: 3, color: tint(gc("#7fa05a")), shape: "soft", seed: 2 }); ground(0.6, gc("#58a531"), gc("#9cc54a"), { flowers: 70 }); break;
      case "hills": k.ridge({ y: 0.5, amp: 0.035, freq: 1.4, color: tint("#7d93b4"), shape: "soft", seed: 3 }); k.ridge({ y: 0.56, amp: 0.04, freq: 4, color: tint(gc("#5c8a58")), shape: "soft", seed: 6 }); ground(0.62, gc("#7caa42"), gc("#b8cf62"), { flowers: 30 }); if (shot.path === true) k.path({ x: 0.5, near: 0.34, far: 0.03, color: tint("#d9bf8a"), bend: 0.12, horizon: 0.62 }); break;
      case "lake": k.ridge({ y: 0.5, amp: 0.03, freq: 1.6, color: tint("#4f6f7e"), shape: "soft", seed: 7 }); k.ridge({ y: 0.57, amp: 0.03, freq: 6, color: tint("#33593f"), shape: "pines", seed: 9 }); k.water({ y0: 0.58, y1: 1, color: tint("#6aa3b8"), deep: tint("#2b5a74"), glint: mix("#fff6d8", T.shade, T.amt * 0.5), glints: 70 }); k.foliage({ side: "left", color: tint("#315a2c"), light: tint("#8cbf4a") }); break;
      case "sea": k.ridge({ y: 0.6, amp: 0.012, freq: 2, color: tint("#5a7a98"), shape: "soft", seed: 4 }); k.water({ y0: 0.6, y1: 1, color: tint("#5b9ab8"), deep: tint("#1f4a6e"), glint: mix("#fff3cc", T.shade, T.amt * 0.4), glints: 110 }); break;
      case "forest": k.rays({ x: 0.72, y: -0.05, angle: 1.7, spread: 0.55, n: 7, a: T.amt > 0.5 ? 0.08 : 0.26, width: 0.05 }); k.trunks({ n: 9, color: tint("#3b2b22"), light: tint("#7a5b3c"), width: 0.06 }); ground(0.8, gc("#5a8a3a"), gc("#9bbd52"), { flowers: 30 }); k.motes({ n: 40, y0: 0.2, y1: 0.85, color: "#fff4b8" }); break;
      case "city": k.city({ y: 0.72, h: 0.38, color: tint("#2a2f5a"), lit: T.amt > 0.4 ? 0.38 : 0.1, litColor: "#ffd98a", n: 22 }); k.ground({ y: 0.84, color: tint("#3a3f6a"), far: tint("#4a4f7a"), stripes: 4 }); break;
      case "street": if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.26, y: 0.8, w: 0.3, h: 0.3, wall: tint("#8a7866"), roof: tint("#4b3a30"), lit: T.amt > 0.3, floors: 2 }); if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.76, y: 0.8, w: 0.26, h: 0.25, wall: tint("#7a6a5a"), roof: tint("#44352d"), lit: T.amt > 0.3 }); ground(0.8, "#566070", "#6a7488", { flowers: 0 }); break;
      case "village": k.ridge({ y: 0.55, amp: 0.04, freq: 3, color: tint(gc("#6a9a58")), shape: "soft", seed: 12 }); if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.3, y: 0.7, w: 0.2, h: 0.17, wall: tint("#b59a7a"), roof: tint("#8a4a36"), lit: T.amt > 0.3 }); if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.68, y: 0.72, w: 0.22, h: 0.18, wall: tint("#c7ad8c"), roof: tint("#7a3f31"), lit: T.amt > 0.3 }); ground(0.7, gc("#6ba540"), gc("#a4c860"), { flowers: 25 }); k.path({ x: 0.5, near: 0.3, far: 0.05, color: tint("#d9bf8a"), bend: -0.08, horizon: 0.7 }); break;
      case "mountains": k.ridge({ y: 0.4, amp: 0.1, freq: 2.2, color: tint("#8aa0bf"), shape: "peaks", seed: 5, snow: tint("#f4f7fb") }); k.ridge({ y: 0.55, amp: 0.07, freq: 3, color: tint("#566b88"), shape: "rocky", seed: 8 }); k.ridge({ y: 0.66, amp: 0.03, freq: 5, color: tint("#2f5a3f"), shape: "pines", seed: 9 }); ground(0.74, gc("#4f7f3f"), gc("#86aa55"), {}); break;
      case "desert": k.ridge({ y: 0.58, amp: 0.05, freq: 2, color: tint("#d9a860"), shape: "soft", seed: 3 }); k.ridge({ y: 0.66, amp: 0.04, freq: 2.6, color: tint("#c9944f"), shape: "soft", seed: 6 }); k.ground({ y: 0.72, color: tint("#c28a47"), far: tint("#e0b66c"), stripes: 0 }); break;
      case "field": k.ridge({ y: 0.56, amp: 0.02, freq: 2, color: tint("#9aa860"), shape: "soft", seed: 5 }); k.ground({ y: 0.58, color: tint(gc("#c9a43a")), far: tint(gc("#e2c460")), stripes: 22, flowers: 0 }); break;
      case "shore": k.water({ y0: 0.52, y1: 0.78, color: tint("#6aaec4"), deep: tint("#3a7a98"), glint: "#ffffff", glints: 60 }); k.ground({ y: 0.76, color: snowy ? tint("#e6edf2") : tint("#e0cfa0"), far: snowy ? tint("#f2f6f9") : tint("#efe2bd"), stripes: 0 }); break;
      case "interior": {                                               // inside a building: a furnished room, a window on the weather outside
        const out = shot.weather === "snow" || shot.weather === "blizzard";
        k.roomOf({ room: shot.room || "cabin", includeTable: !hasProp("table"), wall: mix("#8a6048", "#2a1a14", T.amt * 0.25), floor: mix("#6a4630", "#2a1a14", T.amt * 0.25), night: T.amt > 0.3, snow: out }); break;
      }
      case "custom": k.recipe(shot.recipe && shot.recipe.layers); break;                // a place the vocabulary lacks, drawn from an AI-made recipe
      case "river": k.ridge({ y: 0.55, amp: 0.04, freq: 2.5, color: tint(gc("#6f9a5a")), shape: "soft", seed: 14 }); ground(0.58, gc("#6ba540"), gc("#a4c860"), { flowers: 20 });
        k.path({ x: 0.5, near: 0.86, far: 0.075, color: tint(dry ? "#d9bf8a" : "#cdbb8a"), bend: -0.16, horizon: 0.58 });                      // the banks
        k.path({ x: 0.5, near: 0.7, far: 0.05, color: tint("#4f8fb5"), bend: -0.16, horizon: 0.58 });                                           // the water
        k.path({ x: 0.5, near: 0.5, far: 0.03, color: tint("#7fb8d4"), bend: -0.16, horizon: 0.58 }); break;
      case "road": k.ridge({ y: 0.55, amp: 0.04, freq: 3, color: tint("#7a9a6a"), shape: "soft", seed: 13 }); ground(0.6, gc("#6ba540"), gc("#a4c860"), { flowers: 20 }); k.path({ x: 0.5, near: 0.7, far: 0.04, color: tint("#9a9288"), bend: 0.05, horizon: 0.6 }); break;
      default: k.ridge({ y: 0.82, amp: 0.02, freq: 2, color: tint("#5f8a58"), shape: "soft", seed: 2 }); ground(0.84, gc("#58a531"), gc("#9cc54a"), { flowers: 30 });
    }
    const fogColor = Wt.fogColor ? mix(Wt.fogColor, T.shade, T.amt * 0.45) : T.amt > 0.3 ? mix("#8f98b0", T.shade, T.amt * 0.5) : "#dfe6ea";
    if (Wt.fog) k.fog({ a: 0.78 * Wt.fog, color: fogColor, y: 0.6 });                     // thick fog: the far city and hills are gone
    if (Wt.haze) k.haze({ y: 0.58, h: 0.14, color: tint("#e4ebee"), a: Wt.haze });

    // the sea and lakes have no ground to stand on: anything that stands gets a stretch of rock in front
    const STANDS = ["lighthouse", "cross", "house", "tree", "lamp"];
    const onWater = place === "sea" || place === "lake", boat = onWater ? (shot.props || []).find((p) => p.kind === "boat") : null;
    const rough = onWater ? Wt.rough || 0 : 0;                                  // how wild the water is: the weather decides
    if (rough > 0.2) { k.swell({ y: 0.64, rough, layer: 0, color: tint("#5d83a0"), a: 0.8 }); k.swell({ y: 0.7, rough, layer: 2, color: tint("#35597a"), a: 0.85 }); if (rough > 0.6) k.swell({ y: 0.67, rough, layer: 3, color: tint("#2a4a68"), a: 0.9 }); }
    // one more swell, drawn BEHIND the props: a wave in front would be filled to the bottom of the frame and bury the hull, the rock and the tower
    if (rough > 0.2 && boat) k.swell({ y: 0.8, rough, layer: 1, color: tint("#1c3b57"), a: 0.95 });
    const aboard = (s) => !s.on && boat && (s.aboard !== undefined ? Boolean(s.aboard) : Math.abs((s.x ?? 0.5) - (boat.x ?? 0.5)) < 0.18);   // the relationship layer says who is aboard (spec "aboard"); near-ness is only the fallback
    const needsLand = (place === "sea" || place === "lake") && ((shot.subjects || []).some((s) => !s.on && !aboard(s)) || (shot.props || []).some((p) => STANDS.includes(p.kind) && !p.on));
    if (needsLand) k.ground({ y: 0.8, color: tint("#6b6a66"), far: tint("#8a8984"), stripes: 0 });
    const base = needsLand ? 0.86 : place === "custom" ? ((shot.recipe && shot.recipe.floor_y) || 0.88) : BASE[place], groundY = needsLand ? 0.86 : shot.place === "sea" ? 0.64 : base;
    // props
    const world = window.PaintedLayout.compose(shot, { base, place, needsLand, aspect: k.H / k.W });
    const layout = world.props;
    window.PaintedScenes.objects = layout;
    window.PaintedScenes.frameBounds = world.frameBounds;
    const rockTint = (c) => tint(c, T.amt > 0.3 ? -0.5 : 0);                       // at night a rock stays brown, as if lit by the lamp, so it reads against the dark water
    // far things first, near things last, whatever order the director listed them in (the sort is stable, so a support is still drawn before what stands on it)
    for (const node of [...layout].sort((a, b) => (b.depth || 0) - (a.depth || 0))) {
      const prop = node.prop, px = node.x, py = node.y;
      if (prop.kind === "rock") k.rock({ x: px, y: py, w: node.w, h: node.h, color: rockTint("#8a6445"), light: rockTint("#c49c6c"), dark: rockTint("#4f3626"), rim: T.amt > 0.3 ? mix("#d8e2f4", T.shade, 0.15) : null, foam: onWater ? 0.35 + 0.65 * rough : 0 });
      else if (prop.kind === "lamp") k.lamp({ x: px, y: py, h: node.h });
      else if (prop.kind === "house") k.building({ style: prop.style, x: px, y: py, w: node.w, h: node.h, wall: prop.style ? undefined : tint("#a08a70"), roof: prop.style ? undefined : tint("#6a3f31"), lit: T.amt > 0.3 });
      else if (prop.kind === "custom") {
        const recipe = prop.recipe;
        if (recipe?.space === "object") {
          const g = k.g; g.save(); g.translate(k.X(px - node.w / 2), k.Y(py - node.h)); g.scale(node.w, node.h);
          k.recipe(recipe.layers, { extend: false }); g.restore();
        } else if (prop.on) throw new Error("Attached custom objects require a local-space recipe; regenerate this asset");
        else k.recipe(recipe && recipe.layers); // legacy full-frame recipes stay readable
      }
      else if (prop.kind === "tree") k.tree({ x: px, y: py, h: node.h, kind: prop.style || "round", crown: tint(gc("#4f8a3a")) });
      else if (prop.kind === "boat") k.boat({ x: px, y: py, s: node.w * k.W / k.H, rough, rim: T.amt > 0.3 ? mix("#d8e2f4", T.shade, 0.15) : null });
      else if (prop.kind === "beam") { if ((shot.props || []).some((q) => q.kind === "lighthouse")) continue;  const by = place === "sea" || place === "lake" ? 0.6 : 0.55; k.rays({ x: px, y: by, angle: -1.57, spread: 1.2, n: 7, a: 0.12, width: 0.035, color: "#ffd36a" }); k.glow({ x: px, y: by, r: 0.2, color: "#ffc850", a: 0.7 }); k.sun({ x: px, y: by, r: 0.018, color: "#fff6c8", glow: "#ffd36a", glowSize: 0.12, glowAlpha: 0.9 }); }
      else if (prop.kind === "lighthouse") { k.lighthouse({ x: px, y: py, h: node.h });
        if (T.amt > 0.3) { const ly = (py) - node.h - 0.03; k.rays({ x: px, y: ly, angle: px < 0.5 ? 0.0 : Math.PI, spread: 0.45, n: 5, a: 0.3, width: 0.05, color: "#ffe9a0" }); } }
      else if (prop.kind === "table") k.table({ x: px, y: py, w: node.w, h: node.h, bread: prop.bread ?? !(prop.id && (shot.props || []).some(p => p.on === prop.id)) });
      else if (prop.kind === "jar") { if (prop.on || !(shot.subjects || []).length) k.jar({ x: px, y: py, h: node.h }); }   // with people, it is drawn in their hands, below
      else if (prop.kind === "groundmark") k.groundmark({ x: px, y: py, w: Math.max(node.w, 0.18), shape: prop.shape || "sun" });
      else if (prop.kind === "pond") k.pond({ x: px, y: py, w: node.w, h: node.h, ice: Boolean(snowy) });
      else if (prop.kind === "sprout") k.sprout({ x: px, y: py, h: node.h });
      else if (prop.kind === "cross") k.cross({ x: px, y: py, h: node.h, color: tint("#3a2c24") });
      else if (prop.kind === "heart") k.heart({ x: px, y: prop.y ?? 0.5, s: prop.s ?? 0.12 });
      else if (prop.kind === "moon") k.moon({ x: px, y: prop.y ?? 0.22 });
      else if (prop.kind === "sun") k.sun({ x: px, y: prop.y ?? 0.35, r: 0.07, color: "#fff2c0", glow: "#ffd08a", glowSize: 0.55, glowAlpha: 0.55 });
    }
    if (Wt.fog) k.fog({ a: 0.32 * Wt.fog, color: fogColor, y: 0.6 });                      // near things are softened too
    // people
    window.PaintedScenes.heldJar = (shot.props || []).find((p) => p.kind === "jar" && !p.on) || null;
    const people = shot.subjects || [];
    window.PaintedScenes.heads = []; window.PaintedScenes.foci = [];
    const n = people.length;
    people.forEach((s, i) => {
      const person = world.subjects[i], { h, x } = person;
      if (aboard(s)) {                                         // someone in a boat stands in it, rides its heave and roll, and holds on when it is rough
        const vessel = layout.find(n => n.prop === boat), bs = vessel.w * k.W / k.H, bx = vessel.x, by = vessel.y, ph = Math.min(h, bs * 0.62), fx = bx - bs * 0.34, fy = by + 0.006, m = k.boatMotion(rough, bx);
        window.PaintedScenes.heads.push([by - ph, by - ph * 0.55, by - ph * 0.76]); window.PaintedScenes.foci.push(by - ph * 0.5);
        const g = k.g; g.save(); g.translate(k.X(bx), k.Y(by) + m.dy * k.H); g.rotate(m.rot); g.translate(-k.X(bx), -k.Y(by));
        const lean = rough * 0.2 * Math.sin(k.t * 2.3 + 0.8); g.translate(k.X(fx), k.Y(fy)); g.rotate(lean); g.translate(-k.X(fx), -k.Y(fy));
        k.person({ ...bodyOf(s), x: fx, y: fy, h: ph, pose: rough > 0.6 ? "hold" : s.pose || "stand", facing: s.facing || "back", hair: s.hair || "short", robe: false, top: s.top || "#7a4b2a", bottom: s.bottom || "#2f3a55", skin: s.skin || "#d9a47a", hairColor: s.hairColor || "#2a1d17", silhouette: T.back ? mix("#0b0b18", T.shade, 0.35) : null, rim: null, dx: 0, walk: 0 });
        g.restore();
        return;
      }
      // climbing the lighthouse stair: the person travels up the steps over the shot (the stair is drawn in kit.room), hopping from tread to tread
      const climbing = s.pose === "climb" && shot.place === "interior" && shot.room === "lighthouse", cu = climbU, step = Math.floor(cu), fr = cu - step, hop = fr * fr * (3 - 2 * fr);
      const standY = climbing ? 0.76 - 0.06 * (step + hop) + climbShift : person.y, standX = climbing ? 0.32 + 0.045 * cu + 0.06 : x;
      window.PaintedScenes.heads.push([standY - h * 1.02, standY - h * 0.55, standY - h * 0.76]); window.PaintedScenes.foci.push(standY - h * 0.5);
      // By default people are lit: their own colours, dimmed by the hour, with a rim of the hour's light (the lamp, the moon, the sun low behind them).
      const lit = (c) => mix(c, T.shade, Math.min(0.55, T.amt * 0.6)), litOn = !indoors && T.amt > 0.2;
      // "people": "silhouette" (the film's or the shot's choice) cuts outdoor figures out in black against a bright or night sky; a person's own "silhouette": true/false beats both
      const asSilhouette = s.silhouette === true || (s.silhouette !== false && shot.people === "silhouette" && !indoors && Boolean(T.back));
      k.person({
        ...bodyOf(s), x: standX, y: standY, h, pose: s.pose || "stand", facing: s.facing || (s.mood && s.mood !== "neutral" ? "front" : "back"), hair: s.hair || (i % 2 ? "bun" : "short"), robe: Boolean(s.robe), flip: Boolean(s.flip) || (n > 1 && i === n - 1 && (s.pose === "hug")),
        top: lit(s.top || ["#f3efe6", "#2a3f7a", "#8a3b32", "#3a6a4a"][i % 4]), bottom: lit(s.bottom || "#2f3a55"), skin: lit(s.skin || ["#d9a47a", "#b8825a", "#e8bd96", "#8a5a3a"][i % 4]), hairColor: lit(s.hairColor || ["#2a1d17", "#5a3a22", "#1c1c20", "#7a5a3a"][i % 4]), mood: s.mood || "neutral", extras: s.extras || [],
        silhouette: asSilhouette ? mix("#0b0b18", T.shade, 0.35) : null, rim: !asSilhouette && litOn && T.rim ? T.rim : null, dx: s.dx ?? 0, walk: s.walk ?? 1.2
      });
    });
    if (Wt.fog) k.fog({ a: 0.12 * Wt.fog, color: fogColor, y: 0.7 });
    if (Wt.sand) k.sand({ n: 150, color: mix("#e2b877", T.shade, T.amt * 0.4) });
    if (season === "autumn" && ["forest", "meadow", "hills", "street", "village", "road", "river"].includes(place) && !indoors) k.leaves({ n: 36 });
    window.PaintedScenes.jarState = null;
    if (window.PaintedScenes.heldJar && people.length) {
      const ys = world.subjects.map(p => p.h), xs = world.subjects.map(p => p.x);
      const stand = () => world.subjects[0].y, jh = layout.find(n => n.prop === window.PaintedScenes.heldJar)?.h || ys[0] * .165, clay = { color: "#8c3a1b", dark: "#3d1a0c" };
      const HANDS_BUSY = ["hug", "sit", "kneel", "pray", "wave", "cheer"];                                      // poses that need both hands: nobody holds a jar through them
      if (people.some((s2) => HANDS_BUSY.includes(s2.pose))) { k.jar({ x: Math.min(0.9, Math.max(...xs) + ys[0] * 0.32), y: stand(ys[0]) + 0.005, h: jh, ...clay }); window.PaintedScenes.jarState = "on the ground beside them"; }
      else if (people.length > 1) { k.jar({ x: (xs[0] + xs[1]) / 2, y: stand(ys[0]) - ys[0] * 0.38, h: jh, ...clay }); window.PaintedScenes.jarState = "lifted between them"; }   // two people lift it between them
      else { k.jar({ x: xs[0] + ys[0] * 0.28, y: stand(ys[0]) - ys[0] * 0.3, h: jh, ...clay }); window.PaintedScenes.jarState = "carried at the hip"; }
    }
    if (Wt.rain) k.rain({ n: Wt.rain, a: Wt.bolts ? 0.6 : 0.5, slant: Wt.slant ?? 0.1 });
    if (Wt.bolts) k.lightning({ flashes: shot.flashes || [] });
    if (Wt.snow) k.snow({ n: Wt.snow, wind: Wt.wind || 0 });
    else if (season === "winter" && Wt.rain && !indoors) k.snow({ n: 90, a: 0.9, wind: 0.4 });   // winter: the rain is mixed with sleet, so the season shows over water and ground alike
    if (Wt.whiteout) { const g = k.g, gr = g.createLinearGradient(0, 0, 0, k.H); gr.addColorStop(0, "rgba(235,240,248," + Wt.whiteout * 0.55 + ")"); gr.addColorStop(1, "rgba(235,240,248," + Wt.whiteout * 0.8 + ")"); g.fillStyle = gr; g.fillRect(0, 0, k.W, k.H); k.snow({ n: 220, a: 0.9, wind: 1.4 }); }   // a blizzard whites the world out
  }
  window.PaintedScenes = { draw, TIMES, WEATHER, SIZES, PLACES: Object.keys(BASE) };
})();
