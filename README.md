# BikeErg Racer

A local-first web app that connects to a Concept2 BikeErg's **PM5** monitor
over Bluetooth LE, streams live power/speed/cadence, and (later) renders a
synthwave / outrun-style night road — neon-edged highway to the horizon, dark
mountains, a galaxy sky — driven by your real erg, with ghost racers from your
ride history.

> **Status: Phase 1 — BLE connection + raw data display. NOT YET TESTED ON A
> REAL BIKEERG.** Rendering (Phase 2) and ghosts (Phase 3) are not built yet.

## What Phase 1 does

- Connects to a PM5 over **Web Bluetooth** (Chrome).
- Subscribes to the Concept2 proprietary erg-data stream and parses:
  **power (W), speed (km/h + m/s), cadence (rpm), distance (m), elapsed time**,
  plus drag factor, stroke count and heart rate.
- Shows them live with a connect/disconnect button and a clear status light.
- **Reconnects automatically** if the Bluetooth link drops mid-ride (retries
  for ~75 s), keeping the numbers it already has.
- Keeps the tablet **screen awake** while connected (Screen Wake Lock).
- **Record packets** button: captures the raw BLE stream to a downloadable JSON
  file, so parser bugs can be reproduced in tests without the bike.
- Add `?debug=1` to the URL to log **raw hex + parsed values** for every packet.

## Running it (Web Bluetooth needs HTTPS or localhost)

You are testing on **Chrome on an Android tablet**, next to the BikeErg. Two
easy options:

**Option A — GitHub Pages (simplest, real HTTPS).**
Enable Pages for this repo (Settings → Pages → deploy from branch), then open
the `https://…github.io/…` URL in Chrome on the tablet and tap **Connect PM5**.
BLE is entirely local to the browser, so a static host is fine.

**Option B — localhost over USB (no certs needed).**
`localhost` counts as a secure context even when forwarded over USB:
1. On a computer in this folder: `python3 -m http.server 8000`
2. USB-connect the tablet, enable USB debugging.
3. On the computer's Chrome: `chrome://inspect` → **Port forwarding** →
   map `8000` → `localhost:8000`.
4. On the tablet, open `http://localhost:8000` and tap **Connect PM5**.

Make sure Bluetooth is on and the PM5 is awake (pedal it once). Chrome also
needs Android's Bluetooth-scan permission:
- **Android 12+**: Chrome needs the **Nearby devices** permission
  (Settings → Apps → Chrome → Permissions).
- **Android 11 and older**: **Location** must be on (system-wide, and allowed
  for Chrome) or the PM5 never shows up in the chooser.

## ⚠️ Assumptions to verify on the first real ride

The BLE byte layout is the most likely place for bugs. UUIDs and offsets were
taken from Concept2's *PM5 Bluetooth Smart Interface Definition* and
cross-checked against several open-source implementations — but please
eyeball these against the PM5's own screen on the first test:

| Metric | Source | Watch for |
| --- | --- | --- |
| **Cadence (rpm)** | 0x0032 "Stroke Rate" byte | On a BikeErg we assume SPM = pedal RPM. Confirm it matches the PM5 RPM. |
| **Power (W)** | 0x0036 per-stroke power | Updates **once per pedal stroke**, so it refreshes slowly at low cadence — same as the PM5's watts number. |
| **Speed (km/h)** | 0x0032 speed (0.001 m/s) | This is the BikeErg's simulated road speed. Sanity-check vs. the PM5. |
| **Distance / time** | 0x0031 (0.1 m / 0.01 s) | Confirm they track the PM5's distance and clock. |

**Stop here and test before Phase 2** so parsing bugs don't get tangled up
with rendering bugs.

### First-ride checklist

1. Connect, pedal, and confirm each number moves.
2. Tap **Record packets**. Pedal ~1 minute at a steady effort.
3. Just before stopping, note what the PM5 screen shows: watts, RPM, speed /
   pace, distance, time.
4. Tap **Stop & download**. Commit the JSON to `test/fixtures/` along with the
   numbers from step 3 so a test can lock in the real byte layout.
5. Optional: walk the tablet out of range (or switch the PM5 off and on) to
   watch it reconnect.

## Tests

No dependencies — needs Node 20+.

```bash
npm test
```

- `test/parse.test.js` — packet decoding against hand-built spec packets.
- `test/connection.test.js` — connect / drop / reconnect / disconnect
  lifecycle against an in-memory fake of Chrome's Web Bluetooth
  (`test/helpers/fake-ble.js`).

## Layout

```
index.html        Phase 1 page (status, connect/record buttons, live metrics)
styles.css        Plain dark styling (the synthwave look comes in Phase 2)
js/pm5-parse.js   Pure packet decoding + C2 UUIDs  ← the critical bit
js/pm5.js         PM5 BLE connection lifecycle (connect, reconnect, record)
js/app.js         UI wiring, wake lock, capture download
test/             node:test suites + fake Web Bluetooth
```

Plain ES modules, no build step. Because of that, the page must be served over
http(s) — opening `index.html` as a file won't load the modules.

## Tech notes

- Target: Chrome on an older/lower-spec Android tablet. Phase 2 plans plain
  Canvas 2D (no heavy WebGL): a pseudo-3D "segment" road suits both the
  synthwave look and that hardware. Avoid Canvas `shadowBlur` for neon glow
  (very slow on low-end Android) — pre-render glow sprites instead.
- Race distance comes from the **PM5's own distance** field, not from
  integrating speed, so ghosts and the Concept2 logbook agree.
- The PM5 uses Concept2's own GATT services (not standard FTMS). Base UUID
  `ce0600xx-43e5-11e4-916c-0800200c9a66`; rowing service `…0030`, live-data
  characteristics `…0031/0032/0036`.
