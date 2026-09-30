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
