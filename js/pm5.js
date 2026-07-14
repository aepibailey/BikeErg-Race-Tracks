/*
 * pm5.js — Concept2 PM5 Bluetooth LE interface (Phase 1)
 *
 * Connects to a Concept2 PM5 monitor (as fitted to a BikeErg) over Web
 * Bluetooth, subscribes to the C2-proprietary rowing/erg data stream, parses
 * the raw bytes, and emits normalised metrics.
 *
 * ---------------------------------------------------------------------------
 * SPEC SOURCE
 * ---------------------------------------------------------------------------
 * The PM5 does NOT use the standard Bluetooth Fitness Machine Service (FTMS)
 * as its primary interface. It uses Concept2's own GATT services, documented
 * in "PM5 Bluetooth Smart Interface Definition" (Concept2). The UUIDs and byte
 * layouts below were cross-checked against several independent open-source
 * implementations that agree with each other (go-row, ErgometerJS,
 * ergarcade/pm5-base, qdomyos-zwift, Concept2-SDK).
 *
 * All multi-byte integers are LITTLE-ENDIAN. "u24" = 3-byte unsigned int.
 *
 * ---------------------------------------------------------------------------
 * !! ASSUMPTIONS TO SANITY-CHECK ON THE PHYSICAL BIKEERG (first test) !!
 * ---------------------------------------------------------------------------
 *  A. CADENCE: On a BikeErg, the "Stroke Rate" field (SPM) reported by the
 *     PM5 is the pedal cadence in RPM. We surface it directly as `cadence`.
 *     -> Verify our cadence matches the RPM the PM5 shows on screen.
 *  B. POWER: Instantaneous watts come from the "Additional Stroke Data"
 *     characteristic (0x0036, bytes 3-4). This updates ONCE PER PEDAL STROKE,
 *     so at low cadence it refreshes slowly — this is exactly how the PM5's
 *     own watts number behaves. Between strokes we hold the last value.
 *     -> Verify watts matches the PM5 display while pedalling steadily.
 *  C. SPEED: Reported in 0.001 m/s (0x0032 bytes 3-4). The BikeErg models a
 *     virtual bike, so this is the simulated road speed. We expose m/s and a
 *     km/h convenience value.
 *     -> Verify km/h is sane vs. the PM5's pace/speed display.
 *  D. DISTANCE / ELAPSED TIME: 0x0031 — distance in 0.1 m, time in 0.01 s.
 *     -> Verify against the PM5's distance and time.
 *
 * Everything parsed is also console.log'd (raw hex + parsed) for debugging.
 */

/* ---- C2 GATT UUIDs (all share base ...-43E5-11E4-916C-0800200C9A66) ---- */
const C2 = {
  // Device Information service (optional; used for serial/firmware readout)
  DEVICE_INFO_SERVICE: 'ce060010-43e5-11e4-916c-0800200c9a66',
  SERIAL_CHAR:         'ce060012-43e5-11e4-916c-0800200c9a66',
  HW_REV_CHAR:         'ce060013-43e5-11e4-916c-0800200c9a66',
  FW_REV_CHAR:         'ce060014-43e5-11e4-916c-0800200c9a66',
  MANUFACTURER_CHAR:   'ce060015-43e5-11e4-916c-0800200c9a66',

  // C2 "PM Rowing" service — the live data stream
  ROWING_SERVICE:      'ce060030-43e5-11e4-916c-0800200c9a66',
  GENERAL_STATUS:      'ce060031-43e5-11e4-916c-0800200c9a66', // 0x0031
  ADDITIONAL_STATUS_1: 'ce060032-43e5-11e4-916c-0800200c9a66', // 0x0032
  ADDITIONAL_STATUS_2: 'ce060033-43e5-11e4-916c-0800200c9a66', // 0x0033
  SAMPLE_RATE:         'ce060034-43e5-11e4-916c-0800200c9a66', // 0x0034 (write)
  STROKE_DATA:         'ce060035-43e5-11e4-916c-0800200c9a66', // 0x0035
  ADD_STROKE_DATA:     'ce060036-43e5-11e4-916c-0800200c9a66', // 0x0036 (power)
};

