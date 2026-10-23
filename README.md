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
- **Space weather:** Kp (with NOAA G-scale storm level), GOES X-ray class and the last flare,
  and solar wind speed and Bz, from NOAA SWPC. The Sun disc shows the live GOES SUVI 304 Å image.
- **Sun and Moon:** both are drawn at their true positions and angular size (~0.5°), behind
  the globe like the stars. The Sun is a limb-darkened disc with a glow. The Moon uses NASA's
  LRO colour map, near side to Earth, lit by the real Sun (so it shows its phase) with faint
  earthshine. When either is out of frame, a marker at the screen edge points to it, and **E**
  frames the Sun, then the Moon, just beside the Earth. `bodyscale` enlarges them; at true size
  the Moon is ~1/50 of the Earth's disc.
- **Launch mode:** upcoming launches worldwide (Launch Library 2) as pad markers with live
  countdowns and status. For Starlink missions, SpaceX's own pre-launch orbit prediction (via
  CelesTrak) drives a flight you can watch: an approximate ascent, the coast on the predicted
  orbit, and deployment at the exact predicted time. **J** follows it; **K** previews it from T−1 min.
- **Hazards, live:**
  - **Aurora:** NOAA SWPC's OVATION forecast as a green glow on the night side.
  - **Tropical cyclones:** GDACS for every basin, with NHC detail for its storms. Each gets a
    symbol, name and intensity, the observed track solid and the forecast dashed.
  - **Fires:** NASA FIRMS VIIRS detections from the last 12 h (`firehours`), drawn to scale in
    red-orange.
  - **Earthquakes:** USGS M2.5+ from the last 24 h, as rings sized by magnitude and coloured
    by age, with labels on the largest.
  - **Lightning:** the last 30 minutes of flashes from the GOES-East and GOES-West Geostationary
    Lightning Mappers (the Americas, Atlantic and eastern Pacific) and the Lightning Imager on
    Meteosat Third Generation (Europe, Africa and the Atlantic), as blue-white sparks.
  - **Floods, wildfires, eruptions:** GDACS events with their impact levels; wildfires carry their
    burned area, drawn to scale when zoomed in.
  - **Snow and ice:** today's NOAA IMS snow cover and sea ice, plus Antarctic sea ice from the
    NOAA/NSIDC Sea Ice Index, laid over the month's Blue Marble.
  - **Weather radar:** RainViewer's composite of 1,200+ radars, a new frame every 10 minutes,
    drawn over the clouds the way a weather map shows rain.
  - **Smoke:** NOAA's Hazard Mapping System smoke plumes (light, medium, heavy) over North
    America, as a grey-brown haze on the sunlit ground.
  - **Tsunami alerts:** bulletins from NOAA's two Tsunami Warning Centers at the earthquake's
    epicentre, and live NWS tsunami warnings, watches and advisories lit along US coasts.
- **ISS live telemetry:** NASA's public ISSLive stream (Mission Control console data) in a
  window of gauges while the ISS is tracked: signal, orbit sparklines, cabin-air meters, solar-array dials. While
  the stream is live the ISS is placed from its own GNC state vector instead of SGP4.
- **Satellites:** the ISS, Tiangong and **SAT GUS** (Mark Rober's Space Selfie satellite,
  NORAD 62713) are labelled, with orbit lines and a `view=track` that rides along with them.
  The ~11,100 Starlinks are drawn as a point cloud, from SpaceX's own published ephemerides
  (via CelesTrak supplemental GP), which include newly launched ones not yet catalogued.
  Weather satellites (geostationary, highly elliptical and low orbit), GPS and GLONASS are
  their own colour-coded categories; zoom out to see the navigation shells (~20,000 km) and
  the geostationary ring (~36,000 km). All are propagated live with SGP4 from CelesTrak
  elements, hidden behind the Earth, and dimmed in its shadow.
  - **Satellite panel** (the small button on Satellites in the layer dock, or Shift+O): a tree of every category with
    tri-state checkboxes, colour swatches, counts, and name-label toggles for the categories
    small enough to label. Every far constellation (the diamonds) is named by default; the dense low-orbit dots are not. Satellites a few pixels apart share a label ("MTG-I2 · MTG-S1"), and each label tries right, left, below and above before it is left out.
- **Live imagery** — by day, today's colour pictures from GOES-West, GOES-East and Meteosat
  Third Generation, refreshed as each satellite scans (every 10 minutes), in place of the
  painted Blue Marble and cloud map. Shift+P switches to yesterday's sharper VIIRS mosaic when
  zoomed in, or to the painted globe alone.
- **Clouds** — NOAA/NESDIS GMGSI longwave-infrared mosaic (GOES-East/West, Meteosat,
  Himawari), plus its visible band by day for the low cloud infrared misses, converted
  hourly to an equirectangular alpha map and cross-faded in.
- **Everything is a URL parameter**, like xearth's command-line flags, and the common ones have
  hotkeys. Press **H** in the app for the full list.

## Terrain lit by the Sun

Mountains are shaded by the real Sun, not a fixed lamp. At dawn and dusk, ranges facing the
Sun light up and their far sides fall into shade, and sun-facing ridges catch a little light
just past the terminator. Near noon the effect is slight, as it is from orbit. Shift+E (or
Terrain in the dock) switches it off.

- **Slopes:** `public/relief.webp`, built once by `python scripts/make-relief.py` from NOAA
  NCEI's ETOPO 2022 60″ surface elevation (public domain). The script reads every second
  sample over OPeNDAP (~230 MB; `--cache F.npy` keeps the result for re-runs) and averages
  2×2 to the Blue Marble's 5400×2700 grid, about 7.4 km a texel. Each texel holds the east
  and north slopes, square-root encoded so gentle hills keep their detail, plus the land
  mask. The sea floor stays flat, since sunlight doesn't show it from space. The file ships
  with the app.
- **Shading:** the globe shader tilts each texel's normal by its slope, with a 30× vertical
  exaggeration (`reliefscale` scales it; a 7 km average flattens every real mountain), eased
  off on the steepest slopes so ranges don't break into hard facets. Only the ground uses
  the tilted normal; clouds, smoke and city lights don't.
- **Day texture:** with relief on, the globe's land comes from the Blue Marble without
  NASA's painted-on shading (`textures/surface-MM.jpg`), so mountains aren't lit twice.
  Water comes from the shaded version (`day-MM.jpg`), because the plain one paints the open
  ocean a flat navy. ETOPO's land mask, in the slope map's blue channel and softened over a
  texel at the coast, splits the two. A web worker blends them once per month, which takes
  about half a second. NASA has no plain June image, so June uses July's. With relief off,
  or if a file is missing, the globe goes back to `day-MM.jpg` alone, which the cloud job
  also keeps as its clear-sky reference.
