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
- **Meteors** (Shift+M, off by default): the last day's meteors from the Global Meteor
  Network's cameras, each a streak along its real path ~80–120 km up, the main showers in their
  own colours (the Orionids in gold this week), and the fireballs NASA/JPL's CNEOS has listed in
  the last 90 days.
- **Ionosphere** (Shift+I, off by default): a colour wash ~300 km up, either GloTEC's total
  electron content (the dayside's equatorial crests, what slows GNSS signals) or D-RAP's HF
  radio absorption (near nothing on a quiet day; a flare lights the sunlit side, a proton event
  the polar caps), from NOAA SWPC.
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
  - **Fires:** NASA FIRMS VIIRS detections from the last 12 h (`firehours`), plus what Meteosat
    Third Generation saw burning in the last hour over Europe, Africa and the Atlantic (its fire
    radiative power, every 10 minutes), drawn to scale in red-orange.
  - **Earthquakes:** USGS M2.5+ from the last 24 h, and EMSC's for Europe and the
    Mediterranean, pushed as they're published, as rings sized by magnitude and coloured by age,
    with labels on the largest.
  - **Lightning:** the last 30 minutes of flashes from the GOES-East and GOES-West Geostationary
    Lightning Mappers (the Americas, Atlantic and eastern Pacific) and the Lightning Imager on
    Meteosat Third Generation (Europe, Africa and the Atlantic), as blue-white sparks.
  - **Floods, wildfires, eruptions:** GDACS events with their impact levels; wildfires carry their
    burned area, drawn to scale when zoomed in. With them, NASA's daily flood map (VIIRS): where
    there's water that usually isn't, in blue, the view's own at up to 250 m when zoomed in.
    And USGS's alert levels for the US volcanoes it monitors, in their aviation colours: the
    raised ones labelled, each one's latest notice a click away.
  - **Volcanic ash** (Shift+A, off by default): EUMETSAT's Ash RGB, the false-colour infrared
    picture forecasters use for ash and SO2 plumes, over the whole globe day and night, with a
    toast of what its colours mean and GDACS's eruptions, each one press away.
  - **Sea temperature** (Shift+H: temperature → anomaly → off): the GHRSST MUR analysis, a
    day behind, as a wash over the sea. The anomaly is blue–white–red and faint near zero, so El
    Niño and marine heatwaves stand out; the readout gives Niño 3.4.
  - **Snow and ice:** today's NOAA IMS snow cover and sea ice, plus Antarctic sea ice from the
    NOAA/NSIDC Sea Ice Index, laid over the month's Blue Marble.
  - **Weather radar:** RainViewer's composite of 1,200+ radars, a new frame every 10 minutes,
    drawn over the clouds the way a weather map shows rain. Where no radar reaches (the oceans,
    most of Africa, much of Asia and South America), NASA's IMERG satellite estimate fills in,
    in the same colours, a little fainter: it's about five hours old.
  - **Smoke:** NOAA's Hazard Mapping System smoke plumes (light, medium, heavy) over North
    America, as a grey-brown haze on the sunlit ground.
  - **Tsunami alerts:** bulletins from NOAA's two Tsunami Warning Centers at the earthquake's
    epicentre, and live NWS tsunami warnings, watches and advisories lit along US coasts.
  - **US severe weather:** NWS tornado, severe thunderstorm, flash flood and other storm-based
    warnings as the polygons forecasters drew, and the Storm Prediction Center's day-1 outlook
    (marginal to high risk) in SPC's own colours.
  - **European weather warnings:** MeteoAlarm's warnings from 38 national weather services,
    each region coloured by its worst warning in force in MeteoAlarm's yellow, orange and red,
    and outlined, dashed, where a worse one starts within two days. Red ones get a label and a
    toast; a click opens a region's warnings, in English, and a searched European place's card
    lists its own.
- **Buoys** (Shift+B, off by default): the ~1,900 buoys reporting on NOAA's global network
  (drifting, moored, tropical, ice and DART tsunami buoys) as dots by type. Click one for its
  window: waves, water temperature, wind and pressure with their last 24 hours as sparklines,
  wind and wave direction dials, a drifter's track, a DART buoy's water column. The ~4,000
  Argo floats are there too (violet): one's window has its latest dive, temperature and
  salinity down to 2,000 m, and its track over the last 30 days. A searched place's card
  names the nearest buoy, with a button to open it.
- **ISS live telemetry:** NASA's public ISSLive stream (Mission Control console data) in a
  window of gauges while the ISS is tracked: signal, orbit sparklines, cabin-air meters, solar-array dials. While
  the stream is live the ISS is placed from its own GNC state vector instead of SGP4.
- **Satellites:** the ISS, Tiangong and **SAT GUS** (Mark Rober's Space Selfie satellite,
  NORAD 62713) are labelled, with orbit lines and a `view=track` that rides along with them.
  The ~11,100 Starlinks are drawn as a point cloud, from SpaceX's own published ephemerides
  (via CelesTrak supplemental GP), which include newly launched ones not yet catalogued.
  The other broadband constellations, OneWeb (~650), Amazon's Kuiper (~390) and China's
  Qianfan (~260), are point clouds of their own. Weather satellites (geostationary, highly
  elliptical and low orbit), GPS, GLONASS, Galileo and BeiDou are their own colour-coded
  categories; zoom out to see the navigation shells (~20,000 km) and the geostationary ring
  (~36,000 km). All are propagated live with SGP4 from CelesTrak
  elements, hidden behind the Earth, and dimmed in its shadow.
  - **Satellite panel** (the small button on Satellites in the layer dock, or Shift+O): a tree of every category with
    tri-state checkboxes, colour swatches, counts, and name-label toggles for the categories
    small enough to label. Every far constellation (the diamonds) is named by default; the dense low-orbit dots are not. Satellites a few pixels apart share a label ("MTG-I2 · MTG-S1"), and each label tries right, left, below and above before it is left out.
- **Live imagery** — by day, today's colour pictures from GOES-West, GOES-East and Meteosat
  Third Generation, refreshed as each satellite scans (every 10 minutes), with Meteosat-9
  filling in the Indian Ocean and western and central Asia, in place of the painted Blue
  Marble and cloud map. Over East Asia and the west Pacific, where no colour picture exists,
  Himawari-9's infrared and visible bands give live clouds instead, day and night, every 10
  minutes. Shift+P switches to yesterday's sharper VIIRS mosaic when
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

The night side is painted (Black Marble city lights under the GMGSI cloud map), except that
zoomed in, `live` and `daily` both show the newest night's real lights (see Night lights).
The older `truecolor=0` / `1` links still work (painted / daily).

### Live

- **Sources:** GOES-West (137.2°W) and GOES-East (75.2°W) GeoColor from NASA GIBS, MTG-I1
  (0°) GeoColour and Meteosat-9 (IODC, 45.5°E) Natural Colour Enhanced from EUMETSAT's EUMETView. Both
  are WMS servers with CORS, so the browser asks each for a JPEG of its disc on the globe's own
  latitude/longitude grid (1024–2048 px a side, chosen by how big the globe is on screen;
  ~200 KB each at 1024). Checked every 5 minutes.
- **Coverage:** together they see from about 150°E east across the Pacific, the Americas, the
  Atlantic, Africa, the Indian Ocean and western and central Asia to about 115°E. East Asia and
  the west Pacific are Himawari's, and neither server has a Himawari colour product, so the
  painted globe shows there, blended in over a few degrees, under Himawari's live clouds
  (below).
- **Meteosat-9 fills in:** EUMETView has no GeoColour for the Indian Ocean satellite. Its
  Natural Colour (0.6, 0.8 and 1.6 µm) draws ice cloud and snow in cyan; the enhanced version
  used here draws them white, much nearer GeoColour. It scans every 15 minutes at 3 km. So it goes under the other discs and shows only past MTG's
  limb: MTG keeps everything to ~64°E and hands over by ~72°E, over the Arabian Sea, even
  where Meteosat-9 sees more face-on (Nairobi, Dubai). Zoomed in, it's asked for only where
  MTG can't see. Its JPEGs are white where there's no data (the night side and off the disc),
  which the shader can't tell from cloud, but the product runs until the Sun is ~1–3° below
  the horizon (measured 2026-10-23 15:45Z) and the shader wants it 6° up, and its disc edge
  (~74°) is past the limb fade; a transparent PNG instead was ~11× the size and took up to 49 s.
  Nor is its night side black, so its newest listed scan is used without GIBS's probe (below).
  About 30 minutes old when listed.
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

### Live clouds (Himawari-9)

GIBS has Himawari-9 (140.7°E) only as single bands, so instead of a picture it gives clouds:
the hourly cloud map's own recipe (`pipeline/xearth_clouds/convert.py`), ported to the browser
(`himawariCloud.ts`) and run in a worker every 10 minutes on Himawari's infrared and visible
bands. Over its disc they replace the hourly map's clouds, day and night, fading out toward
its limb as the colour pictures do; elsewhere the hourly map stays.

- **Infrared (Band 13, 10.4 µm):** GIBS colours it, so each colour is read back to a
  brightness temperature through GIBS's colour map (238 colours, baked in), mapped to the grey
  level GMGSI gives the same temperature (median curve, 1.7 million pixels against GMGSI over
  the same ground and hour, 2026-10-21 18Z: GMGSI's scale isn't linear in temperature), then
  put through `to_alpha`: cloud is what's colder than the local clear sky.
- **Visible (Band 3, 0.64 µm), by day:** mapped to GMGSI's visible grey the same way
  (2026-10-23 03Z), then `vis_alpha`: cloud is what's brighter than clear ground of the same
  Blue Marble brightness under the same Sun, in this scene, faded out over sun glint, bright
  deserts and a low Sun. It matters: over Himawari's region at 03Z the visible band doubled the
  cloud (mean opacity 0.18 from infrared alone, 0.36 with it). Like the hourly map, it takes
  early snow the month's Blue Marble lacks for cloud. Without the Blue Marble it's infrared only.
- **Checked against the pipeline:** the port matches `to_alpha`, `vis_alpha` and `subsolar` to
  four decimals on test fields generated by the Python (`himawariCloud.test.ts`), and on real
  scans Himawari's cloud matched the pipeline's map at 0.79 correlation by night (mean opacity
  0.19 vs 0.20) and 0.85 by day (0.37 vs 0.35).
- **Fetching:** both are WMS requests for the disc at 1536 px (0.105°), split at the date line.
  Band 13 must be PNG (~2.4 MB a scan): its colour map has two grey ramps that overlap (−80…−70
  °C runs 230 → 5 and −19…+57 °C runs 197 → 1), told apart only by a grey level or so, and
  JPEG's noise flips 13% of its pixels by more than 20 °C. Band 3, plain grey, is JPEG (~340 KB;
  0.04 mean opacity difference from PNG), only while the Sun is up on the disc. They're fetched
  only while the disc faces the view; GIBS draws a scan about an hour after it's taken (the same
  probe as GOES picks the newest drawn one). A scan took ~9 s to fetch and process on
  2026-10-23. The readout and the feeds window give its time.

