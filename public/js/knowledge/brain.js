// ── Knowledge brain ─────────────────────────────────────────────────────────
// Settings tab "Knowledge": the knowledge graph drawn as a 3D brain. Positions come from the server
// (GET /api/knowledge/graph, layout kept stable by lib/knowledge-layout.js); the client only rotates
// and projects them. Live mode lights the nodes agents read (WS knowledge_used) or write (WS
// knowledge_activity) and types every knowledge event into a terminal card; History shades every
// node by its use in a range (GET /api/knowledge/usage).
//
// Data (kb.graph, typed arrays) is kept apart from drawing (kbCreateRenderer). Canvas 2D holds up to
// roughly 10 000 nodes at a smooth frame rate; past that the renderer should move to WebGL behind the
// same interface (not done: the server caps the graph at 20 000 nodes).
// Server strings reach the DOM through textContent only; canvas labels go through fillText.

const KB_CATS = ['eng', 'ops', 'dec', 'res'];
const KB_CAT_LABEL = { eng: 'Engineering', ops: 'Operations', dec: 'Decisions', res: 'Research' };
const KB_RANGES = ['24h', '7d', '30d'];
const KB_FEED_MAX = 50;
const KB_TOP_USED = 10;
// Decorative scaffold: faint points that keep the brain shape readable while there are few real
// nodes. Never picked, counted or linked.
const KB_SCAFFOLD_TARGET = 1500;
const KB_REFRESH_DEBOUNCE = 2000;
const KB_DEPTH_BUCKETS = 96;
const KB_EDGE_LEVELS = 6;
const KB_LABEL_MAX = 12;
const KB_LABEL_CHARS = 32;
// Live card: a new line types out at KB_TYPE_MS per character (faster while lines wait), and the
// card stays awake KB_AWAKE_MS after the last line is done.
const KB_TYPE_MS = 25;
const KB_AWAKE_MS = 8000;
const KB_IGNITE_MAX = 200;
// Fold lines: depth bands per frame, and the slow pulse (period and depth); none under reduced motion.
const KB_FOLD_BANDS = 5;
const KB_FOLD_PULSE_MS = 6000;
const KB_FOLD_PULSE = 0.18;
// knowledge_activity kinds → line tone (color in knowledge-brain.css).
const KB_ACT_TONE = {
  extract_start: 'write', extract: 'write', extract_failed: 'drop', document_add: 'write',
  document_remove: 'drop', node_delete: 'drop', room_toggle: 'sys',
};

const KB_PALETTE = {
  dark: {
    cats: ['oklch(0.74 0.065 250)', 'oklch(0.78 0.07 78)', 'oklch(0.77 0.06 152)', 'oklch(0.73 0.065 320)'],
    lit: 'oklch(0.93 0.05 85)', dust: 'oklch(0.66 0.03 250)', label: 'oklch(0.9 0.012 250)', knock: 'oklch(0.17 0.02 260)', ring: 'oklch(0.94 0.03 85)',
    halo: 0.2, node: 0.9, edge: 0.2, dust_a: 0.5,
    fold: 'oklch(0.8 0.12 222)', fold_glow: 'oklch(0.68 0.15 238)', fissure: 'oklch(0.88 0.1 212)',
    fold_a: 0.5, fold_glow_a: 0.11, fold_halo_a: 0.035, fold_blend: 'lighter',
  },
  light: {
    cats: ['oklch(0.5 0.085 252)', 'oklch(0.55 0.095 62)', 'oklch(0.5 0.075 152)', 'oklch(0.48 0.08 320)'],
    lit: 'oklch(0.6 0.14 52)', dust: 'oklch(0.55 0.025 70)', label: 'oklch(0.3 0.02 60)', knock: 'oklch(0.97 0.01 85)', ring: 'oklch(0.42 0.1 52)',
    halo: 0.1, node: 0.85, edge: 0.2, dust_a: 0.42,
    fold: 'oklch(0.5 0.12 240)', fold_glow: 'oklch(0.68 0.1 232)', fissure: 'oklch(0.45 0.13 245)',
    fold_a: 0.46, fold_glow_a: 0.1, fold_halo_a: 0, fold_blend: 'source-over',
  },
};

const kb = {
  built: false, els: null, renderer: null,
  mode: 'live', range: '7d',
  graph: null, graphSeq: 0, graphError: null,
  usage: { seq: 0, range: null, counts: null, max: 0, error: null },
  feed: [], usedBy: new Map(), recentLoaded: false, recentSeq: 0, recentError: null,
  term: { queue: [], typing: null, timer: 0, sleepTimer: 0, awake: false }, igniteAfterLoad: [],
  pulses: [], scaffold: null, folds: null, ranked: [], blocked: [],
  view: {
    yaw: -1.05, pitch: 0.18, zoom: 1, yawTo: null, pitchTo: null,
    drag: null, pauseUntil: 0, mouse: null, mouseMoved: false,
    hover: -1, selected: -1, cx: 0, cy: 0, size: 1,
  },
  detail: { seq: 0, id: null },
  raf: 0, lastTs: 0, refreshTimer: null,
  reducedMotion: false, scheme: 'dark',
};

function kbEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function kbDate(s) {
  if (typeof s !== 'string' || !s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}

function kbAgo(d) {
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function kbPlural(n, one, many) { return `${n.toLocaleString()} ${n === 1 ? one : many}`; }

async function kbFetch(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return body;
}

function kbVisible() {
  return kb.built && !document.hidden && typeof settingsOpen !== 'undefined' && settingsOpen
    && kb.els.tab.style.display !== 'none';
}

function kbSchemeNow() {
  const id = typeof currentTheme === 'function' ? currentTheme() : '';
  const t = typeof THEMES !== 'undefined' ? THEMES.find(x => x.id === id) : null;
  return t && t.scheme === 'light' ? 'light' : 'dark';
}

// ── Brain scaffold and folds (the volume itself: knowledge/brain-volume.js, shared with the server) ──

// Fixed seed: the scaffold looks the same on every visit. Denser near the cortex surface.
function kbBuildScaffold() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = new Float32Array(KB_SCAFFOLD_TARGET * 3);
  let n = 0;
  while (n < KB_SCAFFOLD_TARGET) {
    const x = (rnd() - 0.5) * 1.8, y = (rnd() - 0.5) * 2, z = (rnd() - 0.5) * 2.2;
    const k = kbInside(x, y, z);
    if (!k) continue;
    if (k === 1 && kbvCerebrum(Math.abs(x), y, z) < -0.07 && rnd() < 0.7) continue;
    out[n * 3] = x; out[n * 3 + 1] = y; out[n * 3 + 2] = z;
    n++;
  }
  return out;
}

// Glowing folds. Each part's surface is reached from a centre: a ray per (u, v) direction sphere-traces
// the part's distance from outside in, so the point found is the outermost one (the temporal lobe
// hides the crease above it). On that surface the zero contours of a field are the sulci: on the
// cortex random plane waves of one wavelength in every direction, bent by a domain warp (their zero
// set is a labyrinth of long, meandering, branching lines, not rings); on the cerebellum folia fanning
// out from its front and curving back like the ridges of a shell (a spiral around a left-right axis,
// its spacing warped by noise), kept on the back-facing surface off the vermis and broken into dashes
// of random length, so from behind they are uneven open arcs (whole rings read as stacked ellipses
// through the translucent volume), plus its rim (where the surface turns from a side view, kind 4); on
// the brain stem fibres along it. Seams (kind 1, fissure), on the cerebrum only: where the surface stops
// being outer cortex (the longitudinal fissure, kept along the top and the poles), where the outermost
// surface jumps between lobes, and the lateral fissure (the contour where the temporal lobe meets the
// rest, along the lobe's top). Built once as marching-squares segments, then
// chained into polylines and thinned (fewer, longer subpaths stroke much faster). Result: points
// pos[xyz], polyline j = points start[j]..start[j+1]-1, kind 0 = cortex, 1 = fissure, 2 = cerebellum
// folia, 3 = brain stem fibres, 4 = cerebellum rim. The brain stem counts as
// outside for the other parts, so it doesn't punch a seam ring into the cerebellum; its own lines run
// below the cerebrum and simply end where it enters (no seams).
const KB_FOLD_SURFACES = [
  { c: [0.32, 0.1, -0.02], d: kbvCerebrum, k: 1, nu: 300, nv: 220, rmax: 1.05 },
  { c: [-0.32, 0.1, -0.02], d: (x, y, z) => kbvCerebrum(-x, y, z), k: 1, nu: 300, nv: 220, rmax: 1.05 },
  { c: [0, -0.42, -0.57], d: kbvCerebellum, k: 2, nu: 240, nv: 140, rmax: 0.5 },
  { c: [0, -0.46, -0.25], d: kbvStem, k: 3, nu: 96, nv: 100, rmax: 0.4 },
];
// Lowest y of the lateral fissure line (the temporal lobe's upper side; its centre is at y -0.22).
const KB_LATERAL_FLOOR = -0.24;
// Radius jump between neighbouring rays that marks a crease seam rather than a slope.
const KB_FOLD_JUMP = 0.05;

// n plane waves of wavenumber about K in random directions (seeded), for kbFoldNoise.
function kbFoldWaves(seed, n, K) {
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const w = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), k = K * (0.9 + 0.2 * rnd());
    w[i * 4] = k * Math.sin(ph) * Math.cos(th);
    w[i * 4 + 1] = k * Math.sin(ph) * Math.sin(th);
    w[i * 4 + 2] = k * Math.cos(ph);
    w[i * 4 + 3] = rnd() * Math.PI * 2;
  }
  return w;
}
function kbFoldNoise(w, x, y, z) {
  let s = 0;
  const n = w.length / 4;
  for (let i = 0; i < n; i++) s += Math.sin(w[i * 4] * x + w[i * 4 + 1] * y + w[i * 4 + 2] * z + w[i * 4 + 3]);
  return s / Math.sqrt(n / 2);
}