- **Zoomed in:** where the true-colour imagery shows, the relief fades out, because the
  photo already has the real shadows from the satellite's pass.

## Imagery: live, yesterday's, or painted

What the day side shows is one setting, because each choice brings its own clouds and two sets
would read as mush. Shift+P (or Imagery in the dock, tagged LIVE or DAILY) cycles through:

| `imagery=` | Day side | Clouds | Sharpest |
|---|---|---|---|
| `live` (default) | GOES-West, GOES-East and MTG GeoColor pictures, 20–80 min old | in the pictures | ~1 km (2 km a pixel zoomed in) |
| `daily` | Blue Marble; yesterday's VIIRS mosaic once zoomed in | GMGSI, hourly (VIIRS's own when zoomed) | 244 m |
| `painted` | Blue Marble | GMGSI, hourly | Blue Marble, ~7 km |

The night side is always the painted one: Black Marble city lights under the GMGSI cloud map.
The older `truecolor=0` / `1` links still work (painted / daily).

### Live

- **Sources:** GOES-West (137.2°W) and GOES-East (75.2°W) GeoColor from NASA GIBS, and MTG-I1
  (0°) GeoColour from EUMETSAT's EUMETView. Both are WMS servers with CORS, so the browser asks
  each for a JPEG of its disc on the globe's own latitude/longitude grid (1024–2048 px a side,
  chosen by how big the globe is on screen; ~200 KB each at 1024). Checked every 5 minutes.
- **Coverage:** together they see from about 150°E east across the Pacific, the Americas, the
  Atlantic and Africa to about 70°E. Asia and the west Pacific are Himawari's, and neither server has a Himawari colour product, so the painted
  globe shows there, blended in over a few degrees.
- **In the shader:** the pictures are already lit by the real Sun, so they replace the
  finished day-side colour (ground and cloud together) rather than the Blue Marble's albedo.
  Each satellite fades out between 64° and 72° from the point below it, where the view gets
  too oblique; where two overlap, the one seeing more face-on takes over within a few degrees,
  so the clouds' parallax between the two views doesn't ghost.
- **Only by day, then and now:** GeoColor's night side is a different product (infrared cloud
  over a fixed city-lights map), and a scan an hour old has its terminator ~15° from today's.
  So a picture shows only where the Sun is at least ~6° up both now and when it was taken.
  A simulated time more than 30 minutes from now shows the painted globe.
- **Zoomed in** past the Blue Marble (0.09° a screen pixel), the satellite seeing the view's
  centre most face-on is asked for just what's on screen, snapped to GIBS's tile grid so a small
  pan doesn't ask again, down to ~2 km a pixel. The readout names the satellite and resolution.
- **GIBS's lag:** GIBS lists a GOES scan a few minutes after it's taken, but its WMS draws it
  much later, and until then answers with an all-black JPEG rather than an error (2026-10-23:
  00:40Z listed by 01:20, still black at 01:40). So the app tries the listed scans newest
  first with a 64 px picture and uses the first that isn't black. GOES pictures are therefore
  about an hour old, MTG's about 20 minutes. The feeds window shows the oldest disc's time.
- Over open ocean GeoColor is a darker, greyer blue than the Blue Marble, so where a picture
  fades into the painted globe the sea changes tone over a few degrees.

### Yesterday's (daily)

Zoom in past what the monthly Blue Marble can show (about 0.09° a screen pixel) and the day
side switches to yesterday's real colour: NASA GIBS's daily VIIRS mosaic from NOAA-20
("corrected reflectance"), down to 244 m a pixel at the 50× maximum zoom.

- **Only what's on screen:** GIBS serves EPSG:4326 tiles (plain latitude/longitude, the
  globe's own layout) with CORS, so the browser fetches them directly. Once the view settles
  for 0.4 s, it picks the finest level that's no finer than a screen pixel and fetches the
  tiles covering the screen (at most 48, ~70 KB each, cached), draws them into one image
  and hands the globe shader its bounds. A drag or a glide doesn't fetch anything until it
  stops.
- **In the shader:** the photo replaces the Blue Marble on the day side, fading out at the
  edges of the fetched area and wherever GIBS has no data (it draws that black: polar
  night, gaps between passes). The photo has its own clouds — yesterday's — so the live
  cloud layer, the snow and the sea ice step back where it shows, rather than doubling up.
- **Which day:** yesterday (UTC), the newest mosaic that's complete everywhere; a tile that
  comes back empty is retried from the day before. The readout gives the date and the
  resolution in use. Each place is imaged once a day, around 13:30 local time.
- Zooming (wheel and +/−) now goes to 50×, as far as the URL always allowed; it used to stop
  at 8×, where the imagery is ~2 km a pixel.

## Going to a place

- **Search:** press `/` (or the Find button in the dock) and type a place name or
  coordinates. Coordinates can be decimal (`40.71, -74.01`), with hemispheres (`40.71N
  74.01W`, either order) or degrees–minutes–seconds (`40°42′51″N 74°0′21″W`). The app's own
  cities come up instantly; other places come from Open-Meteo's geocoder (GeoNames data,
  CC BY 4.0, CORS-enabled, no key) after a quarter-second pause in typing, cached per
  query, each with its region and country, since names repeat. "My location" asks the
  browser for the viewer's position, only when picked. ↑/↓ choose, Enter goes, Esc closes.
- **Double-click** (or double-tap) a point on the globe to centre on it.
- Either way the view glides along the great circle to the place (~0.5 s for a hop, ~1.5 s
  to the far side; instant with reduced motion), switches to a fixed view and keeps the
  zoom, then marks the spot with a reticle and its name for 12 seconds. Grabbing the globe
  stops a glide.
- **Labels:** a place picked from the search keeps a pink, city-style label on the globe
  (shown even with city labels off). The most recent dozen are kept in the browser and
  listed in the search before anything is typed. "Remove label" on the place card drops one.
- **Place card:** a search also opens a card at the bottom right. It closes itself after
  20 s (30 s with alerts), stays open while the pointer or focus is on it, and closes with
  × or Esc. Each part fills in as it arrives, and each request gives up after 12 s:
  - Local time and UTC offset.
  - Current weather, today's high and low, UV, and sunrise, sunset and daylight, or polar
    night or midnight sun (Open-Meteo forecast, CC BY 4.0, no key).
  - Alerts:
    - NWS active alerts for the point, US and territories only.
    - Air quality, when it's worse than moderate (Open-Meteo air quality, US AQI over 100).
    - Hazards from the app's own layers near the place: tropical cyclones within 800 km,
      tsunami bulletins within 1,000 km, the strongest M4.5+ quake within 300 km in the
      last day (or any within 50 km), GDACS floods and fires within 300 km and eruptions
      within 150 km, GOES or MTG lightning within 50 km, and VIIRS fire detections within 25 km.
      A layer that's switched off is fetched once for the card and cached for 10 minutes.
  - Units follow the browser's locale: °F and mph for the US, °C and km/h elsewhere.

