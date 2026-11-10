# BikeErg Racer — Live Design Doc

Nov 10, 2026 · @Shawn

## Overview

BikeErg Racer is a local-first web app that reads live data from a Concept2 BikeErg's PM5 monitor over Bluetooth LE and turns each ride into a Tron / F-Zero-style race against ghost pods built from your own ride history.

- **Riders:** Shawn and his wife, each with their own profile, data and stats.
- **Device:** an older Android Galaxy tablet running Chrome. Web Bluetooth works there, so no native app is needed.
- **Look:** glowing lines on black, a pseudo-3D (Mode 7-style) track receding into the distance, simple glowing pods.
- **Goal:** keep indoor rides entertaining with ghost racers, effort-tagged rides and several courses, without PR-chasing.
- **Built with:** Claude Code, prompt-driven. The master build prompt is `bikeerg-racer-prompt.md` from the July 2026 planning chat.

## Current status

Phase 1 code exists in the repo `aepibailey/BikeErg-Race-Tracks`. The `main` branch sits at the Phase 1 commit; GitHub's default branch is still an auto-named Claude branch. The graphics approach (Canvas 2D vs WebGL) is the next open decision with Claude Code.

**Next action:** run Phase 1 on the tablet and compare the app's live power, speed, cadence and distance against the PM5's own display.

- [x] Confirm repo name and where the code lives
- [ ] Switch GitHub default branch to `main` (Settings → General → Default branch) and merge the working branch
- [ ] Commit this doc as `docs/DESIGN.md` and point CLAUDE.md at it
- [ ] Decide graphics approach (Canvas 2D vs WebGL); then update CLAUDE.md's "Canvas 2D only" rule
- [ ] Log Phase 1 test result (pass / issues found)

## Locked-in decisions

These are settled; changing any of them means a logged decision below.

| Area | Decision | Why |
| --- | --- | --- |
| Storage | Local-first, no backend; IndexedDB for all data | Single household, no sync needed |
| Renderer | Canvas 2D so far; under review with the quality settings (see Platform and graphics) | Runs well on old tablet hardware |
| Pace curves | Stored as speed over **distance**, not over time | Ghosts from any lap count replay against any other; costly to change later |
| Session flow | Profile → Course → Effort tag → Lap count → Race | One clear path into every ride |
| Effort tags | Easy / Steady / Hard, picked before each ride | Replaces PR-chasing; ghosts compare like with like |
| Ghost field | 5–7 pods with distinct pacing personalities | Races feel populated without multiplayer |
| Ghost source | Active profile's last 5 rides on the same course + tag | Tracks current fitness, not ancient rides |
| First ride | No ghosts on the first ride in a new profile / course / tag combo; field auto-generates after one ride | Cold start is one ride, not three |
| Lap count UI | Shows a time estimate from that rider's own history at the chosen tag | Pick laps by how long you have |
| Courses | At least 3, with distinct lap lengths and curve densities | Variety between rides |
| Track physics | Track distance per second = erg speed | Simplest honest mapping |
| Build order | BLE first, rendering second | Keep hardware bugs apart from rendering bugs |

## Visual direction

The look is moving from plain Tron grid toward synthwave / outrun: a neon-edged road running to a vanishing point under a deep-space sky. Reference given to Claude Code on 2026-11-10: a synthwave music-video still (a night road with glowing orange edges, mountain silhouettes and a large galaxy filling the sky).

- **Keep:** the neon-edged road converging to the horizon; dark mountain silhouettes; a starfield or galaxy sky.
- **Drop:** the car-cockpit view. Use a chase view behind the player pod so the ghost pods stay visible.
- **Readability:** dim or vignette the sky near the vanishing point so pods and the HUD stand out.
- **Curves:** shift the sky and mountains sideways on curves to sell the turn.
- **Per-course skies:** a different backdrop per course helps tell the three apart.
- **Assets:** the reference image is for mood only and can't ship. Draw the sky procedurally in Canvas, or use an original or licensed image.

## Platform and graphics

Android is the main platform; iOS is a cheap test, not a build target. Graphics quality is adjustable per device, but a track's layout never changes, so a ghost on a given track is the same race on every device.

- **Quality settings:** Low / Medium / High / Auto. They change visual detail only, never track geometry.
- **Tracks:** several tracks that differ in curves, hills and scenery. Hills are visual only; erg resistance is not affected.
- **Race distance:** taken from the PM5's own distance reading.
- **Bluetooth layer:** kept swappable so another connection type can replace Web Bluetooth.
- **iOS, step 1:** open the same URL in Bluefy, a Bluetooth-capable iOS browser. No code changes; a 10-minute test.
- **iOS, step 2 (only if needed):** wrap the app with Capacitor and a native Bluetooth plugin. Needs a Mac with Xcode and Apple's $99/year developer account; a free account's install expires every 7 days.
- **Rejected:** a fully native iOS app.

## Build phases

Each phase is tested on the real tablet and BikeErg before the next starts. Tick items as they land.

**Phase 1 — BLE connection and raw data**

