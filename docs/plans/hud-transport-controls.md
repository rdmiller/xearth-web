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
4. Mouse, touch and keyboard all work.
5. Hazard layers fade out as the clock moves away from now, since their data is of the
   present, and fade back in as it returns.
6. Fully usable on a phone, portrait or landscape, in the browser, the installed web app and
   the Android app: thumb-sized targets, no hover needed, clear of the notch and home
   indicator, and never covering the rest of the HUD.

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
pins it open too. Touch screens have no hover, so they get their own rules (see *Mobile*).

### The picker

Opened by the date on the bar, or **Shift+G** ("go to"; Shift+C stayed with pinning the
bar, which phase 3 gave it). A popover above the bar on wide screens, a bottom sheet on
phones (see *Mobile*). It lives inside the bar, so the bar stays while it's open.

- `<input type="date">` and `<input type="time" step="1">`, with a **UTC / Local** toggle,
  which also sets the zone of the bar's own date and time (the readout stays UTC). The
  native inputs give phones their own wheels and keep the hotkey handler out of the way
  (it already ignores events from `input`).
- **Presets** (`timePresets.ts`, all from astronomy-engine): Now · Equinox / solstice ·
  Sunrise here · Sunset here (at the view's centre) · Full moon · New moon. Each is the next
  one after the moment shown, so pressing again goes on to the one after. What it found
  shows on a line in the picker ("Full moon · 2026-10-26 04:12 UTC"), not a toast, which
  would sit behind it. Then −1 d · −1 h · +1 h · +1 d, which replace the plan's ±24 h
  presets.
- **No eclipses** (decided in phase 4): the globe isn't drawn with the Moon's shadow on it,
  nor the Moon with the Earth's, so an eclipse would look like any other day. They're in
  *Later*, with the shadows.
- **Go** jumps there, keeping the current speed (paused stays paused, real time plays on
  from the new moment). Escape, a press outside it, or Android's back button closes it.
- **Range:** 1900–2100. astronomy-engine is good far beyond that, but the stars' precession
  and the textures are tuned for the present, and the input needs bounds.

### Mobile

The bar has to work as well on a phone (browser, installed web app, and the Capacitor
Android app) as on a desktop. The rules below are part of each phase, not a later pass.

**Breakpoint.** Use the app's own `SMALL_SCREEN` query (`params.ts`:
`(max-width: 600px), (max-height: 500px)`), so landscape phones get the compact layout too.
Touch behaviour keys off `(pointer: coarse)` separately, because a tablet is touch but not
small.

**Compact layout (portrait phone).** One row, inset 12 px from each edge, never scrolling
sideways:

```
       10 MIN/S
 [⏪]   [⏯]   [⏩]   OCT 24 2026      [NOW]
                    14:32:07
```

- The step buttons drop out. Stepping on a phone happens in the picker (±1 h / ±1 day
  buttons) and by press-and-hold on ⏪ / ⏩ (below).
- The date block takes two lines in the HUD Digits face (tabular figures, so its width
  doesn't jitter as the seconds tick): the date, then the time. In phase 4 the whole block becomes the button that opens the
  picker.
- The rate is a small tag over ⏯ (as the dock tags its buttons: LIVE, TRACK), not on the
  date's line: "OCT 24 2026 · 10 MIN/S" didn't fit at 360 px, the commonest Android width.
  At real time there's no tag.
- Width budget at 320 px (the narrowest phones): 3 × 44 px buttons and NOW leave about 80 px
  for the date block; below 340 px the gaps tighten and the time drops to 14 px to fit.
- **Landscape phone** (`max-height: 500px`): the same single row, the date on one line. The
  dock now takes its phone layout (one row scrolling sideways) here too: wrapped, it was
  286 px of a 343 px screen, and the bar stacked on it went off the top.

**Touch targets.** Every control is at least 44 × 44 px (Apple's minimum; Android asks for
48 dp, and 44 CSS px is about that on most phones), with at least 6 px between neighbours.
That's larger than the dock's 40 px phone buttons on purpose: the transport buttons get
pressed repeatedly, often one-handed.

**No hover.** On `pointer: coarse`:

- While live, the bar shows when the dock's grip pins the dock open (the grip is already the
  only way into the dock on touch), and goes when it's unpinned. The Time button in the dock
  does the same.
