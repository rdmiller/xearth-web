// Volcanic ash: EUMETSAT's Ash RGB, a false-colour composite of three infrared channels made to
// pick out ash and SO2 plumes, day and night. Red from the 12.0 − 10.8 µm difference (ash
// absorbs the other way round from cloud), green from 10.8 − 8.7 µm (SO2 absorbs at 8.7) and
// blue from 10.8 µm (temperature).
//
// EUMETView serves it three ways, all with CORS and the same recipe, so the colours agree:
// the Geo Ring, a whole-world mosaic of the geostationary ring (every 3 hours, ~3 hours behind),
// and MSG's 0° and Indian Ocean discs (every 15 minutes, ~30 minutes behind). The layer is the
// Geo Ring, with the two discs over it where they see. It replaces everything else on the globe
// it covers (the picture is the point): a forecaster's view, so it's off by default.
//
// Desert ground and dust look pinkish in it too, which is why it's a picture and not ash
// detected and drawn: a detector would light up the Sahara.

import { createElement, MapPin, type IconNode } from 'lucide';
import { IMPACT_COLOR, impactLevel, type GdacsEvent } from './hazards';
import { EUMETSAT_WMS, LIMB_DEG, viewAngleDeg, type LiveSource } from './liveImagery';
import type { Toast } from './toasts';

/** MSG 0° first; the Indian Ocean disc fills in east of it; the Geo Ring under both. */
export const ASH_SOURCES: readonly LiveSource[] = [
  { key: 'ash-msg', name: 'MSG 0°', subLon: 0, wms: EUMETSAT_WMS, layer: 'msg_fes:rgb_ash', times: 'eumetsat' },
  { key: 'ash-iodc', name: 'Meteosat-9', subLon: 45.5, wms: EUMETSAT_WMS, layer: 'msg_iodc:rgb_ash', times: 'eumetsat', fill: true },
  { key: 'ash-ring', name: 'Geo Ring', subLon: 0, wms: EUMETSAT_WMS, layer: 'mumi:wideareacoverage_rgb_ash', times: 'eumetsat', global: true },
];

/** How often each source has a new picture, minutes. */
const EVERY_MIN: Record<string, number> = { 'ash-msg': 15, 'ash-iodc': 15, 'ash-ring': 180 };

/** The Geo Ring's mosaic reaches about this far north and south. */
export const RING_MAX_LAT = 75;

/** A pixel whose weakest channel is at least this is no data (EUMETView draws it white). */
export const NO_DATA_MIN = 240;

/**
 * Mark an Ash RGB picture's no data transparent, in place: white, and `grow` pixels around it,
 * where JPEG blends the white into the picture (a pale band no colour test alone can tell from
 * data: pale desert pink reaches 224 in its weakest channel, so a lower cutoff holes the Sahara).
 * On 2026-10-23's 17:30Z MSG picture, 240 masked none of the Sahara and Arabia, and growing
 * 3 pixels left 11–38 pale band pixels in a picture, against 280–890 at a 209 cutoff.
 */
export function maskAshNoData(rgba: Uint8ClampedArray, w: number, h: number, grow = 3): void {
  const white = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) white[i] = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) >= NO_DATA_MIN ? 1 : 0;
  // Grow rows, then columns: a (2·grow + 1)² square around each white pixel.
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!white[y * w + x]) continue;
      for (let dx = -grow; dx <= grow; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w) rows[y * w + xx] = 1;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!rows[y * w + x]) continue;
      for (let dy = -grow; dy <= grow; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h) rgba.fill(0, (yy * w + x) * 4, (yy * w + x) * 4 + 4);
      }
    }
  }
}

/** EUMETSAT's reading of the Ash RGB's colours (its RGB quick guide). */
export const ASH_KEY: readonly { colour: string; label: string }[] = [
  { colour: '#e0305a', label: 'Ash: red to magenta' },
  { colour: '#4cff3c', label: 'SO2: bright green' },
  { colour: '#7a5a1c', label: 'Thick ice cloud: brown' },
  { colour: '#14205a', label: 'Thin high cloud: dark blue, black' },
  { colour: '#7ab8ff', label: 'Clear ground and sea: light blue' },
  { colour: '#e6a8d8', label: 'Desert and dust: pink (not ash)' },
];