function kbBuildFolds() {
  const warpX = kbFoldWaves(11, 5, 3.5), warpY = kbFoldWaves(23, 5, 3.5), warpZ = kbFoldWaves(37, 5, 3.5);
  const gyri = kbFoldWaves(53, 48, 70);
  const cortex = (x, y, z) => {
    const A = 0.06;
    return kbFoldNoise(gyri, x + A * kbFoldNoise(warpX, x, y, z), y + A * kbFoldNoise(warpY, x, y, z), z + A * kbFoldNoise(warpZ, x, y, z));
  };
  const foliaWarp = kbFoldWaves(89, 6, 6);
  const folia = (x, y, z) => {
    const v = y + 0.42, w = -(z + 0.32);
    return Math.sin(30 * Math.atan2(v, w) + 70 * Math.hypot(v, w) + 1.2 * Math.sin(6 * x) + 1.8 * kbFoldNoise(foliaWarp, x, y, z));
  };
  const dashes = kbFoldWaves(71, 12, 16);
  // Brain stem: fibres running along its axis.
  const stem = (x, y, z) => {
    const t = Math.max(0, Math.min(1, (KBV_STEM.y0 - y) / KBV_STEM.len));
    return Math.sin(6 * Math.atan2(x, z - KBV_STEM.z0 + KBV_STEM.lean * t) + 0.5 * Math.sin(8 * y));
  };
  const segs = [], kinds = [];
  const push = (a, b, kind) => { segs.push(a[0], a[1], a[2], b[0], b[1], b[2]); kinds.push(kind); };
  const EPS = 0.012;

  for (const S of KB_FOLD_SURFACES) {
    const [cx, cy, cz] = S.c, D = S.d;
    const dir = (u, v) => { const sv = Math.sin(v); return [sv * Math.cos(u), Math.cos(v), sv * Math.sin(u)]; };
    // Outermost surface radius along a direction (sphere trace inward from S.rmax, past the part's
    // farthest point), 0 = miss.
    const radius = (u, v) => {
      const [dx, dy, dz] = dir(u, v);
      let r = S.rmax;
      for (let it = 0; it < 64 && r > 0; it++) {
        const s = D(cx + dx * r, cy + dy * r, cz + dz * r);
        if (s < 1e-4) {
          let lo = r, hi = Math.min(S.rmax, r + Math.max(0.004, -s) + 0.004);
          for (let t = 0; t < 8; t++) { const m = (lo + hi) / 2; if (D(cx + dx * m, cy + dy * m, cz + dz * m) < 0) lo = m; else hi = m; }
          return (lo + hi) / 2;
        }
        r -= Math.max(0.004, s * 0.85);
      }
      return 0;
    };
    const at = (u, v, r) => { const [dx, dy, dz] = dir(u, v); return [cx + dx * r, cy + dy * r, cz + dz * r]; };
    const normal = (p) => {
      const h = 0.004, d0 = D(p[0], p[1], p[2]);
      const nx = D(p[0] + h, p[1], p[2]) - d0, ny = D(p[0], p[1] + h, p[2]) - d0, nz = D(p[0], p[1], p[2] + h) - d0;
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    };
    // No seam where the cerebellum meets the cerebrum: that contact is a closed loop per lobe and reads
    // as stacked ellipses through the translucent volume; the folia ending there mark it well enough.
    const seam = (p) => S.k !== 2 && kbvCerebellum(p[0], p[1], p[2]) >= 0.03;
    const outer = (p) => {
      if (S.k === 1 && Math.abs(p[0]) < KBV_FISSURE + 0.025) return false;
      const [nx, ny, nz] = normal(p);
      if (kbInside(p[0] - nx * EPS, p[1] - ny * EPS, p[2] - nz * EPS) !== S.k) return false;
      const beyond = kbInside(p[0] + nx * EPS, p[1] + ny * EPS, p[2] + nz * EPS);
      return beyond === 0 || beyond === 3;
    };
    const field = S.k === 1 ? cortex : S.k === 2 ? folia : stem;
    const NU = S.nu, NV = S.nv, du = Math.PI * 2 / NU, dv = Math.PI / NV;
    const W = NU + 1, ok = new Uint8Array(W * (NV + 1)), val = new Float32Array(W * (NV + 1)), R = new Float32Array(W * (NV + 1));
    // Lateral fissure: where the temporal lobe meets the rest of the hemisphere (lobes − temporal = 0).
    const lat = S.k === 1 ? new Float32Array(W * (NV + 1)) : null;
    // Folia cells: on the back-facing surface, clear of the hub (the lines end on an arc there) and of the
    // vermis (folia crossing it read as chevrons from behind), not in a dash gap.
    const fol = S.k === 2 ? new Uint8Array(W * (NV + 1)) : null;
    // Cerebellum rim: where its surface turns away from a side view (normal x = 0).
    const rim = S.k === 2 ? new Float32Array(W * (NV + 1)) : null;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i * du, v = j * dv, o = j * W + i;
      const r = i === NU ? R[j * W] : radius(u, v);
      R[o] = r;
      if (!r) continue;
      const p = at(u, v, r);
      ok[o] = outer(p) ? 1 : 0;
      if (ok[o]) val[o] = field(p[0], p[1], p[2]);
      if (fol && ok[o]) {
        const n = normal(p), hub = Math.hypot(p[1] + 0.42, p[2] + 0.32) > 0.2;
        fol[o] = n[2] < 0.6 && hub && Math.abs(p[0]) > 0.07 && kbFoldNoise(dashes, p[0], p[1], p[2]) > -0.35 ? 1 : 0;
        rim[o] = hub ? n[0] : NaN;
      }
      if (lat) { const ax = Math.abs(p[0]); lat[o] = kbvLobes(ax, p[1], p[2]) - kbvTemporal(ax, p[1], p[2]); }
    }
    // A grid edge is a seam when the outer test flips along it or the radius jumps (a crease hidden
    // under an overhanging lobe). Bisect in (u, v) for the seam point, on the outermost side.
    const pointAt = (u, v) => { const r = radius(u, v); return r ? at(u, v, r) : null; };
    const seamFlip = (u0, v0, u1, v1, in0) => {
      for (let t = 0; t < 7; t++) {
        const um = (u0 + u1) / 2, vm = (v0 + v1) / 2, p = pointAt(um, vm);
        if ((p ? outer(p) : false) === in0) { u0 = um; v0 = vm; } else { u1 = um; v1 = vm; }
      }
      return pointAt(in0 ? u0 : u1, in0 ? v0 : v1);
    };
    const seamJump = (u0, v0, r0, u1, v1, r1) => {
      const mid = (r0 + r1) / 2, far0 = r0 > r1;
      for (let t = 0; t < 7; t++) {
        const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
        if ((radius(um, vm) > mid) === far0) { u0 = um; v0 = vm; } else { u1 = um; v1 = vm; }
      }
      return far0 ? at(u0, v0, radius(u0, v0)) : at(u1, v1, radius(u1, v1));
    };
    // Marching squares: the zero contour of grid values f through one cell.
    const contour = (f, o, c, kind) => {
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const a = f[o[e]], b = f[o[(e + 1) % 4]];
        if ((a < 0) === (b < 0)) continue;
        const t = a / (a - b), [i0, j0] = c[e], [i1, j1] = c[(e + 1) % 4];
        const ra = R[o[e]], rb = R[o[(e + 1) % 4]];
        pts.push(at((i0 + (i1 - i0) * t) * du, (j0 + (j1 - j0) * t) * dv, ra + (rb - ra) * t));
      }
      if (pts.length >= 2) push(pts[0], pts[1], kind);
      if (pts.length === 4) push(pts[2], pts[3], kind);
    };
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const o = c.map(([a, b]) => b * W + a);
      if (!R[o[0]] && !R[o[1]] && !R[o[2]] && !R[o[3]]) continue;
      const seams = [];
      let n = 0;
      for (let e = 0; e < 4; e++) {
        const a = o[e], b = o[(e + 1) % 4], [i0, j0] = c[e], [i1, j1] = c[(e + 1) % 4];
        n += ok[a];
        if (ok[a] !== ok[b]) {
          const p = seamFlip(i0 * du, j0 * dv, i1 * du, j1 * dv, ok[a] === 1);
          if (p && !(S.k === 1 && Math.abs(p[0]) < KBV_FISSURE + 0.05 && p[1] < 0.05 && Math.abs(p[2]) < 0.6)) seams.push(p);
        } else if (ok[a] && Math.abs(R[a] - R[b]) > KB_FOLD_JUMP) {
          seams.push(seamJump(i0 * du, j0 * dv, R[a], i1 * du, j1 * dv, R[b]));
        }
      }
      if (S.k !== 3 && seams.length >= 2 && seam(seams[0])) push(seams[0], seams[1], 1);
      if (S.k !== 3 && seams.length === 4 && seam(seams[2])) push(seams[2], seams[3], 1);
      if (seams.length || n !== 4) continue;
      if (!fol || (fol[o[0]] && fol[o[1]] && fol[o[2]] && fol[o[3]])) contour(val, o, c, S.k === 1 ? 0 : S.k);
      if (rim && o.every(q => !Number.isNaN(rim[q]))) contour(rim, o, c, 4);
      // The lateral fissure runs along the top of the temporal lobe; below it the same contour would
      // close into a loop under the lobe, which shows through the translucent volume as a ring.
      if (lat && at(i * du, j * dv, R[o[0]])[1] > KB_LATERAL_FLOOR) contour(lat, o, c, 1);
    }
  }
  return kbChainFolds(segs, kinds);
}

function kbChainFolds(segs, kinds) {
  const key = (o) => `${Math.round(segs[o] * 2e4)},${Math.round(segs[o + 1] * 2e4)},${Math.round(segs[o + 2] * 2e4)}`;
  const ends = new Map();
  const m = kinds.length;
  for (let k = 0; k < m; k++) for (let e = 0; e < 2; e++) {
    const kk = kinds[k] + '|' + key(k * 6 + e * 3);
    const list = ends.get(kk);
    if (list) list.push(k * 2 + e); else ends.set(kk, [k * 2 + e]);
  }
  const used = new Uint8Array(m), pos = [], start = [], kind = [];
  const other = (end) => { const list = ends.get(kinds[end >> 1] + '|' + key((end >> 1) * 6 + (end & 1) * 3)); for (const x of list) if (!used[x >> 1]) return x; return -1; };
  const pt = (end) => { const o = (end >> 1) * 6 + (end & 1) * 3; return [segs[o], segs[o + 1], segs[o + 2]]; };
  for (let k = 0; k < m; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const fwd = walk(k * 2 + 1), back = walk(k * 2);
    const line = [...back.reverse(), pt(k * 2), pt(k * 2 + 1), ...fwd];
    start.push(pos.length / 3);
    kind.push(kinds[k]);
    let last = line[0];
    pos.push(...last);
    for (let i = 1; i < line.length; i++) {
      const p = line[i], q = line[i + 1];
      if (q && i < line.length - 1) {
        const ax = q[0] - last[0], ay = q[1] - last[1], az = q[2] - last[2];
        const bx = p[0] - last[0], by = p[1] - last[1], bz = p[2] - last[2];
        const L = ax * ax + ay * ay + az * az;
        const t = L ? (ax * bx + ay * by + az * bz) / L : 0;
        const dx = bx - ax * t, dy = by - ay * t, dz = bz - az * t;
        if (dx * dx + dy * dy + dz * dz < 1.6e-6) continue;
      }
      pos.push(...p);
      last = p;
    }
  }
  start.push(pos.length / 3);
  // Points past a segment end, following unused segments that share it.
  function walk(end) {
    const out = [];
    for (let at = other(end); at >= 0; at = other(at ^ 1)) { used[at >> 1] = 1; out.push(pt(at ^ 1)); }
    return out;
  }
  return { pos: new Float32Array(pos), start: Uint32Array.from(start), kind: Uint8Array.from(kind), count: kind.length, points: pos.length / 3 };
}

