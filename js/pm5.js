/*
 * pm5.js — Concept2 PM5 Bluetooth LE connection (as fitted to a BikeErg).
 *
 * Connects over Web Bluetooth, subscribes to the C2-proprietary erg data
 * stream, decodes packets (see pm5-parse.js) and emits one merged metrics
 * snapshot. Also owns the connection lifecycle: if the link drops mid-ride it
 * reconnects on its own, keeping the metrics it already has.
 *
 * The PM5 does NOT use the standard Fitness Machine Service (FTMS) as its
 * primary interface; it uses Concept2's own GATT services.
 *
 * Events (subscribe via .on(name, cb)):
 *   'state' ({state, detail, deviceName}) — state is one of
 *            idle | requesting | connecting | connected | reconnecting | disconnected
 *   'data'  (metrics)  — latest merged snapshot, emitted on every packet
 *   'error' (Error)
 */
import { C2, SAMPLE_RATE, PARSERS, toHex } from './pm5-parse.js';

/* Wait before each reconnect attempt. ~75 s in total, then give up. */
export const DEFAULT_RECONNECT_DELAYS_MS =
  [1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000, 10000, 10000];

export class PM5 {
  /**
   * @param {object} [opts]
   * @param {Bluetooth} [opts.bluetooth]  defaults to navigator.bluetooth
   * @param {number[]} [opts.reconnectDelaysMs]
   * @param {boolean} [opts.debug]  log every packet (raw hex + parsed)
   * @param {Console} [opts.log]
   */
  constructor({
    bluetooth = globalThis.navigator?.bluetooth,
    reconnectDelaysMs = DEFAULT_RECONNECT_DELAYS_MS,
    debug = false,
    log = console,
  } = {}) {
    this.bluetooth = bluetooth;
    this.reconnectDelaysMs = reconnectDelaysMs;
    this.debug = debug;
    this.log = log;

    this.device = null;
    this.state = 'idle';
    this._detail = '';
    this._listeners = {};
    this._subs = [];               // [{ch, handler}] — removed on every teardown
    this._userDisconnect = false;  // true = don't auto-reconnect
    this._reconnectTimer = null;
    this._recording = null;
    this._onDisconnected = () => this._handleDisconnected();

    /* Latest known values, merged across characteristics. Kept across
     * reconnects so a dropped link doesn't zero the ride. */
    this.metrics = {
      powerW: 0,        // watts (per-stroke, held between strokes)
      speedMps: 0,      // m/s
      speedKmh: 0,      // km/h
      cadence: 0,       // rpm (BikeErg) — PM5 "stroke rate"
      distanceM: 0,     // metres — authoritative race distance
      elapsedSec: 0,    // seconds
      dragFactor: 0,
      heartRate: 0,     // bpm (0 = no strap)
      strokeCount: 0,
      rowingState: 0,
      workoutState: 0,
    };
  }

  on(event, cb) { (this._listeners[event] ||= []).push(cb); return this; }
  _emit(event, payload) { (this._listeners[event] || []).forEach((cb) => cb(payload)); }

  get isConnected() { return this.state === 'connected' && !!this.device?.gatt?.connected; }

  _setState(state, detail = '') {
    if (state === this.state && detail === this._detail) return;
    this.state = state;
    this._detail = detail;
    this._emit('state', { state, detail, deviceName: this.device?.name || '' });
  }

  /* ---- public: connect / disconnect ---- */

