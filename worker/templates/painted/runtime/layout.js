/* Shared, pure layout solver. Browser and Node tests use the same geometry. */
(function () {
  const number = (v, fallback, lo, hi) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  function geometry(p, base, place, needsLand, aspect) {
    const heights = { rock: 0.16, lighthouse: 0.34, lamp: 0.26, house: 0.2, tree: 0.34, table: 0.082, jar: 0.1, sprout: 0.1, cross: 0.24, custom: 0.22 };
    const h = number(p.h, heights[p.kind] ?? 0.2, 0.02, p.kind === "lighthouse" ? 0.4 : 0.65);
    const w = number(p.w, p.kind === "rock" ? 0.5 : p.kind === "table" ? 0.3 : p.kind === "lighthouse" ? h * 0.24 * aspect : 0.3, 0.03, 0.95);
    const offsets = { lamp: 0.02, house: 0.1, tree: 0.04, table: 0.04, jar: 0.03, sprout: 0.03, cross: 0.04 };
    let y = base - (offsets[p.kind] ?? 0);
    if (p.kind === "lighthouse") y = needsLand ? 0.84 : place === "sea" ? 0.64 : base - 0.2;
    if (p.kind === "boat") y = ["sea", "lake"].includes(place) ? 0.72 : base - 0.2;
    if (p.kind === "rock" && ["sea", "lake"].includes(place)) y = 0.84;
    // Only root placement uses x. Attached objects use a fraction of their support's usable width.
    return { prop: p, x: number(p.x, 0.5, 0.03, 0.97), y, w, h };
  }
  function layout(props, { base = 0.88, place = "meadow", needsLand = false, aspect = 16 / 9, project } = {}) {
    const byId = new Map(props.filter(p => p.id).map(p => [p.id, p]));
    const done = new Map(), active = new Set(), out = [];
    function solve(p) {
      if (done.has(p)) return done.get(p);
      if (active.has(p)) throw new Error(`Cyclic support: ${p.id}`);
      active.add(p);
      let target;
      if (p.on) {
        const parent = byId.get(p.on);
        if (!parent) throw new Error(`Missing support: ${p.on}`);
        target = solve(parent);
      }
      const node = project ? project(p, target) : geometry(p, base, place, needsLand, aspect);
      if (target) {
        // an object the director put something on but gave no surface (a sapling "on" a tree): the thing sits at the top middle of its box rather than the film aborting
        const s = target.surface ?? { x: target.x, y: target.y - target.h * 0.9, w: target.w * 0.5 };
        // Keep the child's footprint on the usable surface, including at either edge.
        if (project && node.w > s.w * .9) { const fit = s.w * .9 / node.w; node.w *= fit; node.h *= fit; }
        const reach = project ? Math.max(0, s.w - node.w) : s.w;
        node.x = s.x + number(p.offset, 0, -0.5, 0.5) * reach;
        node.y = s.y;
      }
      const s = p.surface ?? p.recipe?.surface;
      if (p.kind === "pond") node.surface = { x: node.x, y: node.y - node.h * 0.15, w: node.w * 0.5 };
      else if (p.kind === "rock") node.surface = { x: node.x, y: node.y - node.h * 0.8, w: node.w * 0.48 };
      else if (p.kind === "table") node.surface = { x: node.x, y: node.y - node.h, w: node.w * 0.9 };
      else if (s) node.surface = { x: node.x + (number(s.x, 0.5, 0, 1) - 0.5) * node.w, y: node.y - node.h + number(s.y, 0, 0, 1) * node.h, w: number(s.w, 0.6, 0.01, 1) * node.w };
      active.delete(p); done.set(p, node); out.push(node); return node;
    }
    props.forEach(solve);
    return out;
  }
  // Approximate physical dimensions in metres, not independent fractions of the image.
  // These are art-direction defaults; explicit dimensions override them for unusual subjects.
  const DIMENSIONS = {
    table: { height: .78, width: 1.4 }, pond: { height: .3, width: 5 }, groundmark: { height: .02, width: 1.4 }, jar: { height: .28, width: .22 },
    lamp: { height: 3, width: .6 }, lighthouse: { height: 18, width: 4.32 },
    house: { height: 3.5, width: 4.5 }, tree: { height: 5, width: 3 },
    rock: { height: 2, width: 12 }, sprout: { height: .18, width: .2 },
    cross: { height: 2, width: .8 }, boat: { height: 3.3, width: 3.8 },
    custom: { height: 1, width: .7 }
  };
  const FRAMING = { wide: .26, medium: .38, close: .52 };
  const personHeight = s => number(s.heightM, s.age === "child" ? 1.1 : 1.7, .3, 3);
  const depthOf = p => number(p.depth, 0, 0, 1);
  const perspective = depth => 1 / (1 + depth * .9);
  function compose(shot, options = {}) {
    const props = shot.props || [], people = shot.subjects || [], aspect = options.aspect || 16 / 9;
    const byId = new Map(props.filter(p => p.id).map(p => [p.id, p]));
    const dimensions = new Map(), resolving = new Set();
    function measure(p) {
      if (dimensions.has(p)) return dimensions.get(p);
      if (resolving.has(p)) throw new Error(`Cyclic support: ${p.id}`);
      resolving.add(p);
      let d = DIMENSIONS[p.kind];
      if (!d || (p.kind === "custom" && p.recipe?.space !== "object" && !p.dimensions)) { resolving.delete(p); return null; }
      d = { ...d };
      if (p.kind === "custom" && p.on && byId.has(p.on)) {
        const parent = byId.get(p.on), pd = measure(parent);
        if (pd) {
          // Migrate legacy custom assets using their size ratio to the parent, not raw screen size.
          d.height = pd.height * number(p.h / parent.h, .35, .05, 1.5);
          d.width = pd.width * number(p.w / parent.w, .45, .05, .9);
        }
      }
      const fixed = p.dimensions || {};
      d.height = number(fixed.height, d.height, .01, 1000);
      d.width = number(fixed.width, d.width, .01, 1000);
      dimensions.set(p, d); resolving.delete(p); return d;
    }
    props.forEach(measure);
    // Fit a complete support chain and its people, not just the tallest individual object.
    const elevation = new Map(), depths = new Map(), active = new Set();
    function ground(p) {
      if (elevation.has(p)) return elevation.get(p);
      if (active.has(p)) throw new Error(`Cyclic support: ${p.id}`);
      active.add(p);
      const parent = p.on ? byId.get(p.on) : null;
      let y = 0, depth = depthOf(p);
      if (parent) {
        const pd = measure(parent), surf = parent.surface ?? parent.recipe?.surface;
        y = ground(parent) + (pd?.height || 0) * (1 - number(surf?.y, parent.kind === "rock" ? .2 : 0, 0, 1));
        depth = depths.get(parent);
      }
      active.delete(p); depths.set(p, depth); elevation.set(p, y); return y;
    }
    let tallest = 1.7, widest = 1;
    for (const p of props) {
      const d = measure(p); if (!d || p.dressing) continue;                                // set dressing is background: it never decides how the shot is framed
      const y = ground(p), f = perspective(depths.get(p));
      tallest = Math.max(tallest, (y + d.height * (p.kind === "lighthouse" ? 1.21 : p.kind === "house" ? 1.25 : 1)) * f);
      widest = Math.max(widest, d.width * f);
    }
    for (const p of people) {
      const parent = byId.get(p.on), pd = parent && measure(parent), surface = parent?.surface ?? parent?.recipe?.surface;
      const top = parent ? ground(parent) + (pd?.height || 0) * (1 - number(surface?.y, parent.kind === "rock" ? .2 : 0, 0, 1)) : 0;
      tallest = Math.max(tallest, (top + personHeight(p)) * perspective(parent ? depths.get(parent) : depthOf(p)));
    }
    const requested = FRAMING[shot.framing] || (shot.place === "interior" ? .38 : .30);
    const unit = Math.min(requested / 1.7, .64 / tallest, .86 / (widest * aspect));
    const floor = number(options.base, .9, .5, .98);
    const floorAt = depth => floor - (shot.place === "interior" ? .1 : .13) * depth;
    const nodes = layout(props, { ...options, project: (p, parent) => {
      const d = measure(p);
      if (!d) return geometry(p, floor, options.place || shot.place, options.needsLand, aspect);
      const depth = parent?.depth ?? depthOf(p), u = unit * perspective(depth);
      // a boat floats: on a shore its whole hull (0.18 of its width deep) sits in the water, its keel at the waterline where the sand begins
      const water = p.kind === "boat" ? { shore: .765, sea: .88, lake: .88 }[options.place || shot.place] : undefined;
      return { prop: p, x: number(p.x, .5, .03, .97), y: water !== undefined ? water - .18 * d.width * u : floorAt(depth), w: d.width * u * aspect, h: d.height * u, depth, unit: u };
    } });
    const solved = new Map(nodes.filter(n => n.prop.id).map(n => [n.prop.id, n]));
    const subjects = people.map((p, i) => {
      let parent = solved.get(p.on);
      // someone sits "on" a chair that has no declared surface: the seat is the middle of its box, about half way up; someone "on" a thing that is not there stands on the ground
      if (parent && !parent.surface) parent = { ...parent, surface: { x: parent.x, y: parent.y - parent.h * 0.42, w: parent.w * 0.6 } };
      if (p.on && !parent?.surface) p = { ...p, on: undefined };
      const depth = parent?.depth ?? depthOf(p), h = personHeight(p) * unit * perspective(depth);
      const x = parent ? parent.surface.x + number(p.offset, 0, -.5, .5) * Math.max(0, parent.surface.w - h * .3 * aspect) : number(p.x, people.length > 1 ? .3 + i * .4 / (people.length - 1) : .5, .03, .97);
      return { subject: p, x, y: parent ? parent.surface.y : floorAt(depth), h, depth };
    });
    // People never stand in each other: when a closer framing makes them wider than the gap the director left, they are moved apart (nobody sits in a lap, nobody is behind someone's shoulder).
    const loose = subjects.filter(n => !n.subject.on).sort((a, b) => a.x - b.x);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < loose.length; i++) {
        const a = loose[i - 1], b = loose[i], need = (a.h + b.h) * .5 * .27 * aspect * .95, gap = b.x - a.x;
        // Seen from the side (both in profile) two people standing or sitting beside each other may overlap, the one behind a little higher: that is how a side view looks. From the front they must not.
        const side = ["left", "right"].includes(a.subject.facing) && ["left", "right"].includes(b.subject.facing);
        if (gap < need && side) { if (pass === 0 && gap < need * .8) b.y -= .008; continue; }
        if (gap < need) { const push = (need - gap) / 2; a.x -= push; b.x += push; }
      }
      for (const n of loose) n.x = Math.min(.9, Math.max(.1, n.x));
    }
    // someone standing never overlaps someone seated in a chair (front view): the standing one steps aside
    for (const sit of subjects.filter(n => n.subject.on)) for (const n of loose) {
      const need = (sit.h + n.h) * .5 * .27 * aspect * .95, gap = n.x - sit.x;
      if (Math.abs(gap) < need && !(["left", "right"].includes(n.subject.facing) && ["left", "right"].includes(sit.subject.facing))) n.x = Math.min(.9, Math.max(.1, sit.x + (gap >= 0 ? 1 : -1) * need));
    }
    const bounds = nodes.filter(n => n.unit && !n.prop.dressing).map(n => [n.y - n.h * (n.prop.kind === "lighthouse" ? 1.21 : n.prop.kind === "house" ? 1.25 : 1), n.y]);
    bounds.push(...subjects.map(n => [n.y - n.h * (["wave", "cheer", "reach"].includes(n.subject.pose) ? 1.25 : 1.02), n.y]));
    const frameBounds = bounds.length ? { top: Math.min(...bounds.map(b => b[0])), bottom: Math.max(...bounds.map(b => b[1])) } : null;
    return { props: nodes, subjects, unit, floorAt, frameBounds };
  }
  function frameLift(bounds, scale = 1, translateY = 0) {
    if (!bounds) return .05;
    const top = bounds.top * scale + translateY, bottom = bounds.bottom * scale + translateY;
    return Math.max(0, Math.min(.27, (top + bottom) / 2 - .56, top - .08));
  }
  function detailCamera(node, subjects = [], aspect = 1.78) {
    if (!node || ![node.x, node.y, node.w, node.h].every(Number.isFinite) || node.w <= 0 || node.h <= 0) return null;
    // A small thing near people (a seedling at their feet, a hole being dug) is shown WITH them, from their chest down to the object, never zoomed alone onto the ground between two pairs of legs.
    const near = (subjects || []).filter(n => n && [n.x, n.y, n.h].every(Number.isFinite) && n.h > 0).sort((a, b) => Math.abs(a.x - node.x) - Math.abs(b.x - node.x))[0];
    if (near && node.h < near.h * .5) {
      const pw = near.h * .27 * aspect, x0 = Math.min(node.x - node.w / 2, near.x - pw / 2), x1 = Math.max(node.x + node.w / 2, near.x + pw / 2);
      const y0 = Math.min(node.y - node.h, near.y - near.h * .78), y1 = Math.max(node.y, near.y) + .02;
      const scale = Math.max(1, Math.min(3.2, .8 / (x1 - x0), .62 / (y1 - y0)));
      return { scale, x: .5 - (x0 + x1) / 2 * scale, y: .44 - (y0 + y1) / 2 * scale };
    }
    const scale = Math.max(1, Math.min(6, .62 / node.w, .42 / node.h));
    return { scale, x: .5 - node.x * scale, y: .46 - (node.y - node.h / 2) * scale };
  }
  /** A handover or a picking is seen at the hands: the camera sits between the people at chest height, close enough to read the hands, never down at the ground or up the legs. */
  function handoverCamera(nodes, aspect = 1.78) {
    const ns = (nodes || []).filter(n => n && [n.x, n.y, n.h].every(Number.isFinite) && n.h > 0);
    if (!ns.length) return null;
    const xs = ns.map(n => n.x), span = Math.max(...xs) - Math.min(...xs), hMax = Math.max(...ns.map(n => n.h)), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = ns.reduce((a, n) => a + (n.y - n.h * .62), 0) / ns.length;
    const scale = Math.max(1, Math.min(2.6, .8 / (span + hMax * .3 * aspect), .66 / (hMax * .75)));
    return { scale, x: .5 - cx * scale, y: .46 - cy * scale };
  }
  function portraitCamera(node) {
    if (!node || !Number.isFinite(node.h) || node.h <= 0) return null;
    const scale = Math.max(1, Math.min(5, .65 / (node.h * .55)));
    return { scale, x: .5 - node.x * scale, y: .45 - (node.y - node.h * .77) * scale };
  }
  globalThis.PaintedLayout = { layout, compose, frameLift, detailCamera, handoverCamera, portraitCamera, DIMENSIONS, FRAMING };

})();