// ── Renderer (Canvas 2D) ────────────────────────────────────────────────────

function kbCreateRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, D = 1, pal = KB_PALETTE.dark, sprites = null, font = '11.5px system-ui, sans-serif';
  let cap = 0, SX, SY, SZ, SF, SR, order, bucketCount;
  let ecap = 0, ekey, eorder;
  const keyCount = new Uint32Array(KB_CATS.length * KB_EDGE_LEVELS + 1);

  function ensure(n, m) {
    if (n > cap) {
      cap = Math.max(n, 64);
      SX = new Float32Array(cap); SY = new Float32Array(cap); SZ = new Float32Array(cap);
      SF = new Float32Array(cap); SR = new Float32Array(cap); order = new Uint32Array(cap);
    }
    if (!bucketCount) bucketCount = new Uint32Array(KB_DEPTH_BUCKETS + 1);
    if (m > ecap) { ecap = Math.max(m, 64); ekey = new Uint8Array(ecap); eorder = new Uint32Array(ecap); }
  }

  // Pre-rendered once per category and theme; nodes are drawImage'd, never a gradient per frame.
  // Stops fade the same hue to alpha 0 (a bare 'transparent' would fade through black).
  function sprite(color, halo) {
    const s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const a = (x) => color.replace(/\)$/, ` / ${x})`);
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, color);
    rg.addColorStop(0.22, color);
    rg.addColorStop(0.34, a(halo));
    rg.addColorStop(1, a(0));
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
    return c;
  }

  function setScheme(scheme) {
    pal = KB_PALETTE[scheme] || KB_PALETTE.dark;
    sprites = { cats: pal.cats.map(c => sprite(c, pal.halo)), lit: sprite(pal.lit, pal.halo * 1.6) };
    font = '11.5px ' + (getComputedStyle(canvas).getPropertyValue('--kb-sans').trim() || 'system-ui, sans-serif');
  }

  function resize(w, h) {
    D = window.devicePixelRatio || 1;
    W = Math.max(1, w); H = Math.max(1, h);
    canvas.width = Math.round(W * D); canvas.height = Math.round(H * D);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }

  const dep = z => Math.max(0.25, Math.min(1, 0.7 - z * 0.5));

  function project(view, pos, n) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const sc = view.size * 0.42 * view.zoom;
    for (let i = 0; i < n; i++) {
      const a = pos[i * 3], b = pos[i * 3 + 1], c = pos[i * 3 + 2];
      const X = a * cy - c * sy;
      let Z = a * sy + c * cy;
      const Y = b * cp - Z * sp;
      Z = b * sp + Z * cp;
      const f = 3.2 / (3.2 + Z);
      SX[i] = view.cx + X * sc * f; SY[i] = view.cy - Y * sc * f; SZ[i] = Z; SF[i] = f;
    }
  }

  // Far to near, counting sort on depth buckets: O(n) per frame.
  function depthOrder(n) {
    bucketCount.fill(0);
    const B = KB_DEPTH_BUCKETS;
    const bucket = z => Math.max(0, Math.min(B - 1, Math.floor((1.6 - z) / 3.2 * B)));
    for (let i = 0; i < n; i++) bucketCount[bucket(SZ[i]) + 1]++;
    for (let b = 0; b < B; b++) bucketCount[b + 1] += bucketCount[b];
    for (let i = 0; i < n; i++) order[bucketCount[bucket(SZ[i])]++] = i;
  }

  function drawScaffold(view, pts, count) {
    if (!count) return;
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const sc = view.size * 0.42 * view.zoom;
    ctx.fillStyle = pal.dust;
    for (let band = 0; band < 3; band++) {
      ctx.globalAlpha = pal.dust_a * (0.4 + band * 0.3);
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const a = pts[i * 3], b = pts[i * 3 + 1], c = pts[i * 3 + 2];
        const X = a * cy - c * sy;
        let Z = a * sy + c * cy;
        const Y = b * cp - Z * sp;
        Z = b * sp + Z * cp;
        const d = dep(Z);
        if ((d < 0.5 ? 0 : d < 0.8 ? 1 : 2) !== band) continue;
        const f = 3.2 / (3.2 + Z);
        const r = 1.3 * f;
        ctx.rect(view.cx + X * sc * f - r / 2, view.cy - Y * sc * f - r / 2, r, r);
      }
      ctx.fill();
    }
  }

  // Folds in KB_FOLD_BANDS depth bands per kind, each band one thin stroke over one soft wide one;
  // the far side stays visible but dim, as through a translucent brain. breathe is the slow pulse.
  let FX = null, FY = null, FZ = null;
  function drawFolds(view, folds, breathe) {
    const N = folds.points, P = folds.pos, B = KB_FOLD_BANDS, st = folds.start;
    if (!folds.count) return;
    if (!FX || FX.length < N) { FX = new Float32Array(N); FY = new Float32Array(N); FZ = new Float32Array(N); }
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const sc = view.size * 0.42 * view.zoom;
    for (let i = 0; i < N; i++) {
      const a = P[i * 3], b = P[i * 3 + 1], c = P[i * 3 + 2];
      const X = a * cy - c * sy;
      let Z = a * sy + c * cy;
      const Y = b * cp - Z * sp;
      Z = b * sp + Z * cp;
      const f = 3.2 / (3.2 + Z);
      FX[i] = view.cx + X * sc * f; FY[i] = view.cy - Y * sc * f; FZ[i] = Z;
    }
    const band = i => Math.min(B - 1, Math.floor((dep((FZ[i] + FZ[i + 1]) / 2) - 0.25) / 0.75 * B));
    const lw = Math.min(1.6, 0.6 + 0.4 * view.zoom);
    ctx.globalCompositeOperation = pal.fold_blend;
    ctx.lineJoin = 'round';
    // The cerebellum and the brain stem sit under the cerebrum: seen from above or below their folia and
    // fibres would show through the translucent cortex as rings and a starburst, so they fade with pitch.
    // The rim (kind 4) outlines the cerebellum from the side only: from behind it is a line down each lobe.
    // The stem's fibres fade from behind too, where they would cut across the folia.
    const underVis = cp * cp, sideVis = sy * sy;
    for (let kind = 0; kind < 5; kind++) {
      const vis = kind === 2 ? underVis * (0.5 + 0.5 * sideVis) : kind === 3 ? underVis * (0.1 + 0.9 * sideVis) : kind === 4 ? underVis * sideVis : 1;
      if (vis < 0.02) continue;
      for (let bd = 0; bd < B; bd++) {
        const d = 0.08 + 0.92 * ((bd + 1) / B) ** 1.8;
        ctx.beginPath();
        for (let j = 0; j < folds.count; j++) {
          if (folds.kind[j] !== kind) continue;
          let pen = false;
          for (let i = st[j], e = st[j + 1] - 1; i < e; i++) {
            if (band(i) !== bd) { pen = false; continue; }
            if (!pen) { ctx.moveTo(FX[i], FY[i]); pen = true; }
            ctx.lineTo(FX[i + 1], FY[i + 1]);
          }
        }
        const boost = (kind === 1 ? 1.2 : kind === 2 || kind === 4 ? 0.8 : 1) * vis;
        ctx.strokeStyle = pal.fold_glow;
        if (pal.fold_halo_a && bd >= B - 2) {
          ctx.globalAlpha = Math.min(1, pal.fold_halo_a * d * boost * breathe);
          ctx.lineWidth = lw * 9;
          ctx.stroke();
        }
        ctx.globalAlpha = Math.min(1, pal.fold_glow_a * d * boost * breathe);
        ctx.lineWidth = lw * 3.6;
        ctx.stroke();
        ctx.strokeStyle = kind === 1 ? pal.fissure : pal.fold;
        ctx.globalAlpha = Math.min(1, pal.fold_a * d * boost * breathe);
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Edges batched by (category, alpha level) in one path each; lit edges drawn on top.
  function drawEdges(g, bright, glow) {
    const m = g.edgeCount;
    if (!m) return;
    const L = KB_EDGE_LEVELS;
    keyCount.fill(0);
    let lit = null;
    for (let k = 0; k < m; k++) {
      const a = g.ea[k], b = g.eb[k];
      const e = (bright[a] + bright[b]) / 2;
      const al = dep((SZ[a] + SZ[b]) / 2) * (0.25 + 0.75 * e) * (0.6 + 0.4 * g.ew[k]);
      const lvl = Math.max(0, Math.min(L - 1, Math.floor(al * L)));
      const key = g.cat[a] * L + lvl;
      ekey[k] = key;
      keyCount[key + 1]++;
      const gl = Math.max(glow[a], glow[b]);
      if (gl > 0.12) (lit || (lit = [])).push(k);
    }
    for (let i = 0; i < keyCount.length - 1; i++) keyCount[i + 1] += keyCount[i];
    const start = keyCount.slice();
    for (let k = 0; k < m; k++) eorder[start[ekey[k]]++] = k;
    ctx.lineWidth = 0.7;
    for (let key = 0; key < KB_CATS.length * L; key++) {
      const from = keyCount[key], to = keyCount[key + 1];
      if (from === to) continue;
      ctx.strokeStyle = pal.cats[Math.floor(key / L)];
      ctx.globalAlpha = pal.edge * ((key % L) + 0.5) / L;
      ctx.beginPath();
      for (let j = from; j < to; j++) {
        const k = eorder[j];
        ctx.moveTo(SX[g.ea[k]], SY[g.ea[k]]);
        ctx.lineTo(SX[g.eb[k]], SY[g.eb[k]]);
      }
      ctx.stroke();
    }
    if (lit) {
      ctx.strokeStyle = pal.lit;
      for (const k of lit) {
        const a = g.ea[k], b = g.eb[k];
        const gl = Math.max(glow[a], glow[b]);
        ctx.globalAlpha = Math.min(0.75, gl * 0.6);
        ctx.lineWidth = 0.7 + gl * 1.1;
        ctx.beginPath(); ctx.moveTo(SX[a], SY[a]); ctx.lineTo(SX[b], SY[b]); ctx.stroke();
      }
    }
  }

  function drawPulses(pulses) {
    for (const p of pulses) {
      if (p.t < 0 || p.t > 1) continue;
      const x = SX[p.a] + (SX[p.b] - SX[p.a]) * p.t, y = SY[p.a] + (SY[p.b] - SY[p.a]) * p.t;
      const R = 7 * SF[p.a];
      ctx.globalAlpha = 0.85 * p.level;
      ctx.drawImage(sprites.lit, x - R, y - R, R * 2, R * 2);
    }
  }

  function drawNodes(g, bright, glow) {
    const n = g.n, zs = Math.sqrt(kb.view.zoom);
    for (let j = 0; j < n; j++) {
      const i = order[j];
      const d = dep(SZ[i]);
      const r = g.radius[i] * SF[i] * zs;
      SR[i] = r;
      const stale = g.stale[i] ? 0.6 : 1;
      const R = r * 3;
      ctx.globalAlpha = Math.min(1, pal.node * d * (0.22 + 0.78 * bright[i]) * stale);
      ctx.drawImage(sprites.cats[g.cat[i]], SX[i] - R, SY[i] - R, R * 2, R * 2);
      const gl = glow[i];
      if (gl > 0.04) {
        const G = R + gl * 7;
        ctx.globalAlpha = Math.min(1, gl * (0.45 + 0.55 * d));
        ctx.drawImage(sprites.lit, SX[i] - G, SY[i] - G, G * 2, G * 2);
      }
    }
  }

  function drawRing(i, strong) {
    ctx.globalAlpha = strong ? 0.9 : 0.55;
    ctx.strokeStyle = pal.ring;
    ctx.lineWidth = strong ? 1.4 : 1;
    ctx.beginPath(); ctx.arc(SX[i], SY[i], Math.max(5, SR[i] + 4), 0, Math.PI * 2); ctx.stroke();
  }

  // Greedy placement in priority order (selected, hover, lit, most used, hubs), at most KB_LABEL_MAX:
  // a label is drawn right of its node, else left, only where its measured box clears the canvas
  // edge, the panels over the canvas and every label already placed; otherwise it is skipped.
  let lw = null, lwGraph = null, lwFont = '';
  function labelText(g, i) {
    const t = g.titles[i];
    return t.length > KB_LABEL_CHARS ? t.slice(0, KB_LABEL_CHARS - 1).trimEnd() + '…' : t;
  }
  function drawLabels(g, glow, view, litIdx, ranked, blocked) {
    ctx.font = font;
    ctx.fillStyle = pal.label;
    ctx.strokeStyle = pal.knock;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    if (lwGraph !== g || lwFont !== font) { lw = new Float32Array(g.n).fill(-1); lwGraph = g; lwFont = font; }
    const placed = [], seen = new Set(), pad = 3, lh = 15;
    const free = (x0, y0, x1, y1) => {
      if (x0 < 6 || y0 < 4 || x1 > W - 6 || y1 > H - 4) return false;
      for (const b of blocked) if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) return false;
      for (const b of placed) if (x0 < b.x1 + pad && x1 + pad > b.x0 && y0 < b.y1 && y1 > b.y0) return false;
      return true;
    };
    const put = (i, a) => {
      if (i < 0 || i >= g.n || seen.has(i) || placed.length >= KB_LABEL_MAX) return;
      seen.add(i);
      if (lw[i] < 0) lw[i] = ctx.measureText(labelText(g, i)).width;
      const w = lw[i], gap = SR[i] + 6, y0 = SY[i] - lh / 2, y1 = SY[i] + lh / 2;
      let x = SX[i] + gap;
      if (!free(x, y0, x + w, y1)) {
        x = SX[i] - gap - w;
        if (!free(x, y0, x + w, y1)) return;
      }
      placed.push({ x0: x, y0, x1: x + w, y1 });
      const t = labelText(g, i);
      ctx.globalAlpha = a * 0.8;
      ctx.strokeText(t, x, SY[i]);
      ctx.globalAlpha = a;
      ctx.fillText(t, x, SY[i]);
    };
    put(view.selected, 0.95);
    put(view.hover, 0.95);
    if (litIdx.length) {
      const lit = litIdx.slice().sort((a, b) => glow[b] - glow[a]);
      for (const i of lit) put(i, Math.min(0.9, 0.4 + glow[i] * 0.5));
    }
    for (const i of ranked) { const d = dep(SZ[i]); if (d > 0.5) put(i, 0.45 + (d - 0.5) * 0.9); }
    for (const i of g.landmarks) { const d = dep(SZ[i]); if (d > 0.62) put(i, 0.3 + (d - 0.62) * 1.2); }
  }

  function frame(scene) {
    const { view, graph: g, bright, glow, scaffoldCount, pulses, litIdx, ranked, blocked, breathe } = scene;
    ctx.setTransform(D, 0, 0, D, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    if (kb.folds) drawFolds(view, kb.folds, breathe);
    drawScaffold(view, kb.scaffold, scaffoldCount);
    if (g && g.n) {
      ensure(g.n, g.edgeCount);
      project(view, g.pos, g.n);
      depthOrder(g.n);
      drawEdges(g, bright, glow);
      drawPulses(pulses);
      drawNodes(g, bright, glow);
      if (view.hover >= 0 && view.hover !== view.selected) drawRing(view.hover, false);
      if (view.selected >= 0) drawRing(view.selected, true);
      drawLabels(g, glow, view, litIdx, ranked, blocked);
    }
    ctx.globalAlpha = 1;
  }

  // Front-most node under the pointer, from the last drawn frame.
  function pick(g, x, y) {
    if (!g || !g.n || !SX) return -1;
    let best = -1, bz = Infinity;
    for (let i = 0; i < g.n; i++) {
      const rr = Math.max(6, SR[i] + 3), dx = SX[i] - x, dy = SY[i] - y;
      if (dx * dx + dy * dy <= rr * rr && SZ[i] < bz) { bz = SZ[i]; best = i; }
    }
    return best;
  }

  function screenOf(i) { return SX && i >= 0 && i < cap ? { x: SX[i], y: SY[i], r: SR[i] } : null; }

  return { setScheme, resize, frame, pick, screenOf };
}

// ── Graph data ──────────────────────────────────────────────────────────────

function kbBuildGraph(data, old) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const n = nodes.length;
  const g = {
    n, ids: new Float64Array(n), idx: new Map(), pos: new Float32Array(n * 3), cat: new Uint8Array(n),
    stale: new Uint8Array(n), radius: new Float32Array(n), uses: new Float64Array(n), titles: new Array(n),
    categories: new Array(n), landmarks: [], edgeCount: 0, ea: null, eb: null, ew: null, adjStart: null, adj: null,
  };
  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    const id = Number(nd.id);
    g.ids[i] = id;
    g.idx.set(id, i);
    g.pos[i * 3] = Number(nd.x) || 0; g.pos[i * 3 + 1] = Number(nd.y) || 0; g.pos[i * 3 + 2] = Number(nd.z) || 0;
    const c = KB_CATS.indexOf(nd.category);
    g.cat[i] = c < 0 ? 3 : c;
    g.categories[i] = c < 0 ? 'res' : nd.category;
    g.stale[i] = nd.status === 'stale' ? 1 : 0;
    const deg = Number(nd.degree) || 0;
    g.radius[i] = 1.5 + Math.min(2.4, Math.sqrt(deg) * 0.5);
    g.uses[i] = Number(nd.uses_total) || 0;
    g.titles[i] = typeof nd.title === 'string' && nd.title ? nd.title : `Node ${id}`;
  }
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const ea = [], eb = [], ew = [];
  for (const e of edges) {
    if (!Array.isArray(e)) continue;
    const a = g.idx.get(Number(e[0])), b = g.idx.get(Number(e[1]));
    if (a === undefined || b === undefined || a === b) continue;
    ea.push(a); eb.push(b); ew.push(Math.max(0, Math.min(1, Number(e[2]) || 0)));
  }
  g.edgeCount = ea.length;
  g.ea = Uint32Array.from(ea); g.eb = Uint32Array.from(eb); g.ew = Float32Array.from(ew);
  const degc = new Uint32Array(n + 1);
  for (let k = 0; k < g.edgeCount; k++) { degc[g.ea[k] + 1]++; degc[g.eb[k] + 1]++; }
  for (let i = 0; i < n; i++) degc[i + 1] += degc[i];
  g.adjStart = degc.slice();
  g.adj = new Uint32Array(g.edgeCount * 2);
  const fill = degc.slice();
  for (let k = 0; k < g.edgeCount; k++) { g.adj[fill[g.ea[k]]++] = g.eb[k]; g.adj[fill[g.eb[k]]++] = g.ea[k]; }
  // Landmarks: the best connected / most used nodes get a label when they face the viewer.
  const rank = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (g.adjStart[b + 1] - g.adjStart[b]) + g.uses[b] * 0.2 - ((g.adjStart[a + 1] - g.adjStart[a]) + g.uses[a] * 0.2));
  g.landmarks = rank.slice(0, Math.min(10, n));
  // A refetch keeps the glow and brightness of nodes that are still there (no flash on refresh).
  g.bright = new Float32Array(n); g.target = new Float32Array(n); g.glow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = old ? old.idx.get(g.ids[i]) : undefined;
    if (j !== undefined) { g.bright[i] = old.bright[j]; g.glow[i] = old.glow[j]; }
    else g.bright[i] = 0;
  }
  return g;
}