- While not live, the bar stays on screen, so a phone user who fast-forwarded can always get
  back to now with one tap.
- Captions that appear on hover elsewhere become `aria-label`s here, and the icons carry the
  meaning alone.

**Gestures.**

- The bar sits on top of the overlay canvas, whose pointer handlers drag, pinch and pick.
  The bar stops `pointerdown` propagation and isn't a child of the canvas, so a tap on a
  button never picks a satellite or starts a drag. A drag that starts on the globe and runs
  over the bar keeps going (pointer capture is already on the canvas).
- `touch-action: manipulation` on the bar: no double-tap zoom, no 300 ms tap delay.
- **Press and hold** ⏪ / ⏩ (≥ 400 ms) steps back/forward an hour, then repeats every
  150 ms, speeding up to a day per step after 2 s; a plain tap changes speed as usual.
  It's built on `pointerdown` / `pointerup` / `pointercancel` / `pointerleave` with
  `setPointerCapture`, so it stops if the finger slides off or the OS takes the gesture.
- No long-press callout or text selection: `-webkit-touch-callout: none`,
  `user-select: none`, and `contextmenu` cancelled on the bar (Android otherwise opens a menu
  on a long press).

**Safe areas.** The page sets `viewport-fit=cover`, so content can sit under the iPhone home
indicator, Android's gesture bar and a landscape notch. The bar's bottom offset adds
`env(safe-area-inset-bottom)`, and its sides add `env(safe-area-inset-left/right)`. Nothing
in the CSS uses these yet. The dock should get the same treatment in the same PR, or the bar
would float correctly over a dock that's half under the home indicator.

**Stacking with the rest of the HUD.** The drawer already publishes its height as
`--drawer-h` / `--dock-full` (`main.ts`), and the toast column, the pick panel and the toast
are positioned from them. The bar sits at `bottom: calc(var(--drawer-h) + 8px +
env(safe-area-inset-bottom))` and publishes its own height as `--transport-h` from a
`ResizeObserver`. Those three then add `--transport-h` to their bottom offset, so on a phone
the toast column fills exactly the room between the readout (`--readout-bottom`) and the
bar, and nothing overlaps. Orientation changes are just another resize.

**The picker as a bottom sheet.** On `SMALL_SCREEN` it opens as a full-width sheet above the
bar instead of a popover:

- Native `<input type="date">` and `<input type="time">`: iOS shows its wheels, Android
  (Chrome, the TWA and the Capacitor WebView) its calendar and clock dialogs. No custom
  picker to build, and no on-screen keyboard.
- Font size ≥ 16 px in the inputs, or iOS Safari zooms the page on focus (the search box
  already does this).
- Presets as a two-column grid of 44 px buttons, then ±1 h / ±1 day, then Go. The sheet
  scrolls inside itself (`overscroll-behavior: contain`) if a landscape phone is too short
  for it, so the globe behind doesn't scroll or zoom.
- iOS's time wheel has no seconds; that's fine. The picker sets minutes, and stepping or the
  clock itself gets you to the second.
- Local time is the default on phones (the native pickers are local-time dialogs); the
  UTC/Local toggle is still there, remembered per viewer.
