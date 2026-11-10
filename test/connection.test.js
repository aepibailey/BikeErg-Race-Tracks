/*
 * Connection lifecycle tests for PM5 against an in-memory fake of Chrome's
 * Web Bluetooth (test/helpers/fake-ble.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PM5 } from '../js/pm5.js';
import { C2 } from '../js/pm5-parse.js';
import { FakeDevice, FakeBluetooth, waitFor } from './helpers/fake-ble.js';

// A 0x0031 packet: 1.00 s elapsed, 1.0 m distance.
const GENERAL = [0x64, 0, 0, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];

function setup(opts = {}) {
  const device = new FakeDevice({
    services: {
      [C2.ROWING_SERVICE]: [C2.GENERAL_STATUS, C2.ADDITIONAL_STATUS_1,
        C2.SAMPLE_RATE, C2.ADD_STROKE_DATA],
      [C2.DEVICE_INFO_SERVICE]: [C2.SERIAL_CHAR, C2.HW_REV_CHAR, C2.FW_REV_CHAR],
    },
  });
  const logs = [];
  const log = { log: (...a) => logs.push(a), warn: () => {}, error: () => {} };
  const pm5 = new PM5({ bluetooth: new FakeBluetooth(device), reconnectDelaysMs: [0, 0, 0], log, ...opts });
  const states = [];
  const data = [];
  pm5.on('state', (s) => states.push(s.state));
  pm5.on('data', (m) => data.push({ ...m }));
  return { pm5, device, states, data, logs };
}

test('one packet gives exactly one data event, even after reconnecting', async () => {
  const { pm5, device, data } = setup();
  await pm5.connect();
  await pm5.disconnect();
  await pm5.connect();
  device.char(C2.GENERAL_STATUS).notify(GENERAL);
  assert.equal(data.length, 1);
});

test('a dropped link reconnects automatically and data keeps flowing', async () => {
  const { pm5, device, states, data } = setup();
  await pm5.connect();
  device.gatt.drop();
  await waitFor(() => pm5.state === 'connected' && states.includes('reconnecting'));
  device.char(C2.GENERAL_STATUS).notify(GENERAL);
  assert.equal(data.length, 1);
  assert.equal(data[0].distanceM, 1);
});

test('reconnect keeps retrying while the PM5 is unreachable', async () => {
  const { pm5, device } = setup();
  await pm5.connect();
  device.gatt.connectFailures = 2;
  const callsBefore = device.gatt.connectCalls;
  device.gatt.drop();
  await waitFor(() => pm5.state === 'connected');
  assert.equal(device.gatt.connectCalls - callsBefore, 3);
});

test('reconnect gives up once the retry schedule runs out', async () => {
  const { pm5, device, states } = setup();
  await pm5.connect();
  device.gatt.connectFailures = 99;
  device.gatt.drop();
  await waitFor(() => pm5.state === 'disconnected');
  assert.equal(states.at(-1), 'disconnected');
  assert.equal(device.gatt.connected, false);
});

test('a user disconnect does not reconnect and reports disconnected once', async () => {
  const { pm5, device, states } = setup();
  await pm5.connect();
  const callsBefore = device.gatt.connectCalls;
  await pm5.disconnect();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(device.gatt.connectCalls, callsBefore);
  assert.equal(states.filter((s) => s === 'disconnected').length, 1);
});

test('disconnecting while a reconnect is pending cancels it', async () => {
  const { pm5, device } = setup({ reconnectDelaysMs: [30] });
  await pm5.connect();
  device.gatt.drop();
  assert.equal(pm5.state, 'reconnecting');
  const callsBefore = device.gatt.connectCalls;
  await pm5.disconnect();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(device.gatt.connectCalls, callsBefore);
  assert.equal(pm5.state, 'disconnected');
});

test('a setup failure after GATT connects tears the link back down', async () => {
  const { pm5, device } = setup();
  device.gatt.missingServices.add(C2.ROWING_SERVICE);
  await assert.rejects(pm5.connect());
  assert.equal(device.gatt.connected, false);
  assert.equal(pm5.state, 'disconnected');
  assert.equal(pm5.isConnected, false);
});

test('per-packet logging is off by default and on with debug', async () => {
  const quiet = setup();
  await quiet.pm5.connect();
  quiet.logs.length = 0;
  quiet.device.char(C2.GENERAL_STATUS).notify(GENERAL);
  assert.equal(quiet.logs.length, 0);

  const loud = setup({ debug: true });
  await loud.pm5.connect();
  loud.logs.length = 0;
  loud.device.char(C2.GENERAL_STATUS).notify(GENERAL);
  assert.equal(loud.logs.length, 1);
});

test('recording captures each raw packet as hex with its characteristic', async () => {
  const { pm5, device } = setup();
  await pm5.connect();
  pm5.startRecording();
  device.char(C2.ADD_STROKE_DATA).notify([0, 0, 0, 0x38, 0x01, 0, 0, 0xDC, 0x05]);
  const rec = pm5.stopRecording();
  assert.equal(rec.packets.length, 1);
  assert.equal(rec.packets[0].char, '0x36');
  assert.equal(rec.packets[0].hex, '00 00 00 38 01 00 00 dc 05');
  assert.equal(typeof rec.packets[0].t, 'number');
  device.char(C2.ADD_STROKE_DATA).notify([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(rec.packets.length, 1, 'stops capturing after stopRecording');
});