/* Sample-rate values written to 0x0034 (controls status stream cadence).
 * 0 = 1 s, 1 = 500 ms, 2 = 250 ms, 3 = 100 ms. We use 250 ms for a
 * responsive-but-light stream on older hardware. */
const SAMPLE_RATE = { ONE_SEC: 0, HALF_SEC: 1, QUARTER_SEC: 2, TENTH_SEC: 3 };

/* Human-readable rowing/erg state (0x0031 byte 9). */
const ROWING_STATE = ['Inactive', 'Active'];
const WORKOUT_STATE = [
  'WaitToBegin', 'WorkoutRow', 'CountdownPause', 'IntervalRest',
  'IntervalWorkTime', 'IntervalWorkDistance', 'IntervalRestEndToWorkTime',
  'IntervalRestEndToWorkDistance', 'IntervalWorkTimeToRest',
  'IntervalWorkDistanceToRest', 'WorkoutEnd', 'Terminate', 'WorkoutLogged',
  'Rearm',
];

/* ---- little-endian byte helpers over a DataView ---- */
const u8  = (dv, i) => dv.getUint8(i);
const u16 = (dv, i) => dv.getUint8(i) | (dv.getUint8(i + 1) << 8);
const u24 = (dv, i) => dv.getUint8(i) | (dv.getUint8(i + 1) << 8) | (dv.getUint8(i + 2) << 16);

const toHex = (dv) =>
  Array.from({ length: dv.byteLength }, (_, i) =>
    dv.getUint8(i).toString(16).padStart(2, '0')).join(' ');

/*
 * PM5 — tiny event-emitting wrapper around the BLE connection.
 *
 * Events (subscribe via .on(name, cb)):
 *   'status'  (string)  — connection status text
 *   'data'    (metrics) — latest merged metric snapshot (see #metrics)
 *   'error'   (Error)
 *   'device'  ({name})  — device identity once connected
 */
class PM5 {
  constructor() {
    this.device = null;
    this.server = null;
    this._listeners = { status: [], data: [], error: [], device: [] };

    /* Latest known values, merged across the three characteristics. Each
     * characteristic notifies independently, so we keep one running snapshot
     * and emit it whenever any piece updates. */
    this.metrics = {
      powerW: 0,        // watts (per-stroke, held between strokes)
      speedMps: 0,      // m/s
      speedKmh: 0,      // km/h (derived)
      cadence: 0,       // rpm (BikeErg) — PM5 "stroke rate"
      distanceM: 0,     // metres
      elapsedSec: 0,    // seconds
      dragFactor: 0,    // C2 drag factor
      heartRate: 0,     // bpm (0/255 = none)
      strokeCount: 0,
      rowingState: 0,
      workoutState: 0,
    };
  }

  on(event, cb) { (this._listeners[event] ||= []).push(cb); return this; }
  _emit(event, payload) { (this._listeners[event] || []).forEach((cb) => cb(payload)); }

  get isConnected() { return !!(this.device && this.device.gatt && this.device.gatt.connected); }

  /* ---- connect / disconnect ---- */

