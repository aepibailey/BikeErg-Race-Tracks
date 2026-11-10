/*
 * app.js — Phase 1 UI. Connect/disconnect, live metrics, connection state,
 * screen wake lock, and raw-packet recording for on-erg verification.
 *
 * Add ?debug=1 to the URL to log every packet (raw hex + parsed) to the
 * console.
 */
import { PM5 } from './pm5.js';

const debug = new URLSearchParams(location.search).has('debug');
const pm5 = new PM5({ debug });
window.pm5 = pm5; // handy from the DevTools console

const $ = (id) => document.getElementById(id);
const els = {
  connectBtn: $('connectBtn'),
  recordBtn:  $('recordBtn'),
  statusDot:  $('statusDot'),
  statusText: $('statusText'),
  deviceName: $('deviceName'),
  power:    $('power'),
  speed:    $('speed'),
  cadence:  $('cadence'),
  distance: $('distance'),
  time:     $('time'),
  drag:     $('drag'),
  hr:       $('hr'),
  strokes:  $('strokes'),
  unsupported: $('unsupported'),
  debugNote:   $('debugNote'),
};

if (!navigator.bluetooth) {
  els.unsupported.hidden = false;
  els.connectBtn.disabled = true;
}
els.debugNote.hidden = !debug;

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const render = (m) => {
  els.power.textContent    = Math.round(m.powerW);
  els.speed.textContent    = m.speedKmh.toFixed(1);
  els.cadence.textContent  = Math.round(m.cadence);
  els.distance.textContent = Math.round(m.distanceM);
  els.time.textContent     = fmtTime(m.elapsedSec);
  els.drag.textContent     = m.dragFactor || '–';
  els.hr.textContent       = m.heartRate ? Math.round(m.heartRate) : '–';
  els.strokes.textContent  = m.strokeCount;
};

/* ---- screen wake lock: keep the tablet awake while connected ---- */

let wakeLock = null;
const wantWakeLock = () => ['connected', 'reconnecting'].includes(pm5.state);

async function syncWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (wantWakeLock() && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!wantWakeLock() && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (err) {
    console.warn('[app] wake lock unavailable:', err.message);
  }
}
// The browser drops the lock whenever the tab is hidden; take it back.
document.addEventListener('visibilitychange', syncWakeLock);

/* ---- connection state → UI ---- */

const STATE_UI = {
  idle:         { dot: 'off',     text: 'Not connected',  btn: 'Connect PM5' },
  requesting:   { dot: 'pending', text: 'Choose your PM5…', btn: 'Connect PM5', busy: true },
  connecting:   { dot: 'pending', text: 'Connecting…',    btn: 'Connect PM5', busy: true },
  connected:    { dot: 'ok',      text: 'Connected',      btn: 'Disconnect' },
  reconnecting: { dot: 'pending', text: 'Connection lost — reconnecting…', btn: 'Disconnect' },
  disconnected: { dot: 'off',     text: 'Disconnected',   btn: 'Connect PM5' },
};

pm5.on('state', ({ state, detail, deviceName }) => {
  const ui = STATE_UI[state];
  els.statusDot.className = `dot ${ui.dot}`;
  els.statusText.textContent = ui.text;
  els.deviceName.textContent = [deviceName, detail].filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i).join(' · ');
  els.connectBtn.textContent = ui.btn;
  els.connectBtn.disabled = !!ui.busy;
  els.recordBtn.disabled = state !== 'connected' && !pm5.isRecording;
  syncWakeLock();
});

pm5.on('data', render);
pm5.on('error', (err) => {
  console.error('[app]', err);
  els.statusText.textContent = err.message;
});

els.connectBtn.addEventListener('click', async () => {
  try {
    if (['connected', 'reconnecting'].includes(pm5.state)) await pm5.disconnect();
    else await pm5.connect();
  } catch (err) {
    // Already reflected via the 'state' event; keep the console informative.
    console.warn('[app] connect failed:', err);
  }
});

/* ---- raw packet recording → downloadable JSON (future test fixture) ---- */

els.recordBtn.addEventListener('click', () => {
  if (!pm5.isRecording) {
    pm5.startRecording();
    els.recordBtn.textContent = 'Stop & download';
    els.recordBtn.classList.add('recording');
    return;
  }
  const rec = pm5.stopRecording();
  rec.parsedAtEnd = { ...pm5.metrics }; // what we decoded — compare with the PM5 screen
  const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pm5-capture-${rec.startedAt.replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  els.recordBtn.textContent = 'Record packets';
  els.recordBtn.classList.remove('recording');
  els.recordBtn.disabled = pm5.state !== 'connected';
});
