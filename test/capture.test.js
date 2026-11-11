import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapture, captureFilename } from '../js/capture.js';

const recording = { startedAt: '2026-11-10T17:25:28.233Z', device: 'PM5 431234567', packets: [{ t: 0, char: '0x31', hex: '00' }] };

test('capture keeps the packets and what we parsed at the end', () => {
  const cap = buildCapture(recording, { powerW: 312 }, {});
  assert.equal(cap.packets.length, 1);
  assert.equal(cap.parsedAtEnd.powerW, 312);
  assert.equal(cap.device, 'PM5 431234567');
});

test('capture stores the PM5 screen values the rider typed, trimmed', () => {
  const cap = buildCapture(recording, {}, { watts: ' 205 ', pace: '2:05.3', rpm: '' });
  assert.deepEqual(cap.pm5Screen, { watts: '205', pace: '2:05.3' });
});

test('capture marks the PM5 screen as missing when nothing was typed', () => {
  const cap = buildCapture(recording, {}, { watts: '', rpm: '  ' });
  assert.equal(cap.pm5Screen, null);
});

test('capture does not change the recording it was given', () => {
  buildCapture(recording, { powerW: 1 }, { watts: '1' });
  assert.equal('parsedAtEnd' in recording, false);
});

test('capture filename is file-system safe', () => {
  assert.equal(captureFilename(recording), 'pm5-capture-2026-11-10T17-25-28-233Z.json');
});
