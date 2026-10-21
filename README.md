# xearth web

A live space view of Earth in the browser, after [xearth](https://hewgill.com/xearth/original/):
the globe is lit by the real Sun for the current moment and redraws on a timer, with a
global cloud layer refreshed every hour from geostationary satellites.

- **Lighting** — the subsolar point comes from [astronomy-engine](https://github.com/cosinekitty/astronomy)
  (tested against USNO equinox/solstice times and Meeus to < 0.02°). A soft terminator fades
  through civil twilight into NASA Black Marble city lights.
- **Views** — xearth's `fixed`, `sunrel`, `orbit` and `moon` positions; orthographic by
  default, perspective with `dist`. Drag to look around, scroll to zoom.
- **Stars** — the ~9,100 naked-eye stars of the Yale Bright Star Catalogue, placed in the
  real sky (precessed to date and turned with sidereal time), so the constellations behind
  the globe are the right ones and move with the view. Magnitude sets both brightness and
  dot size, B−V sets a gentle blackbody tint, and `stars=photo` dims them the way a camera
  exposed for the sunlit Earth would.
- **Satellites:** the ISS, Tiangong and **SAT GUS** (Mark Rober's Space Selfie satellite,
  NORAD 62713) are labelled, with orbit lines and a `view=track` that rides along with them.
  The ~10,600 Starlinks are drawn as a point cloud. All are propagated live with SGP4 from
  CelesTrak elements, hidden behind the Earth, and dimmed in its shadow.
- **Clouds** — NOAA/NESDIS GMGSI longwave-infrared mosaic (GOES-East/West, Meteosat,
  Himawari), converted hourly to an equirectangular alpha map and cross-faded in.
- **Everything is a URL parameter**, like xearth's command-line flags, and the common ones have
  hotkeys. Press **H** in the app for the full list.

## Hotkeys

| Keys | Action |
|---|---|
| `C` `N` `G` `M` `L` | clouds, city lights, grid, markers, label |
| `S` | stars: on → camera exposure → off |
| `1` `2` `3` `4` | fixed, facing the Sun, orbit, from the Moon |
| `6` `7` `8` | track the ISS, Tiangong, SAT GUS (Mark Rober) |
| `O` | satellites: Starlink + named → named only → off |
| `5` | dusk line down the middle · `V` cycles modes · `Home` back over your time zone |
| arrows (`Shift` = faster) | look around; in the Sun-facing view they shift the offset from the Sun |
| `+` `−` `[` `]` `0` | zoom, rotate, reset · `P` perspective/orthographic |
| `Space` `.` `,` `T` | pause, faster, slower (into reverse), back to now |
| `R` `F` `H` | check for new clouds, fullscreen, help |
| `D` | frame-rate display |

The table lives in `web/src/hotkeys.ts` and also generates the in-app help, so they can't
drift apart.

## Layout

```
web/        Vite + TypeScript + WebGL2 app
  src/astronomy.ts   subsolar / sublunar points
  src/view.ts        view modes, camera, projection
  src/renderer/      full-screen ray-sphere shader
  src/cloudSync.ts   polls clouds/latest.json, hands new maps to the renderer
  src/stars.ts       star frame, magnitude → brightness/size, B−V → colour
  src/satellites.ts  featured satellites, SGP4 (satellite.js), shadow, orbit tracks
  src/satWorker.ts   Starlink propagation off the main thread
  public/stars.json  Bright Star Catalogue, compacted (rebuild: node scripts/build-stars.mjs)
  scripts/fetch-textures.mjs   downloads NASA Blue/Black Marble
pipeline/   Python: GMGSI NetCDF → clouds/clouds-YYYYMMDDTHHMMZ.webp + latest.json;
            CelesTrak GP → satellites/latest.json (xearth_clouds.satellites)
.github/workflows/  CI, and an hourly build-and-deploy to GitHub Pages
```

## Running locally

```bash
cd web
pnpm install
pnpm textures --current      # this month's Blue Marble + Black Marble (~3 MB); omit --current for all 12
pip install -e ../pipeline   # numpy, netCDF4, Pillow
pnpm clouds                  # newest GMGSI file → public/clouds/
pnpm satellites              # CelesTrak elements → public/satellites/ (at most every 3 h)
pnpm dev
```

The app runs without textures or clouds (plain blue globe, "clouds unavailable") and says
which is missing in the label.

Tests: `pnpm test` in `web/`, `pytest` in `pipeline/`.

## URL parameters

| Parameter | Meaning | Default |
|---|---|---|
| `view` | `fixed`, `sunrel`, `orbit`, `moon`, `track` | `fixed` |
| `track` | `iss`, `tiangong`, `satgus` | `iss` |
| `sats` | `all` (Starlink + named), `featured`, `0` | `all` |
| `lat`, `lon` | viewer position (`fixed`) or offset from the subsolar point (`sunrel`) | 20, your time zone's meridian |
| `period`, `inc` | orbit period (h) and inclination (°) | 1.5, 51.6 |
| `dist` | viewer distance in Earth radii; 0 = orthographic | 0 |
| `mag`, `rot` | size, rotation (° counter-clockwise) | 1, 0 |
| `wait` | seconds between redraws | 60 |
| `time`, `speed` | ISO start time; clock multiplier | now, 1 |
| `clouds`, `lights`, `grid`, `markers`, `label` | `0` / `1` | 1,1,0,1,1 |
| `stars` | `1`, `0`, or `photo` (camera-exposure dimming) | 1 |
| `fps` | `1` shows the frame-rate display | 0 |
| `cloudsrc`, `satsrc` | folders holding each `latest.json` (e.g. an R2/S3 bucket) | `clouds/`, `satellites/` |

## How the cloud map is made

GMGSI_LW files (`s3://noaa-gmgsi-pds/GMGSI_LW/YYYY/MM/DD/HH/`) are 4999×3000 Mercator grids,
72.7°S–72.7°N, of 8-bit grey levels where **higher = colder**. The pipeline:

1. Masks pixels whose quality flag isn't 0. Off-disk pixels poleward of ~60° are stored as 255 and
   would otherwise read as the coldest possible cloud.
2. Estimates a **local clear-sky baseline**: the 10th percentile in ~3°×15° blocks, capped at
   25 levels above the row's own baseline so an overcast block can't call its cloud "clear",
   then smoothed. A per-row baseline alone leaves clear ocean grey wherever a hot desert shares
   its latitude.
3. Maps the excess over that baseline to opacity, and forces very cold tops opaque.
4. Reprojects to a 4096×2048 equirectangular map, then fills the polar caps (no geostationary
   view) with a deliberately featureless haze that fades out of the last reliable rows.
5. Writes a WebP, then `latest.json` atomically, and keeps the last three maps.

Infrared can't see low warm cloud (marine stratocumulus reads faint) and cold high terrain can
read as thin cloud. Both are limits of a single IR channel.

## How the stars are drawn

- **Where:** J2000 catalogue positions go through astronomy-engine's precession/nutation
  matrix and Greenwich apparent sidereal time into the Earth-fixed frame, the same frame as
  the globe. Perspective views use the true focal length. Orthographic views have no real
  field of view, so the sky borrows one (~30° across the shorter side).
- **How bright:** Sirius is ~1,500× a magnitude 6.5 star, which no screen can show. Planetarium
  software compresses that range, and so does this: `t = (6.5 − V) / 8` sets both the peak
  (`0.07 + 0.93·t^0.7`) and a Gaussian dot width (`0.55 + 1.6·t^1.8` px). Faint stars stay
  sub-pixel dust and only the brightest few dozen get a visible glow. Stars fade out over the
  magnitude past 6.5.
- **Colour:** B−V gives an effective temperature (Ballesteros 2012), then a blackbody colour,
  pulled 30% of the way toward white.
- **`stars=photo`:** dims every star by `16 · f^0.6` magnitudes, where `f` is the share of the
  screen covered by sunlit Earth. Faint stars go first, and the night side brings them all back.
- No twinkling: that comes from Earth's atmosphere, so it doesn't happen in space.

## How the satellites work

- **Data:** the pipeline fetches CelesTrak GP elements (OMM JSON) for the named satellites and
  the Starlink group. It keeps the 11 numbers SGP4 needs per satellite (1.1 MB, ~400 KB
  gzipped) and publishes `satellites/latest.json`. CelesTrak updates every 2 hours and answers
  a repeat download with HTTP 403 "has not updated", so the pipeline refetches only when its
  file is over 3 hours old, and reuses the previous data on that 403. The deploy workflow
  carries the file between runs in the Actions cache. `--seed starlink=file.tle` builds a group
  from a local TLE file instead, for offline use.
- **Propagation:** satellite.js SGP4 → TEME → Earth-fixed via GMST, in Earth radii, the same
  frame as the globe. The 3 named satellites run on the main thread, with an orbit line over
  ±½ period. Starlink (~20 ms a pass on a desktop) runs in a Web Worker, once per simulated
  second.
- **Drawing:** Starlink is a GL point layer after the globe. Each point is tested against the
  Earth (disc silhouette in orthographic, ray-sphere in perspective) and against a
  one-radius shadow cylinder, so it dims on the night side. Named satellites are drawn on the
  overlay: a filled marker when sunlit, hollow in shadow, the past half-orbit as a fading
  trail and the next half dashed. The top-left label shows the tracked satellite's altitude,
  speed and sunlit state.
- **Scale:** a Starlink is ~10 m across, so the dots are deliberately oversized, as on every
  tracker.

## Frame rate

Press **D** (or add `?fps=1`) for a panel showing frames per second, a sparkline of frame
intervals (60 and 30 fps guides), main-thread time split into `sim` / `gl` / `overlay`, GPU
time (when the browser exposes `EXT_disjoint_timer_query_webgl2`), and how redraws are
scheduled.

- **Redraws follow on-screen motion.** The app redraws only as often as needed to keep
  anything from moving more than half a pixel between frames, capped by `wait`. At default
  zoom satellites move ~0.4 px/s, so that's about once a second. Zoomed in 6× it's every
  ~170 ms, and a fast clock, a drag or a cloud cross-fade renders every display frame.
  "1 FPS" at rest is by design.
- **Time is read on the frame's vsync timestamp**, so motion advances evenly per frame.
- **Starlink is extrapolated, not re-propagated, each frame.** The worker returns positions
  *and* Earth-fixed velocities every 10 simulated seconds, and the shader carries each point to
  the frame's exact time (~0.4 km error at 10 s; clamped at ±60 s).
- **Orbit tracks are sampled on a fixed time grid** and cached, so a frame computes at most
  one new SGP4 sample instead of ~480.
- **Glows are cached as sprites.** Canvas `shadowBlur` is rasterised after our code returns,
  so it never shows in JS timings, but ~40 glowing city labels cost ~15 ms a frame. City,
  satellite and reticle glows are drawn once into offscreen canvases and stamped.

Measured at ×600 in Chrome (1568×741, this machine): **32–40 fps, worst frame 66.6 ms → a
locked 59–60 fps, worst 16.8 ms, 0 slow frames**. Main-thread time 4.2 → 2.5 ms; simulation
2.1 → 0.5 ms.

## Data and credits

- Earth imagery: NASA Visible Earth — Blue Marble Next Generation (Reto Stöckli, NASA Earth
  Observatory) and Black Marble 2016. Public domain.
- Stars: Yale Bright Star Catalogue, 5th revised ed. (Hoffleit & Warren 1991), via CDS
  (catalogue V/50).
- Interface type: Chakra Petch by Cadson Demak (SIL Open Font License 1.1), bundled via
  Fontsource.
- Satellite elements: CelesTrak (Dr T.S. Kelso), from the 18th Space Defense Squadron's GP
  data. SGP4: satellite.js (MIT). SAT GUS is operated by CrunchLabs.
- Clouds: NOAA/NESDIS Global Mosaic of Geostationary Satellite Imagery (GMGSI) via the NOAA
  Open Data Dissemination program. Use does not imply NOAA endorsement.