  async connect() {
    if (!navigator.bluetooth) {
      const err = new Error('Web Bluetooth is not available. Use Chrome on Android/desktop over HTTPS or localhost.');
      this._emit('error', err);
      throw err;
    }

    this._emit('status', 'Requesting device…');
    /* PM5 advertises with a "PM5" name prefix. The rowing service UUID is not
     * always in the advertisement, so we filter by name and declare the
     * services we need under optionalServices to gain access post-connect. */
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'PM5' }],
      optionalServices: [C2.ROWING_SERVICE, C2.DEVICE_INFO_SERVICE],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this._emit('status', 'Disconnected');
      this._emit('device', { name: null });
    });

    this._emit('status', `Connecting to ${this.device.name}…`);
    this.server = await this.device.gatt.connect();
    this._emit('device', { name: this.device.name });

    await this._readDeviceInfo();
    await this._subscribeRowing();

    this._emit('status', `Connected to ${this.device.name}`);
    console.log('[PM5] connected:', this.device.name, this.device.id);
  }

  async disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this._emit('status', 'Disconnected');
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
      console.log('[PM5] device info — serial:', serial, 'hw:', hw, 'firmware:', fw);
    } catch (e) {
      console.warn('[PM5] device info unavailable:', e.message);
    }
  }

  /* ---- subscribe to the live data characteristics ---- */

  async _subscribeRowing() {
    const svc = await this.server.getPrimaryService(C2.ROWING_SERVICE);

    // Set the status stream sample rate (best-effort — some firmware differs).
    try {
      const rate = await svc.getCharacteristic(C2.SAMPLE_RATE);
      await rate.writeValue(Uint8Array.of(SAMPLE_RATE.QUARTER_SEC));
      console.log('[PM5] sample rate set to 250 ms');
    } catch (e) {
      console.warn('[PM5] could not set sample rate (using default):', e.message);
    }

    await this._startNotify(svc, C2.GENERAL_STATUS,      (dv) => this._parseGeneralStatus(dv));
    await this._startNotify(svc, C2.ADDITIONAL_STATUS_1, (dv) => this._parseAdditionalStatus1(dv));
    await this._startNotify(svc, C2.ADD_STROKE_DATA,     (dv) => this._parseAdditionalStrokeData(dv));
  }

  async _startNotify(service, uuid, handler) {
    const ch = await service.getCharacteristic(uuid);
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const dv = e.target.value;
      try {
        handler(dv);
        this._emit('data', this.metrics);
      } catch (err) {
        console.error('[PM5] parse error on', uuid, err, toHex(dv));
        this._emit('error', err);
      }
    });
    await ch.startNotifications();
    console.log('[PM5] subscribed to', uuid);
  }

  /* ---- parsers (offsets straight from the C2 spec; see header) ---- */

  // 0x0031 General Status
  _parseGeneralStatus(dv) {
    this.metrics.elapsedSec   = u24(dv, 0) * 0.01;  // 0.01 s
    this.metrics.distanceM    = u24(dv, 3) * 0.1;   // 0.1 m
    this.metrics.workoutState = u8(dv, 8);
    this.metrics.rowingState  = u8(dv, 9);
    if (dv.byteLength > 18) this.metrics.dragFactor = u8(dv, 18);
    console.log('[PM5] 0x31 general  |', toHex(dv),
      '=> t:', this.metrics.elapsedSec.toFixed(2), 's  d:',
      this.metrics.distanceM.toFixed(1), 'm  state:',
      WORKOUT_STATE[this.metrics.workoutState], '/', ROWING_STATE[this.metrics.rowingState],
      ' drag:', this.metrics.dragFactor);
  }

  // 0x0032 Additional Status 1
  _parseAdditionalStatus1(dv) {
    this.metrics.elapsedSec = u24(dv, 0) * 0.01;    // 0.01 s
    this.metrics.speedMps   = u16(dv, 3) * 0.001;   // 0.001 m/s
    this.metrics.speedKmh   = this.metrics.speedMps * 3.6;
    this.metrics.cadence    = u8(dv, 5);            // spm == rpm on BikeErg
    const hr = u8(dv, 6);
    this.metrics.heartRate  = (hr === 255) ? 0 : hr;
    console.log('[PM5] 0x32 addstat1 |', toHex(dv),
      '=> speed:', this.metrics.speedKmh.toFixed(2), 'km/h  cad:',
      this.metrics.cadence, 'rpm  hr:', this.metrics.heartRate);
  }

  // 0x0036 Additional Stroke Data (instantaneous power lives here)
  _parseAdditionalStrokeData(dv) {
    this.metrics.powerW      = u16(dv, 3);          // watts
    if (dv.byteLength >= 9) this.metrics.strokeCount = u16(dv, 7);
    console.log('[PM5] 0x36 addstrk  |', toHex(dv),
      '=> power:', this.metrics.powerW, 'W  strokes:', this.metrics.strokeCount);
  }
}

window.PM5 = PM5;