## Layer dock

Every layer has a floating button along the bottom, grouped Earth (clouds, city lights,
snow and ice, radar, smoke, grid), Sky (stars, Sun and Moon, aurora), Hazards (cyclones,
fires, quakes, lightning, GDACS alerts, tsunami), Space (satellites, with a small button for
the satellite panel; launches; ISS telemetry) and HUD (city markers, readout, frame rate, data feeds).

- **No panel:** the buttons rise in as the mouse comes within ~160 px of the bottom of the
  window (fully shown within 90 px) and sink away when it leaves. The nearest ones grow a
  little, like a dock; a name appears above a button on hover or keyboard focus.
- **Pinning:** the grip under the buttons (the only way in on a touch screen, where names
  show under the buttons) or Shift+D pins them open; pinned or not is remembered per browser.
  Hidden buttons are inert, so they can't be clicked or tabbed to by accident.
- **One row** whenever the window is wide enough; they wrap only when it isn't.
- Each button runs the same action as its hotkey (shown in its tooltip), so cycling layers
  keep their cycles and toasts: stars show PHOTO, satellites NAMED, ISS telemetry TRACK in
  their in-between states. A cyan glow marks what's on.
- While the buttons show, toasts and the satellite panel sit above them. Callouts, city
  labels and satellite names make room only while they're pinned; a passing reveal floats
  over the map. The attribution line stays at the very bottom, under the grip.

Icons are [Lucide](https://lucide.dev) (ISC), imported one by one so only those used are
bundled. Lucide has no aurora glyph, so aurora is drawn as initials ("Au") in the same line
style. A test checks that every layer hotkey has a button.

## Hotkeys

| Keys | Action |
|---|---|
| `C` `N` `G` `M` `L` | clouds, city lights, grid, markers, label |
| `B` | Sun and Moon on/off |
| `U` | launches on/off · `J` follow the next launch · `K` preview it from T−1 min at 10× |
| `A` `W` `X` `Q` | aurora, tropical cyclones, fires, earthquakes on/off |
| `Z` `Y` `I` | lightning (GOES, MTG), GDACS floods/wildfires/eruptions, snow and ice on/off |
| `Shift+R` `Shift+S` `Shift+T` | weather radar, smoke, tsunami alerts on/off |
| `Shift+L` | ISS telemetry panel: while tracking the ISS → always → off |
| `S` | stars: on → camera exposure → off |
| `Shift+P` | imagery: live (GOES, MTG) → yesterday's when zoomed in (VIIRS) → painted |
| `Shift+E` | terrain lit by the Sun (ETOPO 2022) |
| `/` | go to a place: search by name or coordinates (or double-click the globe) |
| `1` `2` `3` `4` | fixed, facing the Sun, orbit, from the Moon |
| `6` `7` `8` | track the ISS, Tiangong, SAT GUS (Mark Rober) |
| `O` | satellites: everything ticked → named only → off |
| `Shift+O` | satellite categories panel |
| `5` | dusk line down the middle · `V` cycles modes · `Home` back over your time zone |
| `E` | frame the Sun just past the Earth, then the Moon beside it |
| arrows (`Shift` = faster) | look around; in the Sun-facing view they shift the offset from the Sun |
| `+` `−` `[` `]` `0` | zoom, rotate, reset · `P` perspective/orthographic |
| `Space` `.` `,` `T` | pause, faster, slower (into reverse), back to now |
| `R` `F` `H` | check for new clouds, fullscreen, help |
| `D` | frame-rate display |
| `Shift+D` | pin the layer buttons |
| `Shift+U` | data-feeds dashboard |

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
  src/bodies.ts      Sun/Moon positions, sizes, Moon phase and orientation, framing views
  src/launches.ts    launch phases, synthesised ascent, predicted coast and deployment
  src/hazards.ts     aurora grid, storm naming, fire cells, earthquake styling
  src/satellites.ts  featured satellites, SGP4 (satellite.js), shadow, orbit tracks
  src/satWorker.ts   bulk satellite propagation off the main thread
  src/satcategories.ts  satellite category tree, splitting CelesTrak groups by orbit
  src/satTree.ts     the satellite panel (tri-state checkbox tree)
  src/drawer.ts      the layer dock (Lucide icons; buttons run the hotkeys)
  src/places.ts      coordinates parsing, city lookup, geocoding, the great-circle glide
  src/gibs.ts        NASA GIBS true-colour tiles for the region on screen
  src/liveImagery.ts live GOES and MTG pictures: discs, newest drawn scan, zoomed-in requests
  src/mtgLightning.ts  MTG Lightning Imager frames → 0.1° cells, merged with GOES's
  public/manifest.webmanifest, public/sw.js, public/icons/   installable app (and Android TWA)
  capacitor.config.ts, android/   the Capacitor Android app
  scripts/twa.mjs    Bubblewrap TWA manifest and assetlinks.json
  scripts/make-icons.py   app, Android launcher and splash icons
  src/search.ts      the place search box (combobox)
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
pnpm launches                # Launch Library 2 + SpaceX pre-launch orbits → public/launches/
pnpm storms                  # GDACS + NHC tropical cyclones → public/storms/
pnpm fires                   # NASA FIRMS VIIRS, last 24 h → public/fires/
pnpm lightning               # GOES GLM, last 30 min (~70 MB download) → public/lightning/
pnpm events                  # GDACS floods, wildfires, eruptions → public/events/
pnpm snowice                 # NOAA IMS + Sea Ice Index → public/snowice/
pnpm smoke                   # NOAA HMS smoke polygons → public/smoke/
pnpm tsunami                 # NTWC + PTWC bulletins, last 48 h → public/tsunami/
pnpm dev
```

The app runs without textures or clouds (plain blue globe, "clouds unavailable") and says
which is missing in the label.

Tests: `pnpm test` in `web/`, `pytest` in `pipeline/`.

## Android

Two ways to ship it, from the same code. Both need the site hosted somewhere public over
https (GitHub Pages via the deploy workflow, or the Docker stack behind a tunnel).

| | Capacitor (`web/android/`) | Bubblewrap TWA (`web/android-twa/`) |
|---|---|---|
| What the app is | The built site, bundled, in Android's WebView | A thin launcher that opens the hosted site full-screen in Chrome |
| Size | ~12 MB | ~1.7 MB |
| Updates | A new build each release; data from the server either way | Whenever the site deploys |
| Native extras | Plugins: the back button closes panels now; notifications etc. later | None (it's Chrome) |
| Needs | `VITE_DATA_BASE` pointing at the server, with CORS on the data | The site's `/.well-known/assetlinks.json` naming the app's signing key |

Both use the same icon (`pnpm icons` draws them, including Android's launcher icons and
splash images), the web app manifest, pinch-to-zoom, and the touch dock (the grip pins it).
The app ID `dev.xearthweb.app` / `dev.xearthweb.twa` is a placeholder: change it to a
reverse domain you control before publishing (`capacitor.config.ts`,
`android/app/build.gradle`, and `--package` below).

### Capacitor

```sh
cd web
cp .env.android.example .env.android   # set VITE_DATA_BASE=https://your-host/
pnpm android:build                     # vite build --mode android && cap sync android
pnpm android:open                      # Android Studio; or: cd android && ./gradlew assembleDebug
pnpm android:run                       # build, install and launch on a device/emulator
```

- The bundle has no pipeline beside it, so every layer folder and the NASA textures come
  from `VITE_DATA_BASE`; an Android build without it stops with an error. The server must
  send `Access-Control-Allow-Origin` on the data: GitHub Pages does, and so does the
  Docker nginx (also on 404s, so a missing layer reads as missing, not as a CORS failure).
- Gradle needs JDK 21 (Android Studio's bundled one works) and an Android SDK
  (`android/local.properties`: `sdk.dir=…`, forward slashes on Windows).
- Android's back button closes the search, the satellite panel, then help, then minimises.
  The system bars are black (Android 15 draws apps edge to edge).
- Testing against a local http server (e.g. the Docker stack at `http://10.0.2.2:8090/` from
  the emulator): sync with `XEARTH_ANDROID_LOCAL=1` to allow cleartext and mixed content.
  Never ship a build synced that way.
