import { S, clamp } from './state.js';

const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });

/* ---------- Bar tracking (normalised cross-correlation) ---------- */

export function grabGray(s) {
  const src = S.src;
  const w = Math.max(1, Math.round(src.W * s)), h = Math.max(1, Math.round(src.H * s));
  if (proc.width !== w) proc.width = w;
  if (proc.height !== h) proc.height = h;
  pctx.imageSmoothingEnabled = true; pctx.imageSmoothingQuality = 'high';
  src.draw(pctx, w, h);
  const d = pctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return { g, w, h };
}

export function cutPatch(img, cx, cy, ts) {
  const half = ts >> 1, x0 = Math.round(cx) - half, y0 = Math.round(cy) - half;
  if (x0 < 0 || y0 < 0 || x0 + ts > img.w || y0 + ts > img.h) return null;
  const out = new Float32Array(ts * ts);
  for (let j = 0, k = 0; j < ts; j++) for (let i = 0; i < ts; i++, k++) out[k] = img.g[(y0 + j) * img.w + x0 + i];
  return out;
}

export function prepTpl(raw) {
  let m = 0; for (const v of raw) m += v; m /= raw.length;
  const t = new Float32Array(raw.length); let n2 = 0;
  for (let k = 0; k < raw.length; k++) { t[k] = raw[k] - m; n2 += t[k] * t[k]; }
  return { t, n2 };
}

export function match(img, tpl, ts, px, py, R) {
  const half = ts >> 1, n = ts * ts, W = img.w, g = img.g, t = tpl.t;
  const cx = Math.round(px), cy = Math.round(py), size = 2 * R + 1;
  const sc = new Float32Array(size * size).fill(-2);
  let best = -2, bi = -1;
  for (let dy = -R; dy <= R; dy++) {
    const y0 = cy + dy - half; if (y0 < 0 || y0 + ts > img.h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const x0 = cx + dx - half; if (x0 < 0 || x0 + ts > W) continue;
      let s = 0, s2 = 0, c = 0, k = 0;
      for (let j = 0; j < ts; j++) {
        let r = (y0 + j) * W + x0;
        for (let i = 0; i < ts; i++, r++, k++) { const v = g[r]; s += v; s2 += v * v; c += v * t[k]; }
      }
      const vi = s2 - s * s / n; if (vi < 1e-3) continue;
      const score = c / Math.sqrt(vi * tpl.n2);
      const idx = (dy + R) * size + dx + R;
      sc[idx] = score; if (score > best) { best = score; bi = idx; }
    }
  }
  if (bi < 0) return null;
  const by = Math.floor(bi / size), bx = bi % size;
  const sub = (l, r) => { if (l <= -2 || r <= -2) return 0; const den = l - 2 * best + r; return den < 0 ? clamp(0.5 * (l - r) / den, -0.5, 0.5) : 0; };
  const ox = bx > 0 && bx < size - 1 ? sub(sc[bi - 1], sc[bi + 1]) : 0;
  const oy = by > 0 && by < size - 1 ? sub(sc[bi - size], sc[bi + size]) : 0;
  return { x: cx + bx - R + ox, y: cy + by - R + oy, score: best };
}
