import { $, PLATES, S, busy, clamp, tick, vctx, view } from './state.js';
import { demoSource, videoSource } from './sources.js';
import { cutPatch, grabGray, match, prepTpl } from './tracker.js';
import { analyse, pathPoints } from './path.js';
import { detectPose, finishPose, getPoser, useCpu } from './pose.js';
import { GROUPS, evaluate } from './checks.js';
import { drawOverlay } from './draw.js';
import './pwa.js';
import { drawCompareView, exitCompare, libUi, onSourceChange, refreshLibrary, renderLibrary } from './library.js';

async function track() {
  const src = S.src, a = S.anchor;
  if (!src || !a || busy()) return;
  if (S.playing) await pause();
  S.tracking = true; S.stop = false; setMsg(''); ui();
  const s = clamp(28 / S.radius, 0.1, 1);
  const ts = clamp(Math.round(1.5 * S.radius * s) | 1, 15, 61);
  await src.seek(a.frame); S.frame = a.frame;
  let img = grabGray(s);
  const raw = cutPatch(img, a.x * s, a.y * s, ts);
  const fail = m => { setMsg(m, true); S.tracking = false; ui(); render(); };
  if (!raw) return fail('The marked circle runs off the edge of the frame. Make it smaller or mark a point further in.');
  const tpl0 = prepTpl(raw);
  if (tpl0.n2 < ts * ts * 4) return fail('The marked spot has almost no detail to follow. Centre the circle on the sleeve end and plate.');
  let tpl = tpl0;
  S.points.length = a.frame;
  S.points[a.frame] = { x: a.x, y: a.y, score: 1 };
  let prev = { x: a.x * s, y: a.y * s }, vel = { x: 0, y: 0 }, low = 0, lastGood = a.frame, lost = false;
  for (let i = a.frame + 1; i < src.N; i++) {
    if (S.stop) break;
    await src.seek(i); S.frame = i;
    img = grabGray(s);
    const pred = { x: prev.x + vel.x, y: prev.y + vel.y };
    const R = Math.min(48, Math.round(Math.max(8, ts * 0.3) + Math.hypot(vel.x, vel.y)));
    let m = match(img, tpl, ts, pred.x, pred.y, R);
    if (!m || m.score < 0.6) {
      const m0 = match(img, tpl0, ts, pred.x, pred.y, R);
      if (m0 && (!m || m0.score > m.score)) m = m0;
    }
    if (!m || m.score < 0.35) {
      if (++low >= 5) { lost = true; break; }
      S.points[i] = { x: pred.x / s, y: pred.y / s, score: m ? m.score : 0, low: true };
      prev = pred;
    } else {
      low = 0; lastGood = i;
      vel = { x: m.x - prev.x, y: m.y - prev.y };
      prev = { x: m.x, y: m.y };
      S.points[i] = { x: m.x / s, y: m.y / s, score: m.score };
      if (m.score > 0.8) {
        const np = cutPatch(img, m.x, m.y, ts);
        if (np) { for (let k = 0; k < raw.length; k++) raw[k] = 0.85 * raw[k] + 0.15 * np[k]; tpl = prepTpl(raw); }
      }
    }
    $('bar').style.width = ((i - a.frame) / Math.max(1, src.N - 1 - a.frame) * 100) + '%';
    render();
    if (src.kind === 'demo') await tick();
  }
  S.points.length = lastGood + 1;
  S.tracking = false;
  const n = S.points.filter(Boolean).length;
  refreshTech();
  if (lost) {
    setMsg(`Lost the bar after frame ${lastGood}. Go to that frame, click the bar end again, and track from there.`, true);
    await goto(lastGood);
  } else {
    setMsg(S.stop ? `Stopped. ${n} frames tracked.` : `Tracked ${n} frames.`);
    render();
  }
  ui();
}

