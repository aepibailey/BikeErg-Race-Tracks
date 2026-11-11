/*
 * A minimal in-memory stand-in for Chrome's Web Bluetooth objects, enough to
 * drive PM5's connection lifecycle in Node. Like Chrome, it hands back the
 * SAME device / characteristic objects across reconnects — that is what makes
 * listener pile-up possible, so the fake must behave that way too.
 */
class FakeCharacteristic extends EventTarget {
  constructor(uuid) { super(); this.uuid = uuid; this.value = null; this.written = []; }
  async startNotifications() { return this; }
  async writeValue(v) { this.written.push(v); }
  async readValue() { return new DataView(new TextEncoder().encode('fake').buffer); }
  notify(bytes) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeService {
  constructor(chars) { this.chars = chars; }
  async getCharacteristic(uuid) {
    if (!this.chars.has(uuid)) throw new Error(`no characteristic ${uuid}`);
    return this.chars.get(uuid);
  }
}

class FakeGatt {
  constructor(device) {
    this.device = device;
    this.connected = false;
    this.connectCalls = 0;
    this.connectFailures = 0;        // reject this many connect() calls first
    this.missingServices = new Set(); // getPrimaryService rejects for these
  }
  async connect() {
    this.connectCalls++;
    if (this.connectFailures > 0) { this.connectFailures--; throw new Error('connect failed'); }
    this.connected = true;
    return this;
  }
  disconnect() { if (this.connected) this.drop(); }
  /* Remote side / radio drops the link. */
  drop() {
    this.connected = false;
    this.device.dispatchEvent(new Event('gattserverdisconnected'));
  }
  async getPrimaryService(uuid) {
    if (!this.connected) throw new Error('GATT not connected');
    if (this.missingServices.has(uuid)) throw new Error(`no service ${uuid}`);
    const svc = this.device.services.get(uuid);
    if (!svc) throw new Error(`no service ${uuid}`);
    return svc;
  }
}

export class FakeDevice extends EventTarget {
  constructor({ name = 'PM5 431234567', services }) {
    super();
    this.name = name;
    this.id = 'fake-id';
    this.gatt = new FakeGatt(this);
    this.chars = new Map();
    this.services = new Map();
    for (const [svcUuid, charUuids] of Object.entries(services)) {
      const chars = new Map(charUuids.map((u) => [u, new FakeCharacteristic(u)]));
      chars.forEach((c, u) => this.chars.set(u, c));
      this.services.set(svcUuid, new FakeService(chars));
    }
  }
  char(uuid) { return this.chars.get(uuid); }
}

export class FakeBluetooth {
  constructor(device) { this.device = device; this.requests = []; }
  async requestDevice(opts) { this.requests.push(opts); return this.device; }
}

/* Poll until predicate is true (or fail after `ms`). */
export async function waitFor(predicate, ms = 500) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 1));
  }
}
