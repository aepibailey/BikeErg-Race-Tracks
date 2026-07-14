# BikeErg Racer

A local-first web app that connects to a Concept2 BikeErg's **PM5** monitor
over Bluetooth LE, streams live power/speed/cadence, and (later) renders a
Tron/F-Zero style race track driven by your real erg speed, with ghost racers
from your ride history.

> **Status: Phase 1 — BLE connection + raw data display.**
> Rendering (Phase 2) and ghosts (Phase 3) are intentionally not built yet.

## What Phase 1 does

- Connects to a PM5 over **Web Bluetooth** (Chrome).
- Subscribes to the Concept2 proprietary erg-data stream and parses:
  **power (W), speed (km/h + m/s), cadence (rpm), distance (m), elapsed time**,
  plus drag factor, stroke count and heart rate.
- Shows them live with a connect/disconnect button and a clear status light.
- Logs **raw hex + parsed values to the console** for on-erg sanity checking.

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

Make sure the tablet's **Bluetooth and Location** are on (Android requires
Location for BLE scanning) and the PM5 is awake (pedal it once).

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

If anything reads wrong, the console log prints the raw hex for each packet so
we can re-check the offset. **Stop here and test before Phase 2** (per the
build plan) so parsing bugs don't get tangled up with rendering bugs.

## Layout

```
index.html      Phase 1 page (status, connect button, live metrics)
styles.css      Plain dark styling (the Tron look comes in Phase 2)
js/pm5.js       PM5 BLE connection + spec-based packet parsing  ← the critical bit
js/app.js       UI wiring
```

## Tech notes

- Target: Chrome on an older/lower-spec Android tablet. Phase 2 will use plain
  Canvas 2D (no heavy WebGL) to stay light on that hardware.
- The PM5 uses Concept2's own GATT services (not standard FTMS). Base UUID
  `ce0600xx-43e5-11e4-916c-0800200c9a66`; rowing service `…0030`, live-data
  characteristics `…0031/0032/0036`.