- Checked on the Android 15 tablet emulator (2026-10-22): globe, clouds, radar, smoke, snow
  and ice, satellites, storms and GDACS all load from the server; the dock pins with a tap;
  Back closes the keyboard, then the search, then minimises.

### Bubblewrap (Trusted Web Activity)

```sh
cd web
pnpm twa:manifest -- --url https://you.github.io/xearth-web/    # writes android-twa/twa-manifest.json
cd android-twa
npx @bubblewrap/cli update --skipVersionUpgrade                  # generate the Android project
npx @bubblewrap/cli build                                        # signed APK + AAB (makes a key on first run)
npx @bubblewrap/cli fingerprint list                             # the key's SHA-256
cd .. && pnpm twa:assetlinks -- --fingerprint AA:BB:…            # public/.well-known/assetlinks.json
```

- Deploy the site with `assetlinks.json` (GitHub Pages and the Docker nginx serve it) and
  Chrome opens the app with no URL bar; without it the TWA still works, as a Custom Tab
  with one. If Google Play re-signs the app, add Play's fingerprint too (comma-separated).
- The installed site also gets a service worker (`public/sw.js`): the app shell opens
  offline, hashed assets and textures are cached, and layer data is always fetched fresh.
- Bubblewrap downloads its own JDK 17 and Android SDK on first run if it can't use yours.
- `twa-manifest.json` is the project file to commit; the generated Gradle project, builds
  and the keystore are gitignored. Keep the keystore safe: updates must be signed with it.
- Checked: a manifest from this script builds and signs with Bubblewrap 1.27 (minSdk 24,
  which androidbrowserhelper 2.7 needs) and launches into Chrome on the emulator. Loading the
  real site needs it deployed over https.

## Self-hosting with Docker

`docker-compose.yml` runs the whole thing on one machine, with no GitHub Actions:

```sh
docker compose up -d --build        # then open http://localhost:8080
docker compose logs -f pipeline     # the hourly runs
docker compose down                 # stop (the data volume is kept)
```

| Service | Image | Does |
|---|---|---|
| `textures` | `node:24-alpine` | once: NASA Blue/Black Marble and Moon images (~40 MB) into the data volume, then hands the volume to the pipeline's user |
| `pipeline` | `pipeline/Dockerfile` (`python:3.12-slim`, unprivileged) | `python -m xearth_clouds.run --loop`: every job in the deploy workflow's order, each in its own process, now and then every hour at :50 |
| `web` | `web/Dockerfile` (pnpm build → `nginx:1.29-alpine`) | serves the built app, and each layer's folder from the volume |

- **Settings** (environment or a `.env` beside the compose file): `XEARTH_PORT` (default 8080),
  `XEARTH_MINUTE` (minute past the hour, default 50: GMGSI clouds land ~35–45 minutes after
  the hour), `XEARTH_SKIP` (jobs to leave out, e.g. `lightning`, which downloads ~70 MB an
  hour).
- **Health:** after each run the pipeline writes `status.json` in the volume (per job: ok,
  seconds, error), and its healthcheck passes while a run has finished within two hours. A
  failed job doesn't fail it: a feed being down isn't something a restart would fix.
  `docker compose run --rm pipeline python -m xearth_clouds.run --data /data` runs every
  job now.
- **Caching (nginx):** the app shell and every `latest.json` (and the snow/ice and smoke
  PNGs, rewritten in place) are `no-cache`, so a browser revalidates and gets a 304 until the
  pipeline writes a new one; hashed build assets are immutable for a year, time-stamped cloud
  maps for a week, textures for 30 days. JSON goes out gzipped (the satellite file, ~1.1 MB
  with Starlink, as ~400 KB). `status.json` isn't served.
- The site works before the first run finishes: layers without data say so in the data-feeds window.
  Radar, aurora, quakes, space weather, US tsunami alerts and ISS telemetry go from their
  sources straight to the browser either way.
- On 2026-10-21 a first run took ~3 minutes (clouds ~85 s, fires ~40 s, lightning ~60 s).

## URL parameters

