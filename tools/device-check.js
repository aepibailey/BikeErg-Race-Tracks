/*
 * device-check.js — THROWAWAY graphics probe (not part of the game).
 *
 * Reports what the device is and how fast it draws a rough neon-road scene
 * with each candidate technique, so the Canvas 2D vs WebGL decision and the
 * Low / Medium / High settings can be based on real numbers. Delete this
 * folder once that decision is made.
 *
 * Every renderer draws the same scene (built by buildScene) so the numbers
 * compare like with like.
 */

const $ = (id) => document.getElementById(id);
const dpr = window.devicePixelRatio || 1;

/* ------------------------------------------------------------------ */
/* Device info                                                          */
/* ------------------------------------------------------------------ */

async function deviceInfo() {
  const info = {
    userAgent: navigator.userAgent,
    cpuCores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null, // Chrome caps this at 8
    screenCss: `${screen.width}×${screen.height}`,
    devicePixelRatio: dpr,
    screenPhysical: `${Math.round(screen.width * dpr)}×${Math.round(screen.height * dpr)}`,
    viewportCss: `${innerWidth}×${innerHeight}`,
  };
  // Chrome on Android hides the model in the UA string; ask for it directly.
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      const h = await navigator.userAgentData.getHighEntropyValues(
        ['model', 'platform', 'platformVersion', 'fullVersionList']);
      info.model = h.model || null;
      info.platform = `${h.platform} ${h.platformVersion || ''}`.trim();
      const chrome = (h.fullVersionList || []).find((b) => /Chrome/.test(b.brand));
      info.browser = chrome ? `${chrome.brand} ${chrome.version}` : null;
    } catch { /* not available */ }
  }
  const c = document.createElement('canvas');
  const gl2 = c.getContext('webgl2');
  const gl = gl2 || document.createElement('canvas').getContext('webgl');
  info.webgl = gl2 ? 'WebGL 2' : (gl ? 'WebGL 1 only' : 'none');
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    info.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    info.gpuVendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  info.refreshHz = await measureRefreshHz();
  return info;
}

function measureRefreshHz() {
  return new Promise((resolve) => {
    const times = [];
    const tick = (t) => {
      times.push(t);
      if (times.length < 61) requestAnimationFrame(tick);
      else {
        const d = times.slice(1).map((v, i) => v - times[i]).sort((a, b) => a - b);
        resolve(Math.round(1000 / d[Math.floor(d.length / 2)]));
      }
    };
    requestAnimationFrame(tick);
  });
}

/* ------------------------------------------------------------------ */
/* Scene: a curving neon road, lamps, stars, mountains (normalised 0..1) */
/* ------------------------------------------------------------------ */

const HORIZON = 0.42;
const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const STARS = Array.from({ length: 2000 }, () => [rand(), rand() * HORIZON, rand()]);
const MOUNTAINS = Array.from({ length: 41 }, (_, i) =>
  [i / 40, HORIZON - 0.02 - 0.09 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))]);

function buildScene(t, load, scene) {
  const strips = 40 * load, lamps = 10 * load, stars = 250 * load;
  const seg = 60 / strips;
  const travel = t * 12;                         // world units scrolled
  const off = travel % seg;
  const parity = Math.floor(travel / seg);
  const curve = Math.sin(t * 0.35);
  const yAt = (z) => HORIZON + (1 - HORIZON) / z;
  const hwAt = (z) => 0.62 / z;
  const cxAt = (z) => 0.5 + curve * 0.35 * (1 - 1 / z) ** 2;

  scene.quads.length = 0; scene.lines.length = 0; scene.glows.length = 0;
  scene.stars = stars; scene.t = t; scene.parallax = -curve * 0.04;

  for (let i = 0; i < strips; i++) {
    const za = 1 + i * seg - off + (i === 0 ? off : 0);
    const zb = 1 + (i + 1) * seg - off;
    const ya = yAt(za), yb = yAt(zb), ca = cxAt(za), cb = cxAt(zb), ha = hwAt(za), hb = hwAt(zb);
    const dark = (i + parity) % 2 === 0;
    scene.quads.push([ca - ha, ya, ca + ha, ya, cb + hb, yb, cb - hb, yb, dark ? 0 : 1]);
    const w = 0.006 / za;
    scene.lines.push([ca - ha, ya, cb - hb, yb, w], [ca + ha, ya, cb + hb, yb, w]);
  }
  const range = 60;
  for (let k = 0; k < lamps; k++) {
    const z = 1.5 + ((k * (range / lamps) - travel * 0.5) % range + range) % range;
    const y = yAt(z), c = cxAt(z), hw = hwAt(z) * 1.25, poleH = 0.5 / z;
    for (const side of [-1, 1]) {
      const x = c + side * hw;
      scene.lines.push([x, y, x, y - poleH, 0.002 / z, 1]);           // pole (dim)
      scene.glows.push([x - side * 0.02 / z, y - poleH, 0.05 / z]);   // neon head
    }
  }
  return scene;
}

