import { S, clamp } from './state.js';

/* ---------- Body tracking (MediaPipe Pose) ---------- */

const poseCanvas = document.createElement('canvas');
const poseCtx = poseCanvas.getContext('2d');
const MP = new URL('../vendor/mediapipe/', import.meta.url).href;   // pinned copy of @mediapipe/tasks-vision 1.0.1
let poser = null, poseTs = 0;

async function makePoser(delegate) {
  const vision = await import('../vendor/mediapipe/vision_bundle.mjs');
  const lm = await vision.PoseLandmarker.createFromOptions({
    wasmLoaderPath: MP + 'wasm/vision_wasm_internal.js',
    wasmBinaryPath: MP + 'wasm/vision_wasm_internal.wasm',
  }, {
    baseOptions: { modelAssetPath: MP + 'pose_landmarker_full.task', delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
  });
  return { lm, delegate };
}

export async function getPoser() {
  if (poser) return poser;
  try { poser = await makePoser('GPU'); } catch (e) { poser = await makePoser('CPU'); }
  return poser;
}

/* Some GPUs load the model but fail on the first frame; retry on the CPU. */
export async function useCpu() {
  if (!poser || poser.delegate !== 'GPU') return false;
  try { poser.lm.close(); } catch (_) {}
  poser = await makePoser('CPU');
  return true;
}

export function detectPose(src) {
  const q = Math.min(1, 960 / Math.max(src.W, src.H));
  const w = Math.round(src.W * q), h = Math.round(src.H * q);
  if (poseCanvas.width !== w) poseCanvas.width = w;
  if (poseCanvas.height !== h) poseCanvas.height = h;
  src.draw(poseCtx, w, h);
  poseTs += Math.max(1, Math.round(1000 / src.fps));
  const r = poser.lm.detectForVideo(poseCanvas, poseTs);
  const L = r && r.landmarks && r.landmarks[0];
  return L ? L.map(p => ({ x: p.x * src.W, y: p.y * src.H, z: p.z || 0, v: p.visibility == null ? 1 : p.visibility })) : null;
}

export const SIDE = { ear: [7, 8], shoulder: [11, 12], elbow: [13, 14], wrist: [15, 16], hip: [23, 24], knee: [25, 26], ankle: [27, 28], heel: [29, 30], toe: [31, 32] };
export const TRIPLE = { elbow: ['shoulder', 'elbow', 'wrist'], hip: ['shoulder', 'hip', 'knee'], knee: ['hip', 'knee', 'ankle'] };

export function finishPose() {
  const P = S.pose, w = [1, 2, 3, 2, 1];
  S.poseS = [];
  for (let i = 0; i < P.length; i++) {
    if (!P[i]) continue;
    S.poseS[i] = P[i].map((p, k) => {
      let sx = 0, sy = 0, sw = 0;
      for (let j = -2; j <= 2; j++) { const q = P[i + j]; if (q) { sx += q[k].x * w[j + 2]; sy += q[k].y * w[j + 2]; sw += w[j + 2]; } }
      return { x: sx / sw, y: sy / sw, z: p.z, v: p.v };
    });
  }
  // near side = closer to the camera (smaller z), with visibility as a tie-break
  let z = [0, 0], face = 0;
  for (const L of S.poseS) {
    if (!L) continue;
    for (const n of ['shoulder', 'elbow', 'hip', 'knee', 'ankle']) for (const s of [0, 1]) z[s] += L[SIDE[n][s]].z - 0.2 * L[SIDE[n][s]].v;
    for (const s of [0, 1]) face += Math.sign(L[SIDE.toe[s]].x - L[SIDE.heel[s]].x);
    face += Math.sign(L[0].x - (L[7].x + L[8].x) / 2);
  }
  S.poseSide = z[0] <= z[1] ? 0 : 1;
  return face;
}

/* ---------- Technique checks ---------- */

export function jp(i, name) {
  const L = S.poseS[i]; if (!L) return null;
  return name === 'nose' ? L[0] : L[SIDE[name][S.poseSide]];
}
export function midfoot(i) { const h = jp(i, 'heel'), t = jp(i, 'toe'); return h && t ? { x: (h.x + t.x) / 2, y: (h.y + t.y) / 2 } : null; }
export function ang(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  return Math.acos(clamp((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1), -1, 1)) * 180 / Math.PI;
}
export function jointAng(i, j) { const [a, b, c] = TRIPLE[j].map(n => jp(i, n)); return a && b && c ? ang(a, b, c) : null; }
/* Torso lean in degrees from vertical; positive = shoulders ahead of the hips. */
export function lean(i) { const s = jp(i, 'shoulder'), h = jp(i, 'hip'); return s && h ? Math.atan2((s.x - h.x) * S.facing, h.y - s.y) * 180 / Math.PI : null; }
