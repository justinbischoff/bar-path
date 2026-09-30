import { BODY, DESCENT, S, clamp, fix, vctx, view } from './state.js';
import { analyse, cmPerPx, pathPoints } from './path.js';
import { TRIPLE, jointAng, jp, lean, midfoot } from './pose.js';

export function drawOverlay() {
  const k = S.vk, ctx = vctx;
  const rect = view.getBoundingClientRect();
  const px = rect.width ? view.width / rect.width : 1;
  const pts = pathPoints();
  const a = analyse(pts);
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (a) {
    const f = a.first;
    const end = S.grow ? Math.min(S.frame, a.last) : a.last;
    if (S.plumb) {
      ctx.setLineDash([9 * px, 7 * px]); ctx.lineWidth = 1.6 * px;
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; line(pts[f].x * k + px, 0, pts[f].x * k + px, view.height);
      ctx.strokeStyle = 'rgba(244,241,234,.85)'; line(pts[f].x * k, 0, pts[f].x * k, view.height);
      ctx.setLineDash([]);
    }
    if (end > f) {
      const stroke = (from, to, color, width) => {
        if (to <= from) return;
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        let pen = false;
        for (let i = from; i <= to; i++) {
          const p = pts[i]; if (!p) { pen = false; continue; }
          if (pen) ctx.lineTo(p.x * k, p.y * k); else { ctx.moveTo(p.x * k, p.y * k); pen = true; }
        }
        ctx.stroke();
      };
      stroke(f, end, 'rgba(0,0,0,.55)', (S.lw + 4) * px);
      if (S.descent && end > a.peak) {
        stroke(f, a.peak, S.color, S.lw * px);
        stroke(a.peak, Math.min(end, a.catchIdx), DESCENT, S.lw * px);
        stroke(a.catchIdx, end, S.color, S.lw * px);
      } else stroke(f, end, S.color, S.lw * px);
    }
  }
  if (S.ghost && S.src.kind !== 'still') drawGhost(ctx, k, px, pts);
  if (S.showBody) drawBody(ctx, k, px);
  if (a) {
    const cur = S.frame >= a.first && S.frame <= a.last ? pts[S.frame] : null;
    if (cur && !(S.anchor && S.anchor.frame === S.frame && !S.tracking)) {
      ctx.lineWidth = 2 * px; ctx.strokeStyle = S.color;
      ctx.beginPath(); ctx.arc(cur.x * k, cur.y * k, S.radius * k, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = S.color; ctx.beginPath(); ctx.arc(cur.x * k, cur.y * k, 3 * px, 0, Math.PI * 2); ctx.fill();
    }
  }
  drawAnnot(ctx, k, px, pts, line);
  if (S.anchor && S.anchor.frame === S.frame && !S.tracking) {
    const x = S.anchor.x * k, y = S.anchor.y * k, r = S.radius * k;
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(x, y, r + px, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#f2c230'; ctx.setLineDash([6 * px, 5 * px]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const c = Math.max(8 * px, r * 0.35);
    line(x - c, y, x + c, y); line(x, y - c, x, y + c);
  }
  ctx.restore();
}

export function drawBody(ctx, k, px) {
  const i = S.frame;
  if (!S.poseS[i]) return;
  const chains = [['ear', 'shoulder', 'elbow', 'wrist'], ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe', 'ankle']];
  const path = () => {
    ctx.beginPath();
    for (const ch of chains) ch.forEach((n, j) => { const p = jp(i, n); if (j) ctx.lineTo(p.x * k, p.y * k); else ctx.moveTo(p.x * k, p.y * k); });
    ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 6 * px; path();
  ctx.strokeStyle = BODY; ctx.lineWidth = 3 * px; path();
  ctx.fillStyle = '#ffffff';
  for (const n of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
    const p = jp(i, n); ctx.beginPath(); ctx.arc(p.x * k, p.y * k, 3.5 * px, 0, Math.PI * 2); ctx.fill();
  }
}

export function tag(ctx, px, x, y, text) {
  ctx.font = `500 ${13 * px}px "IBM Plex Mono", ui-monospace, monospace`;
  const w = ctx.measureText(text).width + 12 * px, hh = 22 * px;
  x = clamp(x, 4 * px, view.width - w - 4 * px); y = clamp(y, 4 * px, view.height - hh - 4 * px);
  ctx.fillStyle = 'rgba(10,11,12,.85)'; ctx.fillRect(x, y, w, hh);
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, x + 6 * px, y + hh / 2 + px);
}

/* Draws the measurement behind the selected finding, live for the frame on screen. */
export function drawAnnot(ctx, k, px, pts, line) {
  const it = S.focus && S.tech && S.tech.checks && S.tech.checks.find(c => c.id === S.focus);
  if (!it || !it.annot) return;
  const i = S.frame, a = it.annot, c = cmPerPx(), F = S.facing;
  const P = n => { const p = n === 'midfoot' ? midfoot(i) : jp(i, n); return p && { x: p.x * k, y: p.y * k }; };
  const bar = pts[i] && { x: pts[i].x * k, y: pts[i].y * k };
  const dash = () => ctx.setLineDash([6 * px, 5 * px]);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * px;
  if (a.type === 'angle') {
    for (const j of a.joints) {
      const [A, B, C] = TRIPLE[j].map(P); if (!A || !B || !C) continue;
      const a1 = Math.atan2(A.y - B.y, A.x - B.x), a2 = Math.atan2(C.y - B.y, C.x - B.x);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ctx.beginPath(); ctx.arc(B.x, B.y, 20 * px, a1, a1 + d, d < 0); ctx.stroke();
      tag(ctx, px, B.x + 24 * px, B.y - 11 * px, `${j} ${Math.round(jointAng(i, j))}°`);
    }
  } else if (a.type === 'torso') {
    const s = P('shoulder'), h = P('hip'); if (!s || !h) return;
    ctx.lineWidth = 4 * px; line(h.x, h.y, s.x, s.y);
    ctx.lineWidth = 2 * px; dash(); line(h.x, h.y, h.x + 70 * px * F, h.y); ctx.setLineDash([]);
    tag(ctx, px, h.x + 14 * px * F - (F < 0 ? 96 * px : 0), h.y + 8 * px, `back ${Math.round(90 - lean(i))}°`);
  } else if (a.type === 'vs') {
    const s = P('shoulder'); if (!s || !bar) return;
    dash(); line(s.x, s.y, s.x, bar.y); line(bar.x, s.y, bar.x, bar.y); ctx.setLineDash([]);
    const d = (s.x - bar.x) / k * F * c;
    tag(ctx, px, Math.max(s.x, bar.x) + 8 * px, s.y - 28 * px, `shoulder ${fix(Math.abs(d))} cm ${d >= 0 ? 'ahead' : 'behind'}`);
  } else if (a.type === 'feet') {
    const m = P('midfoot'); if (!m) return;
    dash(); line(a.base * k, m.y - 90 * px, a.base * k, m.y + 20 * px); ctx.setLineDash([]);
    line(m.x, m.y - 90 * px, m.x, m.y + 20 * px);
    const d = (m.x / k - a.base) * F * c;
    tag(ctx, px, Math.max(m.x, a.base * k) + 8 * px, m.y - 80 * px, `feet ${fix(Math.abs(d))} cm ${d >= 0 ? 'forward' : 'back'}`);
  } else if (a.type === 'midfoot') {
    const m = P('midfoot'); if (!m || !bar) return;
    dash(); line(m.x, m.y + 10 * px, m.x, bar.y); ctx.setLineDash([]);
    const d = (bar.x - m.x) / k * F * c;
    tag(ctx, px, Math.max(m.x, bar.x) + 8 * px, (m.y + bar.y) / 2, `bar ${fix(Math.abs(d))} cm ${d >= 0 ? 'in front of' : 'behind'} mid-foot`);
  } else if (a.type === 'heel') {
    const hl = P('heel'); if (!hl) return;
    dash(); line(hl.x - 50 * px, a.base * k, hl.x + 50 * px, a.base * k); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(hl.x, hl.y, 6 * px, 0, Math.PI * 2); ctx.stroke();
    tag(ctx, px, hl.x + 12 * px, hl.y - 30 * px, `heel ${fix(Math.max(0, (a.base - hl.y / k) * c))} cm up`);
  } else if (a.type === 'bar' && bar) {
    const d = (pts[i].x - pts[pts.findIndex(Boolean)].x) * F * c;
    tag(ctx, px, bar.x + (S.radius * k + 8 * px), bar.y - 11 * px, `bar ${fix(Math.abs(d))} cm ${d >= 0 ? 'forward' : 'back'}`);
  }
}

/* A saved path laid over the current video, scaled to this video's plate and anchored at its start position. */
function drawGhost(ctx, k, px, pts) {
  const f = pts.findIndex(Boolean);
  const o = f >= 0 ? pts[f] : S.anchor;
  if (!o) return;
  const c = cmPerPx();
  const P = g => ({ x: (o.x + g[1] * S.facing / c) * k, y: (o.y - g[2] / c) * k });
  const path = () => {
    ctx.beginPath(); let pen = false;
    for (const g of S.ghost.pathCm) { if (!g) { pen = false; continue; } const p = P(g); if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; } }
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash([10 * px, 7 * px]);
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 6 * px; path();
  ctx.strokeStyle = 'rgba(244,241,234,.8)'; ctx.lineWidth = 3 * px; path();
  ctx.setLineDash([]);
  const top = S.ghost.pathCm.filter(Boolean).reduce((a, g) => g[2] > a[2] ? g : a);
  const t = P(top);
  tag(ctx, px, t.x + 12 * px, t.y - 30 * px, `ghost · ${S.ghost.label}`);
  ctx.restore();
}

const INK = '#ebe8e1', MUTED = '#8f969c', SURF = '#0a0b0c';
const SANS = '"IBM Plex Sans", system-ui, sans-serif', MONO = '"IBM Plex Mono", ui-monospace, monospace';

/* Saved bar paths on one grid: horizontal cm from the start line (away from the lifter to the right)
   against height above the start. Returns the scales so the caller can hit-test hover. */
export function drawCompare(ctx, W, H, series, hover) {
  ctx.save();
  ctx.fillStyle = SURF; ctx.fillRect(0, 0, W, H);
  const pad = { l: 84, r: 40, t: 84, b: 100 };
  let xm = 0, hmax = 0, hmin = 0;
  for (const s of series) for (const p of s.pts) { xm = Math.max(xm, Math.abs(p[1])); hmax = Math.max(hmax, p[2]); hmin = Math.min(hmin, p[2]); }
  const xStep = xm > 14 ? 10 : 5;
  xm = Math.max(10, Math.ceil((xm + 1) / xStep) * xStep);
  const yStep = hmax > 160 ? 40 : 20;
  const yTop = Math.max(40, Math.ceil((hmax + 5) / yStep) * yStep), yBot = Math.min(0, Math.floor(hmin / yStep) * yStep);
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const X = x => pad.l + (x + xm) / (2 * xm) * pw, Y = h => pad.t + (yTop - h) / (yTop - yBot) * ph;
  const stretch = (pw / (2 * xm)) / (ph / (yTop - yBot));
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };

  ctx.font = `500 19px ${MONO}`; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(235,232,225,.08)'; ctx.fillStyle = MUTED;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = -xm; x <= xm; x += xStep) { line(X(x), pad.t, X(x), pad.t + ph); ctx.fillText(String(Math.abs(x)), X(x), pad.t + ph + 10); }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let h = yBot; h <= yTop; h += yStep) { line(pad.l, Y(h), pad.l + pw, Y(h)); ctx.fillText(String(h), pad.l - 12, Y(h)); }
  ctx.strokeStyle = 'rgba(244,241,234,.5)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  line(X(0), pad.t, X(0), pad.t + ph); ctx.setLineDash([]);

  ctx.fillStyle = MUTED; ctx.font = `500 19px ${SANS}`; ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; ctx.fillText('← toward lifter', pad.l, pad.t + ph + 44);
  ctx.textAlign = 'right'; ctx.fillText('away from lifter →', pad.l + pw, pad.t + ph + 44);
  ctx.textAlign = 'center'; ctx.fillText('cm from start', X(0), pad.t + ph + 44);
  ctx.save(); ctx.translate(26, pad.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle';
  ctx.fillText('height above start, cm', 0, 0); ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = INK; ctx.font = `600 26px ${SANS}`; ctx.fillText('Bar path comparison', pad.l, 30);
  if (stretch > 1.3) { ctx.fillStyle = MUTED; ctx.font = `400 18px ${SANS}`; ctx.fillText(`Horizontal distances stretched ${stretch.toFixed(1)}× so drift is visible`, pad.l, 60); }

  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const trace = pts => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p[1]), Y(p[2])) : ctx.moveTo(X(p[1]), Y(p[2]))); };
  for (const s of series) {
    if (s.pts.length < 2) continue;
    trace(s.pts);
    ctx.strokeStyle = SURF; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = s.color; ctx.lineWidth = 3.5; ctx.stroke();
  }
  for (const s of series) {
    const p = s.catchPt; if (!p) continue;
    ctx.beginPath(); ctx.arc(X(p[1]), Y(p[2]), 7, 0, Math.PI * 2);
    ctx.fillStyle = s.color; ctx.fill(); ctx.strokeStyle = SURF; ctx.lineWidth = 3; ctx.stroke();
  }

  // Direct labels beside each path's highest point, nudged apart so they never overlap.
  ctx.font = `500 19px ${SANS}`;
  const labs = series.filter(s => s.pts.length).map(s => {
    const top = s.pts.reduce((a, p) => p[2] > a[2] ? p : a, s.pts[0]);
    return { s, x: X(top[1]) + 18, y: Y(top[2]) - 20 };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 30) labs[i].y = labs[i - 1].y + 30;
  for (const l of labs) {
    const w = ctx.measureText(l.s.label).width + 26;
    const x = Math.min(l.x, W - pad.r - w), y = Math.max(pad.t - 10, l.y);
    ctx.fillStyle = 'rgba(10,11,12,.8)'; ctx.fillRect(x - 4, y - 14, w + 8, 28);
    ctx.fillStyle = l.s.color; ctx.beginPath(); ctx.arc(x + 7, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(l.s.label, x + 20, y + 1);
  }

  if (hover) {
    const s = series[hover.si], p = s && s.pts[hover.pi];
    if (p) {
      const hx = X(p[1]), hy = Y(p[2]);
      ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2);
      ctx.fillStyle = s.color; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
      const rows = [s.label, `${p[2].toFixed(1)} cm up · ${Math.abs(p[1]).toFixed(1)} cm ${p[1] >= 0 ? 'away' : 'toward'}`, `${p[0].toFixed(2)} s from lift-off`];
      ctx.font = `500 19px ${SANS}`;
      const w = Math.max(...rows.map(r => ctx.measureText(r).width)) + 28, h = rows.length * 26 + 16;
      let bx = hx + 18, by = hy - h - 12;
      if (bx + w > W - 8) bx = hx - w - 18;
      if (by < 8) by = hy + 18;
      ctx.fillStyle = 'rgba(23,26,29,.96)'; ctx.fillRect(bx, by, w, h);
      ctx.strokeStyle = 'rgba(235,232,225,.2)'; ctx.lineWidth = 1; ctx.strokeRect(bx + .5, by + .5, w - 1, h - 1);
      rows.forEach((r, i) => { ctx.fillStyle = i ? MUTED : INK; ctx.fillText(r, bx + 14, by + 22 + i * 26); });
    }
  }
  ctx.restore();
  return { X, Y };
}