| Parameter | Meaning | Default |
|---|---|---|
| `view` | `fixed`, `sunrel`, `orbit`, `moon`, `track` | `fixed` |
| `track` | `iss`, `tiangong`, `satgus`, `launch` (the next / current launch), or `sunrise` / `moonrise` (Sun / Moon framed beside the Earth) | `iss` |
| `aurora`, `storms`, `fires`, `quakes` | hazard layers on/off | 1 |
| `firehours` | show fires detected within this many hours (1–24) | 12 |
| `lightning`, `events`, `snow` | lightning, GDACS events, snow and ice on/off | 1 |
| `radar`, `smoke`, `tsunami` | RainViewer radar, NOAA HMS smoke, NOAA tsunami alerts on/off | 1 |
| `imagery` | `live` GOES/MTG pictures by day, `daily` yesterday's VIIRS when zoomed in, `painted` neither (`truecolor=0/1` still read) | `live` |
| `relief` | terrain lit by the real Sun (ETOPO 2022); 0 shows NASA's fixed shaded relief | 1 |
| `reliefscale` | terrain relief strength, 0.1–5 | 1 |
| `isslive` | ISS telemetry: `track` (panel and stream only while tracking the ISS), `1` (always), `0` | `track` |
| `stormsrc`, `firesrc` | folders holding the storm / fire `latest.json` | `storms/`, `fires/` |
| `lightningsrc`, `eventsrc`, `snowsrc`, `smokesrc`, `tsunamisrc` | folders holding the lightning / GDACS / snow-and-ice / smoke / tsunami `latest.json` | `lightning/`, `events/`, `snowice/`, `smoke/`, `tsunami/` |
| `launches`, `launchsrc` | launch mode on/off; folder holding its `latest.json` | 1, `launches/` |
| `sats` | `all` (everything ticked), `featured` (named only), `0` | `all` |
| `satshow` | categories ticked in the satellite panel: comma list of `iss`, `tiangong`, `satgus`, `starlink`, `weather-geo`, `weather-heo`, `weather-leo`, `gps`, `glonass`, or `none` | all |
| `satlabels` | categories with name labels (same keys) | `weather-geo,weather-heo,gps,glonass` |
| `lat`, `lon` | viewer position (`fixed`) or offset from the subsolar point (`sunrel`) | 20, your time zone's meridian |
| `period`, `inc` | orbit period (h) and inclination (°) | 1.5, 51.6 |
| `dist` | viewer distance in Earth radii; 0 = orthographic | 0 |
| `mag`, `rot` | size, rotation (° counter-clockwise) | 1, 0 |
| `wait` | seconds between redraws | 60 |
| `time`, `speed` | ISO start time; clock multiplier | now, 1 |
| `clouds`, `lights`, `grid`, `markers`, `label` | `0` / `1` | 1,1,0,1,1 |
| `stars` | `1`, `0`, or `photo` (camera-exposure dimming) | 1 |
| `fps` | `1` shows the frame-rate display | 0 |
| `feeds` | `1` shows the data-feeds dashboard | 0 |
| `bodies`, `bodyscale` | Sun and Moon on/off; disc enlargement (1 = true size, up to 30) | 1, 1 |
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

### Day side: the visible band

Infrared can't see low, warm cloud: marine stratocumulus reads faint or clear. The same hour's
GMGSI visible file fills that in by day.
1. **Clear-sky table.** For every bin of (Blue Marble surface brightness × sun height ×
   geostationary satellite), the 20th-percentile visible brightness among IR-clear pixels,
   rebuilt from each scene.
2. **Visible alpha** is brightness above that expectation, and **final alpha =
   max(IR, visible)**.
3. **Fading.** The visible contribution fades as the Sun gets low (nothing below ~5° elevation)
   and within ~12–30° of sunglint on the ocean. Glint is computed per pixel against the nearest
   of GOES-West, GOES-East, Meteosat 0°, Meteosat IODC and Himawari.
4. **Dark surfaces only.** The visible band is used only where the surface is dark (Blue Marble
   luminance < ~0.22). Over deserts, salt flats, snow and ice, cloud and ground differ too
   little in this band. On 2026-10-21 18Z an unrestricted blend put 0.6–0.9 "cloud" on the
   clear Altiplano and Salar de Uyuni, so those areas stay infrared only.

With the dark-surface rule, at 18Z: Peru/Chile stratocumulus 0.09 → 0.23, Southern Ocean by day
0.25 → 0.73, Amazon afternoon cumulus 0.48 → 0.66, while Uyuni, the Atacama, the Sonoran desert
and Greenland are unchanged. Night and dusk low cloud is still infrared-limited: the southeast
Atlantic deck at dusk stayed at 0.02. The cloud job needs the month's Blue Marble
(`textures/day-MM.jpg` beside `--out`, or `--surface`); without it, it uses infrared only.

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

- **Data:** the pipeline fetches CelesTrak GP elements (OMM JSON) for the named satellites
  and four groups: `starlink`, `weather` (73 on 2026-10-21), `gps-ops` (32) and `glo-ops`
  (28). The three small groups also carry names, for labels. A group CelesTrak reports as
  "not updated" with nothing to reuse (one just added) is skipped for that run, not fatal.
  Starlink comes from CelesTrak's supplemental GP, fitted to SpaceX's own published
  ephemerides: more accurate than the catalogue, and it includes satellites not yet
  catalogued (499 under temporary IDs on 2026-10-21). If that fails it falls back to the
  catalogue group, and the manifest's `groupSources` records which was used. It keeps the 11 numbers SGP4 needs per satellite (1.1 MB, ~400 KB
  gzipped) and publishes `satellites/latest.json`. CelesTrak updates every 2 hours and answers
  a repeat download with HTTP 403 "has not updated", so the pipeline refetches only when its
  file is over 3 hours old, and reuses the previous data on that 403. The deploy workflow
  carries the file between runs in the Actions cache. `--seed starlink=file.tle` builds a group
  from a local TLE file instead, for offline use.
- **Propagation:** satellite.js SGP4 → TEME → Earth-fixed via GMST, in Earth radii, the same
  frame as the globe. The 3 named satellites run on the main thread, with an orbit line over
  ±½ period. Starlink (~20 ms a pass on a desktop) runs in a Web Worker, once per simulated
  second.
- **Categories:** the web app splits the weather group by mean motion: geostationary
  (~1 rev/day: GOES, Himawari, Meteosat/MTG, FengYun 2/4, INSAT, GK-2A, Elektro), highly
  elliptical (~2: Arktika-M) and low orbit (14–16: NOAA/JPSS, MetOp, FengYun 3, Meteor-M,
  DMSP, Sentinel-3, Tianmu, CYGNSS). Every bulk satellite goes to the worker in one list with a
  category index; a category that's off is skipped by SGP4 and hidden by a per-category size
  of zero, so ticking one in the panel costs a uniform change and, when it turns on, one pass.
  `sats` (the O key) and `satshow` (the panel) combine: a category shows when both allow it.
  Ticking in the panel keeps everything else exactly as it looks.
- **Drawing:** the bulk satellites are one GL point layer after the globe, coloured per
  category. Starlink and low-orbit weather are soft dots; the far constellations (GPS,
  GLONASS, geostationary and elliptical weather) are 7 px hollow diamonds, since a dot that
  far out reads as a star. Name labels (GOES 19, GPS PRN 02, GLONASS 720…) are propagated on
  the main thread, a few dozen at most, and placed greedily so they never overlap a callout,
  the status readout or each other. Each point is tested against the
  Earth (disc silhouette in orthographic, ray-sphere in perspective) and against a
  one-radius shadow cylinder, so it dims in the Earth's shadow. Named satellites are drawn on the
  overlay: a filled marker when sunlit, hollow in shadow, the past half-orbit as a fading
  trail and the next half dashed. The top-left label shows the tracked satellite's altitude,
  speed and sunlit state.
- **Scale:** a Starlink is ~10 m across, so the dots are deliberately oversized, as on every
  tracker.

## Launch mode

No launch provider publishes live telemetry: SpaceX's on-screen speed and altitude are burned
into the webcast. So launch mode is built from what *is* published, and says which part is which.