/* ------------------------------------------------------------------ */
/* Renderer: Canvas 2D (glow via pre-rendered sprite / layered strokes)  */
/* ------------------------------------------------------------------ */

function makeGlowSprite(size, rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(0.15, `rgba(${rgb},0.9)`);
  grad.addColorStop(0.5, `rgba(${rgb},0.25)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function canvas2d({ shadowBlur }) {
  let ctx, W, H, sky, sprite;
  return {
    init(canvas) {
      ctx = canvas.getContext('2d', { alpha: false });
      W = canvas.width; H = canvas.height;
      sky = ctx.createLinearGradient(0, 0, 0, H * HORIZON);
      sky.addColorStop(0, '#05030f'); sky.addColorStop(1, '#2a1240');
      sprite = makeGlowSprite(64, '255,60,120');
      return true;
    },
    frame(s) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#07040d'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * HORIZON);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < s.stars; i++) {
        const st = STARS[i];
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(s.t * 2 + st[2] * 20));
        ctx.fillRect(st[0] * W, st[1] * H, 1.5 * dpr, 1.5 * dpr);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0c0818';
      ctx.beginPath(); ctx.moveTo(0, HORIZON * H);
      for (const [x, y] of MOUNTAINS) ctx.lineTo((x + s.parallax) * W, y * H);
      ctx.lineTo(W, HORIZON * H); ctx.closePath(); ctx.fill();

      for (const q of s.quads) {
        ctx.fillStyle = q[8] ? '#1a1030' : '#140c26';
        ctx.beginPath();
        ctx.moveTo(q[0] * W, q[1] * H); ctx.lineTo(q[2] * W, q[3] * H);
        ctx.lineTo(q[4] * W, q[5] * H); ctx.lineTo(q[6] * W, q[7] * H);
        ctx.fill();
      }

      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';
      if (shadowBlur) { ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 14 * dpr; }
      const passes = shadowBlur ? [[1, 'rgba(255,170,80,1)']]
        : [[6, 'rgba(255,90,20,0.12)'], [3, 'rgba(255,120,30,0.3)'], [1, 'rgba(255,200,120,1)']];
      for (const [k, color] of passes) {
        ctx.strokeStyle = color;
        for (const l of s.lines) {
          if (l[5]) continue;
          ctx.lineWidth = Math.max(1, l[4] * k * W);
          ctx.beginPath(); ctx.moveTo(l[0] * W, l[1] * H); ctx.lineTo(l[2] * W, l[3] * H); ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(120,90,160,0.6)';
      for (const l of s.lines) {
        if (!l[5]) continue;
        ctx.lineWidth = Math.max(1, l[4] * W);
        ctx.beginPath(); ctx.moveTo(l[0] * W, l[1] * H); ctx.lineTo(l[2] * W, l[3] * H); ctx.stroke();
      }
      if (shadowBlur) { ctx.shadowColor = '#ff3c78'; ctx.shadowBlur = 20 * dpr; ctx.fillStyle = '#ffd0e0'; }
      for (const [x, y, r] of s.glows) {
        const px = x * W, py = y * H, pr = Math.max(2, r * W);
        if (shadowBlur) { ctx.beginPath(); ctx.arc(px, py, pr * 0.25, 0, 6.283); ctx.fill(); }
        else ctx.drawImage(sprite, px - pr, py - pr, pr * 2, pr * 2);
      }
      ctx.shadowBlur = 0;
    },
    destroy() {},
  };
}

/* ------------------------------------------------------------------ */
/* Renderer: WebGL (one batched shader; optional bloom/scanline pass)   */
/* ------------------------------------------------------------------ */

const VS = `
attribute vec2 a_pos; attribute vec4 a_col; attribute vec3 a_uv;
uniform vec2 u_res; varying vec4 v_col; varying vec3 v_uv;
void main() {
  vec2 c = a_pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  v_col = a_col; v_uv = a_uv;
}`;
const FS = `
precision mediump float; varying vec4 v_col; varying vec3 v_uv;
void main() {
  float a = v_col.a;
  if (v_uv.z > 0.5) { float d = dot(v_uv.xy, v_uv.xy); a *= exp(-d * 4.0) * (1.0 - smoothstep(0.85, 1.0, d)); }
  gl_FragColor = vec4(v_col.rgb * a, a);
}`;
const POST_VS = `
attribute vec2 a_pos; varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const POST_FS = `
precision mediump float; varying vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_px;
void main() {
  vec3 col;
  col.r = texture2D(u_tex, v_uv + vec2(u_px.x * 1.5, 0.0)).r;
  col.g = texture2D(u_tex, v_uv).g;
  col.b = texture2D(u_tex, v_uv - vec2(u_px.x * 1.5, 0.0)).b;
  vec3 bloom = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 d = vec2(cos(a), sin(a)) * u_px;
    bloom += texture2D(u_tex, v_uv + d * 4.0).rgb + texture2D(u_tex, v_uv + d * 10.0).rgb;
  }
  col += bloom / 16.0 * 0.8;
  col *= 0.86 + 0.14 * sin(gl_FragCoord.y * 3.14159);
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function webgl({ post }) {
  let gl, W, H, prog, postProg, buf, quadBuf, fbo, tex, loc;
  const STRIDE = 9;                       // pos2 col4 uv3
  const data = new Float32Array(400000);
  let n = 0;                              // floats written
  const v = (x, y, r, g, b, a, u, w, f) => {
    data[n++] = x; data[n++] = y; data[n++] = r; data[n++] = g; data[n++] = b; data[n++] = a;
    data[n++] = u; data[n++] = w; data[n++] = f;
  };
  const quad = (p, col, glow) => {        // p: 4 corners [x,y]×4 in px
    const [r, g, b, a] = col;
    const uv = glow ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[0, 0], [0, 0], [0, 0], [0, 0]];
    for (const i of [0, 1, 2, 0, 2, 3]) v(p[i][0], p[i][1], r, g, b, a, uv[i][0], uv[i][1], glow ? 1 : 0);
  };
  const lineQuad = (l, width, col, glow) => {
    const x1 = l[0] * W, y1 = l[1] * H, x2 = l[2] * W, y2 = l[3] * H;
    let nx = -(y2 - y1), ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1; nx = nx / len * width / 2; ny = ny / len * width / 2;
    const [r, g, b, a] = col, f = glow ? 1 : 0;
    // uv.y runs across the line (-1..1) so the glow falls off sideways
    v(x1 + nx, y1 + ny, r, g, b, a, 0, -1, f); v(x2 + nx, y2 + ny, r, g, b, a, 0, -1, f); v(x2 - nx, y2 - ny, r, g, b, a, 0, 1, f);
    v(x1 + nx, y1 + ny, r, g, b, a, 0, -1, f); v(x2 - nx, y2 - ny, r, g, b, a, 0, 1, f); v(x1 - nx, y1 - ny, r, g, b, a, 0, 1, f);
  };
  const flush = () => {
    if (!n) return;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n));
    gl.drawArrays(gl.TRIANGLES, 0, n / STRIDE);
    n = 0;
  };

  return {
    init(canvas) {
      gl = canvas.getContext('webgl', { antialias: !post, alpha: false });
      if (!gl) return false;
      W = canvas.width; H = canvas.height;
      prog = compile(gl, VS, FS);
      loc = {
        pos: gl.getAttribLocation(prog, 'a_pos'), col: gl.getAttribLocation(prog, 'a_col'),
        uv: gl.getAttribLocation(prog, 'a_uv'), res: gl.getUniformLocation(prog, 'u_res'),
      };
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      if (post) {
        postProg = compile(gl, POST_VS, POST_FS);
        quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
        fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      return true;
    },
    frame(s) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, post ? fbo : null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const F = 4;
      gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, STRIDE * F, 0);
      gl.enableVertexAttribArray(loc.col); gl.vertexAttribPointer(loc.col, 4, gl.FLOAT, false, STRIDE * F, 2 * F);
      gl.enableVertexAttribArray(loc.uv);  gl.vertexAttribPointer(loc.uv, 3, gl.FLOAT, false, STRIDE * F, 6 * F);
      gl.uniform2f(loc.res, W, H);
      gl.clearColor(0.027, 0.016, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);

      // solid layer: sky, stars, mountains, road
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const hz = HORIZON * H;
      const top = [0.02, 0.01, 0.06, 1], bot = [0.16, 0.07, 0.25, 1];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const p = [[0, 0], [W, 0], [W, hz], [0, hz]][i];
        v(p[0], p[1], ...(p[1] ? bot : top), 0, 0, 0);
      }
      const sz = 1.5 * dpr;
      for (let i = 0; i < s.stars; i++) {
        const st = STARS[i], x = st[0] * W, y = st[1] * H;
        const a = 0.4 + 0.6 * Math.abs(Math.sin(s.t * 2 + st[2] * 20));
        quad([[x, y], [x + sz, y], [x + sz, y + sz], [x, y + sz]], [a, a, a, a], false);
      }
      const m = [0.047, 0.031, 0.094, 1];
      for (let i = 0; i < MOUNTAINS.length - 1; i++) {
        const [x1, y1] = MOUNTAINS[i], [x2, y2] = MOUNTAINS[i + 1];
        quad([[(x1 + s.parallax) * W, y1 * H], [(x2 + s.parallax) * W, y2 * H], [(x2 + s.parallax) * W, hz], [(x1 + s.parallax) * W, hz]], m, false);
      }
      for (const q of s.quads) {
        const c = q[8] ? [0.1, 0.063, 0.19, 1] : [0.078, 0.047, 0.15, 1];
        quad([[q[0] * W, q[1] * H], [q[2] * W, q[3] * H], [q[4] * W, q[5] * H], [q[6] * W, q[7] * H]], c, false);
      }
      for (const l of s.lines) if (l[5]) lineQuad(l, Math.max(1, l[4] * W), [0.47, 0.35, 0.63, 0.6], false);
      flush();

      // additive glow layer: edge lines + lamp heads
      gl.blendFunc(gl.ONE, gl.ONE);
      for (const l of s.lines) {
        if (l[5]) continue;
        lineQuad(l, Math.max(4, l[4] * 6 * W), [1, 0.4, 0.1, 0.5], true);
        lineQuad(l, Math.max(1, l[4] * W), [1, 0.78, 0.47, 1], false);
      }
      for (const [x, y, r] of s.glows) {
        const px = x * W, py = y * H, pr = Math.max(2, r * W);
        quad([[px - pr, py - pr], [px + pr, py - pr], [px + pr, py + pr], [px - pr, py + pr]], [1, 0.24, 0.47, 1], true);
      }
      flush();

      if (post) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.BLEND);
        gl.useProgram(postProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const p = gl.getAttribLocation(postProg, 'a_pos');
        gl.disableVertexAttribArray(loc.col); gl.disableVertexAttribArray(loc.uv);
        gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(postProg, 'u_tex'), 0);
        gl.uniform2f(gl.getUniformLocation(postProg, 'u_px'), 1 / W, 1 / H);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    },
    destroy() { gl?.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

/* ------------------------------------------------------------------ */
/* Benchmark harness                                                    */
/* ------------------------------------------------------------------ */

const TESTS = [
  { id: '2d-native',        label: 'Canvas 2D, sprite glow, native res',     make: () => canvas2d({}),                    res: 'native', load: 1 },
  { id: '2d-1x',            label: 'Canvas 2D, sprite glow, 1× res',         make: () => canvas2d({}),                    res: '1x',     load: 1 },
  { id: '2d-shadowblur',    label: 'Canvas 2D, shadowBlur glow, native res', make: () => canvas2d({ shadowBlur: true }),  res: 'native', load: 1 },
  { id: 'gl-native',        label: 'WebGL, native res',                      make: () => webgl({}),                       res: 'native', load: 1 },
  { id: 'gl-post-native',   label: 'WebGL + bloom/scanlines, native res',    make: () => webgl({ post: true }),           res: 'native', load: 1 },
  { id: '2d-native-x4',     label: 'Canvas 2D, sprite glow, native, ×4 load', make: () => canvas2d({}),                   res: 'native', load: 4 },
  { id: 'gl-post-native-x4', label: 'WebGL + bloom, native, ×4 load',        make: () => webgl({ post: true }),           res: 'native', load: 4 },
];
const WARMUP_MS = 600, MEASURE_MS = 3500;

function runTest(test) {
  const bench = $('bench');
  bench.innerHTML = '';
  const canvas = document.createElement('canvas');
  const scale = test.res === 'native' ? dpr : 1;
  canvas.width = Math.round(bench.clientWidth * scale);
  canvas.height = Math.round(bench.clientHeight * scale);
  bench.appendChild(canvas);
  const r = test.make();
  let ok = false;
  try { ok = r.init(canvas); } catch (e) { console.error(test.id, e); }
  if (!ok) return Promise.resolve({ ...pick(test), unsupported: true });

  const scene = { quads: [], lines: [], glows: [] };
  return new Promise((resolve) => {
    const frames = [], cpu = [];
    let start = null;
    const tick = (now) => {
      if (start === null) start = now;
      const el = now - start;
      const c0 = performance.now();
      r.frame(buildScene(el / 1000, test.load, scene));
      const c1 = performance.now();
      if (el > WARMUP_MS) { frames.push(now); cpu.push(c1 - c0); }
      if (el < WARMUP_MS + MEASURE_MS) { requestAnimationFrame(tick); return; }
      r.destroy();
      const dts = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
      const span = frames.at(-1) - frames[0];
      resolve({
        ...pick(test),
        width: canvas.width, height: canvas.height,
        fps: +((frames.length - 1) / (span / 1000)).toFixed(1),
        p95ms: +dts[Math.floor(dts.length * 0.95)].toFixed(1),
        cpuMs: +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2),
      });
    };
    requestAnimationFrame(tick);
  });
}
const pick = (t) => ({ id: t.id, label: t.label, res: t.res, load: t.load });

/* ------------------------------------------------------------------ */
/* Page wiring                                                          */
/* ------------------------------------------------------------------ */

let report = null;

function showInfo(info) {
  const rows = [
    ['Model', info.model || '(not reported)'], ['Platform', info.platform || '–'],
    ['Browser', info.browser || '–'], ['CPU cores', info.cpuCores ?? '–'],
    ['Memory', info.memoryGB ? `~${info.memoryGB} GB (rounded by the browser)` : '–'],
    ['Screen', `${info.screenCss} CSS px × ${info.devicePixelRatio} = ${info.screenPhysical} px`],
    ['Refresh rate', `${info.refreshHz} Hz`], ['WebGL', info.webgl],
    ['GPU', info.gpu || '–'], ['Max texture', info.maxTextureSize || '–'],
  ];
  $('info').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${String(v).replace(/</g, '&lt;')}</td></tr>`).join('');
}

