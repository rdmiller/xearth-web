#!/usr/bin/env node
// Download NASA's Blue Marble Next Generation (one per month, 5400×2700) twice over —
// day-MM.jpg with its shaded topography and bathymetry (the cloud job's clear-sky reference,
// and the globe with terrain lighting off) and surface-MM.jpg without, which the globe
// lights by the real Sun from public/relief.webp — plus Black Marble 2016 (night lights) and
// the CGI Moon Kit LROC colour map (2048×1024, centred on 0° longitude; credit NASA's
// Scientific Visualization Studio) into public/textures/. All NASA imagery. Existing files
// are skipped.
//
//   node scripts/fetch-textures.mjs            all 12 months + night
//   node scripts/fetch-textures.mjs --current  just this month + night (fast start)
//   node scripts/fetch-textures.mjs --out DIR  somewhere else (the Docker setup's data volume)

import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 && process.argv[outArg + 1] ? process.argv[outArg + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures');
const BASE = 'https://eoimages.gsfc.nasa.gov/images/imagerecords';
const MONTH_RECORDS = ['73580', '73605', '73630', '73655', '73701', '73726', '73751', '73776', '73801', '73826', '73884', '73909'];
// The plain (no relief) series. NASA's server has no June image in it, so June uses July's.
const PLAIN_RECORDS = ['73938', '73967', '73992', '74017', '74042', '74092', '74092', '74117', '74142', '74167', '74192', '74218'];
const PLAIN_MONTH = ['01', '02', '03', '04', '05', '07', '07', '08', '09', '10', '11', '12'];

const files = MONTH_RECORDS.flatMap((id, i) => {
  const mm = String(i + 1).padStart(2, '0');
  const plain = PLAIN_RECORDS[i];
  return [
    { name: `day-${mm}.jpg`, url: `${BASE}/73000/${id}/world.topo.bathy.2004${mm}.3x5400x2700.jpg`, month: i },
    { name: `surface-${mm}.jpg`, url: `${BASE}/${plain.slice(0, 2)}000/${plain}/world.2004${PLAIN_MONTH[i]}.3x5400x2700.jpg`, month: i },
  ];
});
files.push({ name: 'night.jpg', url: `${BASE}/144000/144898/BlackMarble_2016_01deg.jpg`, month: -1 });
files.push({ name: 'moon.jpg', url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg', month: -1 });

const currentOnly = process.argv.includes('--current');
const month = new Date().getUTCMonth();
mkdirSync(OUT, { recursive: true });

for (const f of files) {
  if (currentOnly && f.month !== -1 && f.month !== month) continue;
  const dest = join(OUT, f.name);
  if (existsSync(dest)) {
    console.log(`have ${f.name}`);
    continue;
  }
  process.stdout.write(`get  ${f.name} … `);
  const resp = await fetch(f.url);
  if (!resp.ok || !resp.body) throw new Error(`${resp.status} ${f.url}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(part));
  renameSync(part, dest);
  console.log('ok');
}
