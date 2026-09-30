import { S } from './state.js';

/* ---------- Path geometry, lift phases & readout ---------- */

export function pathPoints() {
  const P = S.points;
  if (!S.smooth) return P.map(p => p ? { x: p.x, y: p.y } : null);
  const w = [1, 2, 3, 2, 1], out = [];
  for (let i = 0; i < P.length; i++) {
    if (!P[i]) { out[i] = null; continue; }
    let sx = 0, sy = 0, sw = 0;
    for (let j = -2; j <= 2; j++) { const q = P[i + j]; if (q) { sx += q.x * w[j + 2]; sy += q.y * w[j + 2]; sw += w[j + 2]; } }
    out[i] = { x: sx / sw, y: sy / sw };
  }
  const f = P.findIndex(Boolean);
  if (f >= 0) out[f] = { x: P[f].x, y: P[f].y };
  return out;
}

export const cmPerPx = () => 22.5 / S.radius;   // a 450 mm plate has a 22.5 cm radius

/* Splits the bar path into lift-off, pull peak, catch and (for a clean & jerk) the jerk dip and lockout. */
export function barPhases(pts) {
  const idx = []; pts.forEach((p, i) => p && idx.push(i));
  if (idx.length < 2) return null;
  const first = idx[0], last = idx[idx.length - 1], y0 = pts[first].y, c = cmPerPx();
  const h = i => (y0 - pts[i].y) * c;
  const ph = { first, last, h, liftoff: null, peak: null, catchIdx: null, jerk: null };
  const lo = idx.find(i => h(i) > 1.5);
  if (lo === undefined) return ph;
  ph.liftoff = lo;
  let peak = lo;
  for (const i of idx) {
    if (i < lo) continue;
    if (h(i) > h(peak)) peak = i; else if (h(i) < h(peak) - 1.5) break;
  }
  let cat = peak;
  for (const i of idx) {
    if (i <= peak) continue;
    if (h(i) < h(cat)) cat = i; else if (h(i) > h(cat) + 3) break;
  }
  ph.peak = peak; ph.catchIdx = cat;
  if (S.lift === 'cj') {
    let top = cat;
    for (const i of idx) if (i > cat && h(i) > h(top)) top = i;
    if (h(top) > h(peak) + 15) {
      let b = top; while (b > cat && pts[b - 1] && h(b - 1) <= h(b) + 0.3) b--;
      // dip starts at the last frame still within 0.5 cm of the standing height before it
      let top0 = -Infinity; for (let i = cat; i <= b; i++) if (pts[i]) top0 = Math.max(top0, h(i));
      let s = b; for (let i = b; i >= cat; i--) if (pts[i] && h(i) >= top0 - 0.5) { s = i; break; }
      ph.jerk = { dipStart: s, dipBottom: b, top };
    }
  }
  return ph;
}

export function analyse(pts) {
  const ph = barPhases(pts);
  if (!ph) return null;
  const { first, last } = ph, x0 = pts[first].x, y0 = pts[first].y;
  let peak = ph.peak, cat = ph.catchIdx;
  if (peak == null) { peak = first; for (let i = first; i <= last; i++) if (pts[i] && pts[i].y < pts[peak].y) peak = i; cat = peak; }
  let minD = 0, maxD = 0;
  for (let i = first; i <= cat; i++) {
    if (!pts[i]) continue;
    const d = (pts[i].x - x0) * S.facing;
    minD = Math.min(minD, d); maxD = Math.max(maxD, d);
  }
  return {
    first, last, peak, catchIdx: cat, jerk: ph.jerk,
    toward: -minD, away: maxD, range: maxD - minD,
    height: y0 - pts[peak].y, drop: pts[cat].y - pts[peak].y,
    catchD: (pts[cat].x - x0) * S.facing,
    jerkD: ph.jerk ? (pts[ph.jerk.top].x - pts[ph.jerk.dipBottom].x) * S.facing : null,
    lowCount: S.points.filter(p => p && p.low).length, count: S.points.filter(Boolean).length,
  };
}