function kbNeighbors(g, i, limit) {
  const out = [];
  for (let k = g.adjStart[i]; k < g.adjStart[i + 1] && out.length < limit; k++) out.push(g.adj[k]);
  return out;
}

// Brightness each node eases toward (~400 ms), per mode.
function kbApplyTargets() {
  const g = kb.graph;
  if (!g) return;
  kb.ranked = [];
  if (kb.mode === 'history' && kb.usage.counts && kb.usage.range === kb.range) {
    kb.ranked = [...kb.usage.counts].sort((a, b) => b[1] - a[1]).map(([id]) => g.idx.get(id))
      .filter(i => i !== undefined).slice(0, KB_TOP_USED);
    const max = kb.usage.max, lmax = Math.log1p(max || 1);
    for (let i = 0; i < g.n; i++) {
      const c = kb.usage.counts.get(g.ids[i]) || 0;
      g.target[i] = c > 0 ? 0.32 + 0.68 * (Math.log1p(c) / lmax) : 0.06;
    }
  } else if (kb.mode === 'history') {
    g.target.fill(0.06);
  } else {
    g.target.fill(0.62);
  }
  kbKick();
}

// ── Page ────────────────────────────────────────────────────────────────────

function kbSvg(paths, size = 14) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
  return svg;
}

function kbSegmented(label, items, onPick) {
  const wrap = kbEl('div', 'kb-seg');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', label);
  const btns = {};
  for (const [key, text] of items) {
    const b = kbEl('button', 'kb-seg-btn', text);
    b.type = 'button';
    b.dataset.key = key;
    b.addEventListener('click', () => onPick(key));
    btns[key] = b;
    wrap.appendChild(b);
  }
  const set = (key) => { for (const [k, b] of Object.entries(btns)) b.setAttribute('aria-pressed', String(k === key)); };
  return { wrap, set };
}

