#!/usr/bin/env node
// Convert the Yale Bright Star Catalogue, 5th revised ed. (Hoffleit & Warren
// 1991; CDS catalogue V/50) into public/stars.json.
//
//   node scripts/build-stars.mjs [path/to/catalog or catalog.gz]
//
// Without a path it downloads https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz.
// Output is committed, so the site never depends on CDS at build time.
//
// Byte columns (1-based, from the catalogue's ReadMe):
//   76-77 RAh, 78-79 RAm, 80-83 RAs, 84 DE-, 85-86 DEd, 87-88 DEm, 89-90 DEs
//   (J2000, epoch 2000.0), 103-107 Vmag, 110-114 B-V.
// The 14 entries with no position (novae, clusters dropped from later
// editions) are skipped. Proper motion since 2000 is ≤ ~1′ — ignored.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'stars.json');
const URL_GZ = 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz';
/** Used when a star has no B−V: roughly white. */
const DEFAULT_BV = 0.4;

async function readCatalog(path) {
  const buf = path ? readFileSync(path) : Buffer.from(await (await fetch(URL_GZ)).arrayBuffer());
  return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('latin1');
}

const col = (line, from, to) => line.slice(from - 1, to).trim();

export function parseLine(line) {
  const rah = col(line, 76, 77);
  const vmag = col(line, 103, 107);
  if (!rah || !vmag) return null;
  const ra = (Number(rah) + Number(col(line, 78, 79)) / 60 + Number(col(line, 80, 83)) / 3600) * 15;
  const sign = col(line, 84, 84) === '-' ? -1 : 1;
  const dec = sign * (Number(col(line, 85, 86)) + Number(col(line, 87, 88)) / 60 + Number(col(line, 89, 90)) / 3600);
  const bvRaw = col(line, 110, 114);
  return { hr: Number(col(line, 1, 4)), ra, dec, vmag: Number(vmag), bv: bvRaw ? Number(bvRaw) : DEFAULT_BV };
}

const text = await readCatalog(process.argv[2]);
const stars = text
  .split(/\r?\n/)
  .map(parseLine)
  .filter((s) => s && Number.isFinite(s.ra) && Number.isFinite(s.dec) && Number.isFinite(s.vmag))
  .sort((a, b) => a.vmag - b.vmag);

// Flat integer array, ×100 (0.01° ≈ a fifth of a pixel at the default zoom).
const data = stars.flatMap((s) => [Math.round(s.ra * 100), Math.round(s.dec * 100), Math.round(s.vmag * 100), Math.round(s.bv * 100)]);
const out = {
  source: 'Yale Bright Star Catalogue, 5th rev. ed. (Hoffleit & Warren 1991), CDS V/50',
  frame: 'ICRS/J2000 equatorial, epoch 2000.0',
  fields: ['ra_deg', 'dec_deg', 'vmag', 'b_v'],
  scale: 100,
  count: stars.length,
  data,
};
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`wrote ${stars.length} stars (V ${stars[0].vmag} … ${stars.at(-1).vmag}) to ${OUT}`);
