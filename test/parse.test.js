/*
 * Parser tests. Every packet below is hand-built from the byte tables in
 * Concept2's "PM5 Bluetooth Smart Interface Definition" — expected values are
 * worked out by hand, not by the parser. All multi-byte fields little-endian.
 *
 * When a real capture exists (Record packets → Download in the app), add it
 * under test/fixtures/ and assert against the numbers the PM5 screen showed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGeneralStatus, parseAdditionalStatus1, parseAdditionalStrokeData,
} from '../js/pm5-parse.js';

const dv = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

test('0x0031 general status: time, distance, states, drag factor', () => {
  // time 123456 × 0.01 s = 1234.56 s  -> 0x01E240 -> 40 E2 01
  // distance 54321 × 0.1 m = 5432.1 m -> 0x00D431 -> 31 D4 00
  // workout type 1, interval type 255, workout state 1, rowing state 1,
  // stroke state 2, total work dist (3), workout duration (3), dur type 0,
  // drag factor 117
  const pkt = dv([0x40, 0xE2, 0x01, 0x31, 0xD4, 0x00, 1, 255, 1, 1, 2,
    0, 0, 0, 0, 0, 0, 0, 117]);
  const m = parseGeneralStatus(pkt);
  assert.equal(m.elapsedSec.toFixed(2), '1234.56');
  assert.equal(m.distanceM.toFixed(1), '5432.1');
  assert.equal(m.workoutState, 1);
  assert.equal(m.rowingState, 1);
  assert.equal(m.dragFactor, 117);
});

test('0x0031 short packet (no drag byte) leaves dragFactor out', () => {
  const pkt = dv([0x64, 0, 0, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const m = parseGeneralStatus(pkt);
  assert.equal(m.elapsedSec, 1);
  assert.equal(m.distanceM, 1);
  assert.equal('dragFactor' in m, false);
});

test('0x0032 additional status 1: speed, cadence, heart rate', () => {
  // speed 8333 × 0.001 m/s = 8.333 m/s = 29.9988 km/h -> 0x208D -> 8D 20
  // stroke rate (cadence) 85, heart rate 142
  const pkt = dv([0x10, 0x27, 0x00, 0x8D, 0x20, 85, 142,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const m = parseAdditionalStatus1(pkt);
  assert.equal(m.elapsedSec, 100);
  assert.equal(m.speedMps.toFixed(3), '8.333');
  assert.equal(m.speedKmh.toFixed(2), '30.00');
  assert.equal(m.cadence, 85);
  assert.equal(m.heartRate, 142);
});

test('0x0032 heart rate 255 means "no strap" and reads as 0', () => {
  const pkt = dv([0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(parseAdditionalStatus1(pkt).heartRate, 0);
});

test('0x0036 additional stroke data: power and stroke count', () => {
  // power 312 W -> 0x0138 -> 38 01 ; stroke calories (2) ; stroke count 1500
  // -> 0x05DC -> DC 05 ; projected work time (3) ; projected distance (3)
  const pkt = dv([0, 0, 0, 0x38, 0x01, 0, 0, 0xDC, 0x05, 0, 0, 0, 0, 0, 0]);
  const m = parseAdditionalStrokeData(pkt);
  assert.equal(m.powerW, 312);
  assert.equal(m.strokeCount, 1500);
});