### Volcanic ash

EUMETSAT's Ash RGB combines three infrared channels so that ash (red to magenta) and SO2
(bright green) stand out from cloud and ground: red from the 12.0 − 10.8 µm difference (ash
absorbs the other way round from ice and water cloud), green from 10.8 − 8.7 µm (SO2 absorbs
at 8.7) and blue from the 10.8 µm temperature. Being infrared, it works day and night.

- **Sources, all EUMETView WMS with CORS and the same recipe:** the Geo Ring
  (`mumi:wideareacoverage_rgb_ash`), a whole-world mosaic of the geostationary ring, every 3 hours
  and ~3 hours behind; and MSG's 0° and Indian Ocean discs (`msg_fes:rgb_ash`,
  `msg_iodc:rgb_ash`), every 15 minutes and ~30 minutes behind. The layer is the Geo Ring with
  the discs over it where they see, the Indian Ocean disc filling in east of the 0° one, through
  the live imagery's machinery (`ash.ts`, `liveImagery.ts`) and its own texture array. GOES and
  Himawari have no Ash RGB on either server, so the Geo Ring is all there is for the Americas,
  the Pacific and East Asia.
- **A picture, not a detector:** desert ground and dust come out pink too, so detecting ash and
  drawing only that would light up the Sahara. The picture replaces the globe below it (rain,
  aurora and the ionosphere still draw over it), and the toast's key says which colours mean
  what, dust included.