- **Schedule and status:** the pipeline reads Launch Library 2 (The Space Devs) every hour, which
  is two requests against a free tier of ~15 an hour. Near T−0, in live mode, the browser
  re-reads just that launch every 5 minutes, so holds and scrubs show up.
- **Predicted orbit:** for Starlink, SpaceX gives CelesTrak a pre-launch state vector, published
  as supplemental GP for the stack and for one satellite. Each comes with the deploy time and a
  set per backup launch opportunity. The pipeline parses CelesTrak's index and matches entries
  by launch time, so a hold to a backup opportunity switches to that opportunity's prediction.
- **Phases:**
  - *countdown*: the pad and its predicted route.
  - *ascent (approx.)*: ~T+8.5 min, synthesised, ending on the predicted orbit with matching
    speed. Altitude follows u²(3−2u), close to a typical Falcon 9.
  - *coast*: SpaceX's predicted orbit.
  - *deployed*: the exact predicted time; the camera stays for 30 minutes.
  - Launches without a prediction get a countdown and an "in flight, no trajectory data" marker
    on the pad, never an invented path.

## Hazard layers

| Layer | Source | Fetched by | Every |
|---|---|---|---|
| Aurora | NOAA SWPC OVATION (1° grid, ~156 KB gzipped) | browser | 10 min |
| Space weather | NOAA SWPC Kp, latest flare, solar-wind summaries (< 1 KB each) | browser, with the aurora | 10 min |
| Sun image | NOAA SWPC GOES SUVI 304 Å (1280 px PNG) | browser, only while the Sun is in frame | 15 min |
| Earthquakes | USGS M2.5+ past day (GeoJSON) | browser | 5 min |
| Tropical cyclones | GDACS (JTWC / NHC tracks) + NHC current details | pipeline | hourly, browser re-reads every 15 min |
| Fires | NASA FIRMS VIIRS NOAA-20 + NOAA-21, past 24 h | pipeline | hourly, browser re-reads every 30 min |
| Lightning (Americas) | NOAA GOES-19 + GOES-18 GLM L2 flashes, last 30 min (AWS open data) | pipeline | hourly, browser re-reads every 5 min |
| Lightning (Europe, Africa) | EUMETSAT MTG-I1 Lightning Imager accumulated flash area, six 5-min frames (EUMETView WMS, ~270 KB each) | browser | 5 min |
| Live imagery | GOES-West/East GeoColor (NASA GIBS), MTG GeoColour (EUMETView) | browser | 10 min scans, checked every 5 min |
| Floods, wildfires, eruptions | GDACS current FL/WF events; VO eruptions from the last 90 days | pipeline | hourly, browser re-reads every 30 min |
| Snow and ice | NOAA/NESDIS IMS 4 km (north); NOAA/NSIDC Sea Ice Index (south) | pipeline | daily charts, checked hourly |
| Weather radar | RainViewer composite, 512 px Web Mercator tiles (16 at globe zoom, 64 zoomed in) | browser, only for a new frame | 10 min frames, checked every 5 min |
| Smoke | NOAA/NESDIS HMS smoke polygons (KML) | pipeline | through the day, hourly; browser re-reads every 30 min |
| Tsunami (US alerts) | NWS alerts API: active Tsunami Warning / Watch / Advisory, plus sampled zone geometry | browser | 2 min |
| Tsunami (bulletins) | tsunami.gov Atom feeds, NTWC (Alaska) and PTWC (Hawaii), last 48 h | pipeline | hourly |
| ISS telemetry | NASA ISSLive via Lightstreamer (push.lightstreamer.com, ISSLIVE) | browser, while the ISS is tracked | streamed, ≤ 1 update/s per item |

- **Aurora** is drawn in the globe shader above the clouds, only where the Sun is at least ~6°
  below the horizon, using a 1 − exp(−2.5·p^1.4) response so the oval's core is bright and its
  fringe faint. The feed carries a spurious ring of values at latitudes −3…0°, an edge
  artefact of the model grid, so cells within 20° of the equator are dropped.
- **Storms:** GDACS lists track segments grouped by class, not by time. The current class comes
  from the observed segment that ends at the current position. GDACS's "severity" is the peak
  over the forecast, so NHC's current wind, pressure and motion are used where NHC has the
  storm. NHC's JSON mixes units (intensity in knots, motion in mph), which a test pins against
  the public advisory. Mature storms are named by basin: hurricane, typhoon or cyclone.
- **Fires:** low-confidence detections are dropped and the rest merged into 0.05° cells (fire
  power summed, age from the latest detection): 238k detections became 52.7k points and
  300 KB gzipped. They're drawn red-orange so they never read as city lights.
  - *To scale:* each cell is drawn at the footprint of its detected 375 m VIIRS pixels, but
    never smaller than one device pixel, so at globe zoom a fire is one pixel. They blend "over",
    not additively, so dense clusters don't bloom into sheets. Only the last 12 h show by
    default. Fires below a zoom-dependent power threshold (~3–4 MW at globe zoom, none when a
    pixel is ~1 km) are hidden.
  - On 2026-10-21 these changes cut the area painted over Africa at a 7 km/px view from ~550×
    the area actually flagged to ~57×. The remainder is the one-pixel floor: a screen pixel there
    is ~52 km², a VIIRS pixel 0.14 km². Africa really did have half the world's detections (the
    southern dry-season burning), but they flagged at most ~0.05% of the continent.
- **Earthquakes:** ring size ×1.5 per magnitude. Red within the hour, orange within 6 h, then
  yellow. The largest few, M6+, tsunami-flagged or PAGER-alerted quakes get labels.
- **Lightning:** GLM files (one per 20 s per satellite, ~400 KB) are in NOAA's AWS buckets,
  which don't send CORS headers, so the browser can't read them and the pipeline gathers the
  last 30 minutes instead (~180 files, ~70 MB, about a minute). Flashes that fail quality
  control are dropped; the rest go into 0.1° cells with a count and the minutes since the
  latest. On 2026-10-21 at 21:57Z that was 39.7k flashes in 4,364 cells, 62 KB of JSON.
  - *Overlap:* GOES-East and GOES-West both see the eastern Pacific and the western Americas,
    so each cell takes the larger of the two satellites' counts, not their sum.
  - *Coverage:* GLM sees the Americas, the Atlantic and the eastern Pacific to about ±55°;
    MTG's Lightning Imager (below) adds Europe, Africa and the Atlantic. Asia has none shown.
  - *Staleness:* the hourly run at :50 covers roughly :20–:50, so what's shown is up to
    ~90 minutes old by the next run. The data-feeds window gives the newest flash's time.
  - *MTG Lightning Imager:* EUMETView serves its Accumulated Flash Area as a WMS layer with
    CORS, so the browser reads it directly: a frame every 5 minutes, each that 5 minutes'
    flashes, coloured by how many flashes covered each ~2 km pixel (1 to 20+, YlOrRd on a
    linear scale; the colours are read back to counts from a table sampled off its legend).
    The last six frames make the same 30-minute window as GOES. Frames are fetched at 0.05° a
    pixel and binned into GOES's 0.1° cells, a cell taking its busiest pixel (a flash lights
    every pixel its glow covers, so summing would overcount). Over Africa and the Atlantic on
    2026-10-23, 0.05° caught 97% of the cells a 0.02° fetch found; 0.1° caught 88%. They're
    typically 10–15 minutes old.
  - *Both:* where GOES and MTG both see a cell (the Atlantic, eastern South America) it takes
    the larger count and the newer age. The readout counts GOES's flashes and MTG's lit cells
    separately, since MTG's frames give flashes per pixel, not per flash.
