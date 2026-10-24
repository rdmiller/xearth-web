# Plan: HUD transport controls

On-screen controls to rewind, pause, fast-forward and jump to a chosen date and time, so the
clock can be driven without knowing the hotkeys, and on touch screens, where there are no keys.

## What already exists

The simulated clock is done; what's missing is UI for it.

- **Settings:** `time` (a fixed start moment, `null` for now) and `speed` (a multiplier, 1 =
  real time, 0 = paused, negative = backwards) in `web/src/params.ts`. Both live in the URL.
- **Clock:** `simTime()` in `web/src/main.ts` returns `time + (wall − clockStart) × speed`.
  `hotkeyContext.setSpeed()` re-anchors (`time` = the displayed moment, `clockStart` = now) so
  the clock carries on from where it is, and `goLive()` clears both.
- **Hotkeys** (`web/src/hotkeys.ts`, group `Time`): Space pauses/resumes (remembering the
  speed it paused from), `.` / `,` step along `SPEEDS` (−1 h/s … 1 day/s), `T` goes back to
  now, `K` previews the next launch from T−1 min at 10×. `formatSpeed()` names a speed.
- **Readout:** the overlay's top line shows the UTC time and `clockLabel()` ("paused",
  "10 min per second", "fixed start time") whenever the clock isn't live.
- **Everything follows `simTime()`:** the Sun, terminator, Moon, stars, satellites (SGP4),
  launches, the month's Blue Marble and the redraw cadence (`redrawInterval` scales with
  `|speed|`, going continuous when fast).
- **Live data stays at now:** clouds, hazards and the other feeds are snapshots of the
  present. Live imagery already gives way to the painted globe when the clock is more than
  30 min from now (`liveShown`, `LIVE_MAX_SKEW_MS`), and the launch-detail fetch stops when
  the clock isn't live.

So every control below is a call into what's there, plus two new clock operations: **jump
to a moment** and **step by an amount**.

## Goals

1. A transport bar: rewind, play/pause, fast-forward, step back/forward, and a Now button.
2. The current simulated date and time and the rate, always readable on the bar.
3. A date-and-time picker, with presets for moments worth seeing.
4. Mouse, touch and keyboard all work, and the bar never hides that the data is "now".

**Not in scope:** historical data. Clouds, imagery, quakes and the other feeds keep showing
the present; fetching archives for a past date (GIBS has dated layers, USGS has a query API)
is a separate, much larger piece of work (see *Later*).

## Design

### The bar

A glass pill (`.glass`, the HUD font, `--hud-accent`) centred along the bottom, just above
the layer dock:

```
 ⏮  ⏪  ⏯  ⏩  ⏭ │ 2026-10-24 14:32:07 UTC ▾ │ 10 MIN/S │ ● NOW
```

| Control | Action |
| --- | --- |
| ⏪ Rewind | Media-player style: from forward or paused, go to −10×; pressing again goes faster backwards (−60, −600, −3600). |
| ⏯ Play/Pause | Same as Space: pause, or resume at the speed it paused from. `aria-pressed` reflects it. |
| ⏩ Fast-forward | From backwards or paused, go to +10×; again goes faster (60, 600, 3600, 86400). |
| ⏮ / ⏭ Step | Jump ∓1 hour (Shift: ∓1 day). Keeps the speed, so a paused clock stays paused. Repeats while held. |
| Date/time | Opens the picker. Shows UTC or local time (a toggle in the picker, remembered per viewer). |
| Rate chip | The speed in short form ("PAUSED", "1×", "10 MIN/S", "−1 H/S", "1 DAY/S"). Click cycles back to 1×. |
| ● NOW | Lit (red dot, "LIVE") while live; otherwise a button that does what `T` does. |

**Why not reuse the `.` / `,` ladder for the buttons?** It is linear: from real time, `,`
pauses, then goes −1×, −10×… A rewind button that first pauses, then crawls backwards at
1×, feels broken. The buttons get media-player semantics; the keys keep theirs.

**When it shows.** While the clock is live, the bar rides with the dock: it rises when the
pointer nears the bottom and when the dock is pinned (reuse `revealFor()` from
`drawer.ts`). While the clock isn't live, the bar stays visible, so there is always a way
back to now. A "Time" button in the dock's HUD group (Lucide `Clock`, hotkey `Shift+C`)
pins it open too.

**Phones** (`max-width: 600px`): the step buttons drop out and the date shortens to
`10-24 14:32`; the bar sits above the dock's grip and below the toast column. Tap targets
stay ≥ 40 px (the `pointer: coarse` rule).

### The picker

A small glass popover above the bar:

- `<input type="date">` and `<input type="time" step="1">`, with a **UTC / Local** toggle.
  The native inputs give phones their own wheels and keep the hotkey handler out of the way
  (it already ignores events from `input`).
