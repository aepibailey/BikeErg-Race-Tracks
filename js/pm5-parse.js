/*
 * pm5-parse.js — pure decoding of Concept2 PM5 BLE packets. No Bluetooth,
 * no DOM: each parser takes a DataView and returns the fields it found, so
 * they can be unit-tested in Node against hand-built or recorded packets.
 *
 * Spec: Concept2 "PM5 Bluetooth Smart Interface Definition". Offsets were
 * cross-checked against go-row, ErgometerJS, ergarcade/pm5-base,
 * qdomyos-zwift and Concept2-SDK. All multi-byte ints are LITTLE-ENDIAN.
 *
 * !! UNVERIFIED ON A REAL BIKEERG — check against the PM5 screen !!
 *  A. CADENCE: the "stroke rate" byte (0x0032) is assumed to be pedal RPM.
 *  B. POWER: 0x0036 "stroke power" updates once per stroke; held between.
 *  C. SPEED: 0x0032, 0.001 m/s — the BikeErg's simulated road speed.
 *  D. DISTANCE / TIME: 0x0031, 0.1 m / 0.01 s.
 *  E. PM5 PACE: 0x0032 "current pace", 0.01 s. On a rower this is per 500 m;
 *     on a BikeErg it may be per 1000 m. Compare with our pace-from-speed.
 */

/* ---- C2 GATT UUIDs (all share base ...-43E5-11E4-916C-0800200C9A66) ---- */
export const C2 = {
  // Device Information service (optional; used for serial/firmware readout)
  DEVICE_INFO_SERVICE: 'ce060010-43e5-11e4-916c-0800200c9a66',
  SERIAL_CHAR:         'ce060012-43e5-11e4-916c-0800200c9a66',
  HW_REV_CHAR:         'ce060013-43e5-11e4-916c-0800200c9a66',
  FW_REV_CHAR:         'ce060014-43e5-11e4-916c-0800200c9a66',

  // C2 "PM Rowing" service — the live data stream
  ROWING_SERVICE:      'ce060030-43e5-11e4-916c-0800200c9a66',
  GENERAL_STATUS:      'ce060031-43e5-11e4-916c-0800200c9a66', // 0x0031
  ADDITIONAL_STATUS_1: 'ce060032-43e5-11e4-916c-0800200c9a66', // 0x0032
  SAMPLE_RATE:         'ce060034-43e5-11e4-916c-0800200c9a66', // 0x0034 (write)
  ADD_STROKE_DATA:     'ce060036-43e5-11e4-916c-0800200c9a66', // 0x0036 (power)
};

/* Sample-rate values written to 0x0034. 0 = 1 s, 1 = 500 ms, 2 = 250 ms,
 * 3 = 100 ms. */
export const SAMPLE_RATE = { ONE_SEC: 0, HALF_SEC: 1, QUARTER_SEC: 2, TENTH_SEC: 3 };

export const ROWING_STATE = ['Inactive', 'Active'];
export const WORKOUT_STATE = [
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

export const toHex = (dv) =>
  Array.from({ length: dv.byteLength }, (_, i) =>
    dv.getUint8(i).toString(16).padStart(2, '0')).join(' ');

/* 0x0031 General Status */
export function parseGeneralStatus(dv) {
  const m = {
    elapsedSec:   u24(dv, 0) * 0.01,  // 0.01 s
    distanceM:    u24(dv, 3) * 0.1,   // 0.1 m
    workoutState: u8(dv, 8),
    rowingState:  u8(dv, 9),
  };
  if (dv.byteLength > 18) m.dragFactor = u8(dv, 18);
  return m;
}

/* 0x0032 Additional Status 1 */
export function parseAdditionalStatus1(dv) {
  const speedMps = u16(dv, 3) * 0.001;  // 0.001 m/s
  const hr = u8(dv, 6);
  return {
    elapsedSec: u24(dv, 0) * 0.01,
    speedMps,
    speedKmh: speedMps * 3.6,
    cadence: u8(dv, 5),                 // spm == rpm on BikeErg (assumption A)
    heartRate: hr === 255 ? 0 : hr,     // 255 = no HR strap
    pm5PaceSec: u16(dv, 7) * 0.01,      // PM5's own pace; distance unit unverified (E)
  };
}

/* 0x0036 Additional Stroke Data (per-stroke power lives here) */
export function parseAdditionalStrokeData(dv) {
  const m = { powerW: u16(dv, 3) };     // watts
  if (dv.byteLength >= 9) m.strokeCount = u16(dv, 7);
  return m;
}

/* Which parser handles which characteristic, plus a short tag for logs. */
export const PARSERS = {
  [C2.GENERAL_STATUS]:      { tag: '0x31', parse: parseGeneralStatus },
  [C2.ADDITIONAL_STATUS_1]: { tag: '0x32', parse: parseAdditionalStatus1 },
  [C2.ADD_STROKE_DATA]:     { tag: '0x36', parse: parseAdditionalStrokeData },
};
