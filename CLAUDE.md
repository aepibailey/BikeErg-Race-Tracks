# BikeErg Racer

Local-first web game: a Concept2 BikeErg's PM5 monitor streams live data over
Web Bluetooth and (Phase 2+) drives a synthwave / outrun night-road race with
ghost racers from ride history. See README.md for phases and setup.

## Design doc
- `docs/DESIGN.md` is an export of a live Claude Doc Shawn keeps in claude.ai
  (https://claude.ai/artifact/Pj7FzSn1njBwkpQQW9GfCH, tab "Design Doc"). The live doc wins if they differ.
- Re-export the tab at the start of every phase or build batch (Claude Docs export as Markdown)
  into `docs/DESIGN.md`, and commit the change.
- Don't silently edit DESIGN.md. If something in it looks wrong or a decision changes, tell Shawn
  what to change in the live doc, then re-export.

## Status

- Phase 1 (BLE connection + live numbers) is built but **has never been tested
  on a real BikeErg**. Byte offsets come from Concept2's spec and are unit
  tested, but the BikeErg-specific assumptions (stroke rate = RPM, per-stroke
  power, speed field) are unverified. Do not start Phase 2 rendering until the
  README's first-ride checklist is done.
- Phase 2: the track. Phase 3: ghost racers.

## Commands

- `npm test` — node:test suites, no dependencies (Node 20+).
- `npm run serve` — static server on :8000. Web Bluetooth needs HTTPS or
  localhost; ES modules mean `file://` won't work.
- Add `?debug=1` to the page URL to log every BLE packet.

## Architecture

- `js/pm5-parse.js` — pure packet decoders + C2 GATT UUIDs. No DOM, no BLE.
- `js/pm5.js` — `PM5` class: connect, auto-reconnect, disconnect, raw packet
  recording. Takes `{ bluetooth, reconnectDelaysMs, debug, log }` so tests can
  inject a fake.
- `js/app.js` — UI wiring, screen wake lock, capture download.
- `test/helpers/fake-ble.js` — in-memory Web Bluetooth fake. Like Chrome, it
  returns the same device/characteristic objects across reconnects; keep it
  that way (that is what catches listener pile-up bugs).

## Conventions

- Plain ES modules, no build step, no runtime dependencies.
- Target hardware: Chrome on an older, lower-spec Android tablet. Keep
  rendering light: Canvas 2D, no `shadowBlur` glow (pre-render glow sprites),
  no heavy per-frame allocation.
- Race distance = the PM5's own distance field. Never integrate speed.
- Parser changes need a test with hand-derived expected values; once real
  captures exist in `test/fixtures/`, test against those too.

## Aesthetic (Phase 2)

Synthwave / outrun night drive: dark road with glowing orange edge lines
converging to a vanishing point, dark mountain silhouettes, a big galaxy and
starfield sky, streetlamps with pink-red neon heads, a light VHS / scanline /
RGB-split overlay. Original art only. Don't recreate any specific existing
game.

Would an AI image generator be useful? **Yes, for static backdrops**: the
galaxy sky and the mountain silhouette layers, rendered once, saved as
compressed images, and drawn under a code-drawn road. Use free-tier tools only.
The road, lamps, lane lines and glow should stay code-drawn so they animate
with erg speed. A procedural starfield is a fine fallback.

## Browser Integration
If the claude-in-chrome tool fails (unavailable, not installed, etc.):
- Do not silently continue without it. Show: "[Tool: claude-in-chrome] Required but unavailable. Please open Chrome." Then wait for Shawn's confirmation before any workaround.
- Exception: if Shawn says he'll be away or asleep, ask up front whether you may proceed silently if Chrome fails.