function fmt(px, signed) {
  const mm = S.scaleOn ? 225 / S.radius : 0;
  if (mm) {
    const v = px * mm / 10;
    return `${(signed ? Math.abs(v) : v).toFixed(1)}<small> cm</small>`;
  }
  return `${Math.round(signed ? Math.abs(px) : px)}<small> px</small>`;
}
const dirWord = d => d > 0.5 ? 'away' : d < -0.5 ? 'toward' : '';

function renderStats() {
  const a = analyse(pathPoints());
  const el = $('stats');
  if (!a) {
    el.innerHTML = '<div class="wide"><dd class="note" style="font:inherit">Track a lift to see how far the bar drifts from vertical.</dd></div>';
    $('statsNote').textContent = '';
    return;
  }
  const cd = dirWord(a.catchD), jd = a.jerkD == null ? '' : dirWord(a.jerkD);
  el.innerHTML = `
    <div><dt>Toward lifter</dt><dd>${fmt(a.toward)}</dd></div>
    <div><dt>Away from lifter</dt><dd>${fmt(a.away)}</dd></div>
    <div><dt>Pull height</dt><dd>${fmt(a.height)}</dd></div>
    <div><dt>Drop to catch</dt><dd>${fmt(a.drop)}</dd></div>
    <div><dt>Catch vs start</dt><dd>${fmt(a.catchD, true)}${cd ? `<small> ${cd}</small>` : ''}</dd></div>
    <div><dt>Horizontal range</dt><dd>${fmt(a.range)}</dd></div>
    ${a.jerkD == null ? '' : `<div class="wide"><dt>Jerk: lockout vs dip</dt><dd>${fmt(a.jerkD, true)}${jd ? `<small> ${jd}</small>` : ''}</dd></div>`}
    <div class="wide"><dt>Frames</dt><dd style="font-size:14px">${a.count} tracked${a.lowCount ? ` · ${a.lowCount} low confidence` : ''} · pull peaks f ${a.peak}, catch f ${a.catchIdx}</dd></div>`;
  $('statsNote').textContent = S.lift === 'cj'
    ? (a.jerk ? 'Horizontal figures cover the clean, from the floor to the catch. The jerk is measured separately.' : 'Horizontal figures cover the clean. No jerk found in the tracked frames; track through the lockout to include it.')
    : 'Horizontal figures cover the lift from the floor to the bottom of the catch.';
}

async function runPose() {
  const src = S.src;
  const first = S.points.findIndex(Boolean), last = S.points.length - 1;
  if (!src || first < 0 || busy()) return;
  if (S.playing) await pause();
  S.analysing = true; S.poseStop = false; ui();
  const msg = (t, warn) => { const m = $('poseMsg'); m.textContent = t; m.classList.toggle('warn', !!warn); };
  msg('Loading the body-tracking model…');
  try { await getPoser(); }
  catch (e) {
    S.analysing = false; ui();
    msg(`Could not load the body-tracking model (${e.message || e}). Reload the page and try again.`, true);
    return;
  }
  msg('Finding the lifter on each tracked frame…');
  let found = 0, done = 0;
  try {
    for (let i = first; i <= last; i++) {
      if (S.poseStop) break;
      if (!S.pose[i]) {
        await src.seek(i); S.frame = i;
        let L;
        try { L = detectPose(src); }
        catch (e) {
          if (!(await useCpu())) throw e;
          L = detectPose(src);
        }
        S.pose[i] = L; S.poseS[i] = L;
        render();
      }
      if (S.pose[i]) found++;
      done++;
      $('poseBar').style.width = (done / (last - first + 1) * 100) + '%';
      await tick();
    }
  } catch (e) {
    S.analysing = false; ui();
    msg(/webgl|activeTexture/i.test(String(e && e.message))
      ? 'Body tracking needs WebGL, which is turned off or unavailable in this browser. Try Chrome, Edge or Safari with hardware acceleration on.'
      : `Body tracking stopped: ${e.message || e}`, true);
    return;
  }
  const face = finishPose();
  S.analysing = false;
  if (!found) {
    msg('No lifter found in the tracked frames. The whole body needs to be in shot, side-on.', true);
  } else {
    let t = `Body found on ${found} of ${done} frames.`;
    if (face !== 0) { setFacing(face > 0 ? 1 : -1, true); t += ` Lifter faces ${face > 0 ? 'right' : 'left'}.`; }
    msg(t);
  }
  refreshTech();
  await goto(S.frame);
  ui();
}