- [ ] Scan for and connect to the PM5 via Web Bluetooth (HTTPS or localhost)
- [ ] Parse power (W), speed, cadence (rpm), distance (m), elapsed time from Concept2's published BLE spec
- [ ] Live readout page with connect / disconnect and clear connection status
- [ ] Console logging of raw parsed values; sanity-check against the PM5 display

**Phase 2 — Track renderer (Tron / F-Zero style)**

- [ ] Canvas pseudo-3D scrolling grid, glowing lines on black
- [ ] Track as JSON segments (straights and curves with lengths), flat
- [ ] Player pod driven by live speed; glow or speed lines scale with power
- [ ] HUD: power, speed, cadence, distance, time

**Phase 3 — Ride history and ghosts**

- [ ] Save each ride with ~1 Hz samples
- [ ] One-tap effort tag at ride start
- [ ] Ghost field built from the last 5 rides in the same course + tag
- [ ] Post-ride summary: placing against the ghosts, margins, final stats

**Phase 4 (v2) — Profiles, courses, lap selection**

- [ ] Multiple profiles with their own data and stats
- [ ] Three distinct courses
- [ ] Full lap-selection UI with per-profile time estimates

## Data model

All records live in IndexedDB, and every ride belongs to one profile, one course and one effort tag. Profiles and distance-indexed pace curves are in the schema from the first commit so v2 needs no migration.

| Record | Key fields | Notes |
| --- | --- | --- |
| Profile | id, name | One per rider; owns all of its rides and stats |
| Course | id, name, lap length (m), segments | Hand-authored JSON; straights and curves, flat |
| Ride | profileId, courseId, tag, laps, date, durationSec, samples | Samples at ~1 Hz: time, speed (m/s), power (W), distance (m) |
| Pace curve | speed at each distance point | Derived from a ride; what ghosts replay |
| Ghost bucket | profile + course + tag | Last 5 rides here feed the ghost field |

The exact field list is in the master build prompt; update this table if Claude Code's schema differs.

## Courses

At least three courses, each different in lap length and curve density. None are designed yet; fill a row as each one is defined.

| Course | Lap length (m) | Curve density | Look / theme | Status |
| --- | --- | --- | --- | --- |
| Course 1 |  |  | Galaxy sky over mountains (proposed) | Not designed |
| Course 2 |  |  | Sunset over a neon grid (proposed) | Not designed |
| Course 3 |  |  | City skyline at night (proposed) | Not designed |

## Out of scope and parking lot

These are deliberately not being built. Moving one into scope gets a decision-log entry.

- Backend or cloud sync
- Multiplayer or networked racing
- Gradient or elevation affecting resistance
- Visual track editor (hand-authored JSON instead)
- Fully native iOS app (iOS via Bluefy first; Capacitor only if needed)
- Percentage-of-effort slider for ghost pacing

**Parking lot** (ideas to revisit later):

- (none yet)

## Hardware notes and open questions

The PM5 broadcasts over both Bluetooth LE and ANT+ at the same time, which shapes how the tablet and a Garmin can share it.

- **PM5:** exposes power, speed, cadence, distance and elapsed time over BLE per Concept2's published spec; also ANT+ FE-C.
- **Tablet:** older Galaxy, Chrome, Web Bluetooth. Needs HTTPS or localhost to connect.
- **Garmin alongside:** should work with the Garmin on ANT+ and the tablet on BLE.

**To verify on hardware:**

- [ ] BLE byte offsets match the PM5 display (Claude Code is told to flag any it is unsure of)
- [ ] Garmin (ANT+) and tablet (BLE) record the same ride at once
- [ ] Frame rate is smooth on the tablet at each quality setting
- [ ] Bluefy on an iPhone connects to the PM5 and keeps the screen awake
- [ ] Exact tablet model (unknown so far)

## Decision log

Newest first. Add a row for every decision, scope change or test result.

| Date | Decision or event | Detail |
| --- | --- | --- |
| 2026-11-10 | Quality settings added | Low / Medium / High / Auto; visuals only, track layout fixed |
| 2026-11-10 | Multiple tracks confirmed | Vary in curves, hills (visual) and scenery |
| 2026-11-10 | Race distance from PM5 | Use the monitor's distance reading |
| 2026-11-10 | Android-first; iOS via Bluefy test | Capacitor only if iOS becomes a real need; fully native rejected |
| 2026-11-10 | Synthwave aesthetic reference given to Claude Code | Neon road + galaxy sky; see Visual direction |
| 2026-11-10 | Live design doc created | Consolidates the July planning chat and project notes |
| 2026-07-18 | Ghost rule finalized | No ghost on first ride in a bucket; after that, field from up to the last 5 rides in that bucket |
| 2026-07-18 | v2 end state added | Multiple profiles with own stats; at least 3 unique courses |
| 2026-07-18 | Pace curves by distance | Speed over distance so any lap count replays against any other |
| 2026-07-18 | Effort tags replace PRs | Easy / Steady / Hard chosen per ride |
| 2026-07-18 | Platform chosen | Web app in Chrome on Android tablet; Canvas 2D; IndexedDB; no backend |
| 2026-07-18 | Visual style chosen | Tron / F-Zero, glowing lines on black |