function kbBuild() {
  const tab = document.getElementById('s-tab-knowledge');
  if (!tab) return false;
  const root = kbEl('div', 'kb-root');
  const canvas = kbEl('canvas', 'kb-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Knowledge brain. Drag or use the arrow keys to rotate, scroll or + and - to zoom. The lists beside it open each node.');

  const head = kbEl('div', 'kb-head');
  const title = kbEl('h2', 'kb-title', 'Knowledge brain');
  const counts = kbEl('div', 'kb-counts');
  const controls = kbEl('div', 'kb-controls');
  const mode = kbSegmented('View', [['live', 'Live'], ['history', 'History']], kbSetMode);
  const range = kbSegmented('Range', KB_RANGES.map(r => [r, r]), kbSetRange);
  controls.append(mode.wrap, range.wrap);
  const msg = kbEl('div', 'kb-msg');
  msg.setAttribute('role', 'status');
  msg.hidden = true;
  head.append(title, counts, controls, msg);

  const empty = kbEl('div', 'kb-empty');
  empty.hidden = true;
  empty.append(
    kbEl('div', 'kb-empty-title', 'No knowledge yet'),
    kbEl('p', 'kb-empty-text', 'Knowledge grows from the rooms you include. Open a room, go to Memory › System Prompt › Knowledge and switch on “Include in Knowledge”. Documents can be added there too.'),
  );

  const legend = kbEl('div', 'kb-legend');
  const keys = kbEl('ul', 'kb-legend-keys');
  KB_CATS.forEach((c) => {
    const li = kbEl('li', 'kb-legend-key');
    const dot = kbEl('span', `kb-dot kb-dot-${c}`);
    dot.setAttribute('aria-hidden', 'true');
    li.append(dot, kbEl('span', null, KB_CAT_LABEL[c]));
    keys.appendChild(li);
  });
  const hint = kbEl('div', 'kb-hint');
  legend.append(keys, hint);

  const side = kbEl('aside', 'kb-side');
  side.setAttribute('aria-label', 'Activity');
  const sideTitle = kbEl('div', 'kb-side-title');
  const sideNote = kbEl('div', 'kb-side-note');
  sideNote.hidden = true;
  const list = kbEl('ol', 'kb-list');
  const prompt = kbEl('div', 'kb-term-prompt');
  prompt.setAttribute('aria-hidden', 'true');
  const announce = kbEl('div', 'kb-sr');
  announce.setAttribute('role', 'status');
  announce.setAttribute('aria-live', 'polite');
  side.append(sideTitle, sideNote, list, prompt, announce);

  const detail = kbEl('section', 'kb-detail');
  detail.hidden = true;
  detail.setAttribute('aria-label', 'Node detail');
  detail.tabIndex = -1;

  const tip = kbEl('div', 'kb-tip');
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');

  root.append(canvas, head, empty, legend, side, detail, tip);
  tab.replaceChildren(root);

  kb.els = { tab, root, canvas, head, counts, msg, empty, side, sideTitle, sideNote, list, prompt, announce, detail, tip, mode, range, legend, hint };
  kb.renderer = kbCreateRenderer(canvas);
  kb.scaffold = kbBuildScaffold();
  // Folds take a few hundred ms to build: after the first frame, so the tab opens at once.
  requestAnimationFrame(() => setTimeout(() => { kb.folds = kbBuildFolds(); kbKick(); }, 0));
  kb.scheme = kbSchemeNow();
  root.dataset.scheme = kb.scheme;
  kb.renderer.setScheme(kb.scheme);
  kb.built = true;

  kbBindCanvas(canvas);
  const ro = new ResizeObserver(kbLayout);
  for (const el of [root, head, legend, side, detail]) ro.observe(el);
  new MutationObserver(() => {
    const s = kbSchemeNow();
    if (s === kb.scheme) return;
    kb.scheme = s;
    root.dataset.scheme = s;
    kb.renderer.setScheme(s);
    kbKick();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  kb.reducedMotion = mq.matches;
  mq.addEventListener('change', (e) => {
    kb.reducedMotion = e.matches;
    if (e.matches) { kb.pulses = []; kbTermFlush(); }
    kbKick();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kbKick(); });
  document.addEventListener('keydown', kbOnKey, true);

  mode.set(kb.mode);
  range.set(kb.range);
  range.wrap.hidden = kb.mode !== 'history';
  return true;
}

// Center the brain in the space the side panel leaves free; sizes are read here, never per frame.
function kbLayout() {
  if (!kb.built) return;
  const { root, side, head, legend } = kb.els;
  const r = root.getBoundingClientRect();
  if (!r.width || !r.height) return;
  kb.renderer.resize(r.width, r.height);
  const s = side.getBoundingClientRect();
  const h = head.getBoundingClientRect();
  const v = kb.view;
  const stacked = s.top - r.top > r.height * 0.4;
  if (stacked) {
    const l = legend.getBoundingClientRect();
    const top = h.bottom - r.top, bottom = (l.height ? Math.min(s.top, l.top) : s.top) - r.top;
    v.cx = r.width / 2; v.cy = (top + bottom) / 2 + 8;
    v.size = Math.max(120, Math.min(r.width, bottom - top));
  } else {
    const right = s.left - r.left;
    v.cx = right * 0.52; v.cy = r.height / 2 + 24;
    v.size = Math.max(160, Math.min(right, r.height - 40));
  }
  kbMeasureBlocked(r);
  kbKick();
}

// Panels drawn over the canvas, in canvas coordinates: node labels stay out of them.
function kbMeasureBlocked(r) {
  const out = [];
  for (const el of [kb.els.head, kb.els.legend, kb.els.side, kb.els.detail]) {
    if (el.hidden) continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    out.push({ x0: b.left - r.left - 6, y0: b.top - r.top - 4, x1: b.right - r.left + 6, y1: b.bottom - r.top + 4 });
  }
  kb.blocked = out;
}

function kbOnKey(e) {
  if (e.key !== 'Escape' || !kbVisible() || kb.els.detail.hidden) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  kbCloseDetail(true);
}

function kbBindCanvas(canvas) {
  const v = kb.view;
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, moved: false };
    v.drag = [e.clientX, e.clientY];
    v.yawTo = v.pitchTo = null;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('kb-dragging');
    kbKick();
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    v.mouse = [e.clientX - r.left, e.clientY - r.top];
    v.mouseMoved = true;
    if (v.drag) {
      const dx = e.clientX - v.drag[0], dy = e.clientY - v.drag[1];
      if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) down.moved = true;
      v.yaw += dx * 0.006;
      v.pitch = Math.max(-1.2, Math.min(1.2, v.pitch + dy * 0.006));
      v.drag = [e.clientX, e.clientY];
    }
    kbKick();
  });
  const end = (e) => {
    if (!v.drag) return;
    v.drag = null;
    canvas.classList.remove('kb-dragging');
    v.pauseUntil = performance.now() + 2500;
    if (down && !down.moved && e.type === 'pointerup') {
      const r = canvas.getBoundingClientRect();
      const i = kb.renderer.pick(kb.graph, e.clientX - r.left, e.clientY - r.top);
      if (i >= 0) kbFocusNode(i, false); else kbCloseDetail(false);
    }
    down = null;
    kbKick();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { v.mouse = null; v.mouseMoved = true; kbKick(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    v.zoom = Math.max(0.6, Math.min(2.4, v.zoom * (e.deltaY > 0 ? 0.93 : 1.07)));
    kbKick();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = 0.12;
    if (e.key === 'ArrowLeft') v.yaw -= step;
    else if (e.key === 'ArrowRight') v.yaw += step;
    else if (e.key === 'ArrowUp') v.pitch = Math.max(-1.2, v.pitch - step);
    else if (e.key === 'ArrowDown') v.pitch = Math.min(1.2, v.pitch + step);
    else if (e.key === '+' || e.key === '=') v.zoom = Math.min(2.4, v.zoom * 1.1);
    else if (e.key === '-') v.zoom = Math.max(0.6, v.zoom / 1.1);
    else return;
    e.preventDefault();
    v.yawTo = v.pitchTo = null;
    v.pauseUntil = performance.now() + 2500;
    kbKick();
  });
}

// ── Animation loop: runs only while something moves, and only while the tab is on screen ──

function kbKick() {
  if (kb.raf || !kbVisible()) return;
  kb.lastTs = 0;
  kb.raf = requestAnimationFrame(kbLoop);
}

function kbLoop(ts) {
  kb.raf = 0;
  if (!kbVisible()) { kb.els.tip.hidden = true; kb.view.mouse = null; kb.view.hover = -1; return; }
  const dt = kb.lastTs ? Math.min(64, ts - kb.lastTs) : 16;
  kb.lastTs = ts;
  const moving = kbStep(dt, ts);
  const g = kb.graph;
  const litIdx = [];
  if (g) for (let i = 0; i < g.n; i++) if (g.glow[i] > 0.3) litIdx.push(i);
  kb.renderer.frame({
    view: kb.view, graph: g, bright: g ? g.bright : null, glow: g ? g.glow : null, pulses: kb.pulses, litIdx,
    ranked: kb.ranked, blocked: kb.blocked,
    scaffoldCount: Math.max(0, KB_SCAFFOLD_TARGET - (g ? g.n : 0)),
    breathe: kb.reducedMotion ? 1 : 1 - KB_FOLD_PULSE * (0.5 + 0.5 * Math.cos(ts / KB_FOLD_PULSE_MS * Math.PI * 2)),
  });
  if (kb.view.mouseMoved) {
    kb.view.mouseMoved = false;
    kbUpdateHover();
  }
  if (moving) kb.raf = requestAnimationFrame(kbLoop);
  else kb.lastTs = 0;
}

function kbStep(dt, now) {
  const v = kb.view, g = kb.graph;
  let moving = false;
  if (v.yawTo != null) {
    const k = kb.reducedMotion ? 1 : 1 - Math.exp(-dt / 160);
    v.yaw += (v.yawTo - v.yaw) * k;
    v.pitch += (v.pitchTo - v.pitch) * k;
    if (Math.abs(v.yawTo - v.yaw) < 0.002 && Math.abs(v.pitchTo - v.pitch) < 0.002) { v.yaw = v.yawTo; v.pitch = v.pitchTo; v.yawTo = v.pitchTo = null; }
    else moving = true;
  } else if (!kb.reducedMotion && !v.drag && v.hover < 0 && v.selected < 0) {
    if (now >= v.pauseUntil) v.yaw += dt * 0.00015;
    moving = true;
  }
  if (!g) return moving;
  const k = 1 - Math.exp(-dt / 110);
  const decay = Math.exp(-dt / (kb.reducedMotion ? 2600 : 1800));
  for (let i = 0; i < g.n; i++) {
    const d = g.target[i] - g.bright[i];
    if (d > 0.002 || d < -0.002) { g.bright[i] += d * k; moving = true; } else g.bright[i] = g.target[i];
    if (g.glow[i] > 0) {
      g.glow[i] *= decay;
      if (g.glow[i] < 0.01) g.glow[i] = 0; else moving = true;
    }
  }
  for (let j = kb.pulses.length - 1; j >= 0; j--) {
    const p = kb.pulses[j];
    p.t += dt / 650;
    if (p.t >= 1) {
      if (p.b < g.n) g.glow[p.b] = Math.max(g.glow[p.b], p.level);
      kb.pulses.splice(j, 1);
    }
  }
  if (kb.pulses.length) moving = true;
  return moving;
}