- Closes on Go, Escape, a tap outside, a swipe down on its handle, and Android's back
  button, which gets more steps in `main.ts`'s `backButton` chain: the picker first, then the
  existing search → satellite tree → help, then the bar (when it's pinned on screen), then
  minimise. (The bar comes after help, not before search: back closes what's on top first.)

**Performance on phones.** In `.lite` mode (slow GPUs) the bar drops its backdrop blur like
every other `.glass`. The date text updates only when the shown text changes: once a second
at real time, and at most ~4 times a second at high speeds, so a mid-range phone isn't doing
layout every frame. The bar adds no work to `frame()` beyond a string compare.

**Accessibility (VoiceOver, TalkBack).** `role="toolbar"`, an `aria-label` on every button,
`aria-pressed` on play/pause. The date button's label reads in full ("Simulated time:
24 October 2026, 14:32 UTC. Change"). The time is not an `aria-live` region; it would talk
every second.

### Hazards fade away from now

Hazard data is a snapshot of the present: last night's quake ringed over a Tuesday three
weeks ago would be a lie. So as the clock moves away from now, in either direction, the
hazard layers fade out, and they fade back in as it returns. The Sun, Moon, stars,
satellites and launches are what keep moving.

**The curve.** `hazardFade(offsetMs, tier)` returns 1 (fully shown) to 0 (gone), as a
smoothstep on `|simTime − now|`, in two tiers:

| Tier | Layers | Fully shown within | Gone by |
| --- | --- | --- | --- |
| **Live** (minutes to hours old) | aurora, ionosphere, lightning, radar + IMERG, quakes, fires, storms, severe weather + MeteoAlarm, tsunami, GDACS events and US volcano alerts, smoke, ash, meteors | 30 min (`LIVE_MAX_SKEW_MS`, the same as live imagery) | 2 h |
| **Daily** (a day's product) | snow and sea ice, sea temperature, the VIIRS flood map | 12 h | 36 h |

At real time a fade takes over an hour; at 1 h/s it takes about 1.5 s, which reads as a
deliberate fade; a jump from the picker is instant. A storm's forecast track is the one
case of hazard data that's about the future, but it still fades on the live tier: it's
today's forecast, not what happened.

**What stays.** Clouds, the live-imagery fallback (already handled by `liveShown`), winds,
buoys, the Blue Marble's month, and the ISS telemetry window. Clouds aren't a hazard, and
without them the globe would be bare. Buoys
are observations, not hazards: their dots, picks and windows (with their own 24-hour
sparklines and timestamps) behave as they do today, whatever the clock.

**What fading means, layer by layer:**

- **Globe shader** (aurora, iono, snow/ice, radar + IMERG, smoke, ash, SST): the `u…On`
  flags become strengths. Each `if (uXOn > 0.5)` becomes `> 0.0`, and that layer's blend
  is multiplied by the strength. Iono and SST carry a mode in theirs, so they get a plain
  float each (`uIonoFade`, `uSstFade`). No new textures, so the 16-texture-unit test still
  holds.
- **Point layers** (fires, lightning, the flood map): a `uOpacity` on the layer.
- **Overlay canvas** (quakes, storms, events and volcano alerts, tsunami, severe,
  meteors): the draw functions set their own `globalAlpha`, so each run of hazards is drawn
  to a scratch canvas and composited at the fade, keeping the stacking order (buoys stay
  between them, unfaded). Fully shown, they draw directly as before. Below 0.3, a layer's
  labels drop out of the label placement (`overlay.ts`'s priority list), so faded symbols
  don't take label space from cities and launches.
- **At 0** a layer is skipped entirely: no drawing, no label requests, and no hit-testing
  in `pickAt` / `hoverAt`, so nothing invisible can be clicked. An open window on a hazard
  (`settings.pick`) closes the same way it does when its layer is switched off
  (`pickedThing` returns undefined), and reopens when the clock comes back to now.
- **Readout:** a faded-out layer's row goes, and one row says "Hazards hidden: live data
  shows now".
- **Toasts:** new-alert toasts (MeteoAlarm reds, tsunami bulletins, eruptions) aren't raised
  while their layer is faded below 0.5; they're shown when the clock comes back, if they're
  still current.
- **Settings and the URL don't change.** Fading is a view of the clock, not a setting: the
  dock buttons stay lit, toggling a layer still works and takes effect on return, and a link
  still carries `quakes=1`.
- **Polling carries on** on the usual schedules, so coming back to now is instant. The
  feeds are small. Pausing them while faded would save a little mobile data at the cost of a
  blank return, so it's not worth it.

**No chip on the bar.** The time controls don't flag hidden hazards (decided after
phase 3: it wasn't needed). The readout's `hazards` row is the one note that they're fading
or hidden.

### Satellites far from now

Satellites need one extra limit: SGP4 from today's elements drifts badly beyond a few weeks.
`satAge.ts` measures from the elements themselves, not from now:

- **The constellations** (the point clouds, their name labels and their clicks) go more than
  30 days from the catalog's date. The readout's satellites row says so ("constellations
  hidden: orbits from 24 Oct 2026").
- **The named satellites** (and one picked or followed from a constellation), each from its
  own epoch: past 30 days the label reads "ISS · APPROX.", the tracking row and pick window
  say "position approximate"; past a year they go, with their pick window. A view following
  one stays where it was set; the ISS camera goes with the ISS.
- NASA's live ISS telemetry already only places the ISS near now (`STATE_VECTOR_MAX_AGE_MS`).

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
- `shortSpeed(speed)`: the rate chip's text (beside the existing `formatSpeed`); it comes
  with the bar in phase 3.
- `HotkeyContext` gains `jumpTo(date: Date)` and `stepTime(ms: number)`, implemented in
  `main.ts` with `clock.ts`, re-anchoring `clockStart` like `setSpeed`.
- New hotkeys in the `Time` group (all currently free):

  | Key | Action |
  | --- | --- |
  | `;` / `'` | Step back / forward 1 hour (Shift: 1 day), repeating |
  | `Shift+,` / `Shift+.` | Rewind / fast-forward (media ladder) |
  | `Shift+C` | Keep the time controls on screen |
  | `Shift+G` | Open the time picker (phase 4) |

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
- A `ResizeObserver` publishes `--transport-h`; press-and-hold lives here too.
- Pure helpers, exported for tests: `compactDate(date, zone)` / `fullDate(date, zone)`, and
  `holdStep(heldMs)` (the press-and-hold step size and repeat interval).
- `index.html`: `<div id="transport" class="glass" role="toolbar" aria-label="Time">` next
  to `#drawer`, plus its CSS: the `SMALL_SCREEN` and `pointer: coarse` rules, safe-area
  insets, and reduced-motion and `.lite` variants, like the rest. `#toasts`, `#pick` and
  `#toast` add `var(--transport-h, 0px)` to their bottom offsets.

### 4. `web/src/hazardFade.ts` (new, pure)

```ts
export type FadeTier = 'live' | 'daily';
export const FADE_TIER: Record<HazardLayer, FadeTier>;            // the table above
export function hazardFade(offsetMs: number, tier: FadeTier): number; // 1 → 0, smoothstep
export function fades(offsetMs: number): Record<HazardLayer, number>;  // every layer, once a frame
```

`frame()` computes `fades(date − Date.now())` once and passes it on:

- `FrameState` (renderer): `aurora`, `snowIce`, `radar`, `imerg`, `smoke`, `ash`, `floods`
  become strengths, `ionoFade` and `sstFade` join the modes, and `fires` / `lightning` gain
  an `opacity`. `globe.frag.glsl` multiplies each layer's blend by its strength.
- The overlay state: `hazardAlpha` (every overlay hazard is on the live tier).
  `overlay.ts` composites the hazard runs at it (`drawFaded`) and fades or drops their
  labels (`fadeRequests`). At 0, `main.ts` doesn't pass the layers at all.
- `main.ts`: `shown(k, fade)` (on and not faded away) gates the overlay data, `targetAt`
  (clicks and hover), `pickedThing` and the readout rows. Alert toasts go through
  `announcing(k)` (`≥ 0.5`), and the frame catches them up when the clock comes back.

### 5. Wiring in `main.ts`

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

1. **Clock model** (done). `clock.ts` + tests; `main.ts` delegates to it; `jumpTo`/`stepTime` in
   the hotkey context; the new step and rewind/forward hotkeys. *Keyboard-only users get
   everything except the picker.*
2. **Hazard fade** (done). `hazardFade.ts` + tests; shader strengths; overlay alpha, labels and
   hit-testing; readout row; toast suppression. Worth having before the bar: the `,` / `.`
   keys can already take the clock far from now today.
3. **Transport bar** (done; UTC only until the picker's toggle). `transport.ts`, markup, CSS, reveal-with-dock behaviour, the dock's
   Time button, and all of *Mobile* that applies to the bar:
   compact and landscape layouts, 44 px targets, touch reveal, press-and-hold, safe areas
   (dock included), `--transport-h` stacking.
4. **Picker** (done). Date/time inputs, UTC/Local, presets, Android back button; the bottom sheet
   on phones.
5. **Satellite age limit** (done). Hide/tag satellites far from their elements' epoch.

## Testing

- **Unit (vitest, node):** `clock.ts` (continuity across `withSpeed`/`jumpTo`/`stepBy`,
  negative speeds, live detection); the rewind/forward ladders; `shortSpeed`; the presets'
  times against almanac dates (the 2024 December solstice, January 2024's full and new moon,
  Greenwich's midsummer sunrise and sunset, none in the midnight sun);
  `hotkeys.test.ts` already checks for key collisions.
- **Drawer test:** extend `drawer.test.ts` for the Time button.
- **Unit, hazard fade:** `hazardFade` is 1 within 30 min and 0 beyond 2 h on the live
  tier (12 h / 36 h daily), the same for past and future offsets, and never rises as the
  offset grows; every `HazardKey` except `buoys`, plus ash, SST, iono and floods, has a tier, and
  `buoys` has none; the shader
  test still passes with the strengths.
- **Unit, mobile helpers:** `compactDate` fits the 320 px budget (character count in the
  tabular face) for every month name; `holdStep` gives an hour, then a day after 2 s.
- **In the browser** (Playwright, pre-installed): click ⏩ twice and check the rate chip and
  URL; confirm `T`/NOW returns to live. In the picker: Go keeps the speed, presets chain,
  Local shows the browser's zone, 1850 is refused, Escape, Shift+G and a click outside.
  On phones: the sheet in view, 16 px inputs, 44 px targets, Go in sight without scrolling,
  closed by its handle or a tap outside, which picks nothing.
- **Hazard fade in the browser:** with quakes, radar and severe on, load `?time=` 3 h ago:
  the quake rings and radar are gone, the readout says so, and a click where a
  quake was picks nothing. Load 1 h ago: they're partly faded. Press NOW: they're back in
  full, and `quakes=1` was in the URL throughout.
- **Phones in Playwright** (device emulation with `hasTouch`: iPhone SE at 320 × 568,
  iPhone 15, Pixel 7, and the iPhone 15 in landscape):
  - no horizontal scroll (`scrollWidth === clientWidth`), and the bar inside the viewport;
  - every bar control's bounding box ≥ 44 × 44;
  - the bar doesn't overlap the dock, the grip, the toast column or the readout, with a
    toast window open;
  - `tap()` on ⏩ changes speed and doesn't pick or drag the globe;
  - a held ⏩ steps the clock forward by hours, and releasing stops it;
  - tapping the grip shows the bar while live, and it stays while not live;
  - the picker opens as a sheet, the inputs are ≥ 16 px, and it closes on a tap outside.
- **Real devices, before merging phases 3 and 4:** iOS Safari (home indicator, notch in
  landscape, the time wheel, no focus zoom), Android Chrome, and the Capacitor build
  (`pnpm android:run`: native date/time dialogs in the WebView, the back button order).
  Playwright can't emulate safe-area insets, so they're checked by hand here.

## Decisions

1. **Hazards away from now:** they fade out (see *Hazards fade away from now*).
2. **Bar placement:** bottom centre, above the dock.
3. **Step size:** fixed, 1 hour (Shift or a long hold: 1 day).

## Later

- A scrub timeline (drag across ±48 h) with tick marks for sunrise/sunset at the view's
  centre and upcoming launches.
- Dated data for the past: GIBS layers by date for imagery, USGS/EMSC queries for quakes,
  archived cloud maps from the pipeline.
- Eclipses: the Moon's shadow on the globe and the Earth's on the Moon, then "next solar
  eclipse" (centring the view on the greatest eclipse) and "next lunar eclipse" presets
  (astronomy-engine's `SearchGlobalSolarEclipse`, `SearchLunarEclipse`).
