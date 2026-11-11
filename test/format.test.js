import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paceSecPer, fmtPace, fmtTime } from '../js/format.js';

test('pace per 1000 m from speed: 8.333 m/s is a 2:00 pace', () => {
  assert.equal(paceSecPer(8.333, 1000).toFixed(2), '120.00');
});

test('pace per 500 m is half the 1000 m pace', () => {
  assert.equal(paceSecPer(5, 500), 100);
});

test('no pace when stopped', () => {
  assert.equal(paceSecPer(0, 1000), null);
});

test('fmtPace shows m:ss.t', () => {
  assert.equal(fmtPace(125.37), '2:05.4');
});

test('fmtPace carries a rounded-up tenth into the minute', () => {
  assert.equal(fmtPace(59.96), '1:00.0');
});

test('fmtPace shows a dash for no pace', () => {
  assert.equal(fmtPace(null), '–');
  assert.equal(fmtPace(0), '–');
});

test('fmtTime shows whole seconds as m:ss', () => {
  assert.equal(fmtTime(125.9), '2:05');
});