/** The source drawn at a point: a disc where one sees it well, else the Geo Ring, else none. */
export function ashSourceAt(lat: number, lon: number): LiveSource | undefined {
  for (const s of ASH_SOURCES) {
    if (s.global) {
      if (Math.abs(lat) <= RING_MAX_LAT) return s;
    } else if (viewAngleDeg(lat, lon, s.subLon) < LIMB_DEG - 8) return s;
  }
  return undefined;
}

export interface AshVolcano {
  event: GdacsEvent;
  source: LiveSource | undefined;
  /** Days since the eruption GDACS last recorded (undefined when it gave no date). */
  daysAgo: number | undefined;
}

/** GDACS's eruptions, newest first, each with the source that shows it. */
export function ashVolcanoes(events: readonly GdacsEvent[], now: number): AshVolcano[] {
  return events
    .filter((e) => e.type === 'VO')
    .map((e) => {
      const t = Date.parse(e.from ?? e.to ?? '');
      return { event: e, source: ashSourceAt(e.pos[1], e.pos[0]), daysAgo: Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : undefined };
    })
    .sort((a, b) => (a.daysAgo ?? Infinity) - (b.daysAgo ?? Infinity));
}

/** "MSG 0° · every 15 min" or "outside the ash pictures". */
export function seenBy(source: LiveSource | undefined): string {
  if (!source) return 'outside the ash pictures';
  const m = EVERY_MIN[source.key] ?? 15;
  return `${source.name} · every ${m >= 60 ? `${m / 60} h` : `${m} min`}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

function icon(node: IconNode, size = 12): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "erupted 10 Oct · 13 d ago · MSG 0° · every 15 min". */
export function volcanoLine(v: AshVolcano): string {
  const when = v.daysAgo === undefined ? 'date unknown' : `erupted ${day((v.event.from ?? v.event.to)!)} · ${v.daysAgo} d ago`;
  return `${when} · ${seenBy(v.source)}`;
}

/**
 * The layer's toast: the pictures' times, what the colours mean, and GDACS's eruptions with
 * the source that shows each; pressing one goes there.
 */
export class AshView {
  constructor(
    private readonly toast: Toast,
    private readonly go: (v: AshVolcano) => void,
  ) {}

  show(open: boolean) {
    this.toast.show(open);
  }

  /** `times`: each source's scan time, by key; `volcanoes` undefined while GDACS is loading. */
  render(times: ReadonlyMap<string, string>, volcanoes: AshVolcano[] | undefined, failed: boolean) {
    const t = this.toast;
    const body = el('div', 'iss-content');

    const scans = ASH_SOURCES.filter((s) => times.has(s.key)).map((s) => `${s.name} ${times.get(s.key)!.slice(11, 16)}`);
    body.append(el('p', 'iss-note', scans.length ? `Ash RGB · ${scans.join(' · ')} UTC` : 'Ash RGB · loading…'));

    const key = el('ul', 'ash-key');
    for (const k of ASH_KEY) {
      const li = el('li', '');
      const sw = el('span', 'ash-swatch');
      sw.style.background = k.colour;
      li.append(sw, el('span', '', k.label));
      key.append(li);
    }
    body.append(key);

    body.append(el('p', 'iss-label', 'Eruptions (GDACS, 90 days)'));
    if (!volcanoes) body.append(el('p', 'iss-note', failed ? 'GDACS unavailable' : 'Loading…'));
    else if (!volcanoes.length) body.append(el('p', 'iss-note', 'None reported'));
    else {
      const list = el('ul', 'ash-volcanoes');
      for (const v of volcanoes) {
        const b = el('button', 'ash-volcano');
        b.type = 'button';
        b.title = `Go to ${v.event.name}`;
        const name = el('span', 'ash-name', `${v.event.name}, ${v.event.country}`);
        const alert = el('span', 'iss-chip', v.event.alert);
        alert.style.color = IMPACT_COLOR[impactLevel(v.event.alert)];
        const when = el('span', 'iss-note', volcanoLine(v));
        const head = el('span', 'ash-head');
        head.append(icon(MapPin), name, alert);
        b.append(head, when);
        b.addEventListener('click', () => this.go(v));
        const li = el('li', '');
        li.append(b);
        list.append(li);
      }
      body.append(list);
    }
    t.body.replaceChildren(body);
    const seen = volcanoes?.filter((v) => v.source).length ?? 0;
    t.setStatus(volcanoes ? `${seen} OF ${volcanoes.length} IN VIEW` : '', seen ? 'warn' : 'info');
  }
}