  async connect() {
    if (!this.bluetooth) {
      const err = new Error('Web Bluetooth is not available. Use Chrome on Android/desktop over HTTPS or localhost.');
      this._emit('error', err);
      throw err;
    }
    if (['requesting', 'connecting', 'connected', 'reconnecting'].includes(this.state)) return;

    this._userDisconnect = false;
    this._setState('requesting');

    let device;
    try {
      /* PM5 advertises as "PM5 <serial>". The rowing service isn't always in
       * the advertisement, so filter by name and list the services we need
       * under optionalServices. */
      device = await this.bluetooth.requestDevice({
        filters: [{ namePrefix: 'PM5' }],
        optionalServices: [C2.ROWING_SERVICE, C2.DEVICE_INFO_SERVICE],
      });
    } catch (err) {
      this._setState('disconnected', err?.name === 'NotFoundError' ? 'No device selected' : (err?.message || 'Request failed'));
      throw err;
    }

    // Chrome may return the same device object every time: never double-bind.
    if (this.device && this.device !== device) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnected);
    }
    this.device = device;
    device.removeEventListener('gattserverdisconnected', this._onDisconnected);
    device.addEventListener('gattserverdisconnected', this._onDisconnected);

    this._setState('connecting', device.name);
    try {
      await this._open();
    } catch (err) {
      // Partial setup (e.g. GATT up but service missing): tear it all down.
      this._userDisconnect = true;
      this._unsubscribe();
      if (device.gatt.connected) device.gatt.disconnect();
      this._setState('disconnected', err.message || 'Connection failed');
      throw err;
    }
    this._setState('connected', device.name);
    this.log.log('[PM5] connected:', device.name, device.id);
  }

  async disconnect() {
    this._userDisconnect = true;
    this._cancelReconnect();
    this._unsubscribe();
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this._setState('disconnected');
  }

  /* ---- public: raw packet recording (for building test fixtures) ---- */

  startRecording() {
    this._recording = {
      startedAt: new Date().toISOString(),
      device: this.device?.name || null,
      packets: [],               // {t: ms since start, char: '0x31', hex}
    };
    this._recordStart = Date.now();
  }

  stopRecording() {
    const rec = this._recording;
    this._recording = null;
    return rec;
  }

  get isRecording() { return !!this._recording; }

  /* ---- lifecycle internals ---- */

  async _open() {
    this.server = await this.device.gatt.connect();
    await this._readDeviceInfo();
    await this._subscribeRowing();
  }

  _handleDisconnected() {
    this._unsubscribe();
    if (this.state === 'connected' && !this._userDisconnect) {
      this._scheduleReconnect(0);
      return;
    }
    // While connecting/reconnecting, whoever is mid-attempt handles failure.
    if (this.state === 'connecting' || this.state === 'reconnecting') return;
    this._setState('disconnected');
  }

  _scheduleReconnect(attempt) {
    const total = this.reconnectDelaysMs.length;
    if (attempt >= total) {
      this._setState('disconnected', 'Lost connection to PM5');
      return;
    }
    this._setState('reconnecting', `Attempt ${attempt + 1} of ${total}`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._userDisconnect) return;
      try {
        await this._open();
        if (this._userDisconnect) { this._unsubscribe(); this.device.gatt.disconnect(); return; }
        this._setState('connected', this.device.name);
        this.log.log('[PM5] reconnected on attempt', attempt + 1);
      } catch (err) {
        if (this._userDisconnect) return;
        this.log.warn('[PM5] reconnect attempt', attempt + 1, 'failed:', err.message);
        this._unsubscribe();
        if (this.device.gatt.connected) this.device.gatt.disconnect();
        this._scheduleReconnect(attempt + 1);
      }
    }, this.reconnectDelaysMs[attempt]);
  }

  _cancelReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _unsubscribe() {
    for (const { ch, handler } of this._subs) {
      ch.removeEventListener('characteristicvaluechanged', handler);
    }
    this._subs = [];
  }

  /* ---- device info (best-effort; failures are non-fatal) ---- */

  async _readDeviceInfo() {
    try {
      const svc = await this.server.getPrimaryService(C2.DEVICE_INFO_SERVICE);
      const dec = new TextDecoder();
      const read = async (uuid) => {
        try { return dec.decode(await (await svc.getCharacteristic(uuid)).readValue()).replace(/\0+$/, ''); }
        catch { return null; }
      };
      const [serial, hw, fw] = await Promise.all([
        read(C2.SERIAL_CHAR), read(C2.HW_REV_CHAR), read(C2.FW_REV_CHAR),
      ]);
      this.log.log('[PM5] device info — serial:', serial, 'hw:', hw, 'firmware:', fw);
    } catch (e) {
      this.log.warn('[PM5] device info unavailable:', e.message);
    }
  }

  /* ---- subscribe to the live data characteristics ---- */

  async _subscribeRowing() {
    this._unsubscribe();
    const svc = await this.server.getPrimaryService(C2.ROWING_SERVICE);

    // Status stream every 250 ms (best-effort — some firmware differs).
    try {
      const rate = await svc.getCharacteristic(C2.SAMPLE_RATE);
      await rate.writeValue(Uint8Array.of(SAMPLE_RATE.QUARTER_SEC));
    } catch (e) {
      this.log.warn('[PM5] could not set sample rate (using default):', e.message);
    }

    for (const uuid of Object.keys(PARSERS)) {
      const ch = await svc.getCharacteristic(uuid);
      const handler = (e) => this._onPacket(uuid, e.target.value);
      ch.addEventListener('characteristicvaluechanged', handler);
      this._subs.push({ ch, handler });
      await ch.startNotifications();
    }
  }

  _onPacket(uuid, dv) {
    const { tag, parse } = PARSERS[uuid];
    if (this._recording) {
      this._recording.packets.push({ t: Date.now() - this._recordStart, char: tag, hex: toHex(dv) });
    }
    try {
      const parsed = parse(dv);
      Object.assign(this.metrics, parsed);
      if (this.debug) this.log.log(`[PM5] ${tag} |`, toHex(dv), '=>', parsed);
      this._emit('data', this.metrics);
    } catch (err) {
      this.log.error('[PM5] parse error on', tag, err, toHex(dv));
      this._emit('error', err);
    }
  }
}
