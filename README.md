# xearth web

A live space view of Earth in the browser, after [xearth](https://hewgill.com/xearth/original/):
the globe is lit by the real Sun for the current moment and redraws on a timer, with a
global cloud layer refreshed every hour from geostationary satellites.

- **Lighting** — the subsolar point comes from [astronomy-engine](https://github.com/cosinekitty/astronomy)
  (tested against USNO equinox/solstice times and Meeus to < 0.02°). A soft terminator fades
  through civil twilight into NASA Black Marble city lights.
- **Views** — xearth's `fixed`, `sunrel`, `orbit` and `moon` positions; orthographic by
  default, perspective with `dist`. Drag to look around, scroll to zoom.
- **Clouds** — NOAA/NESDIS GMGSI longwave-infrared mosaic (GOES-East/West, Meteosat,
  Himawari), converted hourly to an equirectangular alpha map and cross-faded in.
- **Everything is a URL parameter**, like xearth's command-line flags. Press **H** in the app.

## Layout

```
web/        Vite + TypeScript + WebGL2 app
  src/astronomy.ts   subsolar / sublunar points
  src/view.ts        view modes, camera, projection
  src/renderer/      full-screen ray-sphere shader
  src/cloudSync.ts   polls clouds/latest.json, hands new maps to the renderer
  scripts/fetch-textures.mjs   downloads NASA Blue/Black Marble
pipeline/   Python: GMGSI NetCDF → clouds/clouds-YYYYMMDDTHHMMZ.webp + latest.json
.github/workflows/  CI, and an hourly build-and-deploy to GitHub Pages
```

## Running locally

```bash
cd web
pnpm install
pnpm textures --current      # this month's Blue Marble + Black Marble (~3 MB); omit --current for all 12
pip install -e ../pipeline   # numpy, netCDF4, Pillow
pnpm clouds                  # newest GMGSI file → public/clouds/
pnpm dev
```

The app runs without textures or clouds (plain blue globe, "clouds unavailable") and says
which is missing in the label.

Tests: `pnpm test` in `web/`, `pytest` in `pipeline/`.

## URL parameters

| Parameter | Meaning | Default |
|---|---|---|
| `view` | `fixed`, `sunrel`, `orbit`, `moon` | `fixed` |
| `lat`, `lon` | viewer position (`fixed`) or offset from the subsolar point (`sunrel`) | 20, your time zone's meridian |
| `period`, `inc` | orbit period (h) and inclination (°) | 1.5, 51.6 |
| `dist` | viewer distance in Earth radii; 0 = orthographic | 0 |
| `mag`, `rot` | size, rotation (° counter-clockwise) | 1, 0 |
| `wait` | seconds between redraws | 60 |
| `time`, `speed` | ISO start time; clock multiplier | now, 1 |
| `clouds`, `lights`, `grid`, `markers`, `stars`, `label` | `0` / `1` | 1,1,0,1,1,1 |
| `cloudsrc` | folder holding `latest.json` (e.g. an R2/S3 bucket) | `clouds/` |

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

## Data and credits

- Earth imagery: NASA Visible Earth — Blue Marble Next Generation (Reto Stöckli, NASA Earth
  Observatory) and Black Marble 2016. Public domain.
- Clouds: NOAA/NESDIS Global Mosaic of Geostationary Satellite Imagery (GMGSI) via the NOAA
  Open Data Dissemination program. Use does not imply NOAA endorsement.