- **GDACS events:** floods (GloFAS) and wildfires (GWIS) come from GDACS's list of current
  events. GDACS records an eruption as a single moment that is never "current", so eruptions
  come from a search over the last 90 days, one marker per volcano at its latest eruption.
  Every flood, eruption and Orange/Red alert is labelled; of the dozens of Green wildfires
  only the three largest are, since FIRMS already shows where they burn. A wildfire's burned
  area is drawn as a dashed circle of the same area once it outgrows the marker.
  - *Impact, not size:* GDACS's Green / Orange / Red grade expected humanitarian impact
    (the hazard, the people exposed and how vulnerable they are), so labels end in an impact
    meter: one, two or three rising bars lit in those colours, for low, medium and high
    impact (the help panel has the legend). Green means international help is unlikely to be
    needed, not that nothing is happening: a 66,000 ha fire with few people near it is Green.
    Cyclone labels and the place card's alerts show the same meter for GDACS's levels.
- **Snow and ice:**
  - *North:* the IMS 4 km chart is polar stereographic on WGS84 (true at 60°N, −80° down the
    grid). The pipeline reprojects it with its own projection maths rather than NOAA's 300 MB
    latitude/longitude files. A test pins known places (Greenland snow, mid-Atlantic and
    Hudson Bay water, polar ice) to their cells, which a mirrored grid would get wrong.
  - *South:* IMS stops at the equator, so Antarctic sea ice comes from the Sea Ice Index
    concentration (25 km, EPSG:3412, a few days behind), smoothed before sampling so its cells
    don't show as blocks.
  - *Output:* both land in one 4096×2048 PNG (red = snow, green = ice concentration, ~270 KB),
    loaded without colour management so the values stay exact. The shader whitens snow-covered
    ground (less over dark forest, where snow reads grey from space) and paints sea ice a
    bluer white with no sun glint.
  - *Limitation:* the monthly Blue Marble has its own snow, which isn't removed where IMS says
    there's none.
