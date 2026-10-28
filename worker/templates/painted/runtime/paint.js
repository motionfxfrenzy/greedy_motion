/*
 * The paint pass: turns the kit's flat drawing into a painting, on the GPU (or on SwiftShader when there is none: slower, same picture).
 *
 *   "strokes"  (oil, pastel)  thousands of brush strokes laid in layers, big to small. Each stroke takes its colour from the drawing under it,
 *                              runs along the nearest edge (so shapes keep their outline) or swirls where the picture is flat, and has bristle
 *                              streaks and thick-paint lighting. A share of the strokes is laid again on every drawing: that is the shimmer.
 *   "wash"     (watercolour, gouache, ink)  the drawing, softened and pooled at the edges, with pigment granulation, optional inked outlines and posterised bands.
 *
 * Then, for every mode: paper, grain, grade, vignette and bloom. Each drawing is a pure function of (picture, look, drawing number).
 */
(function () {
  const LOOKS = {
    oil:        { mode: "strokes", brush: 11, length: 2.8, layers: 3, swirl: 0.7, curve: 0.9, bristle: 0.75, impasto: 0.6, jitter: [0.2, 0.22, 0.35], respect: 0.85, boil: 0.5, paper: 0.6, grain: 0.5, saturation: 1.18, contrast: 1.06, warmth: 0.2, vignette: 0.35, bloom: 0.3 },
    pastel:     { mode: "strokes", brush: 9, length: 4.2, layers: 2, swirl: 0.15, curve: 0.3, bristle: 1.0, impasto: 0.1, jitter: [0.08, 0.2, 0.2], respect: 0.6, boil: 0.45, paper: 1.0, grain: 1.0, saturation: 1.05, contrast: 1.02, warmth: 0.2, vignette: 0.2, bloom: 0.1 },
    watercolor: { mode: "wash", brush: 12, wash: 0.85, bleed: 0.8, outline: 0.0, ink: "#2a2a3a", paper: 0.9, paperColor: "#f6f1e4", grain: 0.5, saturation: 1.0, contrast: 0.98, warmth: 0.1, vignette: 0.25, bloom: 0.2, boil: 0.35 },
    ink:        { mode: "wash", brush: 6, wash: 0.2, bleed: 0.1, outline: 0.95, ink: "#14141c", posterize: 6, paper: 0.7, paperColor: "#f3ecd8", grain: 0.5, saturation: 0.95, contrast: 1.15, warmth: 0.1, vignette: 0.2, bloom: 0.0, boil: 0.5 },
    gouache:    { mode: "wash", brush: 6, wash: 0.25, bleed: 0.12, outline: 0.0, posterize: 7, paper: 0.55, paperColor: "#f7f0e0", grain: 0.35, saturation: 1.1, contrast: 1.08, warmth: 0.15, vignette: 0.15, bloom: 0.05, boil: 0.25 }
  };
  const resolve = (look) => { const base = LOOKS[typeof look === "string" ? look : look && look.base] || LOOKS.oil; return Object.assign({}, base, typeof look === "object" ? look : {}); };

  const NOISE = `
  float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= .5; } return s; }
  vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1e-10; return vec3(abs(q.z + (q.w - q.y) / (6.*d + e)), d / (q.x + e), q.x); }
  vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1., 2./3., 1./3., 3.); vec3 p = abs(fract(c.xxx + K.xyz) * 6. - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y); }
  float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }`;

  const STROKE_VS = `#version 300 es
  precision highp float;
  ${NOISE}
  layout(location=0) in vec2 corner;      // -1..1
  layout(location=1) in vec3 inst;        // stroke centre in px, and a fixed random
  uniform sampler2D src; uniform vec2 res; uniform float brush, len, swirl, curve, respect, boil, drawing, lodBias, jitterPos;
  out vec2 vUv; out vec3 vCol; out float vRand; out float vAng;
  void main(){
    float id = inst.z;
    float fresh = step(h11(id * 91.7), boil);                  // this stroke is laid again on every drawing
    float r = fresh > .5 ? h11(id * 17.3 + drawing * 7.13) : id;
    vec2 c = inst.xy + (vec2(h11(r*5.1), h11(r*9.7)) - .5) * brush * jitterPos * (fresh > .5 ? 1.0 : 0.25);
    vec2 uv = c / res;
    float lod = max(0., log2(brush) - 0.5 + lodBias);
    vec3 col = textureLod(src, uv, lod).rgb;
    float d = brush * .9;
    float lx0 = luma(textureLod(src, vec2((c.x-d)/res.x, uv.y), lod).rgb), lx1 = luma(textureLod(src, vec2((c.x+d)/res.x, uv.y), lod).rgb);
    float ly0 = luma(textureLod(src, vec2(uv.x, (c.y-d)/res.y), lod).rgb), ly1 = luma(textureLod(src, vec2(uv.x, (c.y+d)/res.y), lod).rgb);
    vec2 g = vec2(lx1 - lx0, ly1 - ly0);
    float m = length(g);
    float edgeA = atan(g.y, g.x) + 1.5708;                          // along the edge
    vec2 q = (c - res * vec2(.5, .42)) / res.y;
    float flowA = atan(q.y, q.x) + 1.5708 + (fbm(c / (brush * 14.) + vec2(.0, drawing * .0)) - .5) * 4. * curve;   // swirl around the centre, bent by noise
    float wEdge = smoothstep(.015, .09, m) * respect;
    float a = mix(mix(edgeA, flowA, swirl), edgeA, wEdge) + (h11(r*3.3) - .5) * .5 * (1. - wEdge * .6);
    float L = brush * len * mix(1., .45, smoothstep(.02, .16, m) * respect) * (.7 + .6 * h11(r*2.2));
    float Wd = brush * (.85 + .3 * h11(r*8.8));
    vec2 p = c + mat2(cos(a), sin(a), -sin(a), cos(a)) * (corner * vec2(L * .5, Wd * .5));
    gl_Position = vec4(p / res * 2. - 1., 0., 1.); gl_Position.y *= -1.;
    vUv = corner; vCol = col; vRand = r; vAng = a;
  }`;
  const STROKE_FS = `#version 300 es
  precision highp float;
  ${NOISE}
  in vec2 vUv; in vec3 vCol; in float vRand; in float vAng;
  uniform float bristle, impasto, sat, valj, huej, layerAlpha;
  out vec4 o;
  void main(){
    float along = abs(vUv.x), across = abs(vUv.y);
    float endSoft = smoothstep(1.0, .7, along);
    float edgeSoft = smoothstep(1.0, .55, across);
    float streakId = floor((vUv.y * .5 + .5) * 9.);
    float br = h21(vec2(streakId, vRand * 311.));
    float dry = step(.62, br) * smoothstep(.45, 1., along) * bristle;
    float a = endSoft * edgeSoft * (1. - dry * .9) * layerAlpha;
    if (a < .02) discard;
    vec3 hsv = rgb2hsv(vCol);
    hsv.x += (h11(vRand * 3.1) - .5) * huej; hsv.y = clamp(hsv.y * (1. + (h11(vRand * 7.7) - .5) * sat), 0., 1.); hsv.z = clamp(hsv.z * (1. + (h11(vRand * 5.5) - .5) * valj), 0., 1.);
    vec3 c = hsv2rgb(hsv);
    float ridge = (br - .5) * bristle;                               // bristle ridges catch the light
    float lit = dot(vec2(cos(vAng), sin(vAng)), vec2(.6, -.8)) * (vUv.y) * .5;
    c *= 1. + impasto * (ridge * .5 + lit * .5);
    o = vec4(c * a, a);
  }`;
  const QUAD_VS = `#version 300 es
  layout(location=0) in vec2 corner; out vec2 uv;
  void main(){ uv = corner * .5 + .5; gl_Position = vec4(corner, 0., 1.); }`;
  const BASE_FS = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D src; uniform float lod; out vec4 o;
  void main(){ o = vec4(textureLod(src, vec2(uv.x, 1. - uv.y), lod).rgb, 1.); }`;
  // wash: softened, pooled edges, granulation, posterised bands, inked outlines
  const WASH_FS = `#version 300 es
  precision highp float;
  ${NOISE}
  in vec2 uv; uniform sampler2D src; uniform vec2 res; uniform float brush, wash, bleed, outline, posterize, drawing, boil; uniform vec3 inkColor;
  out vec4 o;
  vec3 S(vec2 p, float lod){ return textureLod(src, vec2(p.x, 1. - p.y), lod).rgb; }
  void main(){
    vec2 px = 1. / res; float u = res.y / 1920.;
    float seed = drawing * boil;
    vec2 warp = (vec2(fbm(uv * res / (brush * 9.) + seed), fbm(uv * res / (brush * 9.) + 31.7 + seed)) - .5) * bleed * brush * 3. * u * px;
    vec2 p = uv + warp;
    float lod = log2(brush * u * .9 + 1.);
    vec3 soft = S(p, lod), sharp = S(p, 0.6);
    vec3 c = mix(sharp, soft, wash);
    float e = length(vec2(luma(S(p + vec2(px.x * brush * u, 0.), lod)) - luma(S(p - vec2(px.x * brush * u, 0.), lod)), luma(S(p + vec2(0., px.y * brush * u), lod)) - luma(S(p - vec2(0., px.y * brush * u), lod))));
    c *= 1. - smoothstep(.01, .12, e) * wash * .25;                           // pigment pools at the edges
    if (posterize > 0.) c = floor(c * posterize + .5) / posterize;
    if (outline > 0.) { float l = smoothstep(.03, .16, length(vec2(luma(S(uv + vec2(px.x*2., 0.), .5)) - luma(S(uv - vec2(px.x*2., 0.), .5)), luma(S(uv + vec2(0., px.y*2.), .5)) - luma(S(uv - vec2(0., px.y*2.), .5))))); float wob = fbm(uv * res / 40. + seed); c = mix(c, inkColor, l * outline * (.65 + .35 * wob)); }
    o = vec4(c, 1.);
  }`;
  const POST_FS = `#version 300 es
  precision highp float;
  ${NOISE}
  in vec2 uv; uniform sampler2D tex; uniform sampler2D src; uniform vec2 res; uniform float paper, grain, sat, contrast, warmth, vignette, bloom, drawing, wetPaper; uniform vec3 paperColor;
  out vec4 o;
  void main(){
    vec2 p = uv * res / (res.y / 1920.);
    vec3 c = texture(tex, uv).rgb;
    float tooth = fbm(p / 5.) * .6 + fbm(p / 22.) * .4;                       // paper tooth: pigment sits in the dips
    float weave = (sin(p.x * .9) * sin(p.y * .9)) * .5 + .5;
    c = mix(c, c * (.82 + .3 * tooth), paper * .5);
    c = mix(c, c * (.94 + .1 * weave), paper * .25);
    if (wetPaper > 0.) c = mix(paperColor, c, mix(1., clamp(.55 + c.r * .0 + (1. - luma(c)) * 1.2, 0., 1.), 0.)); 
    float g = h21(p + drawing * 13.7) - .5; c += g * grain * .07;
    vec3 hsv = rgb2hsv(c); hsv.y *= sat; c = hsv2rgb(hsv);
    c = (c - .5) * contrast + .5; c += vec3(warmth * .05, warmth * .015, -warmth * .04);
    vec3 bl = textureLod(src, vec2(uv.x, 1. - uv.y), 5.).rgb; c += max(bl - .72, 0.) * bloom * 1.4;
    float v = smoothstep(.95, .25, length((uv - .5) * vec2(res.x / res.y, 1.) * .9)); c *= mix(1., v, vignette);
    o = vec4(clamp(c, 0., 1.), 1.);
  }`;

  function Painter(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    const W = canvas.width, H = canvas.height;
    const compile = (vs, fs) => { const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + "\n" + s.split("\n").map((l, i) => (i + 1) + ": " + l).join("\n").slice(0, 3000)); return sh; }; const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr)); return pr; };
    const strokeP = compile(STROKE_VS, STROKE_FS), baseP = compile(QUAD_VS, BASE_FS), washP = compile(QUAD_VS, WASH_FS), postP = compile(QUAD_VS, POST_FS);
    const U = (pr) => new Proxy({}, { get: (_, n) => gl.getUniformLocation(pr, n) });
    const us = U(strokeP), ub = U(baseP), uw = U(washP), up = U(postP);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const srcTex = gl.createTexture();
    const fbTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fbTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const instBuf = gl.createBuffer();
    const cache = new Map();                                               // layer -> instance data (same for every drawing; boil is in the shader)
    function instances(layer, brush) {
      const key = layer + ":" + brush;
      if (cache.has(key)) return cache.get(key);
      const stepX = brush * 0.8, stepY = brush * 0.55, cols = Math.ceil(W / stepX) + 2, rows = Math.ceil(H / stepY) + 2, data = new Float32Array(cols * rows * 3);
      let s = 1234567 + layer * 99991; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      let n = 0; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { data[n++] = (i + rnd()) * stepX - stepX; data[n++] = (j + rnd()) * stepY - stepY; data[n++] = rnd() * 997 + layer; }
      // shuffled order: strokes overlap in no particular direction
      const order = Array.from({ length: cols * rows }, (_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const sh = new Float32Array(data.length); order.forEach((o, i) => { sh[i * 3] = data[o * 3]; sh[i * 3 + 1] = data[o * 3 + 1]; sh[i * 3 + 2] = data[o * 3 + 2]; });
      const out = { data: sh, count: cols * rows }; cache.set(key, out); return out;
    }
    const hexRgb = (c) => { const n = parseInt((c || "#000000").replace("#", ""), 16); return [(n >> 16) / 255 & 255 || ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const rgbOf = (c) => { const n = parseInt((c || "#000000").replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

    function paint(flat, lookIn, drawing) {
      const look = resolve(lookIn), u = H / 1920;
      gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0); gl.disableVertexAttribArray(1);
      if (look.mode === "strokes") {
        gl.useProgram(baseP); gl.uniform1i(ub.src, 0); gl.uniform1f(ub.lod, Math.log2(look.brush * u * 1.6)); gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(strokeP); gl.uniform1i(us.src, 0); gl.uniform2f(us.res, W, H);
        gl.uniform1f(us.len, look.length); gl.uniform1f(us.swirl, look.swirl); gl.uniform1f(us.curve, look.curve); gl.uniform1f(us.respect, look.respect); gl.uniform1f(us.boil, look.boil); gl.uniform1f(us.drawing, drawing);
        gl.uniform1f(us.bristle, look.bristle); gl.uniform1f(us.impasto, look.impasto); gl.uniform1f(us.huej, look.jitter[0]); gl.uniform1f(us.valj, look.jitter[1]); gl.uniform1f(us.sat, look.jitter[2]);
        const sizes = look.layers >= 3 ? [1.7, 1, 0.55] : look.layers === 2 ? [1.3, 0.7] : [1];
        sizes.forEach((m, layer) => {
          const brush = look.brush * u * m, inst = instances(layer, Math.round(brush * 4) / 4);
          gl.uniform1f(us.brush, brush); gl.uniform1f(us.lodBias, layer === sizes.length - 1 ? -0.8 : 0); gl.uniform1f(us.jitterPos, 0.7); gl.uniform1f(us.layerAlpha, layer === sizes.length - 1 ? 0.92 : 1);
          gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, inst.data, gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
          gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, inst.count);
        });
        gl.vertexAttribDivisor(1, 0); gl.disableVertexAttribArray(1);
      } else {
        gl.useProgram(washP); gl.uniform1i(uw.src, 0); gl.uniform2f(uw.res, W, H);
        gl.uniform1f(uw.brush, look.brush); gl.uniform1f(uw.wash, look.wash ?? 0.5); gl.uniform1f(uw.bleed, look.bleed ?? 0.3); gl.uniform1f(uw.outline, look.outline ?? 0); gl.uniform1f(uw.posterize, look.posterize ?? 0); gl.uniform1f(uw.drawing, drawing); gl.uniform1f(uw.boil, look.boil ?? 0.3); gl.uniform3fv(uw.inkColor, rgbOf(look.ink));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(postP); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTex); gl.uniform1i(up.tex, 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.uniform1i(up.src, 1);
      gl.uniform2f(up.res, W, H); gl.uniform1f(up.paper, look.paper ?? 0.5); gl.uniform1f(up.grain, look.grain ?? 0.4); gl.uniform1f(up.sat, look.saturation ?? 1); gl.uniform1f(up.contrast, look.contrast ?? 1); gl.uniform1f(up.warmth, look.warmth ?? 0); gl.uniform1f(up.vignette, look.vignette ?? 0.2); gl.uniform1f(up.bloom, look.bloom ?? 0); gl.uniform1f(up.drawing, drawing); gl.uniform1f(up.wetPaper, 0); gl.uniform3fv(up.paperColor, rgbOf(look.paperColor || "#f4efe2"));
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.activeTexture(gl.TEXTURE0);
    }
    return { paint, gl, renderer: (() => { const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ""; })() };
  }
  window.PaintedPaint = { Painter, LOOKS, resolve };
})();
