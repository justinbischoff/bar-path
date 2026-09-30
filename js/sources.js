
/* ---------- Sources ---------- */

export function seekTo(v, t) {
  return new Promise(res => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    v.addEventListener('seeked', fin, { once: true });
    setTimeout(fin, 2000);
    v.currentTime = t;
  });
}

export function detectFps(v) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return Promise.resolve(null);
  return new Promise(res => {
    const times = []; let finished = false;
    const finish = () => {
      if (finished) return; finished = true; clearTimeout(to); v.pause();
      let d = Infinity;
      for (let i = 1; i < times.length; i++) { const x = times[i] - times[i - 1]; if (x > 0.002 && x < d) d = x; }
      if (!isFinite(d)) return res(null);
      const f = 1 / d;
      const common = [24, 25, 30, 48, 50, 60, 90, 100, 120, 240];
      const near = common.find(c => Math.abs(c - f) / c < 0.04);
      res(near || Math.round(f));
    };
    const cb = (now, md) => { times.push(md.mediaTime); if (times.length < 14) v.requestVideoFrameCallback(cb); else finish(); };
    v.requestVideoFrameCallback(cb);
    const to = setTimeout(finish, 2000);
    v.play().catch(finish);
  });
}

export async function videoSource(file) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = URL.createObjectURL(file);
  await new Promise((res, rej) => {
    v.onloadeddata = res;
    v.onerror = () => rej(new Error("This browser can't decode that file. Try an MP4 (H.264) or WebM video."));
  });
  if (!isFinite(v.duration)) { await seekTo(v, 1e7); await seekTo(v, 0); }
  const detected = await detectFps(v);
  await seekTo(v, 0);
  return {
    kind: 'video', el: v, name: file.name, W: v.videoWidth, H: v.videoHeight,
    fps: detected || 30, detected,
    get N() { return Math.max(1, Math.floor(v.duration * this.fps + 1e-6)); },
    frameTime(i) { return Math.min(v.duration - 0.001, (i + 0.5) / this.fps); },
    async seek(i) { await seekTo(v, this.frameTime(i)); },
    draw(ctx, w, h) { ctx.drawImage(v, 0, 0, w, h); },
  };
}

/* Synthetic snatch: a red bumper plate filmed side-on, lifter facing right. */
export function demoSource() {
  const W = 720, H = 960, FPS = 30, N = 84;
  const pxPerM = 436, floorY = 900, R = Math.round(0.225 * pxPerM), cx0 = 380;
  // [time s, horizontal m (+ = away from lifter), height m]
  const K = [[0, 0, 0], [0.4, 0, 0], [0.9, -0.045, 0.28], [1.2, -0.03, 0.55], [1.45, 0.045, 0.85],
             [1.65, 0.02, 1.02], [1.85, -0.035, 0.93], [2.1, -0.03, 0.87], [2.8, -0.03, 0.87]];
  const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  function at(t) {
    if (t >= K[K.length - 1][0]) return { x: K[K.length - 1][1], h: K[K.length - 1][2] };
    let k = 0; while (t >= K[k + 1][0]) k++;
    const u = (t - K[k][0]) / (K[k + 1][0] - K[k][0]);
    const a = K[Math.max(0, k - 1)], b = K[k], c = K[k + 1], d = K[Math.min(K.length - 1, k + 2)];
    return { x: cr(a[1], b[1], c[1], d[1], u), h: Math.max(0, cr(a[2], b[2], c[2], d[2], u)) };
  }
  const rand = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let cur = 0;
  function paint(ctx, i) {
    const p = at(i / FPS);
    const x = cx0 + p.x * pxPerM, y = floorY - R - p.h * pxPerM;
    const g = ctx.createLinearGradient(0, 0, 0, floorY);
    g.addColorStop(0, '#2b2f33'); g.addColorStop(1, '#1c1e21');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, floorY);
    ctx.fillStyle = '#3b4046';
    for (const rx of [70, 630]) {
      ctx.fillRect(rx, 80, 28, floorY - 80);
      ctx.fillStyle = '#23272b';
      for (let hy = 110; hy < floorY - 20; hy += 44) ctx.fillRect(rx + 10, hy, 8, 8);
      ctx.fillStyle = '#3b4046';
    }
    ctx.fillStyle = '#8a6a45'; ctx.fillRect(0, floorY, W, H - floorY);
    ctx.strokeStyle = '#6f5436'; ctx.lineWidth = 2;
    for (let px = 40; px < W; px += 120) { ctx.beginPath(); ctx.moveTo(px, floorY); ctx.lineTo(px, H); ctx.stroke(); }
    ctx.fillStyle = 'rgba(12,13,15,.85)';
    ctx.beginPath(); ctx.ellipse(x - 40, y - 40 - p.h * 60, 80, 190, 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    ctx.fillStyle = '#c8342a'; ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, 7); ctx.fill();
    ctx.strokeStyle = '#8f2119'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, R * 0.6, 0, 7); ctx.stroke();
    ctx.rotate(0.35 * p.h + 0.02 * i);
    ctx.fillStyle = '#f4f1ea';
    ctx.font = `700 ${Math.round(R * 0.26)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('25', 0, -R * 0.44); ctx.fillText('KG', 0, R * 0.46);
    ctx.fillRect(-R * 0.72, -R * 0.05, R * 0.3, R * 0.1); ctx.fillRect(R * 0.42, -R * 0.05, R * 0.3, R * 0.1);
    ctx.fillStyle = '#b9bdc1'; ctx.beginPath(); ctx.arc(0, 0, R * 0.28, 0, 7); ctx.fill();
    ctx.fillStyle = '#7f858a'; ctx.beginPath(); ctx.arc(0, 0, R * 0.16, 0, 7); ctx.fill();
    ctx.fillStyle = '#4d5256'; ctx.beginPath(); ctx.arc(0, 0, R * 0.07, 0, 7); ctx.fill();
    ctx.restore();
    const r = rand(1000 + i * 7919);
    for (let k = 0; k < 900; k++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.09)';
      ctx.fillRect(r() * W, r() * H, 2, 2);
    }
  }
  return {
    kind: 'demo', name: 'Sample clip · synthetic snatch', W, H, fps: FPS, N, R,
    start: { x: cx0, y: floorY - R },
    async seek(i) { cur = i; },
    draw(ctx, w, h) { ctx.save(); ctx.scale(w / W, h / H); paint(ctx, cur); ctx.restore(); },
  };
}
