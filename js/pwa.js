import { $ } from './state.js';

/* Offline cache, install button and offline indicator. */

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

let deferred = null;
const btn = $('btnInstall'), help = $('installHelp');

function showButton() { btn.hidden = standalone() || (!deferred && !ios); }

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; showButton(); });
window.addEventListener('appinstalled', () => { deferred = null; help.hidden = true; showButton(); });

btn.addEventListener('click', async () => {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null; showButton();
  } else {
    help.hidden = !help.hidden;
  }
});
showButton();

const net = () => { $('offline').hidden = navigator.onLine; };
window.addEventListener('online', net);
window.addEventListener('offline', net);
net();