- **No data:** EUMETView draws it white (off a disc, past the Geo Ring's ~75–80°), and JPEG
  blends that white into the picture over a pixel or two, a pale band no colour test can tell
  from data: pale desert pink reaches 224 in its weakest channel. So white (weakest channel 240
  or more) and 3 pixels around it are made transparent before upload; on 2026-10-23 that holed
  none of the Sahara or Arabia, where a 209 cutoff had holed 3% of it. The Geo Ring's own black
  slivers near 75°N are in EUMETSAT's mosaic.
- **The toast** lists GDACS's eruptions (the last 90 days, newest first) with their alert, the
  day and how long ago, and which picture shows each and how often it's new. On 2026-10-23
  those were Kanlaon and Taal (Philippines, the Geo Ring only) and Krakatau (the Indian Ocean
  disc). Pressing one centres the globe on it.

### US volcano alert levels

USGS's Volcano Hazards Program publishes each monitored US volcano's ground-hazard alert level
(NORMAL, ADVISORY, WATCH, WARNING) and aviation colour code (GREEN, YELLOW, ORANGE, RED) through
HANS, its notification service, with CORS: 69 volcanoes on 2026-10-23, four of them raised
(Great Sitkin WATCH/ORANGE; Shishaldin, Kīlauea and Ahyi Seamount ADVISORY/YELLOW). They're
drawn with the GDACS events (Y), checked every 15 minutes.

- **Positions from the Smithsonian:** HANS gives none, so they come from the Smithsonian's
  Volcanoes of the World, joined on the volcano number. Its WFS has no CORS and volcanoes don't
  move, so `web/scripts/bake-volcanoes.py` bakes the 351 US volcanoes (Holocene, and Pleistocene
  for the calderas HANS watches: Long Valley, Yellowstone, Coso) into `src/usVolcanoes.ts`.
  A number the Smithsonian doesn't list is taken as a vent of the volcano numbered the same but
  for a last 0 (VOTW's convention): Korovin (311161) is drawn at the Atka Volcanic Complex
  (311160), and its window says so. That places 67 of 69; the other two ("Alaskan Volcanoes",
  "Cascade Range") are regions with no number.
- **On the globe:** a cone in the aviation colour, larger and labelled ("GREAT SITKIN · WATCH")
  when raised, small and unlabelled when normal, most serious first.
- **A volcano's window:** alert level and colour code, observatory, notice time, elevation,
  type and last eruption, then its latest notice's synopsis and summary (fetched when the window
  opens, once per notice, plain text only), and a link to the notice. 13 volcanoes had no notice
  at all (no time), and say nothing more.

### Flood extent

NASA LANCE's global flood product (VIIRS on NOAA-20 and NOAA-21, via GIBS) maps water seen
where reference maps have none: flood, or recurring flood where past years flooded too. It's
drawn with the GDACS events (Y), whose floods are only those big enough to be reported; on
2026-10-23 GDACS had none current, while the map had ~22,000 km² of flood.

- **Product:** the 2-day composite. NASA recommends none of the 1-, 2- and 3-day windows over
  the others: the 1-day lets more cloud shadow through as false flood, the 3-day is older.
  VIIRS, as MODIS's Terra and Aqua near their end. It's optical, so it can't see under cloud,
  and NASA says it isn't research grade.
- **The world in one picture:** 4096 × 2048 (0.088°, ~640 KB), its exact class colours read
  back (flood, recurring flood; normal water and "not enough data" aren't drawn). The flood
  pixels are scattered (~700 of 8.4 million on 2026-10-22) but keep the floods' area: over
  South Sudan's Sudd it gave 0.123% of the box flooded, against 0.138% from a 0.01° picture.
  Today's composite fills in as the day's passes arrive, so it's asked for again every 3 hours.
- **Zoomed in** (past ~3 km a pixel), the view's own box, snapped out to whole degrees, is asked
  for at the screen's resolution, no finer than the product's 250 m and at most 2048 px, and its
  cells replace the world's there: the Sudd's flood shows the White Nile's shape.
- **Drawn as points,** each its ground's size, as the FIRMS fires are, so it takes no texture
  unit (the shader has none left: see Sea surface temperature). Blue, as public flood maps draw
  flood water: deep for flood, paler and fainter for recurring flood, so it's never mistaken for
  the red-orange fires. The readout gives the areas.

### Sea surface temperature

GHRSST's MUR analysis (JPL) blends satellite and in-situ SST into a gap-free daily field, and
NASA GIBS serves it, and its anomaly from usual, as coloured PNGs with CORS.

- **Read back to values:** GIBS's colour maps (215 colours for temperature, 0.15 °C bins; 62
  for the anomaly, 0.1 °C bins, ±3 °C at the ends) are baked in and tested against the real
  files, and every pixel of both PNGs was an exact colour-map colour on 2026-10-22, so each is
  read back to °C and the globe draws them in its own ramps: cool to warm for the temperature,
  and for the anomaly the blue–white–red public anomaly maps use, faint near zero and strong
  past ±2 °C, so the big departures are what you see.
- **MUR, not MUR25:** MUR (0.01°) asked for at 0.25° (1440 × 720, ~880 KB for both a day).
  GIBS's MUR25 anomaly comes in ~1° squares that showed as blocks on the globe; MUR's at the
  same size has none, and gives the same Niño 3.4 (+2.67 against +2.68 °C on 2026-10-22).
- **Niño 3.4** (5°S–5°N, 170°W–120°W) is averaged by area for the readout, with the region's
  temperature, and named by NOAA's ONI thresholds (±0.5, 1.0, 1.5 °C), loosely, since it's a
  day and not a three-month mean. MUR's anomaly is against MUR's own 2003–2014 climatology,
  not NOAA's 1991–2020, and it matters: in October 2026 MUR said +2.7 °C where NOAA CPC's
  weekly OISST said +3.3, though both had the region at 30.0 °C. So the readout names the
  baseline. CPC's file has no CORS; the official index would need the pipeline.
- **Marine heatwaves** proper (above the seasonal 90th percentile for 5+ days, Hobday et al.
  2016) need a percentile climatology GIBS doesn't serve, so the readout only says how much of
  the ocean is +2 °C or more above usual (11.2% on 2026-10-22), and doesn't call it a heatwave.
- **Texture units:** WebGL promises a shader 16, and with the live clouds and volcanic ash all
  16 were spoken for (the GPU it was checked on has exactly 16). The hourly cloud map's two
  textures (the current and the previous, for the cross-fade) became one two-layer array, which
  freed the unit SST uses; temperature and anomaly share that one texture, so switching between
  them costs nothing.

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

### Night lights

Zoomed in on the night side, with `live` or `daily` imagery: NASA's Black Marble nightly
product from VIIRS's Day/Night Band (GIBS's "Gap-Filled BRDF Corrected Radiance"), in place of
the 2016 Black Marble composite, down to 488 m a pixel. (`painted` keeps the 2016 map.)

- **Why that one:** of GIBS's night-band layers, the raw at-sensor radiance shows moonlit cloud
  smearing the lights (and the app already draws live cloud), and the blue/yellow composite
  paints cloud blue. The Black Marble nightly one is corrected for moonlight and the
  atmosphere, and fills cloudy pixels from the last clear night, so it's clean lights: what's
  lit now, power cuts, new towns, gas flares, fishing fleets.
- **The look:** it's one grey band, about as bright as the 2016 map (90th–99th percentile
  52–217 against 62–173 over Europe on 2026-10-21), so the shader gives it the Black Marble's
  warm colour, over the Black Marble's dark ground (capped, so the old lights don't show
  through), fading out at the fetched area's edges and where it has no data (polar day).
- **Which night:** GIBS has it a day or two after the night; the app asks GIBS for its newest
  date (every 6 hours) rather than guess. The readout's "lights" row gives the date and
  resolution.
- **Only the side on screen:** night tiles are fetched only when the view reaches the night
  side, and day tiles only when it reaches the day side (they used to be fetched for an
  all-night view too).

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

## Clicking things on the globe

