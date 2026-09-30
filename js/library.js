import { $, S, busy, view } from './state.js';
import { analyse, barPhases, cmPerPx, pathPoints } from './path.js';
import { finishPose } from './pose.js';
import { stillSource, videoSource } from './sources.js';
import { drawCompare } from './draw.js';
import * as db from './storage.js';
import { goto, pause, refreshTech, render, setFacing, setLift, setRadius, setSource, setTab, ui } from './app.js';

/* Categorical slots validated against the dark stage (#0a0b0c) for adjacent-pair CVD and contrast. */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
const MAX_COMPARE = SERIES.length;
const STILLS = [['liftoff', 'Lift-off'], ['knee', 'Bar at knee'], ['ext', 'Extension'], ['catch', 'Catch'], ['jerk', 'Jerk lockout']];
const LIFT = { snatch: 'Snatch', clean: 'Clean', cj: 'Clean & jerk' };

let lifts = [];
const filter = { lift: 'all' };
const picked = new Set();
const thumbURLs = new Map();
let detailURLs = [];

const r1 = v => Math.round(v * 10) / 10;
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const isoDay = ms => { const d = new Date(ms); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const niceDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const shortDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
const bytes = n => n == null ? '?' : n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(1)} GB`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = r => `${LIFT[r.lift] || r.lift}${r.weightKg ? ` · ${r.weightKg} kg` : ''}`;
const side = (v, a = 'away', t = 'toward') => `${Math.abs(v).toFixed(1)} cm ${v >= 0 ? a : t}`;

function msg(text, warn) { const m = $('saveMsg'); m.textContent = text; m.classList.toggle('warn', !!warn); }
function libMsg(text, warn) { const m = $('libMsg'); m.textContent = text; m.classList.toggle('warn', !!warn); }

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- Saving ---------- */

/* Called by app.js whenever a new video, sample or saved lift is loaded. */
export function onSourceChange(src) {
  $('saveDate').value = src.file && src.file.lastModified ? isoDay(src.file.lastModified) : today();
  $('saveKg').value = ''; $('saveNotes').value = '';
  $('keepVideo').checked = false;
  msg('');
}

function fillForm(rec) {
  $('saveDate').value = rec.date || today();
  $('saveKg').value = rec.weightKg ?? '';
  $('saveNotes').value = rec.notes || '';
  $('keepVideo').checked = !!(rec.video && rec.video.saved);
}

async function snap(maxSide) {
  const q = Math.min(1, maxSide / Math.max(view.width, view.height));
  const c = document.createElement('canvas');
  c.width = Math.round(view.width * q); c.height = Math.round(view.height * q);
  c.getContext('2d').drawImage(view, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}

/* Renders the key positions with the path and body lines drawn on, and saves them as JPEGs. */
async function captureStills(a, ph) {
  const keep = { frame: S.frame, grow: S.grow, focus: S.focus, anchor: S.anchor, ghost: S.ghost };
  S.focus = null; S.anchor = null; S.ghost = null;
  const blobs = {}, stills = [];
  try {
    S.grow = false;
    await goto(ph.jerk ? ph.jerk.top : a.catchIdx);
    blobs.thumb = await snap(360);
    S.grow = true;
    const k = (S.tech && S.tech.keys) || {};
    const frames = { liftoff: k.liftoff ?? ph.liftoff, knee: k.knee, ext: k.ext ?? a.peak, catch: a.catchIdx, jerk: ph.jerk ? ph.jerk.top : null };
    for (const [key, label] of STILLS) {
      const f = frames[key];
      if (f == null) continue;
      await goto(f);
      blobs[`k:${key}`] = await snap(720);
      stills.push({ k: key, label, frame: f });
    }
  } finally {
    Object.assign(S, keep);
    await goto(keep.frame);
  }
  return { blobs, stills };
}

function buildRecord(id, prev, keepVideo) {
  const pts = pathPoints(), a = analyse(pts), ph = barPhases(pts), c = cmPerPx(), src = S.src;
  const first = a.first, last = a.last, x0 = pts[first].x, y0 = pts[first].y, lo = ph.liftoff ?? first;
  const pathCm = [], points = [];
  for (let i = first; i <= last; i++) {
    const p = pts[i], raw = S.points[i];
    pathCm.push(p ? [Math.round((i - lo) / src.fps * 1000) / 1000, r1((p.x - x0) * S.facing * c), r1((y0 - p.y) * c)] : null);
    points.push(raw ? [r1(raw.x), r1(raw.y), raw.low ? 1 : 0] : null);
  }
  let pose = null;
  if (S.pose.some(Boolean)) {
    pose = { first, frames: [] };
    for (let i = first; i <= last; i++) {
      const L = S.pose[i];
      pose.frames.push(L ? L.flatMap(q => [r1(q.x), r1(q.y), Math.round(q.z * 1000) / 1000, Math.round(q.v * 100) / 100]) : null);
    }
  }
  const checks = S.tech && S.tech.checks ? S.tech.checks : [];
  const count = s => checks.filter(x => x.status === s).length;
  const now = new Date().toISOString();
  return {
    id, schema: db.SCHEMA,
    createdAt: prev ? prev.createdAt : now, updatedAt: now,
    date: $('saveDate').value || today(), lift: S.lift,
    weightKg: parseFloat($('saveKg').value) || null, notes: $('saveNotes').value.trim(),
    video: { name: src.name, size: src.file ? src.file.size : null, W: src.W, H: src.H, fps: src.fps, saved: keepVideo },
    radius: S.radius, facing: S.facing, smooth: S.smooth,
    first, points, pose, pathCm,
    phases: { liftoff: ph.liftoff, peak: a.peak, catch: a.catchIdx, jerk: ph.jerk },
    stats: {
      toward: r1(a.toward * c), away: r1(a.away * c), range: r1(a.range * c),
      height: r1(a.height * c), drop: r1(a.drop * c), catchD: r1(a.catchD * c),
      jerkD: a.jerkD == null ? null : r1(a.jerkD * c),
    },
    findings: checks.map(({ group, id: cid, title: t, status, text, frame }) => ({ group, id: cid, title: t, status, text, frame })),
    counts: { fault: count('fault'), watch: count('watch'), good: count('good') },
    stills: [],
  };
}

async function save(asNew) {
  if (busy() || !S.src) return;
  if (S.src.kind === 'still') return saveDetails();
  if (!S.points.some(Boolean)) return;
  if (S.playing) await pause();
  const pts = pathPoints();
  if (!analyse(pts) || barPhases(pts).liftoff == null) { msg('Track the lift from the floor before saving it.', true); return; }
  const id = (!asNew && S.recordId) || crypto.randomUUID();
  const prev = !asNew && S.recordId ? await db.getLift(id) : null;
  const keep = $('keepVideo').checked && !!S.src.file;
  S.saving = true; ui(); msg('Saving…');
  try {
    const a = analyse(pts), ph = barPhases(pts);
    const shots = await captureStills(a, ph);
    const rec = buildRecord(id, prev, keep);
    rec.stills = shots.stills;
    const blobs = { ...shots.blobs };
    for (const [k] of STILLS) if (!blobs[`k:${k}`]) blobs[`k:${k}`] = null;
    if (!keep) blobs.video = null;
    else if (!(prev && prev.video && prev.video.saved)) blobs.video = S.src.file;
    await db.saveLift(rec, blobs);
    thumbURLs.delete(id);
    S.recordId = id; S.viewing = rec;
    const kept = await db.askPersist();
    msg(`Saved to the library${keep ? ' with the video' : ''}.${kept ? '' : ' Export a backup now and then; this browser may clear site data if space runs low.'}`);
    await refreshLibrary();
  } catch (e) {
    msg(`Could not save: ${e.message || e}`, true);
  } finally {
    S.saving = false; ui();
  }
}

/* A lift opened without its video can still have its date, weight and notes edited. */
async function saveDetails() {
  if (!S.viewing) return;
  const rec = { ...S.viewing, date: $('saveDate').value || S.viewing.date, weightKg: parseFloat($('saveKg').value) || null, notes: $('saveNotes').value.trim(), updatedAt: new Date().toISOString() };
  try { await db.saveLift(rec); S.viewing = rec; msg('Details updated.'); await refreshLibrary(); }
  catch (e) { msg(`Could not save: ${e.message || e}`, true); }
}

/* ---------- Opening ---------- */

async function openLift(id) {
  if (busy()) return;
  if (S.playing) await pause();
  const rec = await db.getLift(id);
  if (!rec) return;
  exitCompare(true);
  $('chip').textContent = 'Opening saved lift…';
  try {
    const video = rec.video && rec.video.saved ? await db.getBlob(id, 'video') : null;
    if (video) {
      setSource(await videoSource(video, { name: rec.video.name, fps: rec.video.fps }));
      setLift(rec.lift, true); setFacing(rec.facing, true); setRadius(rec.radius);
      S.smooth = rec.smooth !== false; $('smooth').checked = S.smooth;
      rec.points.forEach((p, j) => { if (p) S.points[rec.first + j] = { x: p[0], y: p[1], score: 1, low: !!p[2] }; });
      if (rec.pose) {
        rec.pose.frames.forEach((f, j) => {
          if (!f) return;
          const L = [];
          for (let k = 0; k < 33; k++) L.push({ x: f[k * 4], y: f[k * 4 + 1], z: f[k * 4 + 2], v: f[k * 4 + 3] });
          S.pose[rec.pose.first + j] = L;
        });
        finishPose();
      }
      S.recordId = id; S.viewing = rec;
      refreshTech();
      fillForm(rec);
      await goto(rec.phases.catch ?? rec.first);
      setTab('path');
    } else {
      const stills = [];
      for (const s of rec.stills || []) { const b = await db.getBlob(id, `k:${s.k}`); if (b) stills.push({ label: s.label, blob: b, k: s.k }); }
      if (!stills.length) { const b = await db.getBlob(id, 'thumb'); if (b) stills.push({ label: 'Bar path', blob: b, k: 'thumb' }); }
      if (!stills.length) throw new Error('No images were saved with this lift.');
      setSource(await stillSource(`${title(rec)} · ${shortDate(rec.date)}`, stills));
      setLift(rec.lift, true);
      S.recordId = id; S.viewing = rec;
      fillForm(rec);
      await goto(Math.max(0, stills.findIndex(s => s.k === 'catch')));
    }
  } catch (e) {
    libMsg(`Could not open that lift: ${e.message || e}`, true);
  }
  ui(); renderLibrary();
}

/* ---------- Library list ---------- */

export async function refreshLibrary() {
  try { lifts = await db.listLifts(); }
  catch (e) { lifts = []; libMsg(`Saved lifts are unavailable in this browser: ${e.message || e}`, true); }
  for (const id of [...picked]) if (!lifts.some(r => r.id === id)) picked.delete(id);
  if (S.ghost && !lifts.some(r => r.id === S.ghost.id)) { S.ghost = null; render(); }
  if (S.viewing && !lifts.some(r => r.id === S.viewing.id)) { S.viewing = null; S.recordId = null; }
  renderLibrary();
  renderUsage();
}

async function renderUsage() {
  const u = await db.usage();
  const vids = lifts.reduce((n, r) => n + (r.video && r.video.saved && r.video.size ? r.video.size : 0), 0);
  const parts = [`${lifts.length} lift${lifts.length === 1 ? '' : 's'}`];
  if (u.used != null) parts.push(`${bytes(u.used)} used${u.quota ? ` of ${bytes(u.quota)} available` : ''}`);
  if (vids) parts.push(`videos ${bytes(vids)}`);
  let t = parts.join(' · ') + '.';
  if (lifts.length) {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone;
    t += u.persisted ? ' Kept permanently on this device.'
      : ios ? ' Safari may clear these after a week without a visit; add this site to your Home Screen, and export a backup.'
      : ' The browser may clear these if the device runs low on space; export a backup now and then.';
  }
  $('libUsage').textContent = t;
  $('meter').style.width = u.used && u.quota ? `${Math.min(100, u.used / u.quota * 100).toFixed(2)}%` : '0';
}

export function renderLibrary() {
  $('libCount').textContent = lifts.length ? lifts.length : '';
  const list = lifts.filter(r => filter.lift === 'all' || r.lift === filter.lift);
  const el = $('libList');
  if (!lifts.length) {
    el.innerHTML = '<p class="note">No saved lifts yet. Track a lift, then save it above. Each save keeps the path, the readout, the technique findings and stills of the key positions.</p>';
  } else if (!list.length) {
    el.innerHTML = '<p class="note">No saved lifts of this type.</p>';
  } else {
    el.innerHTML = '<ul class="lib-list">' + list.map(r => {
      const s = r.stats || {}, c = r.counts || {};
      const pills = [c.fault ? `<span class="pill fault">${c.fault} fault${c.fault === 1 ? '' : 's'}</span>` : '',
                     c.watch ? `<span class="pill watch">${c.watch} to watch</span>` : '',
                     !c.fault && !c.watch && c.good ? `<span class="pill good">${c.good} good</span>` : ''].join('');
      const full = picked.size >= MAX_COMPARE && !picked.has(r.id);
      return `<li class="card${r.id === S.recordId ? ' current' : ''}" data-id="${r.id}">
        <img class="thumb" data-thumb="${r.id}" alt="">
        <div class="meta">
          <div class="ttl">${esc(title(r))}</div>
          <div class="sub">${niceDate(r.date)}${r.video && r.video.saved ? ` · <span class="tagv">video ${bytes(r.video.size)}</span>` : ''}</div>
          <div class="nums">drift ${s.away != null ? s.away.toFixed(1) : '–'} away / ${s.toward != null ? s.toward.toFixed(1) : '–'} toward · catch ${s.catchD != null ? side(s.catchD) : '–'}</div>
          ${pills ? `<div class="tally">${pills}</div>` : ''}
          ${r.notes ? `<div class="sub notes">${esc(r.notes)}</div>` : ''}
        </div>
        <div class="acts">
          <label class="pick"><input type="checkbox" data-act="pick"${picked.has(r.id) ? ' checked' : ''}${full ? ' disabled' : ''}> Compare</label>
          <button class="btn sm" data-act="open">Open</button>
          <button class="btn sm" data-act="ghost" aria-pressed="${S.ghost && S.ghost.id === r.id}">Ghost</button>
          <button class="btn sm" data-act="del">Delete</button>
        </div>
      </li>`;
    }).join('') + '</ul>';
    el.querySelectorAll('img[data-thumb]').forEach(async img => {
      const id = img.dataset.thumb;
      if (!thumbURLs.has(id)) { const b = await db.getBlob(id, 'thumb'); thumbURLs.set(id, b ? URL.createObjectURL(b) : ''); }
      if (thumbURLs.get(id)) img.src = thumbURLs.get(id);
    });
  }
  $('btnCompare').disabled = !picked.size || busy();
  $('btnCompare').textContent = picked.size ? `Compare ${picked.size} lift${picked.size === 1 ? '' : 's'}` : 'Compare';
  $('btnExport').disabled = !lifts.length;
  const g = $('ghostNote');
  g.hidden = !S.ghost;
  if (S.ghost) $('ghostName').textContent = S.ghost.label;
  renderDetail();
}

async function renderDetail() {
  const r = S.viewing, sec = $('detailSec');
  detailURLs.forEach(u => URL.revokeObjectURL(u)); detailURLs = [];
  sec.hidden = !r;
  if (!r) return;
  $('detTitle').textContent = title(r);
  $('detSub').textContent = `${niceDate(r.date)} · ${r.video && r.video.saved ? 'video kept on this device' : 'video not kept'}`;
  const s = r.stats;
  $('detStats').innerHTML = `
    <div><dt>Toward lifter</dt><dd>${s.toward.toFixed(1)}<small> cm</small></dd></div>
    <div><dt>Away from lifter</dt><dd>${s.away.toFixed(1)}<small> cm</small></dd></div>
    <div><dt>Pull height</dt><dd>${s.height.toFixed(1)}<small> cm</small></dd></div>
    <div><dt>Catch vs start</dt><dd>${Math.abs(s.catchD).toFixed(1)}<small> cm ${s.catchD >= 0 ? 'away' : 'toward'}</small></dd></div>`;
  const stillsEl = $('detStills');
  stillsEl.innerHTML = '';
  for (const [i, st] of (r.stills || []).entries()) {
    const b = await db.getBlob(r.id, `k:${st.k}`);
    if (!b || S.viewing !== r) continue;
    const u = URL.createObjectURL(b); detailURLs.push(u);
    const btn = document.createElement('button');
    btn.innerHTML = `<img src="${u}" alt="${st.label}"><span>${st.label}</span>`;
    btn.onclick = () => goto(S.src.kind === 'still' ? i : st.frame);
    stillsEl.appendChild(btn);
  }
  const f = $('detFindings');
  if (S.src && S.src.kind === 'still' && r.findings.length) {
    f.innerHTML = '<ul class="findings">' + r.findings.filter(x => x.status !== 'na').map(x => `
      <li class="finding static"><span class="pill ${x.status}">${x.status === 'fault' ? 'Fault' : x.status === 'watch' ? 'Watch' : x.status === 'good' ? 'Good' : 'Info'}</span>
      <span class="t">${esc(x.title)}</span><span class="f"></span><span class="d">${esc(x.text)}</span></li>`).join('') + '</ul>';
  } else f.innerHTML = r.findings.length ? '<p class="note">The full findings are on the Technique tab.</p>' : '';
  $('btnDetVideo').hidden = !(r.video && r.video.saved);
}

/* ---------- Ghost ---------- */

function setGhost(rec) {
  S.ghost = rec ? { id: rec.id, pathCm: rec.pathCm, label: `${shortDate(rec.date)} ${title(rec)}` } : null;
  render(); renderLibrary();
}

/* ---------- Compare ---------- */

function series() {
  return [...picked].map(id => lifts.find(r => r.id === id)).filter(Boolean)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt.localeCompare(b.createdAt))
    .map(r => {
      let pts = r.pathCm.filter(Boolean);
      if (S.compare.pullOnly && r.phases.catch != null) pts = r.pathCm.slice(0, r.phases.catch - r.first + 1).filter(Boolean);
      return { id: r.id, rec: r, pts, catchPt: r.phases.catch != null ? r.pathCm[r.phases.catch - r.first] : null, label: `${shortDate(r.date)}${r.weightKg ? ` · ${r.weightKg} kg` : ''}` };
    })
    .map((s, i) => ({ ...s, color: SERIES[i % SERIES.length] }));
}

export function drawCompareView() {
  const ser = series();
  S.compare.scale = drawCompare(view.getContext('2d'), view.width, view.height, ser, S.compare.hover);
  S.compare.series = ser;
}

function enterCompare() {
  if (!picked.size || busy()) return;
  if (S.playing) pause();
  S.compare = { pullOnly: $('pullOnly').checked, hover: null };
  view.width = 1000; view.height = 1150;
  $('compareSec').hidden = false;
  render(); renderCompareTable(); ui();
  $('screen').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function exitCompare(quiet) {
  if (!S.compare) return;
  S.compare = null;
  $('compareSec').hidden = true;
  if (S.src) { view.width = Math.round(S.src.W * S.vk); view.height = Math.round(S.src.H * S.vk); }
  if (!quiet) { render(); ui(); }
}

function renderCompareTable() {
  const ser = S.compare.series || series();
  const cell = v => v == null ? '–' : v.toFixed(1);
  $('cmpTable').innerHTML = `<table class="cmp"><thead><tr><th>Lift</th><th>Away</th><th>Toward</th><th>Catch</th><th>Faults</th></tr></thead><tbody>` +
    ser.map(s => `<tr><td><span class="sw" style="background:${s.color}"></span>${esc(s.label)}<div class="sub">${esc(LIFT[s.rec.lift] || '')}</div></td>
      <td>${cell(s.rec.stats.away)}</td><td>${cell(s.rec.stats.toward)}</td><td>${side(s.rec.stats.catchD, 'away', 'toward').replace(' cm', '')}</td>
      <td>${s.rec.findings.length ? s.rec.counts.fault : '–'}</td></tr>`).join('') +
    '</tbody></table><p class="note">Distances in cm from the start position. Away means away from the lifter.</p>';
}

view.addEventListener('pointermove', e => {
  if (!S.compare || !S.compare.scale) return;
  const r = view.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * view.width, y = (e.clientY - r.top) / r.height * view.height;
  const { X, Y } = S.compare.scale;
  let best = null, bd = 28 * view.width / r.width;
  S.compare.series.forEach((s, si) => s.pts.forEach((p, pi) => {
    const d = Math.hypot(X(p[1]) - x, Y(p[2]) - y);
    if (d < bd) { bd = d; best = { si, pi }; }
  }));
  const was = S.compare.hover;
  if ((was && best && was.si === best.si && was.pi === best.pi) || (!was && !best)) return;
  S.compare.hover = best; render();
});
view.addEventListener('pointerleave', () => { if (S.compare && S.compare.hover) { S.compare.hover = null; render(); } });

/* ---------- Events ---------- */

$('btnSave').onclick = () => save(false);
$('btnSaveNew').onclick = () => save(true);
$('libFilter').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  filter.lift = b.dataset.lift;
  $('libFilter').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  renderLibrary();
});

const armed = new Map();
$('libList').addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.closest('.card').dataset.id, rec = lifts.find(r => r.id === id);
  const act = el.dataset.act;
  if (act === 'pick') {
    el.checked ? picked.add(id) : picked.delete(id);
    if (S.compare) { if (!picked.size) exitCompare(); else { S.compare.hover = null; render(); renderCompareTable(); } }
    renderLibrary();
  } else if (act === 'open') openLift(id);
  else if (act === 'ghost') setGhost(S.ghost && S.ghost.id === id ? null : rec);
  else if (act === 'del') {
    if (!armed.has(id)) {
      el.textContent = 'Confirm delete'; el.classList.add('danger');
      armed.set(id, setTimeout(() => { armed.delete(id); el.textContent = 'Delete'; el.classList.remove('danger'); }, 4000));
      return;
    }
    clearTimeout(armed.get(id)); armed.delete(id);
    try {
      await db.deleteLift(id);
      picked.delete(id);
      const u = thumbURLs.get(id); if (u) URL.revokeObjectURL(u); thumbURLs.delete(id);
      if (S.recordId === id) { S.recordId = null; S.viewing = null; msg(''); }
      if (S.compare) { if (!picked.size) exitCompare(); else { render(); renderCompareTable(); } }
      libMsg(`Deleted ${title(rec)} from ${shortDate(rec.date)}.`);
      await refreshLibrary(); ui();
    } catch (err) { libMsg(`Could not delete: ${err.message || err}`, true); }
  }
});

$('btnDetVideo').onclick = async () => {
  const r = S.viewing; if (!r || busy()) return;
  const b = $('btnDetVideo');
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirm: remove video'; b.classList.add('danger'); setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Remove saved video'; b.classList.remove('danger'); }, 4000); return; }
  b.dataset.armed = ''; b.textContent = 'Remove saved video'; b.classList.remove('danger');
  const rec = { ...r, video: { ...r.video, saved: false }, updatedAt: new Date().toISOString() };
  await db.saveLift(rec, { video: null });
  S.viewing = rec; $('keepVideo').checked = false;
  libMsg('Video removed. The analysis and stills are kept.');
  await refreshLibrary();
};
$('btnDetClose').onclick = () => { S.viewing = null; S.recordId = null; msg(''); renderLibrary(); ui(); };
$('btnGhostOff').onclick = () => setGhost(null);
$('btnCompare').onclick = enterCompare;
$('btnCompareExit').onclick = () => exitCompare();
$('pullOnly').addEventListener('change', e => { if (S.compare) { S.compare.pullOnly = e.target.checked; S.compare.hover = null; render(); } });

$('btnExport').onclick = async () => {
  libMsg('Preparing backup…');
  try { download(await db.exportAll(), `bar-path-library-${today()}.json`); libMsg('Backup saved. It holds every lift and its stills; videos are left out.'); }
  catch (e) { libMsg(`Could not export: ${e.message || e}`, true); }
};
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  libMsg('Importing…');
  try { const r = await db.importAll(f); libMsg(`Imported ${r.added} new lift${r.added === 1 ? '' : 's'}${r.updated ? `, updated ${r.updated}` : ''}.`); await refreshLibrary(); }
  catch (err) { libMsg(err.message || String(err), true); }
});

/* Save-section state, called from app.ui(). */
export function libUi() {
  const src = S.src, still = src && src.kind === 'still';
  const tracked = S.points.some(Boolean);
  const canSave = !!src && !busy() && (still ? !!S.viewing : tracked);
  $('saveSec').hidden = !src || (!tracked && !still);
  $('btnSave').disabled = !canSave;
  $('btnSave').textContent = still ? 'Update details' : S.recordId ? 'Update saved lift' : 'Save to library';
  $('btnSaveNew').hidden = !S.recordId || still;
  $('btnSaveNew').disabled = !canSave;
  const kv = $('keepVideo'), lbl = $('keepVideoLbl');
  kv.disabled = !src || !src.file || still || busy();
  lbl.textContent = still ? 'Video not kept for this lift.'
    : src && src.file ? `Keep the video on this device (${bytes(src.file.size)})`
    : 'Keep the video on this device (not available for the sample clip)';
  $('saveHint').textContent = still ? 'Opened without its video, so only the date, weight and notes can change.'
    : S.recordId ? 'Updating replaces the saved analysis and stills with what is on screen now.'
    : 'Saves the path, readout, technique findings and stills of the key positions.';
  $('btnCompare').disabled = !picked.size || busy();
}
