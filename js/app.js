/*
 * app.js — Phase 1 UI. Wires the connect/disconnect button to the PM5 BLE
 * module and renders live metrics + a connection status indicator.
 */
(() => {
  const pm5 = new PM5();

  const $ = (id) => document.getElementById(id);
  const els = {
    connectBtn: $('connectBtn'),
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
  };

  /* Warn early if the browser can't do Web Bluetooth at all. */
  if (!navigator.bluetooth) {
    els.unsupported.hidden = false;
    els.connectBtn.disabled = true;
  }

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const setStatus = (text, state) => {
    els.statusText.textContent = text;
    els.statusDot.className = `dot ${state || ''}`;
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

  pm5.on('status', (text) => {
    const connected = pm5.isConnected;
    const connecting = /connecting|requesting/i.test(text);
    setStatus(text, connected ? 'ok' : (connecting ? 'pending' : 'off'));
    els.connectBtn.textContent = connected ? 'Disconnect' : 'Connect PM5';
    els.connectBtn.disabled = false;
    if (!connected && !connecting) els.deviceName.textContent = '';
  });

  pm5.on('device', ({ name }) => { els.deviceName.textContent = name || ''; });
  pm5.on('data', render);
  pm5.on('error', (err) => {
    console.error('[app]', err);
    setStatus(err.message, 'off');
    els.connectBtn.disabled = false;
  });

  els.connectBtn.addEventListener('click', async () => {
    els.connectBtn.disabled = true;
    try {
      if (pm5.isConnected) {
        await pm5.disconnect();
      } else {
        await pm5.connect();
      }
    } catch (err) {
      // User-cancelled chooser or connection failure — surface it, re-enable.
      if (err && err.name === 'NotFoundError') {
        setStatus('No device selected', 'off');
      } else {
        setStatus((err && err.message) || 'Connection failed', 'off');
      }
      els.connectBtn.disabled = false;
    }
  });

  setStatus('Not connected', 'off');
})();