export function refreshTech() {
  S.tech = S.points.some(Boolean) ? evaluate() : null;
  if (S.tech && S.tech.checks && !S.tech.checks.some(c => c.id === S.focus)) S.focus = null;
  renderTech();
}

const LABEL = { fault: 'Fault', watch: 'Watch', good: 'Good', info: 'Info', na: 'n/a' };
function renderTech() {
  const el = $('findings'), t = S.tech, count = $('techCount');
  count.textContent = '';
  if (!t) { el.innerHTML = '<p class="note">Nothing to check yet.</p>'; return; }
  if (t.error) { el.innerHTML = `<p class="note warn">${t.error}</p>`; return; }
  const n = s => t.checks.filter(c => c.status === s).length;
  if (n('fault')) count.textContent = n('fault');
  let html = `<div class="tally">
    <span class="pill fault">${n('fault')} fault${n('fault') === 1 ? '' : 's'}</span>
    <span class="pill watch">${n('watch')} to watch</span>
    <span class="pill good">${n('good')} good</span>
    ${n('na') ? `<span class="pill na">${n('na')} not checked</span>` : ''}</div>`;
  for (const g of GROUPS) {
    const items = t.checks.filter(c => c.group === g);
    if (!items.length) continue;
    html += `<h3>${g}</h3><ul class="findings">` + items.map(c => `
      <li><button class="finding" data-id="${c.id}" aria-current="${c.id === S.focus}">
        <span class="pill ${c.status}">${LABEL[c.status]}</span>
        <span class="t">${c.title}</span>
        <span class="f">${c.frame == null ? '' : 'f ' + c.frame}</span>
        <span class="d">${c.text}</span>
      </button></li>`).join('') + '</ul>';
  }
  el.innerHTML = html;
}

$('findings').addEventListener('click', async e => {
  const b = e.target.closest('.finding'); if (!b || busy()) return;
  const c = S.tech.checks.find(x => x.id === b.dataset.id);
  S.focus = S.focus === c.id && S.frame === c.frame ? null : c.id;
  $('findings').querySelectorAll('.finding').forEach(x => x.setAttribute('aria-current', x.dataset.id === S.focus));
  if (S.playing) await pause();
  if (c.frame != null) await goto(c.frame); else render();
});

/* ---------- Drawing ---------- */

export function render() {
  const src = S.src; if (!src) return;
  if (S.compare) { drawCompareView(); return; }
  src.draw(vctx, view.width, view.height);
  drawOverlay();
  updateTransport();
}

/* ---------- Transport ---------- */


let wantFrame = null, seeking = false;
export async function goto(i) {
  if (!S.src) return;
  wantFrame = clamp(Math.round(i), 0, S.src.N - 1);
  if (seeking) return;
  seeking = true;
  while (wantFrame !== null) {
    const f = wantFrame; wantFrame = null;
    await S.src.seek(f); S.frame = f; render();
  }
  seeking = false;
  ui();
}

