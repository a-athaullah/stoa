// ── Knowledge brain volume ──────────────────────────────────────────────────
// The shape of the knowledge brain, shared by the page (knowledge/brain.js: scaffold and fold lines)
// and the server (lib/knowledge-layout.js requires this file: node positions), so both always agree.
// Axes: x left-right, y up, z front, roughly [-1, 1].
//
// Each part is a signed distance estimate (negative inside): lobes are ellipsoids joined with a
// smooth minimum, so the hemisphere reads as one organic body instead of stacked balls. Per
// hemisphere: a blunt frontal lobe, a high parietal dome, a tapered occipital pole, a flattened base
// whose orbital floor rises toward the front, and a temporal lobe hanging below the side, joined
// with a tight blend so the lateral (Sylvian) fissure stays a crease. The lobes are centred close to
// the midline, so each hemisphere stays high and flat right up to the thin longitudinal fissure (seen
// from above the two read as one brain, not two ovals). Tucked under the occipital lobe: the
// cerebellum (two lobes and the vermis); in front of it the short brain stem, leaning back as it
// goes down.

// Polynomial smooth min / max: blend width k.
function kbvSmin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function kbvSmax(a, b, k) { return -kbvSmin(-a, -b, k); }

// Ellipsoid distance estimate (exact on the surface, close nearby).
function kbvEll(x, y, z, cx, cy, cz, rx, ry, rz) {
  const X = (x - cx) / rx, Y = (y - cy) / ry, Z = (z - cz) / rz;
  const k0 = Math.sqrt(X * X + Y * Y + Z * Z);
  const k1 = Math.sqrt((X / rx) ** 2 + (Y / ry) ** 2 + (Z / rz) ** 2);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}

// Half width of the longitudinal fissure between the hemispheres.
const KBV_FISSURE = 0.012;

// One hemisphere without its temporal lobe, mirrored: ax = |x|.
function kbvLobes(ax, y, z) {
  let d = kbvEll(ax, y, z, 0.27, 0.12, 0, 0.43, 0.54, 0.82);
  d = kbvSmin(d, kbvEll(ax, y, z, 0.25, 0.06, 0.46, 0.38, 0.44, 0.42), 0.12);
  d = kbvSmin(d, kbvEll(ax, y, z, 0.24, 0.3, -0.18, 0.39, 0.4, 0.52), 0.12);
  d = kbvSmin(d, kbvEll(ax, y, z, 0.19, 0, -0.66, 0.3, 0.32, 0.3), 0.12);
  return kbvSmax(d, -(y + 0.32 - 0.18 * Math.max(0, z - 0.25)), 0.08);
}

// Tilted: its back end rises along the lateral fissure.
const KBV_TEMPORAL_TILT = [Math.cos(0.3), Math.sin(0.3)];
function kbvTemporal(ax, y, z) {
  const [c, s] = KBV_TEMPORAL_TILT, ty = y + 0.22, tz = z - 0.04;
  return kbvEll(ax, c * ty + s * tz, c * tz - s * ty, 0.45, 0, 0, 0.23, 0.2, 0.47);
}

function kbvCerebrum(ax, y, z) {
  return kbvSmax(kbvSmin(kbvLobes(ax, y, z), kbvTemporal(ax, y, z), 0.035), KBV_FISSURE - ax, 0.008);
}

// Its top overlaps the underside of the occipital lobe (the cerebrum wins there), so the two touch.
function kbvCerebellum(x, y, z) {
  const d = kbvEll(Math.abs(x), y, z, 0.15, -0.42, -0.58, 0.21, 0.18, 0.27);
  return kbvSmin(d, kbvEll(x, y, z, 0, -0.42, -0.55, 0.1, 0.16, 0.23), 0.08);
}

// Axis from (0, -0.26, -0.2) down 0.4 and back 0.1, against the front of the cerebellum; radius 0.12
// narrowing to 0.075.
const KBV_STEM = { y0: -0.26, len: 0.4, z0: -0.2, lean: 0.1 };
function kbvStem(x, y, z) {
  const S = KBV_STEM, t = Math.max(0, Math.min(1, (S.y0 - y) / S.len));
  return Math.hypot(x, y - S.y0 + S.len * t, z - S.z0 + S.lean * t) - (0.12 - 0.045 * t);
}

// → 0 outside, 1 cerebrum, 2 cerebellum, 3 brain stem.
function kbInside(x, y, z) {
  if (kbvCerebrum(Math.abs(x), y, z) < 0) return 1;
  if (kbvCerebellum(x, y, z) < 0) return 2;
  if (kbvStem(x, y, z) < 0) return 3;
  return 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KBV_FISSURE, KBV_STEM, kbInside, kbvCerebrum, kbvLobes, kbvTemporal, kbvCerebellum, kbvStem };
}