A click (a press that moves under 5 px, not part of a pinch) on a marker opens its window
under the others on the right, and puts a reticle on it. The nearest marker of every layer
shown wins, within about its drawn size (8 px for a bulk satellite's dot, 14 for a named
satellite, a launch, a cyclone or a tsunami bulletin, a quake's ring plus 3 px). A click on
nothing marked falls through to the severe-weather warning under the pointer, if any, the
one drawn on top (a US warning, else the worst MeteoAlarm region). Clicking empty space does nothing; × closes the window. With a mouse, the
cursor turns from the grab hand to the pointing hand over anything a click would open,
checked as the mouse moves and every 300 ms while it rests, since satellites move under it.

- **Satellites**, the named ones and every bulk dot (Starlink, OneWeb, GPS…): altitude, speed,
  period, inclination, sunlit or in shadow, NORAD number and how old the elements are, and a
  link to N2YO. A picked bulk satellite is drawn like a named one, with its name and orbit
  line. Clicking a satellite also **follows** it: the view tracks it (`view=track`, `track=`
  its key or NORAD number), as the 6–8 keys do for the named ones.
- **Launches** (pad or vehicle): the clock, status, orbit, altitude and speed in flight, the
  provider, pad and NET. The picked launch is the one shown in full and followed by J. A launch
  in flight is followed on the click; one on the pad offers Follow, which waits on the pad and
  rides the ascent.
- **Earthquakes** (magnitude, depth, PAGER alert, tsunami flag, a link to the USGS event page),
  **cyclones** (class, wind, pressure, motion, GDACS impact), **GDACS** floods, fires and
  eruptions (impact, burned area, since when, a link to the GDACS report), **tsunami** bulletins
  (centre, magnitude, region, a link to the bulletin), **fireballs** (impact and radiated
  energy, altitude, speed), **NWS warnings** (until when, the threat tags, the counties) and
  **MeteoAlarm regions** (each warning's level, type and hours, who issued it, the worst one's
  text and advice, a link to the national service).
- **Buoys** keep their own window (see Buoys under Hazard layers).
- **Following:** the window's Follow / Stop following button switches it. A click while
  following still picks; only a drag lets go (into a fixed view from where the view was), so
  a pinch can zoom while following.
- **Links:** the pick goes in the URL as `pick=kind:id` (`pick=quake:us7000abcd`,
  `pick=sat:44744`), so a link or a reload reopens the window once that layer's data is in.
  The window hides while its layer is off or its data no longer lists it.

## Layer dock

Every layer has a floating button along the bottom, grouped Earth (clouds, city lights,
snow and ice, radar, smoke, buoys, grid), Sky (stars, Sun and Moon, aurora, meteors, ionosphere), Hazards (cyclones,
fires, quakes, lightning, GDACS alerts, tsunami, severe weather), Space (satellites, with a small button for
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
| `Shift+I` | ionosphere: electron content → HF radio absorption → off |
| `Shift+M` | meteors (last 24 h) and fireballs on/off |
| `Shift+B` | buoys on/off (click one for its window) |
| `Z` `Y` `I` | lightning (GOES, MTG), GDACS floods/wildfires/eruptions, snow and ice on/off |
| `Shift+R` | rain: radar with satellite rain where there's none → radar only → off |
| `Shift+S` `Shift+T` | smoke, tsunami alerts on/off |
| `Shift+W` | severe weather on/off: US warnings and SPC outlook, MeteoAlarm's European warnings |
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
  src/severe.ts      NWS storm-based warnings and the SPC outlook: decoding, styles, labels
  src/meteoalarm.ts  MeteoAlarm's European warnings (pipeline): region levels, window, labels
  src/ionosphere.ts  GloTEC electron content and D-RAP absorption onto the aurora's grid
  src/meteors.ts     GMN meteor trajectories as streaks, CNEOS fireballs, shower colours
  src/buoys.ts       buoys: decoding, picking, nearest to a place, drift, pressure tendency, wording
  src/buoyView.ts    a buoy's window: history sparkline tiles, direction dials (the ISS window's parts), an Argo float's profile
  src/satellites.ts  featured satellites, SGP4 (satellite.js), shadow, orbit tracks
  src/satWorker.ts   bulk satellite propagation off the main thread
  src/satcategories.ts  satellite category tree, splitting CelesTrak groups by orbit
  src/satTree.ts     the satellite panel (tri-state checkbox tree)
  src/drawer.ts      the layer dock (Lucide icons; buttons run the hotkeys)
  src/places.ts      coordinates parsing, city lookup, geocoding, the great-circle glide
  src/gibs.ts        NASA GIBS true-colour and night-lights tiles for the region on screen
  src/liveImagery.ts live GOES and MTG pictures: discs, newest drawn scan, zoomed-in requests
  src/mtgLightning.ts  MTG Lightning Imager frames → 0.1° cells, merged with GOES's
  src/mtgFires.ts    MTG fire radiative power (WFS) → FIRMS's 0.05° cells, drawn with them
  src/himawariCloud.ts  the hourly cloud map's recipe (convert.py), ported, for Himawari's bands
  src/himawariClouds.ts, src/himawariWorker.ts   Himawari live clouds: fetching, and a worker
  src/ash.ts         volcanic ash: the Ash RGB sources, their no-data mask, and the toast
  src/sst.ts         sea surface temperature: GIBS's MUR colours read back to °C, Niño 3.4
  src/flood.ts       flood extent: GIBS's flood classes to points, world and zoomed in
  src/usgsVolcanoes.ts  US volcano alert levels (USGS HANS) at the Smithsonian's positions
  src/emsc.ts        EMSC's European and Mediterranean quakes: the day, the push feed, one of each
  src/usVolcanoes.ts the US volcanoes' positions, baked by scripts/bake-volcanoes.py
  src/imerg.ts       NASA IMERG satellite rain from GIBS, recoloured to RainViewer's scheme
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
pnpm meteoalarm              # MeteoAlarm warnings, 38 countries, with region outlines → public/meteoalarm/
pnpm ionosphere              # SWPC GloTEC, newest map, trimmed → public/ionosphere/
pnpm meteors                 # GMN trajectories (last 24 h) + CNEOS fireballs (90 d) → public/meteors/
pnpm buoys                   # NOAA OSMC + NDBC: buoys, latest + last 24 h, and Argo floats → public/buoys/
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
| `track` | `iss`, `tiangong`, `satgus`, any other satellite by NORAD number (`44744`), `launch` (the picked, current or next launch), or `sunrise` / `moonrise` (Sun / Moon framed beside the Earth) | `iss` |
| `pick` | what was clicked, whose window is open: `sat:`, `launch:`, `quake:`, `storm:`, `event:`, `tsunami:`, `fireball:`, `warning:`, `volcano:` or `alarm:` (a MeteoAlarm region) and its id | none |
| `aurora`, `storms`, `fires`, `quakes` | hazard layers on/off | 1 |
| `buoys`, `buoy`, `buoysrc` | buoys on/off; the buoy whose window is open (its id, e.g. `46026`); folder holding `latest.json`, `history.json` and `argo.json` | `0`, none, `buoys/` |
| `meteors`, `meteorsrc` | meteors and fireballs on/off; folder holding their `latest.json` | `0`, `meteors/` |
| `iono`, `ionosrc` | ionosphere wash: `tec` (GloTEC electron content), `drap` (D-RAP HF absorption) or `0`; folder holding GloTEC's `latest.json` | `0`, `ionosphere/` |
| `firehours` | show fires detected within this many hours (1–24) | 12 |
| `lightning`, `events`, `snow` | lightning, GDACS events, snow and ice on/off | 1 |
| `radar`, `smoke`, `tsunami` | RainViewer radar, NOAA HMS smoke, NOAA tsunami alerts on/off | 1 |
| `imagery` | `live` GOES/MTG pictures by day, `daily` yesterday's VIIRS when zoomed in, `painted` neither (`truecolor=0/1` still read) | `live` |
| `severe` | severe weather: NWS storm-based warnings and the SPC day-1 outlook (US), MeteoAlarm's warnings (Europe) | 1 |
| `imerg` | with the radar, NASA IMERG satellite rain where there's no radar | 1 |
| `relief` | terrain lit by the real Sun (ETOPO 2022); 0 shows NASA's fixed shaded relief | 1 |
| `reliefscale` | terrain relief strength, 0.1–5 | 1 |
| `isslive` | ISS telemetry: `track` (panel and stream only while tracking the ISS), `1` (always), `0` | `track` |
| `stormsrc`, `firesrc` | folders holding the storm / fire `latest.json` | `storms/`, `fires/` |
| `lightningsrc`, `eventsrc`, `snowsrc`, `smokesrc`, `tsunamisrc`, `meteoalarmsrc` | folders holding the lightning / GDACS / snow-and-ice / smoke / tsunami / MeteoAlarm `latest.json` | `lightning/`, `events/`, `snowice/`, `smoke/`, `tsunami/`, `meteoalarm/` |
| `launches`, `launchsrc` | launch mode on/off; folder holding its `latest.json` | 1, `launches/` |
| `sats` | `all` (everything ticked), `featured` (named only), `0` | `all` |
| `satshow` | categories ticked in the satellite panel: comma list of `iss`, `tiangong`, `satgus`, `starlink`, `oneweb`, `kuiper`, `qianfan`, `weather-geo`, `weather-heo`, `weather-leo`, `gps`, `glonass`, `galileo`, `beidou`, or `none` | all |
| `satlabels` | categories with name labels (same keys) | `weather-geo,weather-heo,gps,glonass,galileo,beidou` |
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
  and nine groups: `starlink`, `oneweb` (651 on 2026-10-22), `kuiper` (391), `qianfan` (256),
  `weather` (73), `gps-ops` (32), `glo-ops` (28), `galileo` (32) and `beidou` (54). The weather
  and navigation groups also carry names, for labels. A group CelesTrak reports as
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
  category. The broadband constellations and low-orbit weather are soft dots; the far ones
  (GPS, GLONASS, Galileo, BeiDou, geostationary and elliptical weather) are 7 px hollow
  diamonds, since a dot that far out reads as a star. Name labels (GOES 19, GPS PRN 02,
  GLONASS 720, GALILEO 5, BEIDOU C19…) are propagated on the main thread, under 200 with
  every category labelled, and placed greedily so they never overlap a callout,
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
| Ionosphere: electron content | NOAA SWPC GloTEC, 5° × 2.5° (2.5 MB a map at SWPC, ~12 KB gzipped after the pipeline) | pipeline | hourly, browser re-reads every 15 min (only while shown) |
| Ionosphere: HF absorption | NOAA SWPC D-RAP global frequencies, 4° × 2° text table (2.8 KB gzipped) | browser | 10 min (only while shown) |
| Buoys | NOAA OSMC (ERDDAP, last 24 h of buoy reports, ~1.4 MB gzipped); NDBC names, latest observations and DART files | pipeline | hourly; browser re-reads the dots every 15 min, the history when a window opens |
| Argo floats | NOAA OSMC ArgoFloats (ERDDAP): 30 days of surfacings (~280 KB gzipped); new profiles since the last run, binned to 50 dbar | pipeline, keeping a profile store between runs | hourly; browser reads `argo.json` when a float's window opens |
| Meteors | Global Meteor Network daily trajectories (5 MB, trimmed to ~107 KB gzipped); NASA/JPL CNEOS fireballs, 90 days | pipeline | hourly, browser re-reads every 30 min (only while shown) |
| Sun image | NOAA SWPC GOES SUVI 304 Å (1280 px PNG) | browser, only while the Sun is in frame | 15 min |
| Earthquakes | USGS M2.5+ past day (GeoJSON); EMSC M2.5+ in Europe and the Mediterranean, past day (FDSN GeoJSON) | browser | 5 min; EMSC's also pushed as published (WebSocket) |
| Tropical cyclones | GDACS (JTWC / NHC tracks) + NHC current details | pipeline | hourly, browser re-reads every 15 min |
| Fires | NASA FIRMS VIIRS NOAA-20 + NOAA-21, past 24 h | pipeline | hourly, browser re-reads every 10 min |
| Fires (Europe, Africa) | EUMETSAT MTG-I1 FCI Fire Radiative Power, six 10-min slots (EUMETView WFS GeoJSON, ~100 KB gzipped each) | browser | 10 min |
| Lightning (Americas) | NOAA GOES-19 + GOES-18 GLM L2 flashes, last 30 min (AWS open data) | pipeline | hourly, browser re-reads every 5 min |
| Lightning (Europe, Africa) | EUMETSAT MTG-I1 Lightning Imager accumulated flash area, six 5-min frames (EUMETView WMS, ~270 KB each) | browser | 5 min |
| Live imagery | GOES-West/East GeoColor (NASA GIBS), MTG GeoColour and Meteosat-9 IODC Natural Colour Enhanced (EUMETView) | browser | 10 min scans (Meteosat-9: 15), checked every 5 min |
| Live clouds (East Asia, west Pacific) | Himawari-9 AHI Band 13 (PNG, ~2.4 MB) and, by day, Band 3 (JPEG, ~340 KB) from NASA GIBS, turned into cloud opacity in a worker | browser, while its disc faces the view | 10 min |
| Floods, wildfires, eruptions | GDACS current FL/WF events; VO eruptions from the last 90 days | pipeline | hourly, browser re-reads every 30 min |
| US volcano alert levels | USGS HANS monitored volcanoes (~45 KB), positions baked from the Smithsonian's Volcanoes of the World; a volcano's latest notice when its window opens | browser, with the GDACS events | 15 min |
| Flood extent | NASA LANCE VIIRS combined flood, 2-day (NASA GIBS WMS PNG: world 0.088°, ~640 KB; zoomed in, the view at up to 250 m) | browser, with the GDACS events | daily, refreshed every 3 h; checked hourly |
| Sea surface temperature | GHRSST MUR temperature and anomaly (NASA GIBS WMS PNG, 0.25°, ~880 KB a day) | browser, while the layer is on | daily, a day behind; checked hourly |
| Volcanic ash | EUMETSAT Ash RGB: Geo Ring (whole world) and MSG 0° and Indian Ocean discs (EUMETView WMS JPEG) | browser, while the layer is on | Geo Ring 3 h, discs 15 min; checked every 5 min |
| Snow and ice | NOAA/NESDIS IMS 4 km (north); NOAA/NSIDC Sea Ice Index (south) | pipeline | daily charts, checked hourly |
| Weather radar | RainViewer composite, 512 px Web Mercator tiles (16 at globe zoom, 64 zoomed in) | browser, only for a new frame | 10 min frames, checked every 5 min |
| Satellite rain | NASA GPM IMERG early run, 30-min rate, via GIBS (15 tiles, ~0.5 MB); RainViewer coverage tiles | browser | 30 min, ~5 h late, checked every 15 min; coverage daily |
| Smoke | NOAA/NESDIS HMS smoke polygons (KML) | pipeline | through the day, hourly; browser re-reads every 30 min |
| Tsunami (US alerts) | NWS alerts API: active Tsunami Warning / Watch / Advisory, plus sampled zone geometry | browser | 2 min |
| Severe weather (US) | NWS alerts API: storm-based warning polygons; SPC day-1 categorical outlook (GeoJSON) | browser | 2 min (outlook 15 min) |
| Weather warnings (Europe) | MeteoAlarm CAP feeds, one per country (JSON, ~37 MB in all); region outlines baked from MeteoAlarm's geocodes | pipeline | hourly; browser re-reads every 15 min |
| Tsunami (bulletins) | tsunami.gov Atom feeds, NTWC (Alaska) and PTWC (Hawaii), last 48 h | pipeline | hourly |
| ISS telemetry | NASA ISSLive via Lightstreamer (push.lightstreamer.com, ISSLIVE) | browser, while the ISS is tracked | streamed, ≤ 1 update/s per item |

- **Buoys** (`buoys=1`, Shift+B; `buoy=<id>` opens one's window):
  - *Sources:* NOAA's Observing System Monitoring Center (OSMC) gathers what every buoy on the
    global network reports. The pipeline asks its ERDDAP server for the last day, buoys only
    (drifting, moored, weather, tropical-moored and ice) and the columns it uses: ~130,000 rows,
    1.4 MB gzipped, ~20 s. Moorings report a temperature profile, so only depths to 1 m count
    as the surface. NOAA NDBC adds what OSMC lacks for its own stations: names
    (activestations.xml), gusts and wave period and direction (latest_obs.txt, taken whole when
    it's newer), and the DART tsunami buoys' water-column height (realtime2/<id>.dart: every
    15 minutes in standard mode, sent every few hours; 1-minute or 15-second readings in event
    mode, which the window flags). None of them sends CORS headers.
  - *Two files:* `latest.json` holds each buoy's position, type and latest readings (1,921
    buoys on 2026-10-23, 42 KB gzipped: 1,300 drifting, 489 moored, 54 ice, 43 DART, 35
    tropical); buoys that only report a position are left out. `history.json` holds the last
    24 hours in hourly bins (each the hour's last value), a drifter's track, and DART heights
    every 15 minutes (257 KB gzipped); the browser only fetches it once a window opens, and
    again when the pipeline has written a newer one.
  - *Picking:* a click (a press that moves under 5 px, not part of a pinch) selects the
    nearest dot within 12 px, unless another layer's marker is nearer (see Clicking things on
    the globe). The selected buoy gets a reticle in its type's colour, and a
    drifting or ice buoy its last day's track as a dashed line. The selection goes in the
    link, so `?buoy=46026` opens that buoy's window (and shows where it is) with or without the
    layer on.
  - *The window* is built from the ISS window's parts and styles: stat tiles for waves (with
    period), water, wind and pressure, each with its 24-hour sparkline (hover for any hour) and
    its change over the day; direction dials for wind and waves (where they come from); a
    footer with the pressure's 3-hour tendency, gusts, and how far a drifter drifted. Tiles and
    dials a buoy has nothing for hide themselves; a DART buoy has one full-width tile, its
    water column, where the tide shows as the slow swing. Units follow the browser's locale.
    The header chip says how old the latest report is, and the window dims after 6 hours.
  - *Place card:* a searched place lists the nearest buoy within 150 km (not DARTs, which
    report no weather, nor Argo floats, whose surface reading can be days old), e.g. "Buoy
    46237 (10 mi WNW): waves 5.2 ft every 8 s · water 60°F", with an Open button.
  - *Argo floats:* ~4,000 robots that drift at 1,000 m, dive to 2,000 m every ~10 days and
    rise measuring temperature and salinity, then report by satellite from the surface. From
    OSMC's `ArgoFloats` ERDDAP dataset (no CORS either), in `argo.py`:
    - *Positions:* each run asks for the last 30 days of surfacings (`distinct()`, ~10 s,
      ~280 KB gzipped): ~4,350 floats. The latest one goes in `latest.json` as a buoy of type
      `argo`, with its cycle, float model, programme, and surface temperature and salinity
      (the profile's shallowest reading, if within 10 dbar); the rest are its track.
    - *Profiles:* all of them every hour is too much (a 10-day query times out at the server),
      but only ~300 come in a day. So the pipeline keeps a store, each float's newest profile,
      in `argo.json`, and each run fetches only those since the last (plus 3 h of overlap),
      binned by ERDDAP's `orderByClosest` to one level per 50 dbar (~41 levels). Levels whose
      QC flag is 3 or 4 (probably bad, bad) are dropped; real-time salinity especially has
      sensors that drift to nonsense. Profiles older than 30 days are pruned. With no store,
      it's rebuilt from the last 10 days, a day at a time (5–10 min, once). The deploy
      workflow carries `web/public/buoys` between runs with actions/cache; Docker's volume
      keeps it anyway. A failed request is retried once after 20 s (the server returns an
      occasional 500); if Argo is down for a run, the buoys go out without floats, and the
      store is left as it was.
    - *The window:* surface water and salinity tiles, and the dive as a chart: temperature
      (orange) and salinity (blue) against depth, each on its own scale, with their ranges
      underneath; hover to read off any depth. The footer says how far the float drifted over
      30 days, its model and programme. It dims after 15 days without surfacing. `argo.json`
      (~3,900 profiles and ~4,350 tracks, ~700 KB gzipped) is fetched once a float's window
      opens; its track is drawn as a dashed line.
- **Meteors** (`meteors=1`, Shift+M):
  - *The data:* GMN's cameras triangulate each meteor two or more sites catch, and publish the
    trajectories (updated every 6 hours): where it lit up and burned out (latitude,
    longitude, height), its speed, peak brightness, orbit and shower. Two files cover the
    latest day: "yesterday" (a full day, published a few hours after it ends) and
    "latest_daily" (what's come in since); the pipeline merges them by trajectory ID and keeps
    the 24 hours before the newest meteor. On 2026-10-23 that was 5,841 meteors up to 21 Oct
    20:55 UTC: 1,579 Orionids, 200 Southern Taurids, 169 XAR, and 3,300 sporadic.
  - *Not live:* the newest meteor is hours old by the time GMN publishes it, and the day's
    file a day; the readout and the feeds window give the window's end.
  - *Where:* GMN's cameras are mostly in Europe, North America, Australia, New Zealand, Brazil
    and Chile, so meteors show where cameras are; the rest of the world is empty, not quiet.
  - *Drawing:* each meteor is a streak from where it lit up to where it burned out, at those
    heights (so it tilts with the view and hides behind the Earth), on the overlay, batched
    into one path per colour and opacity band. The three biggest showers of the day (30+
    meteors) get gold, cyan and violet; minor showers and sporadics a dim blue-white.
    Brightness follows peak magnitude (−4 bright, +4 faint) and fades to 40% across the day;
    magnitude −2 and brighter are drawn wider. A shower's meteors share a radiant, so they run
    parallel across a region.
  - *Fireballs:* CNEOS lists bolides US government sensors saw from space: a few a month, with
    their height, speed and energy. The last 90 days' are marked; those of the last 30 days, and
    the three biggest, are labelled with their impact energy in kilotons. Its API sends no CORS
    headers, so it comes through the pipeline too.
- **Ionosphere** (`iono=tec` or `drap`, Shift+I): one wash at a time, and only its source
  is fetched.
  - *Electron content:* GloTEC assimilates GNSS ground stations and radio occultations into a
    global map of total electron content (TECU, 10^16 electrons/m²) every 10 minutes. SWPC
    serves each as GeoJSON with CORS, but 5,184 points with four variables each come to
    2.5 MB, uncompressed, so the pipeline keeps the newest map's TEC and anomaly as a 72×72
    grid in tenths of a TECU (36 KB, 12 KB gzipped). Drawn on an "inferno"-like ramp
    (violet → magenta → orange → pale yellow) up to 120 TECU, fading in from ~8 so the night
    side stays clear. On 2026-10-23 at 01:55Z it ran 2–84 TECU, the equatorial anomaly's two
    crests either side of the magnetic equator across the afternoon Pacific.
  - *HF absorption:* D-RAP is the highest radio frequency the D region absorbs by 1 dB, on a
    4° × 2° grid, as a text table (with SWPC's X-ray and proton messages) the browser reads
    directly every 10 minutes. Drawn violet → green → yellow → red up to 35 MHz, SWPC's own
    scale. SWPC's maps start at blue, but over the ocean blue disappears, so here the low end
    is violet. A quiet day (02:16Z on 2026-10-23: up to 3.4 MHz under the Sun, over a third of
    the globe above 1 MHz) is only a faint tint; ~10 MHz, where HF blackouts start, is clear;
    20+ is strong. The readout names the X-ray or proton message when it isn't "normal".
  - *One texture:* both are resampled (bilinear, wrapping the date line) onto the aurora's 1°
    grid and share its texture, aurora in red, TEC in green, absorption in blue, so the
    ionosphere costs no texture unit.
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
  - *MTG fire radiative power:* VIIRS passes over a place a few times a day; the imager on
    Meteosat Third Generation (MTG-I1, at 0°) sees Europe, Africa and the Atlantic every 10
    minutes. EUMETView serves its FRP product as a WFS layer with CORS (one point per fire
    pixel, with its power in MW and a 0–100 confidence), so the browser asks for each slot's
    pixels as GeoJSON, trimmed to five fields: ~4,000 pixels and ~100 KB gzipped on 2026-10-23.
    Pixels under 50% confidence are dropped (~9%) and the rest binned into FIRMS's 0.05° cells.
    The last hour's six slots are kept, fetched one at a time (EUMETView turns away bursts), and
    a cell shows its newest slot's power: power is a rate, so slots aren't summed. Slots are
    listed ~20 minutes after they start, and their counts don't change once listed.
  - *Drawn together:* each MTG cell is drawn at the ground its pixels cover: 1 km² below the
    satellite, ~1.4 km² at a 40° viewing angle and ~2.2 km² at 58°, so a cell of geostationary
    pixels is drawn larger than one of VIIRS's 375 m pixels. FIRMS and MTG cells aren't merged
    where both see a fire (a VIIRS pass hours ago and an FCI scan now are different
    observations), so both are drawn. On 2026-10-23 at 15:10Z the hour held 8.4k pixels in
    5.9k cells. The readout counts FIRMS's detections and MTG's pixels separately.
- **Earthquakes:** ring size ×1.5 per magnitude. Red within the hour, orange within 6 h, then
  yellow. The largest few, M6+, tsunami-flagged or PAGER-alerted quakes get labels.
  - *EMSC for Europe and the Mediterranean:* USGS's day feed has few small quakes outside the
    US: on 2026-10-23 it had 4 M2.5+ in 25–72°N, 30°W–50°E in 24 hours, where the
    Euro-Mediterranean Seismological Centre had 73. So EMSC's M2.5+ earthquakes in that box are
    added (its FDSN service, with CORS: known and suspected earthquakes only, not blasts or
    unconfirmed events), the same threshold as USGS's. A quake both have, within a minute and
    100 km, is shown once, as USGS's (with its tsunami flag and PAGER alert): USGS's 4 were all
    among EMSC's 73, within 3 s and 11 km. EMSC's regions are its upper-case Flinn–Engdahl names,
    written as names; an EMSC quake's window links to EMSC.
  - *Pushed:* EMSC's push feed, a WebSocket (`wss://www.seismicportal.eu/standing_order/websocket`)
    that sends each event as it's published or revised (`create` / `update`), is open while
    quakes are shown, and reconnects 5 s to a minute after a drop. It adds a quake within moments
    of EMSC putting it out rather than at the next 5-minute poll (published 3–9 minutes after
    the quake, on 2026-10-23), revises one in place, and drops one revised below M2.5; old events
    it sends late (an 11 October one, that day) are left out. The day is still fetched every 5
    minutes with USGS's, so a missed push can't leave a gap. The readout counts EMSC's.
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
- **Satellite rain (IMERG):** NASA's Integrated Multi-satellitE Retrievals for GPM merge every
  passing microwave satellite with geostationary infrared into a global rain and snow rate
  every half hour. The near-real-time "early" run reaches GIBS ~5 hours after its half hour
  (20:30Z was the newest at 02:10Z on 2026-10-23).
  - *Only where there's no radar:* RainViewer publishes where its radars reach, as the same
    Web Mercator tiles (opaque where none sees). The app fetches them once a day and the
    shader draws IMERG only there, under the radar, at 65% where radar is 85%. Over radar
    a five-hour-old estimate would put rain where there's none now, so IMERG waits for the
    coverage before it shows anywhere. Storms near the edge of coverage have moved on in
    five hours, so the two can disagree there.
  - *Same colours:* GIBS draws IMERG in its own palette, so the app reads each colour back to
    a rate through GIBS's colour map (fetched once; separate rain and snow ranges, in mm/h),
    turns it into the reflectivity a radar would see (Marshall–Palmer Z = 200 R^1.6 for rain,
    the US radar network's Z = 75 S² for snow), and colours that from RainViewer's Universal
    Blue table, rain and snow apart, with the radar's own cut: rain under 15 dBZ (~0.3 mm/h)
    and snow under 10 dBZ are dropped.
  - *Resolution:* GIBS's 2 km tile set at level 2, 5×3 tiles of 512 px, 0.14° a pixel (IMERG
    itself is 0.1°, ~11 km), so up close it's blockier than radar.
  - A newest half hour GIBS lists but hasn't tiled yet (a 404) falls back half an hour at a
    time, up to an hour and a half. The readout says how old the estimate is, the data-feeds window
    has its own card, and Shift+R's middle step (or `imerg=0`) turns it off.
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
- **US severe weather:**
  - *Warnings:* tornado, extreme wind, severe thunderstorm, flash flood, snow squall and dust
    storm warnings are "storm-based": NWS draws a polygon around the threat itself rather than
    warning whole counties, and the alerts API carries it. Watches and river flood warnings
    cover counties and zones, so they're left out. Real alerts only (`status=actual`), checked
    every two minutes. Each is outlined and lightly filled: red for tornado and extreme wind,
    orange severe thunderstorm, blue flash flood (the GDACS flood colour), with tornadoes on top.
  - *Labels:* tornado and extreme wind warnings always get one; others only when NWS tags the
    threat as destructive, considerable (tornado) or catastrophic. A label leads with NWS's own
    tags ("OBSERVED", "60 MPH", "1.75 IN HAIL") and ends with the expiry. A new tornado or
    extreme wind warning raises a toast (one toast for more than three at once).
  - *Outlook:* SPC's day-1 categorical outlook, the "non-layered" GeoJSON, where each risk
    level is a ring with a hole where the next sits, so it's filled even-odd. Marginal and up
    are filled in SPC's colours; general thunderstorms, which cover half the country most days,
    are a faint dashed edge. The highest area gets a label from Slight Risk up, which gives way
    to every other label. Fetched every 15 minutes (SPC issues it five times a day).
  - Long edges are split every degree so they follow the globe's curve. A polygon crossing the
    limb is drawn as an outline only.
  - On 2026-10-23 at 02:00Z that was 5 severe thunderstorm and 14 flash flood warnings over
    the Southwest, inside a Slight Risk over Arizona and New Mexico.
- **European weather warnings (MeteoAlarm):**
  - *Source:* MeteoAlarm (EUMETNET) gathers the warnings of 38 national weather services into a
    CAP feed per country (feeds.meteoalarm.org, CC BY 4.0). The feeds send no CORS headers and
    keep expired warnings, so the pipeline reads all 38 (~37 MB, under a minute) and keeps what's
    in force or starts within 48 h, at level yellow and up (green means no warning). Nearly every
    service sends English alongside its own language; that's the text kept.
  - *Levels and types:* MeteoAlarm's awareness level is the same scale everywhere: yellow
    (potentially dangerous), orange (dangerous), red (very dangerous). The colours are its style
    guide's, #ffda22, #ff9300 and #ff0000. Its awareness type says what: wind, rain,
    thunderstorm, snow or ice, fog, heat, cold, coastal event, forest fire, avalanche, flood.
  - *Regions:* services name the areas they warn in different ways, and the pipeline turns each
    into an outline. Some put the polygon in the warning (France, Switzerland, Norway, Sweden,
    the UK, Israel, Ukraine, the Baltics, Slovenia, Luxembourg). Most give MeteoAlarm's EMMA_ID
    region codes, whose outlines come from its geocode file (2,006 regions, 33 MB), simplified to
    ~1 km and baked into the pipeline (0.26 MB, `pipeline/scripts/bake_meteoalarm_regions.py`).
    Bulgaria, Hungary, Romania and North Macedonia give only NUTS codes, matched to the region of
    the same name. Belgium's provinces and Ireland's counties (FIPS codes) go by small tables. Croatia's
    counties are newer than the geocode file and come from Natural Earth. On 2026-10-23 every
    area in all 38 feeds found its outline. The pipeline's file was 0.67 MB (0.15 MB gzipped)
    for ~400 warnings over ~760 regions.
  - *Drawing:* a region is filled by its worst warning in force and outlined, dashed, in the
    colour of a worse one still to come. Each level is one shape, filled non-zero with outlines
    wound one way and holes the other, so where regions overlap (Ireland's sea areas under the
    Met Office's polygons, Dutch coastal waters over German islands) they fill once instead of
    cancelling out, and holes stay open. The borders between regions are kept faint. Red warnings get a label at their
    largest region and a toast when new (one toast for more than three). Shapes are rebuilt each
    minute, as warnings begin and end.
  - On 2026-10-23 at 19:30Z: a red wind warning over the Harz above 1,000 m (gusts up to 130 km/h),
    49 orange and ~350 yellow, most for wind.
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
- Tsunami, severe weather, launch, storm, quake and GDACS labels share one placement pass (in that order). Labels keep
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

## Baked data: re-running by hand

Two datasets change too rarely to fetch each hour, so they're baked into the repo by a
script run by hand. Neither runs in the pipeline or the deploy; nothing reminds you when
they go stale, so check them now and then (a few times a year is plenty).

| What | Script | Writes | When to re-run | How to tell |
|---|---|---|---|---|
| MeteoAlarm's warning regions | `python -I pipeline/scripts/bake_meteoalarm_regions.py` | `pipeline/xearth_clouds/meteoalarm_regions.json.gz` | MeteoAlarm publishes a new `MeteoAlarm_Geocodes_<date>.json` in [its documents repository](https://gitlab.com/meteoalarm-pm-group/documents) (it was `2026_07_31` when baked): update `GEOCODES_FILE` in the script first | `unplaced` in `meteoalarm/latest.json` isn't empty (areas with no outline aren't drawn), or the job's log ends "N areas unplaced" |
| US volcanoes' positions | `python -I web/scripts/bake-volcanoes.py web/src/usVolcanoes.ts` | `web/src/usVolcanoes.ts` | The Smithsonian adds or renumbers a US volcano | A volcano HANS monitors is missing from the globe (one it can't place is dropped without a message): on 2026-10-23 HANS listed 69 and 67 were placed, the other two being regions with no volcano number |

The MeteoAlarm script fetches the geocodes (33 MB) and Natural Earth's admin-1 file (40 MB),
or takes paths to copies already downloaded. Before committing a new bake, run the pipeline
tests (`python -m pytest`), and run the job once (`pnpm meteoalarm`) to see that `unplaced`
is empty. If a country's names no longer match, the script's `RENAMES` and the job's
`BE_NUTS2` and `IE_FIPS` tables are where to fix them.

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
(`src/toasts.ts`) gives frame rate, ISS telemetry, data feeds, a searched place's card, a
buoy's window and the window of anything else clicked on the globe the same window: one width (320 px), the same glass, and a header with the
title, a status chip (the ISS signal, the feeds summary, a buoy's last report) and ×. It stacks them in that order in one column from
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
- Live imagery, lightning and fire radiative power over Europe and Africa: EUMETSAT, via
  EUMETView — MTG-I1 FCI GeoColour RGB and Fire Radiative Power, and Lightning Imager
  Accumulated Flash Area; over the Indian Ocean and western Asia, Meteosat-9 (IODC) SEVIRI
  Natural Colour Enhanced RGB.
- Live clouds over East Asia and the west Pacific: Himawari-9 AHI (Japan Meteorological
  Agency) Band 13 infrared and Band 3 visible, via NASA GIBS.
- Night lights: NASA Black Marble (Román et al.), NOAA-20 VIIRS Day/Night Band gap-filled BRDF
  corrected radiance, via NASA GIBS.
- Icons: Lucide (ISC License).
- Place search: geocoding by Open-Meteo, with GeoNames data (CC BY 4.0).
- Interface type: Chakra Petch by Cadson Demak (SIL Open Font License 1.1), bundled via
  Fontsource.
- Buoys: NOAA Observing System Monitoring Center (OSMC) and NOAA National Data Buoy Center
  (NDBC), including the DART tsunami buoys. Argo floats: the Argo programme
  (https://argo.ucsd.edu), part of the Global Ocean Observing System; data collected and made
  freely available by the International Argo Program and the national programs that
  contribute to it, via the Coriolis GDAC and NOAA OSMC.
- Meteors: Global Meteor Network (globalmeteornetwork.org), data CC BY 4.0. Vida et al. 2020,
  MNRAS 491, 2688–2705; Vida et al. 2021, "The Global Meteor Network – Methodology and first
  results", MNRAS 506, 5046–5074. Fireballs: NASA/JPL Center for Near Earth Object Studies (CNEOS).
- Aurora, space weather, the ionosphere (GloTEC, D-RAP) and the GOES SUVI Sun image: NOAA Space Weather Prediction Center. Earthquakes: USGS, and the Euro-Mediterranean Seismological Centre (EMSC, seismicportal.eu). Tropical cyclones:
  GDACS (European Commission JRC; JTWC and NHC data) and NOAA NHC. Fires: "We acknowledge the use
  of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's
  Earth Science Data and Information System (ESDIS)."
- Lightning: NOAA GOES-R Series Geostationary Lightning Mapper (GLM) L2 data via the NOAA Open
  Data Dissemination program on AWS; EUMETSAT MTG Lightning Imager (see above).
- Floods, wildfires, eruptions: GDACS, a cooperation framework of the United Nations and the
  European Commission (GloFAS, GWIS and the Volcanic Ash Advisory Centres).
- Volcanic ash: EUMETSAT, via EUMETView — Ash RGB from the Geo Ring multi-mission mosaic and
  Meteosat Second Generation's 0° and Indian Ocean services.
- Sea surface temperature: GHRSST Level 4 MUR Global Foundation SST Analysis (JPL MUR MEaSUREs
  Project), distributed by NASA PO.DAAC, via NASA GIBS.
- Flood extent: NASA LANCE VIIRS (VCDWD) global flood product, NOAA-20 and NOAA-21, via NASA
  GIBS.
- US volcano alert levels: USGS Volcano Hazards Program (HANS) and its observatories (AVO, CVO,
  HVO, YVO, CalVO and the Northern Mariana Islands). Volcano positions: Global Volcanism Program,
  Smithsonian Institution, Volcanoes of the World.
- Weather radar: [Weather data by RainViewer](https://www.rainviewer.com/) (free API, personal
  and educational use).
- Satellite rain: NASA GPM IMERG (Huffman et al.), early run, via NASA GIBS.
- Smoke: NOAA/NESDIS Hazard Mapping System (HMS) fire and smoke analysis.
- Tsunami: NOAA National Tsunami Warning Center and Pacific Tsunami Warning Center
  (tsunami.gov); NOAA National Weather Service alerts.
- Severe weather: NOAA National Weather Service alerts (api.weather.gov) and the NOAA Storm
  Prediction Center's day-1 convective outlook.
- European weather warnings: MeteoAlarm, data provided by EUMETNET members (CC BY 4.0); region
  outlines from MeteoAlarm's geocodes, and Croatia's counties from Natural Earth (public domain).
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