function showResults(results) {
  $('results').innerHTML = results.map((r) => r.unsupported
    ? `<tr><td>${r.label}</td><td colspan="3">not supported</td></tr>`
    : `<tr><td>${r.label}<br><small class="hint">${r.width}×${r.height}</small></td>
       <td class="num">${r.fps}</td><td class="num">${r.p95ms}</td><td class="num">${r.cpuMs}</td></tr>`).join('');
}

const asText = (rep) => [
  `Device check ${rep.when}`,
  ...Object.entries(rep.info).map(([k, v]) => `${k}: ${v}`),
  '',
  ...rep.results.map((r) => r.unsupported ? `${r.label}: not supported`
    : `${r.label} (${r.width}×${r.height}): ${r.fps} fps, p95 ${r.p95ms} ms, cpu ${r.cpuMs} ms`),
].join('\n');

const info = await deviceInfo();
showInfo(info);

$('runBtn').addEventListener('click', async () => {
  $('runBtn').disabled = true;
  const results = [];
  for (const [i, t] of TESTS.entries()) {
    $('progress').textContent = `Running ${i + 1} of ${TESTS.length}: ${t.label}…`;
    results.push(await runTest(t));
    showResults(results);
  }
  $('bench').innerHTML = '';
  $('progress').textContent = 'Done.';
  report = { when: new Date().toISOString(), info, results };
  $('copyBtn').disabled = $('saveBtn').disabled = false;
  $('runBtn').disabled = false;
});

$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(asText(report)); $('progress').textContent = 'Copied.'; }
  catch { $('progress').textContent = 'Copy failed — use Download instead.'; }
});

$('saveBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  a.download = `device-check-${(info.model || 'device').replace(/\W+/g, '-')}-${report.when.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
