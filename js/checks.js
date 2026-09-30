import { S, fix } from './state.js';
import { barPhases, cmPerPx, pathPoints } from './path.js';
import { jointAng, jp, lean, midfoot } from './pose.js';

export const GROUPS = ['First pull', 'Second pull', 'Turnover and catch', 'Jerk'];

export function evaluate() {
  const pts = pathPoints(), ph = barPhases(pts);
  if (!ph) return null;
  if (ph.liftoff == null) return { error: 'The bar never leaves the floor in the tracked frames. Track from the start position through the catch.' };
  const { first, last, liftoff, peak, catchIdx, jerk, h } = ph;
  const F = S.facing, c = cmPerPx(), cm = v => v * c, fps = S.src.fps;
  const ms = frames => Math.round(frames * 1000 / fps);
  const hasPose = S.poseS.some(Boolean);
  const fwd = i => cm((pts[i].x - pts[first].x) * F);
  const out = [];
  const add = (group, id, title, status, text, frame, annot) => out.push({ group: GROUPS[group], id, title, status, text, frame, annot });
  const needPose = (group, id, title) => add(group, id, title, 'na', hasPose ? 'The body model could not see the joints needed on these frames.' : 'Press Analyse technique to check this.', null, null);

  // Frame where the bar passes the knee, and the frame of greatest hip + knee extension before the bar peaks.
  let kneeIdx = null;
  for (let i = liftoff; i <= peak; i++) { const k = jp(i, 'knee'); if (k ? pts[i].y <= k.y : h(i) >= 25) { kneeIdx = i; break; } }
  let extIdx = null, best = -1;
  if (kneeIdx != null) for (let i = kneeIdx; i <= peak; i++) {
    const a = jointAng(i, 'hip'), b = jointAng(i, 'knee');
    if (a != null && b != null && a + b > best) { best = a + b; extIdx = i; }
  }

  // --- First pull ---
  {
    const rows = [[liftoff, 'at lift-off'], [kneeIdx, 'as the bar passes the knee']].filter(r => r[0] != null && jp(r[0], 'shoulder'))
      .map(([f, where]) => ({ f, where, d: cm((jp(f, 'shoulder').x - pts[f].x) * F) }));
    if (!rows.length) needPose(0, 'shoulders', 'Shoulders over the bar');
    else {
      const worst = rows.reduce((a, b) => b.d < a.d ? b : a);
      const st = worst.d >= -2 ? 'good' : worst.d >= -5 ? 'watch' : 'fault';
      const say = r => `${fix(Math.abs(r.d))} cm ${r.d >= 0 ? 'in front of' : 'behind'} the bar ${r.where}`;
      add(0, 'shoulders', 'Shoulders over the bar', st,
        `Shoulders ${rows.map(say).join(', ')}.${st === 'good' ? '' : ' Keep them over or just ahead of the bar until it clears the knee.'}`,
        worst.f, { type: 'vs' });
    }
  }
  {
    const l0 = lean(liftoff), l1 = kneeIdx != null ? lean(kneeIdx) : null;
    if (l0 == null || l1 == null) needPose(0, 'hips', 'Hips and shoulders rise together');
    else {
      const d = l1 - l0, st = d <= 4 ? 'good' : d <= 8 ? 'watch' : 'fault';
      const hr = cm(jp(liftoff, 'hip').y - jp(kneeIdx, 'hip').y), sr = cm(jp(liftoff, 'shoulder').y - jp(kneeIdx, 'shoulder').y);
      add(0, 'hips', 'Hips and shoulders rise together', st,
        `Back angle ${Math.round(90 - l0)}° at lift-off, ${Math.round(90 - l1)}° at the knee. Hips rose ${fix(hr)} cm, shoulders ${fix(sr)} cm.${st === 'good' ? '' : ' The hips are coming up faster than the shoulders, which tips the chest down.'}`,
        kneeIdx, { type: 'torso' });
    }
  }
  if (kneeIdx == null) add(0, 'close1', 'Bar stays close off the floor', 'na', 'The bar did not reach knee height in the tracked frames.', null, null);
  else {
    let mx = -1e9, mn = 1e9, fm = liftoff;
    for (let i = liftoff; i <= kneeIdx; i++) { const d = fwd(i); if (d > mx) { mx = d; fm = i; } mn = Math.min(mn, d); }
    const st = mx <= 2 ? 'good' : mx <= 4 ? 'watch' : 'fault';
    add(0, 'close1', 'Bar stays close off the floor', st,
      mx <= 2 ? (mn < -0.5 ? `Bar moved ${fix(-mn)} cm back toward the lifter before the knee.` : 'Bar rose straight up to the knee.')
              : `Bar drifted ${fix(mx)} cm forward of the start line before the knee. It should travel straight up or slightly back toward the shins.`,
      fm, { type: 'bar' });
  }
  {
    let base = 0, n = 0;
    for (let i = first; i <= liftoff; i++) { const p = jp(i, 'heel'); if (p) { base += p.y; n++; } }
    let mid = null;
    if (kneeIdx != null) for (let i = kneeIdx; i <= peak; i++) { const k = jp(i, 'knee'), hp = jp(i, 'hip'); if (k && hp && pts[i].y <= (k.y + hp.y) / 2) { mid = i; break; } }
    if (!n || mid == null) needPose(0, 'heels', 'Heels stay down');
    else {
      base /= n; let up = null, rise = 0;
      for (let i = liftoff; i <= mid; i++) { const p = jp(i, 'heel'); if (p && cm(base - p.y) > 2.5) { up = i; rise = cm(base - p.y); break; } }
      add(0, 'heels', 'Heels stay down', up == null ? 'good' : 'watch',
        up == null ? 'Heels stayed on the floor until the bar passed mid-thigh.'
                   : `Heel lifted ${fix(rise)} cm at frame ${up}, before the bar reached mid-thigh. The weight may be shifting to the toes early.`,
        up == null ? mid : up, { type: 'heel', base });
    }
  }

  // --- Second pull ---
  if (extIdx == null) { needPose(1, 'arms', 'Arms stay long'); needPose(1, 'extension', 'Full extension'); }
  else {
    let mn = 999, fm = liftoff;
    for (let i = liftoff; i < extIdx; i++) { const a = jointAng(i, 'elbow'); if (a != null && a < mn) { mn = a; fm = i; } }
    if (mn === 999) needPose(1, 'arms', 'Arms stay long');
    else {
      const st = mn >= 160 ? 'good' : mn >= 150 ? 'watch' : 'fault';
      add(1, 'arms', 'Arms stay long', st,
        st === 'good' ? `Elbows stayed straight until full extension (most bent: ${Math.round(mn)}°).`
                      : `Elbow bent to ${Math.round(mn)}° at frame ${fm}, ${ms(extIdx - fm)} ms before full extension. Pulling with the arms early takes power away from the legs and hips.`,
        fm, { type: 'angle', joints: ['elbow'] });
    }
    const a = jointAng(extIdx, 'hip'), b = jointAng(extIdx, 'knee'), l = lean(extIdx);
    const st = a >= 170 && b >= 160 ? 'good' : a >= 160 ? 'watch' : 'fault';
    add(1, 'extension', 'Full extension', st,
      `At the top of the pull: hip ${Math.round(a)}°, knee ${Math.round(b)}° (180° is straight)${l != null && l < -2 ? `, torso ${Math.round(-l)}° behind vertical` : ''}.${st === 'good' ? '' : ' The hips and knees did not open fully before the pull under.'}`,
      extIdx, { type: 'angle', joints: ['hip', 'knee'] });
  }
  {
    let mx = -1e9, fm = peak;
    for (let i = kneeIdx == null ? liftoff : kneeIdx; i <= peak; i++) { const d = fwd(i); if (d > mx) { mx = d; fm = i; } }
    const st = mx <= 3 ? 'good' : mx <= 6 ? 'watch' : 'fault';
    add(1, 'close2', 'Bar stays close at the hips', st,
      st === 'good' ? (mx <= 0 ? 'Bar stayed behind the start line through the second pull.' : `Bar stayed within ${fix(mx)} cm of the start line through the second pull.`)
                    : `Bar swung ${fix(mx)} cm in front of the start line at frame ${fm}. That usually comes from bumping it forward with the hips rather than brushing it upward.`,
      fm, { type: 'bar' });
  }

  // --- Turnover and catch ---
  {
    let bx = 0, n = 0;
    for (let i = first; i <= liftoff; i++) { const m = midfoot(i); if (m) { bx += m.x; n++; } }
    const mc = midfoot(catchIdx);
    if (!n || !mc || catchIdx === peak) needPose(2, 'feet', 'Feet land in place');
    else {
      bx /= n;
      const d = cm((mc.x - bx) * F);
      const st = d > 3 ? 'fault' : d < -8 ? 'watch' : 'good';
      add(2, 'feet', 'Feet land in place', st,
        d > 3 ? `Feet jumped ${fix(d)} cm forward. The lifter is chasing a bar that went out in front.`
        : d < -8 ? `Feet jumped ${fix(-d)} cm back. A small hop back is common; this much usually means leaning back or swinging the bar.`
        : `Feet landed ${fix(Math.abs(d))} cm ${d >= 0 ? 'forward of' : 'behind'} where they started.`,
        catchIdx, { type: 'feet', base: bx });
    }
    if (!mc) needPose(2, 'catchPos', 'Bar lands over mid-foot');
    else {
      const d = cm((pts[catchIdx].x - mc.x) * F), ad = Math.abs(d);
      const st = ad <= 4 ? 'good' : ad <= 8 ? 'watch' : 'fault';
      add(2, 'catchPos', 'Bar lands over mid-foot', st,
        `Bar is ${fix(ad)} cm ${d >= 0 ? 'in front of' : 'behind'} mid-foot at the bottom of the catch.${st === 'good' ? '' : d > 0 ? ' A bar that lands forward pulls the lifter onto the toes.' : ' A bar that lands behind the base is hard to hold.'}`,
        catchIdx, { type: 'midfoot' });
    }
    add(2, 'turnover', 'Turnover', 'info',
      `Bar peaked ${fix(h(peak))} cm above the start and dropped ${fix(h(peak) - h(catchIdx))} cm into the catch${extIdx != null ? `, ${ms(catchIdx - extIdx)} ms after full extension` : ''}.`,
      peak, { type: 'bar' });
  }

  // --- Jerk ---
  if (S.lift === 'cj') {
    if (!jerk) add(3, 'jerk', 'Jerk', 'na', 'No jerk found in the tracked frames. Track through the lockout to check it.', null, null);
    else {
      const { dipStart: s, dipBottom: b, top } = jerk;
      const d = cm((pts[b].x - pts[s].x) * F), ls = lean(s), lb = lean(b), dl = ls != null && lb != null ? lb - ls : null;
      let st = d > 5 || dl > 9 ? 'fault' : d > 2.5 || dl > 5 ? 'watch' : 'good';
      add(3, 'dip', 'Dip stays vertical', st,
        `Dip ${fix(h(s) - h(b))} cm deep. Bar moved ${fix(Math.abs(d))} cm ${d >= 0 ? 'forward' : 'back'}${dl != null ? `, torso tipped ${fix(Math.abs(dl))}° ${dl >= 0 ? 'forward' : 'back'}` : ''}.${st === 'good' ? '' : ' A dip that tips forward sends the drive out in front.'}`,
        b, { type: 'torso' });
      const dd = cm((pts[top].x - pts[b].x) * F);
      st = dd > 6 ? 'fault' : dd > 3 || dd < -8 ? 'watch' : 'good';
      add(3, 'drive', 'Drive goes straight up', st,
        `Bar finished ${fix(Math.abs(dd))} cm ${dd >= 0 ? 'in front of' : 'behind'} where it was at the bottom of the dip.${dd > 3 ? ' The bar is being driven forward, away from the base.' : ''}`,
        top, { type: 'bar' });
      let lk = top; for (let i = b; i <= top; i++) if (h(i) >= h(top) - 3) { lk = i; break; }
      const e0 = jointAng(lk, 'elbow');
      let e1 = e0;
      for (let i = lk; i <= Math.min(last, lk + Math.round(fps * 0.6)); i++) { const e = jointAng(i, 'elbow'); if (e != null && e > e1) e1 = e; }
      if (e0 == null) needPose(3, 'lockout', 'Arms lock out');
      else {
        st = e0 < 155 && e1 - e0 > 10 ? 'fault' : e1 < 165 ? 'watch' : 'good';
        add(3, 'lockout', 'Arms lock out', st,
          st === 'fault' ? `Elbow was at ${Math.round(e0)}° when the bar arrived overhead and straightened to ${Math.round(e1)}° afterwards. That is a press-out.`
          : st === 'watch' ? `Elbow only reached ${Math.round(e1)}° overhead (180° is straight).`
          : `Elbow locked at ${Math.round(e1)}° as the bar arrived overhead.`,
          lk, { type: 'angle', joints: ['elbow'] });
      }
    }
  }
  return { checks: out, hasPose };
}
