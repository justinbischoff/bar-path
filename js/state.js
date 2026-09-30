export const $ = id => document.getElementById(id);
export const view = $('view'), vctx = view.getContext('2d');

export const PLATES = [
  { name: '15 kg yellow', color: '#f2c230' },
  { name: '25 kg red', color: '#e5392b' },
  { name: '20 kg blue', color: '#2f80ed' },
  { name: '10 kg green', color: '#2fb457' },
  { name: 'Chalk white', color: '#f4f1ea' },
];
export const DESCENT = 'rgba(244,241,234,.92)';
export const BODY = '#6fe0ee';

export const S = {
  src: null, frame: 0, vk: 1,
  anchor: null, radius: 40, points: [],
  tracking: false, stop: false, playing: false, recording: false,
  facing: 1, lift: 'snatch', color: PLATES[0].color, lw: 7,
  plumb: true, grow: true, smooth: true, descent: true, scaleOn: true,
  pose: [], poseS: [], poseSide: 0, analysing: false, poseStop: false,
  tech: null, focus: null, showBody: true,
  recordId: null, viewing: null, compare: null, ghost: null, saving: false,
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const tick = () => new Promise(r => setTimeout(r, 0));
export const fix = v => (Math.round(v * 10) / 10).toFixed(1);

export const busy = () => S.tracking || S.analysing || S.recording || S.saving;