- **Weather radar:** RainViewer's API sends CORS headers, so the browser reads it directly:
  the frame list every 5 minutes, then (only when there's a new frame) that frame's tiles,
  stitched into one Web Mercator texture. That's 4×4 tiles at globe zoom (2048 px, ~20 km/px
  at the equator) and 8×8 once magnified 2× or more. The shader maps latitude through
  ln tan(π/4 + φ/2) to sample it, and draws radar over the clouds, dimmer on the night side.
  - *Weak echoes:* RainViewer's colour table makes −10…14 dBZ translucent grey-beige and
    15 dBZ and up opaque. That translucent band is mostly not rain: clear-air returns, and at
    dusk the rings of birds and insects around every radar site. Only opaque pixels are kept,
    so the cut is exactly 15 dBZ. Strong biological returns can still pass it.
  - *Terms:* free for personal and educational use, with a visible, linked credit ("Weather
    data by RainViewer", bottom right while radar is on), and the API asks clients to cache.
    Tiles are only fetched for a new frame or a finer zoom, never while the tab is hidden.
    The free tier gives the past two hours of frames in one fixed colour scheme, with no
    nowcast.
- **Smoke:** HMS analysts outline plumes on GOES imagery through the day, classed light,
  medium or heavy. The pipeline reads the day's KML (yesterday's early in the UTC day, before
  today's has any plumes) and rasterises it onto a 4096×2048 single-channel PNG: 85 / 170 /
  255 for the three classes, densest wins where plumes overlap, edges softened by 1.5 px
  (~23 KB on 2026-10-21, 234 plumes). The shader mixes a grey-brown haze into the sunlit
  ground under the clouds, up to ~55% for heavy smoke, and suppresses sun glint under it.
  Small plumes are drawn to scale, so a 10 km plume is one faint pixel at globe zoom.
- **Tsunami alerts:**
  - *Bulletins:* NTWC (US mainland, Alaska, Canada) and PTWC (Hawaii, US Pacific and Caribbean
    territories, and threat messages for other nations) each publish an Atom feed of their
    latest bulletins: epicentre, preliminary magnitude, category, note. tsunami.gov sends no
    CORS headers, so the pipeline keeps the last 48 h. Warnings, threats, advisories and
    watches show for the whole window with a ringed red/orange/yellow marker; information
    statements and cancellations show for a day and are labelled for 6 h.
  - *Live US alerts:* the NWS alerts API is CORS-enabled, so the browser checks it every two
    minutes. NWS sends routine "Test" tsunami warnings through the same feed, so only
    `status: Actual` alerts count. An alert lists the coastal zones it covers (up to hundreds,
    ~90 KB of polygon each), so up to 24, spread evenly along the list, are fetched once each
    and drawn as dots along the coast. A new alert also raises a toast.
  - Tsunami labels take precedence over every other callout.
- **ISS live telemetry:** NASA publishes Mission Control's ISS console data through a
  Lightstreamer server (adapter set `ISSLIVE` at push.lightstreamer.com); the symbol list is
  NASA's PUIList.xml. The client library (~50 KB gzipped) is loaded only when wanted, and by
  default the stream is only opened while the ISS is tracked.
  - *Units, checked against the live stream (2026-10-21):* the J2000 state vector is km and m/s
    (the dictionary's unit fields say ft); pressures are mmHg (cabin 748), not psi. Each
    update's time stamp is hours counted from 00:00 UTC on 31 December; the state vector's
    own time tag is GPS seconds (less 18 leap seconds for UTC). The two agree to ~2 s.
  - *Position:* the state vector is precessed from J2000 to the equator of date and turned by
    sidereal time (astronomy-engine). That lands within ~1 km of SGP4 from the same day's
    elements; skipping precession would be ~40 km off. Within two minutes of the vector's
    epoch (two-body propagation covers the gap), the ISS marker uses it and is tagged LIVE,
    and the panel shows how far SGP4 is from it. Otherwise SGP4 places the ISS as before.
  - *Signal:* the stream only moves while the ISS has a TDRS link. Out of signal, or when the
    feed itself stalls, the server keeps serving the last values, so the panel shows LOS
    and how old they are, and dims its instruments. On 2026-10-21 the newest values were from
    01:02Z, ~21 h earlier.
  - *Window:* instruments rather than rows of text. Two stat tiles show altitude and speed
    with their change and a 15-minute sparkline; hover a sparkline to read off any point.
    Below them is how far the TLE prediction sits from the telemetry. Meters show cabin
    pressure, temperature, O₂, CO₂ and gyroscope (CMG) momentum, each marking its normal
    band and turning amber or red outside it. The bands are approximate, from NASA's
    published cabin norms, not flight rules. Dials show the Sun's β angle and the two solar
    array joints. Chips show the station mode, attitude frame, any maneuver, and Ku-band video.
- Tsunami, launch, storm, quake and GDACS labels share one placement pass (in that order). Labels keep
  on screen and clear of the status readout; a GDACS label with no free spot is dropped (its
  marker stays) rather than overlap another. City labels avoid all of them.

## Data feeds

Press **Shift+U** (or add `?feeds=1`, or use the Feeds button in the dock) for a column of
toast cards down the right edge, one per data source on screen. Each card shows two things,
on two clocks kept apart on purpose:

- **Last update, as a bar:** when the data itself was published (the pipeline's run, the
  cloud scan, the radar frame, USGS's feed, the OVATION observation, the Sun image's
  `Last-Modified`), its age, and a bar that fills as it ages. The bar's midpoint is the
  source's usual age (90 min for hourly pipeline layers, 2 h for clouds, 20 min for radar and
  aurora, 10 min for quakes, 4 h for satellite elements). The bar is green up to that point,
  amber up to twice it, and red beyond.
- **Next update, as a ring:** a ring that drains to the app's next check, with the time
  left inside it and "checked 3 min ago · next in 6:12" beside it. It spins during a check
  and turns red, with the error in its tooltip, when the last check failed. ISS telemetry is
  a stream, not a poll, so its ring reads LIVE.

Cards slide in and out as layers are switched on and off, and flash when new data arrives.
The Sun-image card appears once the Sun has been in frame (that's the only time it's fetched).
The dashboard ticks once a second while open, and not at all while closed or hidden.

## Status readout

The block at the top left says what's on screen: the time, then a row per kind of thing
shown (view, Sun, satellites, the one being tracked, the next launch, then a row for each
data layer on: smoke plumes, aurora peak, space weather, cyclones, fires, quakes, lightning,
GDACS events, tsunami alerts, imagery date and resolution). It doesn't say when things were
fetched or where from: that's the data-feeds window (Shift+U) and the credits along the
bottom. Keys and values sit in two columns. A long value wraps at its " · " separators
(about 290 px), so the block grows down the side rather than across the globe.

## Toast windows

The panels down the right edge share one look and one place. A toast manager
(`src/toasts.ts`) gives frame rate, ISS telemetry, data feeds and a searched place's card the
same window: one width (320 px), the same glass, and a header with the title, a status chip
(the ISS signal, the feeds summary) and ×. It stacks them in that order in one column from
the top of the window to the dock, so they never overlap.

- **Space:** when the windows don't fit, the data feeds give up height first and scroll.
  Frame rate and ISS keep their height. A place's card keeps up to half the column, since
  it's what was just asked for.
- **Truncation:** long titles, chips and rows end in an ellipsis (the full text is in the
  tooltip) rather than wrapping.
- **Folding:** a click on a window's title folds it to its header; another click unfolds it.
- **Closing:** × does what the hotkey would: it turns the frame rate or ISS telemetry off,
  closes the feeds dashboard, or dismisses the place.
- **Labels:** globe labels keep clear of the windows, as they do of the readout, and move
  as windows open, close and fold.

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
- Moon: CGI Moon Kit colour map (LRO LROC/LOLA), NASA's Scientific Visualization Studio.
- Terrain: NOAA National Centers for Environmental Information, ETOPO 2022 15 Arc-Second Global
  Relief Model (60″ surface elevation), doi:10.25921/fd45-gt74.
- True-colour imagery: NASA Global Imagery Browse Services (GIBS), part of NASA's Earth
  Science Data and Information System (ESDIS); VIIRS corrected reflectance from NOAA-20, and
  GOES-East/West ABI GeoColor (NOAA/CIRA).
- Live imagery and lightning over Europe and Africa: EUMETSAT, via EUMETView — MTG-I1 FCI
  GeoColour RGB and Lightning Imager Accumulated Flash Area.
- Icons: Lucide (ISC License).
- Place search: geocoding by Open-Meteo, with GeoNames data (CC BY 4.0).
- Interface type: Chakra Petch by Cadson Demak (SIL Open Font License 1.1), bundled via
  Fontsource.
- Aurora, space weather and the GOES SUVI Sun image: NOAA Space Weather Prediction Center. Earthquakes: USGS. Tropical cyclones:
  GDACS (European Commission JRC; JTWC and NHC data) and NOAA NHC. Fires: "We acknowledge the use
  of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's
  Earth Science Data and Information System (ESDIS)."
- Lightning: NOAA GOES-R Series Geostationary Lightning Mapper (GLM) L2 data via the NOAA Open
  Data Dissemination program on AWS; EUMETSAT MTG Lightning Imager (see above).
- Floods, wildfires, eruptions: GDACS, a cooperation framework of the United Nations and the
  European Commission (GloFAS, GWIS and the Volcanic Ash Advisory Centres).
- Weather radar: [Weather data by RainViewer](https://www.rainviewer.com/) (free API, personal
  and educational use).
- Smoke: NOAA/NESDIS Hazard Mapping System (HMS) fire and smoke analysis.
- Tsunami: NOAA National Tsunami Warning Center and Pacific Tsunami Warning Center
  (tsunami.gov); NOAA National Weather Service alerts.
- ISS telemetry: NASA ISSLive public telemetry, streamed by Lightstreamer
  (lightstreamer-client-web, Apache-2.0).
- Snow and ice: U.S. National Ice Center / NOAA NESDIS, IMS Daily Northern Hemisphere Snow and
  Ice Analysis at 4 km (NSIDC G02156); Fetterer et al., Sea Ice Index, Version 4 (NSIDC
  G02135).
- Launches: Launch Library 2 by The Space Devs; Starlink pre-launch orbits are SpaceX state
  vectors published by CelesTrak as supplemental GP.
- Satellite elements: CelesTrak (Dr T.S. Kelso), from the 18th Space Defense Squadron's GP
  data. SGP4: satellite.js (MIT). SAT GUS is operated by CrunchLabs.
- Clouds: NOAA/NESDIS Global Mosaic of Geostationary Satellite Imagery (GMGSI) via the NOAA
  Open Data Dissemination program. Use does not imply NOAA endorsement.
