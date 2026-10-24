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
5. Fully usable on a phone, portrait or landscape, in the browser, the installed web app and
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

A small glass popover above the bar on wide screens, a bottom sheet on phones (see *Mobile*):

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
 [⏪] [⏯] [⏩]   OCT 24 2026        [NOW]
                14:32:07 · 10 MIN/S
```

- The step buttons drop out. Stepping on a phone happens in the picker (±1 h / ±1 day
  buttons) and by press-and-hold on ⏪ / ⏩ (below).
- The date block takes two lines in the HUD Digits face (tabular figures, so its width
  doesn't jitter as the seconds tick), with the rate after the time. The whole block is the
  button that opens the picker.
- Width budget at 320 px (the narrowest phones): 3 × 44 px buttons, a 52 px NOW, 4 × 6 px
  gaps and 2 × 12 px gutters leave about 88 px for the date block. "14:32:07" at 13 px fits.
- **Landscape phone** (`max-height: 500px`): the same single row, the date on one line
  (`OCT 24 14:32:07 · 10 MIN/S`). There's little height, so the bar and dock stack as
  tightly as they can, with the toast column given what's left.

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
  button, which gets one more step in `main.ts`'s `backButton` chain: picker first, then the
  bar (when it's only showing because it was pinned), then the existing search → satellite
  tree → help → minimise.

**Performance on phones.** In `.lite` mode (slow GPUs) the bar drops its backdrop blur like
every other `.glass`. The date text updates only when the shown text changes: once a second
at real time, and at most ~4 times a second at high speeds, so a mid-range phone isn't doing
layout every frame. The bar adds no work to `frame()` beyond a string compare.

**Accessibility (VoiceOver, TalkBack).** `role="toolbar"`, an `aria-label` on every button,
`aria-pressed` on play/pause. The date button's label reads in full ("Simulated time:
24 October 2026, 14:32 UTC. Change"). The time is not an `aria-live` region; it would talk
every second.

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
- A `ResizeObserver` publishes `--transport-h`; press-and-hold lives here too.
- Pure helpers, exported for tests: `compactDate(date, zone)` / `fullDate(date, zone)`, and
  `holdStep(heldMs)` (the press-and-hold step size and repeat interval).
- `index.html`: `<div id="transport" class="glass" role="toolbar" aria-label="Time">` next
  to `#drawer`, plus its CSS: the `SMALL_SCREEN` and `pointer: coarse` rules, safe-area
  insets, and reduced-motion and `.lite` variants, like the rest. `#toasts`, `#pick` and
  `#toast` add `var(--transport-h, 0px)` to their bottom offsets.

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
   Time button, the DATA: NOW chip, and all of *Mobile* that applies to the bar: compact and
   landscape layouts, 44 px targets, touch reveal, press-and-hold, safe areas (dock
   included), `--transport-h` stacking.
3. **Picker.** Date/time inputs, UTC/Local, presets, Android back button; the bottom sheet
   on phones.
4. **Satellite age limit.** Hide/tag satellites far from their elements' epoch.

## Testing

- **Unit (vitest, node):** `clock.ts` (continuity across `withSpeed`/`jumpTo`/`stepBy`,
  negative speeds, live detection); the rewind/forward ladders; `shortSpeed`; the presets'
  times against known dates (2026-12-21 solstice, 2027-08-02 total solar eclipse);
  `hotkeys.test.ts` already checks for key collisions.
- **Drawer test:** extend `drawer.test.ts` for the Time button.
- **Unit, mobile helpers:** `compactDate` fits the 320 px budget (character count in the
  tabular face) for every month name; `holdStep` gives an hour, then a day after 2 s.
- **In the browser** (Playwright, pre-installed): load `?time=2027-08-02T10:07:00Z&speed=0`
  and screenshot the eclipse; click ⏩ twice and check the rate chip and URL; confirm
  `T`/NOW returns to live and the chip clears.
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
- **Real devices, before merging phases 2 and 3:** iOS Safari (home indicator, notch in
  landscape, the time wheel, no focus zoom), Android Chrome, and the Capacitor build
  (`pnpm android:run`: native date/time dialogs in the WebView, the back button order).
  Playwright can't emulate safe-area insets, so they're checked by hand here.

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