let playDone = null;
async function play() {
  const src = S.src;
  if (!src || S.tracking || S.analysing || S.playing) return;
  if (S.frame >= src.N - 1) await goto(0);
  S.playing = true; ui();
  const rate = +$('speed').value;
  const done = new Promise(r => { playDone = r; });
  if (src.kind === 'video') {
    const v = src.el;
    v.playbackRate = rate;
    try { await v.play(); } catch (e) { S.playing = false; ui(); playDone(); return done; }
    const loop = () => {
      if (!S.playing) return;
      S.frame = clamp(Math.floor(v.currentTime * src.fps + 1e-3), 0, src.N - 1);
      render();
      if (v.ended || S.frame >= src.N - 1) { pause(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } else {
    const f0 = S.frame, t0 = performance.now();
    const loop = () => {
      if (!S.playing) return;
      const f = Math.min(src.N - 1, f0 + Math.floor((performance.now() - t0) / 1000 * src.fps * rate));
      if (f !== S.frame) { S.frame = f; src.seek(f); render(); }
      if (f >= src.N - 1) { pause(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return done;
}

export async function pause() {
  if (!S.playing) return;
  S.playing = false;
  if (S.src.kind === 'video') S.src.el.pause();
  await goto(S.frame);
  if (playDone) { playDone(); playDone = null; }
}

function updateTransport() {
  const src = S.src; if (!src) return;
  const sc = $('scrub');
  sc.max = src.N - 1;
  if (!seeking || S.playing || S.tracking || S.analysing) sc.value = S.frame;
  $('counter').textContent = src.label ? `${src.label(S.frame)} · ${S.frame + 1}/${src.N}` : `f ${S.frame}/${src.N - 1} · ${(S.frame / src.fps).toFixed(2)} s`;
  if (S.tracking) $('chip').textContent = `Tracking the bar · frame ${S.frame} of ${src.N - 1}`;
  else if (S.analysing) $('chip').textContent = `Tracking the body · frame ${S.frame}`;
}

/* ---------- UI ---------- */

export function setMsg(text, warn) { const m = $('trackMsg'); m.textContent = text; m.classList.toggle('warn', !!warn); }

export function ui() {
  const has = !!S.src, b = busy(), working = S.tracking || S.analysing;
  $('btnPlay').textContent = S.playing ? 'Pause' : 'Play';
  const still = has && S.src.kind === 'still';
  for (const id of ['btnPrev', 'btnNext', 'scrub']) $(id).disabled = !has || working || !!S.compare;
  for (const id of ['btnPlay', 'speed']) $(id).disabled = !has || working || !!S.compare || still;
  $('file').disabled = b; $('fps').disabled = b || !has || S.src.kind !== 'video';
  $('btnTrack').disabled = !S.anchor || b;
  $('btnTrack').textContent = S.anchor ? `Track from frame ${S.anchor.frame}` : 'Track';
  $('btnStop').hidden = !S.tracking;
  const tracked = S.points.some(Boolean);
  $('btnPose').disabled = !tracked || b;
  $('btnPoseStop').hidden = !S.analysing;
  if (!tracked) { $('poseMsg').textContent = 'Track the bar on the Bar path tab first.'; $('poseMsg').classList.remove('warn'); }
  else if ($('poseMsg').textContent.startsWith('Track the bar')) $('poseMsg').textContent = 'Ready. This takes a few seconds per hundred frames.';
  $('btnPng').disabled = $('btnRec').disabled = !has || b;
  $('btnRec').textContent = S.recording ? 'Recording…' : 'Save video';
  $('screen').classList.toggle('busy', working);
  const chip = $('chip');
  chip.hidden = !!S.compare;
  if (has && !working) {
    chip.classList.remove('warn');
    chip.textContent = S.compare ? 'Comparing saved lifts' : still ? `Saved lift · ${S.src.name}` : `${S.src.name} · ${S.src.W}×${S.src.H} · ${S.src.fps} fps`;
  }
  $('hint').innerHTML = !has ? '' :
    S.compare ? 'Hover a path to read its height and drift. Pick lifts in the Library to add or remove them.' :
    still ? 'Saved without its video. Step through the saved positions with ‹ and ›.' :
    S.tracking ? 'Following the bar end frame by frame.' :
    S.analysing ? 'Finding the lifter on each frame.' :
    !S.anchor && !tracked ? 'Scrub to the start of the lift, then click the centre of the bar end and drag to the plate rim.' :
    !tracked ? 'Press <b>Track</b> in step 3.' :
    'Play to watch the path draw in. If the circle drifts off the bar, click the bar end on that frame and track again from there. <kbd>←</kbd> <kbd>→</kbd> step · <kbd>Space</kbd> play';
  if (!working) renderStats();
  libUi();
}

export function setSource(src) {
  exitCompare(true);
  S.src = src; S.frame = 0; S.points = []; S.anchor = null;
  S.recordId = null; S.viewing = null;
  S.pose = []; S.poseS = []; S.tech = null; S.focus = null;
  S.vk = Math.min(1, 1280 / Math.max(src.W, src.H));
  view.width = Math.round(src.W * S.vk); view.height = Math.round(src.H * S.vk);
  const rmax = Math.round(Math.min(src.W, src.H) / 3);
  $('radius').max = rmax;
  setRadius(src.R || clamp(Math.round(Math.min(src.W, src.H) * 0.08), 8, rmax));
  $('bar').style.width = '0'; $('poseBar').style.width = '0';
  renderTech();
  onSourceChange(src);
  renderLibrary();
}

export function setRadius(r) { S.radius = r; $('radius').value = r; $('radiusOut').textContent = `${Math.round(r)} px`; }

export function setFacing(f, quiet) {
  S.facing = f;
  $('faceL').setAttribute('aria-pressed', f < 0); $('faceR').setAttribute('aria-pressed', f > 0);
  if (!quiet) { refreshTech(); render(); ui(); }
}

export function setTab(t) {
  for (const [tab, panel, key] of [['tabPath', 'panelPath', 'path'], ['tabTech', 'panelTech', 'tech'], ['tabLib', 'panelLib', 'lib']]) {
    $(tab).setAttribute('aria-selected', t === key); $(panel).hidden = t !== key;
  }
}

export function setLift(l, quiet) {
  S.lift = l;
  $('liftSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.lift === l));
  if (!quiet) { refreshTech(); render(); ui(); }
}

async function loadFile(file) {
  if (!file || busy()) return;
  if (S.playing) await pause();
  const chip = $('chip');
  chip.classList.remove('warn');
  chip.textContent = `Opening ${file.name}…`;
  try {
    const src = await videoSource(file);
    setSource(src);
    const sel = $('fps');
    if (![...sel.options].some(o => +o.value === src.fps)) sel.add(new Option(`${src.fps} fps`, src.fps));
    sel.value = src.fps;
    $('fpsNote').textContent = src.detected
      ? `Detected ${src.detected} fps. Slow-motion phone clips often play back at 30; change it if the timing looks wrong.`
      : 'Could not detect the frame rate; set it to match your camera.';
    setMsg('Tracking runs frame by frame in your browser.');
    setTab('path');
    await goto(0);
    ui();
  } catch (e) {
    ui();
    chip.textContent = e.message; chip.classList.add('warn');
  }
}

function toSrc(e) {
  const r = view.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * view.width / S.vk, y: (e.clientY - r.top) / r.height * view.height / S.vk };
}

let drag = false;
view.addEventListener('pointerdown', async e => {
  if (!S.src || busy() || S.compare || S.src.kind === 'still') return;
  if (S.playing) await pause();
  const p = toSrc(e);
  S.anchor = { x: p.x, y: p.y, frame: S.frame };
  drag = true; view.setPointerCapture(e.pointerId);
  render(); ui();
});
view.addEventListener('pointermove', e => {
  if (!drag || !S.anchor) return;
  const p = toSrc(e), d = Math.hypot(p.x - S.anchor.x, p.y - S.anchor.y);
  if (d > 6 / S.vk) { setRadius(clamp(d, 8, +$('radius').max)); render(); }
});
const endDrag = () => { if (drag) { drag = false; refreshTech(); ui(); } };
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);

$('file').addEventListener('change', e => loadFile(e.target.files[0]));
const screen = $('screen');
screen.addEventListener('dragover', e => { e.preventDefault(); $('drop').hidden = false; });
screen.addEventListener('dragleave', e => { if (!screen.contains(e.relatedTarget)) $('drop').hidden = true; });
screen.addEventListener('drop', e => { e.preventDefault(); $('drop').hidden = true; loadFile(e.dataTransfer.files[0]); });

$('btnPlay').onclick = () => S.playing ? pause() : play();
$('btnPrev').onclick = async () => { if (S.playing) await pause(); goto(S.frame - 1); };
$('btnNext').onclick = async () => { if (S.playing) await pause(); goto(S.frame + 1); };
$('scrub').addEventListener('input', async e => { if (S.playing) await pause(); goto(+e.target.value); });
$('btnTrack').onclick = track;
$('btnStop').onclick = () => { S.stop = true; };
$('btnPose').onclick = runPose;
$('btnPoseStop').onclick = () => { S.poseStop = true; };
$('tabPath').onclick = () => setTab('path');
$('tabTech').onclick = () => setTab('tech');
$('tabLib').onclick = () => setTab('lib');
$('fps').addEventListener('change', async e => {
  if (!S.src || S.src.kind !== 'video') return;
  S.src.fps = +e.target.value; S.points = []; S.anchor = null; S.pose = []; S.poseS = [];
  setMsg('Frame rate changed. Mark the bar end again.');
  refreshTech();
  await goto(0); ui();
});
$('liftSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (b) setLift(b.dataset.lift);
});
$('radius').addEventListener('input', e => { setRadius(+e.target.value); render(); });
$('radius').addEventListener('change', () => { refreshTech(); ui(); });
$('scaleOn').addEventListener('change', e => { S.scaleOn = e.target.checked; ui(); });
for (const id of ['plumb', 'grow', 'descent']) $(id).addEventListener('change', e => { S[id] = e.target.checked; render(); });
$('smooth').addEventListener('change', e => { S.smooth = e.target.checked; refreshTech(); render(); ui(); });
$('showBody').addEventListener('change', e => { S.showBody = e.target.checked; render(); });
$('lw').addEventListener('input', e => { S.lw = +e.target.value; $('lwOut').textContent = `${S.lw} px`; render(); });
$('faceL').onclick = () => setFacing(-1);
$('faceR').onclick = () => setFacing(1);

const sw = $('swatches');
PLATES.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.style.background = p.color; b.title = p.name;
  b.setAttribute('aria-label', p.name); b.setAttribute('aria-pressed', i === 0);
  b.onclick = () => { S.color = p.color; sw.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', x === b)); render(); };
  sw.appendChild(b);
});

document.addEventListener('keydown', e => {
  if (!S.src || S.tracking || S.analysing || S.compare || e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); $('btnPrev').click(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); $('btnNext').click(); }
  else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); $('btnPlay').click(); }
});
window.addEventListener('resize', () => { if (!S.playing && !S.tracking && !S.analysing) render(); });

/* ---------- Export ---------- */

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const baseName = () => (S.src.name || 'lift').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
$('btnPng').onclick = () => view.toBlob(b => b && download(b, `${baseName()}-bar-path.png`), 'image/png');
$('btnRec').onclick = async () => {
  if (!S.src || !window.MediaRecorder || !view.captureStream) { $('exportNote').textContent = 'This browser cannot record the canvas.'; return; }
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(view.captureStream(Math.min(60, S.src.fps)), { mimeType: type, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => { rec.onstop = r; });
  S.recording = true; ui();
  const first = S.points.findIndex(Boolean);
  await goto(Math.max(0, first));
  rec.start();
  await play();
  rec.stop(); await stopped;
  S.recording = false; ui();
  download(new Blob(chunks, { type: rec.mimeType }), `${baseName()}-bar-path.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
};
$('exportNote').textContent = 'Save video replays the lift at the chosen speed and records it.';

/* ---------- Start with the sample ---------- */

refreshLibrary();

(async () => {
  const demo = demoSource();
  setSource(demo);
  S.anchor = { x: demo.start.x, y: demo.start.y, frame: 0 };
  await goto(0);
  ui();
  await track();
  S.anchor = null;
  await goto(demo.N - 1);
})();