- **Presets:** Now · −24 h · +24 h · Next sunrise here (at the view's centre) · Next
  equinox or solstice · Next solar eclipse · Next lunar eclipse. All come from
  astronomy-engine, which the app already ships (`Seasons`, `SearchRiseSet`,
  `SearchGlobalSolarEclipse`, `SearchLunarEclipse`). For a solar eclipse, also centre the
  view on the greatest-eclipse point: that one's the show.
- **Go** jumps there, keeping the current speed (paused stays paused, real time plays on
  from the new moment). Escape or a click outside closes it; so does Android's back button
  (add it to the `backButton` chain in `main.ts`).
- **Range:** 1900–2100. astronomy-engine is good far beyond that, but the stars' precession
  and the textures are tuned for the present, and the input needs bounds.

### Being honest about the data

When the clock is more than `LIVE_MAX_SKEW_MS` (30 min) from now, the bar shows an amber
**DATA: NOW** chip, with a title explaining that clouds and hazards show the present, not the
chosen time. The Sun, Moon, stars and satellites are what move.

Satellites need one extra limit: SGP4 from today's elements drifts badly beyond a few weeks.
More than 30 days from now, the bulk point clouds hide and the named satellites show a
"position approximate" tag; beyond a year they hide too.

## Architecture

### 1. `web/src/clock.ts` (new, pure)

Pull the clock arithmetic out of `main.ts` so it can be unit-tested:

```ts
export interface Clock { time: Date | null; speed: number; anchor: number /* wall ms */ }
export function clockAt(c: Clock, wall: number): Date;
export const isLive = (c: Clock) => !c.time && c.speed === 1;
export function withSpeed(c: Clock, speed: number, wall: number): Clock; // re-anchor, today's setSpeed
export function jumpTo(c: Clock, at: Date, wall: number): Clock;         // keeps speed
export function stepBy(c: Clock, ms: number, wall: number): Clock;       // jumpTo(clockAt + ms)
export function live(wall: number): Clock;                               // goLive
```

`main.ts` keeps `clockStart` as `anchor` and `simTime()` becomes
`clockAt({ time: settings.time, speed: settings.speed, anchor: clockStart }, wallAt(perfNow))`.
No behaviour change in this step.

### 2. Transport semantics (`web/src/hotkeys.ts`)

- `rewindSpeed(current)` / `forwardSpeed(current)`: the media-player ladders above.
- `shortSpeed(speed)`: the rate chip's text (beside the existing `formatSpeed`).
- `HotkeyContext` gains `jumpTo(date: Date)` and `stepTime(ms: number)`, implemented in
  `main.ts` with `clock.ts`, re-anchoring `clockStart` like `setSpeed`.
- New hotkeys in the `Time` group (all currently free):

  | Key | Action |
  | --- | --- |
  | `;` / `'` | Step back / forward 1 hour (Shift: 1 day), repeating |
  | `Shift+,` / `Shift+.` | Rewind / fast-forward (media ladder) |
  | `Shift+C` | Show the transport bar and open the picker |

  `<` and `>` are bound today as aliases of `,` and `.`; they move to rewind and
  fast-forward. On layouts where Shift+`,` isn't `<`, the buttons still work.

  The help panel lists them automatically (`helpRows()`).

### 3. `web/src/transport.ts` (new, DOM)

A class like `PerfPanel` / `Drawer`:

- `constructor(root, { run(key), jumpTo(date), preset(name) })`. The buttons call hotkeys
  through `run`, the way the dock does, so behaviour and toasts can't drift between keys and
  buttons.
- `refresh(settings, simDate, live: boolean)` called once per frame from `frame()`. It
  touches the DOM only when the text changes (the `put()` pattern from `hudPanels.ts`),
  and formats to whole seconds, so it updates at most once a second at real time.
- The picker's markup is built lazily on first open.
- `index.html`: `<div id="transport" class="glass" role="toolbar" aria-label="Time">` next
  to `#drawer`, plus its CSS (reduced-motion and `.lite` variants, like the rest).

### 4. Wiring in `main.ts`

- Construct the transport after the drawer; call `transport.refresh(...)` in `frame()` next
  to `perfPanel.update`.
- Add `jumpTo`/`stepTime` to `hotkeyContext`.
- Add the satellite age limit where `satelliteOverlay` and the bulk propagation run.
- A jump of any size clears and re-requests what depends on the time: `liveShown()` already
  handles imagery; force the bulk satellites to re-propagate (`requestedTime = NaN`).

### URL behaviour

`time` and `speed` are already in the URL, so a link reproduces the clock. One nuance:
`time` is the anchor of the last change, so reloading a running clock restarts from that
anchor. Paused (the common case for sharing a moment) is exact. Leave it; it matches how
xearth's `-time` flag worked.

## Phases

Each is its own PR, shippable alone.

1. **Clock model.** `clock.ts` + tests; `main.ts` delegates to it; `jumpTo`/`stepTime` in
   the hotkey context; the new step and rewind/forward hotkeys. *Keyboard-only users get
   everything except the picker.*
2. **Transport bar.** `transport.ts`, markup, CSS, reveal-with-dock behaviour, the dock's
   Time button, phone layout, the DATA: NOW chip.
3. **Picker.** Date/time inputs, UTC/Local, presets, Android back button.
4. **Satellite age limit.** Hide/tag satellites far from their elements' epoch.

## Testing

- **Unit (vitest, node):** `clock.ts` (continuity across `withSpeed`/`jumpTo`/`stepBy`,
  negative speeds, live detection); the rewind/forward ladders; `shortSpeed`; the presets'
  times against known dates (2026-12-21 solstice, 2027-08-02 total solar eclipse);
  `hotkeys.test.ts` already checks for key collisions.
- **Drawer test:** extend `drawer.test.ts` for the Time button.
- **In the browser** (Playwright, pre-installed): load `?time=2027-08-02T10:07:00Z&speed=0`
  and screenshot the eclipse; click ⏩ twice and check the rate chip and URL; open the picker
  on a phone-sized viewport; confirm `T`/NOW returns to live and the chip clears.

## Open questions

1. **Hazards in the past.** Keep them drawn with the DATA: NOW chip (proposed), or fade them
   out when the clock is far from now?
2. **Bar placement.** Bottom-centre above the dock (proposed), or under the readout, top
   left, where the time already is?
3. **Step size.** Fixed 1 h / 1 day (proposed), or scaled to the speed (one second's worth
   of the current rate)?

## Later

- A scrub timeline (drag across ±48 h) with tick marks for sunrise/sunset at the view's
  centre and upcoming launches.
- Dated data for the past: GIBS layers by date for imagery, USGS/EMSC queries for quakes,
  archived cloud maps from the pipeline.