// ── Hover tooltip ───────────────────────────────────────────────────────────

function kbUpdateHover() {
  const v = kb.view, g = kb.graph;
  const i = v.mouse && !v.drag && g ? kb.renderer.pick(g, v.mouse[0], v.mouse[1]) : -1;
  if (i !== v.hover) { v.hover = i; kbKick(); }
  kb.els.canvas.classList.toggle('kb-pointer', i >= 0);
  const tip = kb.els.tip;
  if (i < 0) { tip.hidden = true; return; }
  const rows = [kbEl('div', 'kb-tip-title', g.titles[i]), kbEl('div', 'kb-tip-meta', KB_CAT_LABEL[g.categories[i]] + (g.stale[i] ? ' · stale' : ''))];
  const used = kb.usedBy.get(g.ids[i]);
  if (used && used.length) {
    for (const u of used.slice(0, 3)) {
      rows.push(kbEl('div', 'kb-tip-use', `${u.who}${u.room ? ` · ${u.room}` : ''} · ${kbAgo(u.at)}`));
    }
  }
  tip.replaceChildren(...rows);
  tip.hidden = false;
  const W = kb.els.root.clientWidth, H = kb.els.root.clientHeight;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = v.mouse[0] + 14, y = v.mouse[1] + 14;
  if (x + tw > W - 8) x = v.mouse[0] - tw - 14;
  if (y + th > H - 8) y = v.mouse[1] - th - 14;
  tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

// ── Loading ─────────────────────────────────────────────────────────────────

function kbShowMessage(text, retry) {
  const m = kb.els.msg;
  if (!text) { m.hidden = true; m.replaceChildren(); return; }
  const parts = [kbEl('span', null, text)];
  if (retry) {
    const b = kbEl('button', 'kb-link', 'Try again');
    b.type = 'button';
    b.addEventListener('click', retry);
    parts.push(b);
  }
  m.replaceChildren(...parts);
  m.hidden = false;
}

async function kbLoadGraph() {
  const seq = ++kb.graphSeq;
  try {
    const data = await kbFetch('/api/knowledge/graph');
    if (seq !== kb.graphSeq) return;
    const selectedId = kb.view.selected >= 0 && kb.graph ? kb.graph.ids[kb.view.selected] : null;
    const g = kbBuildGraph(data, kb.graph);
    kb.graph = g;
    kb.graphError = null;
    kb.pulses = [];
    kb.view.hover = -1;
    kb.view.selected = selectedId != null && g.idx.has(selectedId) ? g.idx.get(selectedId) : -1;
    if (kb.detail.id != null && !g.idx.has(Number(kb.detail.id))) kbCloseDetail(kb.els.detail.contains(document.activeElement));
    kbRenderCounts(data);
    kbApplyTargets();
    kbRenderSide();
    const ids = kb.igniteAfterLoad;
    kb.igniteAfterLoad = [];
    if (ids.length && kb.mode === 'live' && kbVisible()) kbIgnite([...new Set(ids)]);
  } catch (e) {
    if (seq !== kb.graphSeq) return;
    kb.igniteAfterLoad = [];
    kb.graphError = e.message || 'Failed to load the knowledge graph';
    kbRenderCounts(null);
  }
  kbKick();
}

function kbRenderCounts(data) {
  const g = kb.graph;
  if (kb.graphError) {
    kb.els.counts.textContent = '';
    kbShowMessage(kb.graphError, kbLoadGraph);
    kb.els.empty.hidden = true;
    return;
  }
  kbShowMessage('');
  const nodes = g ? g.n : 0;
  kb.els.empty.hidden = nodes > 0;
  kb.els.legend.classList.toggle('kb-legend-quiet', nodes === 0);
  kb.els.hint.textContent = nodes ? 'Drag to rotate · scroll to zoom · click a node to read it' : 'Drag to rotate · scroll to zoom';
  if (!nodes) { kb.els.counts.textContent = ''; return; }
  const total = data && data.counts && Number.isFinite(Number(data.counts.nodes)) ? Number(data.counts.nodes) : nodes;
  const parts = [kbPlural(nodes, 'node', 'nodes'), kbPlural(g.edgeCount, 'link', 'links')];
  if (total > nodes) parts.push(`showing the ${nodes.toLocaleString()} most used of ${total.toLocaleString()}`);
  kb.els.counts.textContent = parts.join(' · ');
}

async function kbLoadUsage() {
  const range = kb.range;
  const seq = ++kb.usage.seq;
  kb.usage.error = null;
  kbRenderSide();
  try {
    const data = await kbFetch(`/api/knowledge/usage?range=${encodeURIComponent(range)}`);
    if (seq !== kb.usage.seq) return;
    const counts = new Map();
    let max = 0;
    for (const r of Array.isArray(data.nodes) ? data.nodes : []) {
      const c = Number(r.count) || 0;
      counts.set(Number(r.node_id), c);
      if (c > max) max = c;
    }
    kb.usage.counts = counts; kb.usage.max = max; kb.usage.range = range;
  } catch (e) {
    if (seq !== kb.usage.seq) return;
    kb.usage.error = e.message || 'Failed to load usage';
    kb.usage.counts = null; kb.usage.range = null;
  }
  kbApplyTargets();
  kbRenderSide();
}

function kbFeedKey(f) {
  const t = f.at ? Math.floor(f.at.getTime() / 1000) : 0;
  return `${f.kind}|${f.actorId}|${f.subId}|${f.roomId}|${t}`;
}

async function kbLoadRecent() {
  const seq = ++kb.recentSeq;
  try {
    const data = await kbFetch('/api/knowledge/usage/recent?limit=' + KB_FEED_MAX);
    if (seq !== kb.recentSeq) return;
    const have = new Set(kb.feed.map(kbFeedKey));
    for (const it of Array.isArray(data.items) ? data.items : []) {
      const f = {
        kind: 'search', tone: 'use', shown: Infinity,
        nodeIds: Array.isArray(it.node_ids) ? it.node_ids.map(Number) : [],
        who: kbWho(it.actor?.name, it.sub_agent?.label),
        actorId: it.actor?.id ?? null, subId: it.sub_agent?.id ?? null, roomId: it.room?.id ?? null,
        room: it.room?.title || null, query: undefined, at: kbDate(it.used_at),
      };
      if (!have.has(kbFeedKey(f))) { kb.feed.push(f); have.add(kbFeedKey(f)); }
    }
    kb.feed.sort((a, b) => (b.at ? b.at.getTime() : 0) - (a.at ? a.at.getTime() : 0));
    kb.feed.length = Math.min(kb.feed.length, KB_FEED_MAX);
    kb.recentLoaded = true;
    kb.recentError = null;
  } catch (e) {
    if (seq !== kb.recentSeq) return;
    kb.recentError = e.message || 'Failed to load recent searches';
  }
  kbRenderSide();
}

function kbWho(actor, sub) {
  const a = actor || 'A removed agent';
  return sub ? `${sub} (${a})` : a;
}

// ── Side panel: Live feed / Most used ───────────────────────────────────────

function kbRenderSide() {
  if (!kb.built) return;
  const { side, sideTitle, sideNote, list, prompt } = kb.els;
  const live = kb.mode === 'live';
  side.classList.toggle('kb-term', live);
  prompt.hidden = !live;
  if (live) {
    const state = kbEl('span', 'kb-term-state', kb.term.awake ? 'active' : 'idle');
    sideTitle.replaceChildren(kbEl('span', 'kb-term-name', 'Live activity'), state);
    const items = kb.feed.map(kbFeedRow);
    if (!items.length) {
      sideNote.textContent = kb.recentError ? kb.recentError : kb.recentLoaded ? 'No knowledge activity yet. Searches, writes and documents show up here as they happen.' : 'loading…';
      sideNote.classList.toggle('kb-error', !!kb.recentError);
      sideNote.hidden = false;
    } else sideNote.hidden = true;
    list.replaceChildren(...items);
    kbTermPrompt();
    return;
  }
  sideTitle.textContent = `Most used · ${kb.range}`;
  sideNote.classList.toggle('kb-error', !!kb.usage.error);
  const g = kb.graph;
  if (kb.usage.error) { sideNote.textContent = kb.usage.error; sideNote.hidden = false; list.replaceChildren(); return; }
  if (!kb.usage.counts || kb.usage.range !== kb.range) { sideNote.textContent = 'loading…'; sideNote.hidden = false; list.replaceChildren(); return; }
  const top = [];
  if (g) {
    for (const [id, c] of kb.usage.counts) {
      const i = g.idx.get(id);
      if (i !== undefined && c > 0) top.push([i, c]);
      if (top.length >= KB_TOP_USED) break;
    }
  }
  if (!top.length) {
    sideNote.textContent = 'No knowledge was used in this range.';
    sideNote.hidden = false;
    list.replaceChildren();
    return;
  }
  sideNote.hidden = true;
  list.replaceChildren(...top.map(([i, c]) => {
    const li = kbEl('li', 'kb-row');
    const b = kbEl('button', 'kb-row-btn');
    b.type = 'button';
    const dot = kbEl('span', `kb-dot kb-dot-${g.categories[i]}`);
    dot.setAttribute('aria-hidden', 'true');
    b.append(dot, kbEl('span', 'kb-row-title', g.titles[i]), kbEl('span', 'kb-row-n', `${c}×`));
    b.setAttribute('aria-label', `${g.titles[i]}, used ${c} times`);
    b.addEventListener('click', () => kbFocusNode(i, true));
    li.appendChild(b);
    return li;
  }));
}

// One terminal line: `> [HH:MM:SS] who@room did what`. The visible text types out (kbTermType);
// screen readers get the whole line from .kb-sr and the announcement from kbTermPush.
function kbFeedRow(f) {
  const li = kbEl('li', `kb-row kb-feed kb-tone-${f.tone}`);
  const g = kb.graph;
  const first = g ? f.nodeIds.map(id => g.idx.get(id)).find(i => i !== undefined) : undefined;
  const body = kbEl(first !== undefined ? 'button' : 'div', 'kb-feed-body');
  if (first !== undefined) {
    body.type = 'button';
    body.addEventListener('click', () => kbFocusNode(first, true));
  }
  const gt = kbEl('span', 'kb-t-gt', '>');
  gt.setAttribute('aria-hidden', 'true');
  const t = kbEl('time', 'kb-t-ts', `[${kbClock(f.at)}]`);
  if (f.at) { t.dateTime = f.at.toISOString(); t.title = f.at.toLocaleString(); }
  const line = kbEl('span', 'kb-feed-line');
  line.setAttribute('aria-hidden', 'true');
  kbTermFill(line, f);
  f.el = line;
  body.append(gt, t, ' ', line, kbEl('span', 'kb-sr', kbTermText(f)));
  li.appendChild(body);
  return li;
}

function kbClock(d) {
  if (!d) return '--:--:--';
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

function kbCount(n, one, many) { return kbPlural(Number(n) || 0, one, many); }

// The line as [class, text] parts; strings come from the server and are only ever set as text.
function kbTermSegs(f) {
  const who = [['kb-t-who', f.who]];
  if (f.room) who.push(['kb-t-room', `@${f.room}`]);
  const doc = f.doc ? `"${f.doc}"` : '(private)';
  const diff = [];
  if (f.added) diff.push(['kb-t-add', `+${kbCount(f.added, 'node', 'nodes')}`]);
  if (f.updated) diff.push(['kb-t-upd', `~${f.updated} updated`]);
  if (f.removed) diff.push(['kb-t-del', `-${f.removed} removed`]);
  const counts = diff.length ? diff.flatMap((d, i) => (i ? [[null, ' '], d] : [d])) : [['kb-t-dim', 'no changes']];
  const inRoom = f.room ? [[null, ' '], ['kb-t-room', `[${f.room}]`]] : [];
  // An agent's document line leads with who@room, so the trailing [room] would repeat it.
  const docLead = f.byAgent ? [...who, [null, ' document ']] : [[null, 'document ']];
  const docTail = f.byAgent ? [] : inRoom;
  switch (f.kind) {
    case 'search':
      if (f.query === null) return [...who, [null, ' searched '], ['kb-t-dim', '(private)'], [null, ` → ${kbCount(f.nodeIds.length, 'node', 'nodes')}`]];
      if (typeof f.query === 'string' && f.query) return [...who, [null, ' searched '], ['kb-t-q', `"${f.query}"`], [null, ` → ${kbCount(f.nodeIds.length, 'node', 'nodes')}`]];
      return [...who, [null, ` used ${kbCount(f.nodeIds.length, 'node', 'nodes')}`]];
    case 'extract_start': return [...who, [null, ' writing knowledge…']];
    case 'extract': return [...who, [null, ' wrote '], ...counts];
    case 'extract_failed': return [...who, [null, ' writing '], f.deferred ? ['kb-t-upd', 'deferred'] : ['kb-t-del', 'failed']];
    case 'document_add': return [...docLead, ['kb-t-q', doc], [null, ' ingested '], ...counts, ...docTail];
    case 'document_remove': return [...docLead, ['kb-t-q', doc], [null, ' removed '], ['kb-t-del', `-${kbCount(f.removed, 'node', 'nodes')}`], ...docTail];
    case 'node_delete': return [[null, 'node '], ['kb-t-q', f.nodeTitle ? `"${f.nodeTitle}"` : `#${f.nodeId ?? '?'}`], [null, ' removed'], ...inRoom];
    case 'room_toggle': return [[null, 'room '], ['kb-t-q', f.room ? `"${f.room}"` : `#${f.roomId ?? '?'}`], [null, f.enabled ? ' included in knowledge' : ' left knowledge']];
    default: return [['kb-t-dim', f.kind]];
  }
}

function kbTermText(f) { return kbTermSegs(f).map(s => s[1]).join(''); }

function kbTermFill(el, f) {
  const typing = kb.term.typing === f;
  let left = f.shown ?? Infinity;
  const out = [];
  for (const [cls, text] of kbTermSegs(f)) {
    if (left <= 0) break;
    const part = left >= text.length ? text : text.slice(0, left);
    left -= part.length;
    out.push(cls ? kbEl('span', cls, part) : part);
  }
  if (typing) out.push(kbEl('span', 'kb-t-cursor', '_'));
  el.replaceChildren(...out);
}

function kbTermPrompt() {
  const { prompt, side, sideTitle } = kb.els;
  const typing = !!kb.term.typing;
  side.classList.toggle('kb-term-awake', kb.term.awake);
  const state = sideTitle.querySelector('.kb-term-state');
  if (state) state.textContent = kb.term.awake ? 'active' : 'idle';
  const cursor = kbEl('span', 'kb-t-cursor', '_');
  cursor.hidden = typing;
  prompt.replaceChildren(kbEl('span', 'kb-t-gt', '>'), kb.term.awake ? '' : 'idle', cursor);
}

// A new feed entry: typed out when the card is on screen in Live, shown whole otherwise.
function kbTermPush(f) {
  const show = kb.built && kb.mode === 'live' && kbVisible();
  if (!show || kb.reducedMotion) f.shown = Infinity;
  else { f.shown = 0; kb.term.queue.push(f); }
  if (!show) return;
  kb.els.announce.textContent = kbTermText(f);
  kb.term.awake = true;
  clearTimeout(kb.term.sleepTimer);
  if (!kb.term.timer && kb.term.queue.length) kb.term.timer = setInterval(kbTermType, KB_TYPE_MS);
  if (!kb.term.timer) kb.term.sleepTimer = setTimeout(kbTermSleep, KB_AWAKE_MS);
}

function kbTermType() {
  const t = kb.term;
  if (kb.mode !== 'live' || !kbVisible()) { kbTermFlush(); return; }
  if (!t.typing) {
    t.typing = t.queue.shift() || null;
    if (!t.typing) { kbTermFlush(); return; }
    kbTermPrompt();
  }
  const f = t.typing;
  f.shown += 1 + t.queue.length;
  if (f.shown >= kbTermText(f).length) {
    f.shown = Infinity;
    t.typing = null;
  }
  if (f.el && f.el.isConnected) kbTermFill(f.el, f);
  if (!t.typing && !t.queue.length) kbTermFlush();
}

// Stop typing: every waiting line shows whole, the card dozes off after KB_AWAKE_MS.
function kbTermFlush() {
  const t = kb.term;
  clearInterval(t.timer);
  t.timer = 0;
  for (const f of [t.typing, ...t.queue]) {
    if (!f) continue;
    f.shown = Infinity;
    if (f.el && f.el.isConnected) kbTermFill(f.el, f);
  }
  t.typing = null;
  t.queue = [];
  clearTimeout(t.sleepTimer);
  if (t.awake) t.sleepTimer = setTimeout(kbTermSleep, KB_AWAKE_MS);
  if (kb.built) kbTermPrompt();
}

function kbTermSleep() {
  kb.term.awake = false;
  if (kb.built) kbTermPrompt();
}

// ── Modes ───────────────────────────────────────────────────────────────────

function kbSetMode(mode) {
  if (mode !== 'live' && mode !== 'history') return;
  kb.mode = mode;
  kb.els.mode.set(mode);
  kb.els.range.wrap.hidden = mode !== 'history';
  if (mode === 'history') {
    kb.pulses = [];
    if (kb.graph) kb.graph.glow.fill(0);
    kbLoadUsage();
  }
  kbApplyTargets();
  kbRenderSide();
}

function kbSetRange(range) {
  if (!KB_RANGES.includes(range)) return;
  kb.range = range;
  kb.els.range.set(range);
  kbLoadUsage();
}

// ── Focus + detail panel ────────────────────────────────────────────────────

function kbFocusNode(i, turn) {
  const g = kb.graph;
  if (!g || i < 0 || i >= g.n) return;
  const v = kb.view;
  v.selected = i;
  if (turn) {
    const a = g.pos[i * 3], c = g.pos[i * 3 + 2];
    let to = Math.atan2(-a, -c);
    while (to - v.yaw > Math.PI) to -= Math.PI * 2;
    while (to - v.yaw < -Math.PI) to += Math.PI * 2;
    v.yawTo = to;
    v.pitchTo = Math.max(-0.6, Math.min(0.6, g.pos[i * 3 + 1] * 0.4));
  }
  kbOpenDetail(g.ids[i]);
  kbKick();
}

function kbCloseDetail(restoreFocus) {
  if (!kb.built) return;
  kb.detail.seq++;
  kb.detail.id = null;
  kb.els.detail.hidden = true;
  kb.els.detail.replaceChildren();
  kb.els.side.classList.remove('kb-under');
  kb.els.root.classList.remove('kb-detail-open');
  kb.view.selected = -1;
  if (restoreFocus) kb.els.canvas.focus({ preventScroll: true });
  kbKick();
}

async function kbOpenDetail(id) {
  const d = kb.els.detail;
  const seq = ++kb.detail.seq;
  kb.detail.id = id;
  const g = kb.graph;
  const i = g ? g.idx.get(id) : undefined;
  d.replaceChildren(kbDetailHead(i !== undefined ? g.titles[i] : `Node ${id}`, null), kbEl('div', 'kb-muted', 'loading…'));
  d.hidden = false;
  kb.els.side.classList.add('kb-under');
  kb.els.root.classList.add('kb-detail-open');
  d.focus({ preventScroll: true });
  try {
    const n = await kbFetch(`/api/knowledge/nodes/${encodeURIComponent(id)}`);
    if (seq !== kb.detail.seq) return;
    kbRenderDetail(n);
  } catch (e) {
    if (seq !== kb.detail.seq) return;
    d.replaceChildren(kbDetailHead(i !== undefined ? g.titles[i] : `Node ${id}`, null),
      kbEl('div', 'kb-error', e.status === 404 ? 'This node no longer exists.' : (e.message || 'Failed to load the node')));
    if (e.status === 404) kbScheduleRefresh();
  }
}

function kbDetailHead(title, node) {
  const head = kbEl('div', 'kb-detail-head');
  const t = kbEl('h3', 'kb-detail-title', title);
  const close = kbEl('button', 'kb-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.appendChild(kbSvg(['M3 3l8 8', 'M11 3l-8 8']));
  close.addEventListener('click', () => kbCloseDetail(true));
  head.append(t, close);
  if (node) {
    const chips = kbEl('div', 'kb-chips');
    const cat = KB_CATS.includes(node.category) ? node.category : 'res';
    const c = kbEl('span', 'kb-chip');
    const dot = kbEl('span', `kb-dot kb-dot-${cat}`);
    dot.setAttribute('aria-hidden', 'true');
    c.append(dot, KB_CAT_LABEL[cat]);
    chips.appendChild(c);
    if (node.status === 'stale') {
      const s = kbEl('span', 'kb-chip kb-chip-stale', 'stale');
      const at = kbDate(node.stale_at);
      if (at) s.title = `Its sources changed ${at.toLocaleString()}; it is refreshed on the next extraction.`;
      chips.appendChild(s);
    }
    head.appendChild(chips);
  }
  return head;
}

function kbRenderDetail(n) {
  const d = kb.els.detail;
  const parts = [kbDetailHead(n.title || `Node ${n.id}`, n)];
  if (n.summary) parts.push(kbEl('p', 'kb-summary', n.summary));

  const uses = n.uses || {};
  const stats = kbEl('dl', 'kb-uses');
  for (const r of KB_RANGES) {
    const box = kbEl('div', 'kb-use');
    box.append(kbEl('dt', null, r), kbEl('dd', null, String(Number(uses[r]) || 0)));
    stats.appendChild(box);
  }
  parts.push(kbEl('div', 'kb-detail-label', 'Used'), stats);

  const sources = Array.isArray(n.sources) ? n.sources : [];
  const hidden = Number(n.hidden_sources) || 0, more = Number(n.more_sources) || 0;
  parts.push(kbEl('div', 'kb-detail-label', 'Sources'));
  const ul = kbEl('ul', 'kb-sources');
  for (const s of sources) ul.appendChild(kbSourceRow(s));
  if (sources.length) parts.push(ul);
  if (more) parts.push(kbEl('div', 'kb-muted', `+ ${kbPlural(more, 'more source', 'more sources')}`));
  if (hidden) parts.push(kbEl('div', 'kb-muted kb-private-note', `${kbPlural(hidden, 'source', 'sources')} from private rooms`));
  if (!sources.length && !hidden && !more) parts.push(kbEl('div', 'kb-muted', 'No remaining source.'));

  const users = Array.isArray(n.recent_users) ? n.recent_users : [];
  parts.push(kbEl('div', 'kb-detail-label', 'Recently used by'));
  if (!users.length) parts.push(kbEl('div', 'kb-muted', 'Not used yet.'));
  else {
    const ol = kbEl('ul', 'kb-users');
    for (const u of users) {
      const li = kbEl('li', 'kb-user');
      li.appendChild(kbEl('span', 'kb-user-who', kbWho(u.actor?.name, u.sub_agent?.label)));
      const meta = [];
      if (u.room?.title) meta.push(u.room.title);
      meta.push(kbAgo(kbDate(u.used_at)));
      li.appendChild(kbEl('span', 'kb-muted', meta.join(' · ')));
      ol.appendChild(li);
    }
    parts.push(ol);
  }
  const updated = kbDate(n.updated_at);
  if (updated) parts.push(kbEl('div', 'kb-muted kb-detail-foot', `Updated ${updated.toLocaleString()}`));
  d.replaceChildren(...parts);
}

function kbSourceRow(s) {
  const li = kbEl('li', 'kb-source');
  if (s.type === 'document') {
    li.appendChild(kbEl('div', 'kb-source-title', s.name || 'Document'));
    const meta = [];
    if (s.section) meta.push(s.section);
    if (s.room_title) meta.push(s.room_title);
    if (meta.length) li.appendChild(kbEl('div', 'kb-muted', meta.join(' · ')));
    return li;
  }
  const top = kbEl('div', 'kb-source-top');
  top.appendChild(kbEl('span', 'kb-source-title', s.room_title || 'A removed room'));
  if (s.room_archived) top.appendChild(kbEl('span', 'kb-chip', 'archived'));
  const roomId = Number(s.room_id), msgId = Number(s.message_id);
  if (!s.room_archived && roomId > 0 && msgId > 0 && typeof goToMessage === 'function') {
    const open = kbEl('button', 'kb-link', 'Open');
    open.type = 'button';
    open.setAttribute('aria-label', `Open the message in ${s.room_title || 'its room'}`);
    open.addEventListener('click', () => goToMessage(roomId, msgId, Number(s.thread_id) || null));
    top.appendChild(open);
  }
  li.appendChild(top);
  if (s.preview) li.appendChild(kbEl('div', 'kb-source-preview', s.preview));
  return li;
}

// ── Realtime ────────────────────────────────────────────────────────────────

// knowledge_used (owner browsers only): collected even while the tab is closed or in History, so
// the feed is complete when it is opened; nodes light up only in Live and only on screen.
function kbHandleUsed(msg) {
  if (!msg || !Array.isArray(msg.node_ids)) return;
  const at = kbDate(msg.at) || new Date();
  const f = {
    kind: 'search', tone: 'use',
    nodeIds: msg.node_ids.map(Number).filter(n => n > 0),
    who: kbWho(msg.actor_name, msg.sub_agent_label),
    actorId: msg.actor_id ?? null, subId: msg.sub_agent_id ?? null, roomId: msg.room_id ?? null,
    room: msg.room_title || null,
    query: typeof msg.query === 'string' ? msg.query : null,
    at,
  };
  kb.feed.unshift(f);
  if (kb.feed.length > KB_FEED_MAX) kb.feed.length = KB_FEED_MAX;
  for (const id of f.nodeIds) {
    const list = kb.usedBy.get(id) || [];
    list.unshift({ who: f.who, room: f.room, at });
    if (list.length > 3) list.length = 3;
    kb.usedBy.set(id, list);
  }
  kbTermPush(f);
  if (!kb.built) return;
  if (kb.mode === 'live') kbRenderSide();
  if (kb.mode === 'live' && kbVisible()) kbIgnite(f.nodeIds);
}

// knowledge_activity (owner browsers only): writes, documents, deletions and room opt-in, typed into
// the same card. Nodes a write touched may not be in kb.graph yet, so they light up after the next
// graph load; a deleted node is named from the graph before that load drops it.
function kbHandleActivity(msg) {
  if (!msg || typeof msg.kind !== 'string' || !Object.hasOwn(KB_ACT_TONE, msg.kind)) return;
  const ids = Array.isArray(msg.node_ids) ? msg.node_ids.map(Number).filter(n => Number.isSafeInteger(n) && n > 0) : [];
  const g = kb.graph;
  const nodeId = Number.isSafeInteger(Number(msg.node_id)) && Number(msg.node_id) > 0 ? Number(msg.node_id) : null;
  const gi = g && nodeId != null ? g.idx.get(nodeId) : undefined;
  // A busy agent's job is retried without costing an attempt, so its line reads deferred, not failed.
  const deferred = msg.kind === 'extract_failed' && msg.reason === 'busy';
  const f = {
    kind: msg.kind, tone: deferred ? 'write' : KB_ACT_TONE[msg.kind], deferred,
    nodeIds: msg.kind === 'node_delete' || msg.kind === 'document_remove' ? [] : ids,
    who: msg.actor_name ? kbWho(msg.actor_name, msg.sub_agent_label) : msg.kind.startsWith('extract') ? 'An agent' : 'You',
    // by_owner marks panel actions that still carry the owner's name; servers without it send none.
    byAgent: msg.by_owner !== true && !!msg.actor_name,
    actorId: null, subId: null, roomId: msg.room_id ?? null,
    room: typeof msg.room_title === 'string' && msg.room_title ? msg.room_title : null,
    doc: typeof msg.doc_name === 'string' && msg.doc_name ? msg.doc_name : null,
    added: Number(msg.added) || 0, updated: Number(msg.updated) || 0, removed: Number(msg.removed) || 0,
    enabled: msg.enabled === true, nodeId, nodeTitle: gi !== undefined ? g.titles[gi] : null,
    at: kbDate(msg.at) || new Date(),
  };
  if (f.kind === 'extract' || f.kind === 'extract_failed') kbCloseWriting(f);
  kb.feed.unshift(f);
  if (kb.feed.length > KB_FEED_MAX) kb.feed.length = KB_FEED_MAX;
  kbTermPush(f);
  if (!kb.built) return;
  if (kb.mode === 'live') kbRenderSide();
  if (f.kind === 'extract_start' || f.kind === 'extract_failed') return;
  if (f.nodeIds.length && kb.mode === 'live' && kbVisible()) {
    kb.igniteAfterLoad.push(...f.nodeIds);
    if (kb.igniteAfterLoad.length > KB_IGNITE_MAX) kb.igniteAfterLoad.splice(0, kb.igniteAfterLoad.length - KB_IGNITE_MAX);
  }
  kbScheduleRefresh();
}

// The newest open "writing…" line of the same writer is settled by its result: a success leaves it
// in place, a failure takes its place so a retrying job doesn't pile up dangling lines.
function kbCloseWriting(f) {
  const open = kb.feed.find(o => o.kind === 'extract_start' && !o.closed && o.roomId === f.roomId && o.who === f.who);
  if (!open) return;
  open.closed = true;
  if (f.kind !== 'extract_failed') return;
  kb.feed.splice(kb.feed.indexOf(open), 1);
  const t = kb.term;
  if (t.typing === open) t.typing = null;
  t.queue = t.queue.filter(q => q !== open);
}

function kbIgnite(ids) {
  const g = kb.graph;
  if (!g) return;
  const seeds = ids.map(id => g.idx.get(id)).filter(i => i !== undefined);
  for (const s of seeds) {
    g.glow[s] = 1;
    const hop1 = kbNeighbors(g, s, 6);
    for (const a of hop1) {
      if (kb.reducedMotion) { g.glow[a] = Math.max(g.glow[a], 0.5); continue; }
      kb.pulses.push({ a: s, b: a, t: 0, level: 0.6 });
      for (const b of kbNeighbors(g, a, 3)) {
        if (b !== s) kb.pulses.push({ a, b, t: -0.8, level: 0.32 });
      }
    }
  }
  if (kb.pulses.length > 400) kb.pulses.splice(0, kb.pulses.length - 400);
  kbKick();
}

function kbScheduleRefresh() {
  if (!kb.built) return;
  clearTimeout(kb.refreshTimer);
  kb.refreshTimer = setTimeout(() => {
    kb.refreshTimer = null;
    kbLoadGraph();
    if (kb.mode === 'history') kbLoadUsage();
  }, KB_REFRESH_DEBOUNCE);
}

function kbHandleGraphChanged() { kbScheduleRefresh(); }

// globalWs reconnected: events may have been missed.
function kbResync() {
  if (!kb.built) return;
  kbScheduleRefresh();
  kbLoadRecent();
}

// ── Entry (Settings tab) ────────────────────────────────────────────────────

function sLoadKnowledgeTab() {
  if (!kb.built) {
    if (!kbBuild()) return;
    kbRenderSide();
    kbLoadGraph();
    kbLoadRecent();
  } else {
    kbScheduleRefresh();
    kbRenderSide();
  }
  requestAnimationFrame(kbLayout);
}
