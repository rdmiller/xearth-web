// The card shown after going to a place from the search, or clicking a city: its local time,
// weather, sunrise and sunset, a city's facts, and any alerts there. A toast window
// (toasts.ts) that stays a while — it closes itself after a read (held open while the pointer
// or focus is on it), with ×, or with Escape. A city's card has no timer: it stays until the
// viewer moves on to something else.

import {
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  createElement,
  Droplets,
  Moon,
  Navigation2,
  Sun,
  Sunrise,
  Sunset,
  Wind,
  type IconNode,
} from 'lucide';
import type { CityAbout } from './cities';
import { IMPACT_COLOR, IMPACT_WORD } from './hazards';
import { formatCoordinates, type Place } from './places';
import {
  compass,
  daylightText,
  localClock,
  offsetLabel,
  sortAlerts,
  speed,
  sunLine,
  temp,
  uvBand,
  weatherIcon,
  weatherWord,
  type LocalAlert,
  type LocalWeather,
  type WeatherIcon,
} from './locale';
import type { Toast } from './toasts';

const SHOW_MS = 20_000;
/** With alerts to read, a little longer. */
const SHOW_ALERTS_MS = 30_000;

/** Each part arrives on its own: absent while it's still loading. */
export interface PlaceReport {
  /** null: the weather service didn't answer. */
  weather?: LocalWeather | null;
  alerts?: LocalAlert[];
  /** What was checked for alerts, for the "none" line: "NWS", "nearby hazards"… */
  checked?: string[];
  /** The nearest buoy's readings, and opening its window; null when none is near. */
  buoy?: { text: string; open: () => void } | null;
  /** A city's facts (Natural Earth): its region and country, and lines like "Capital of Japan". */
  facts?: { where: string; lines: string[] };
  /** A city's Wikipedia summary; null when there's none. */
  about?: CityAbout | null;
}

export interface PlaceCardHandlers {
  /** "Remove label" was pressed. */
  unlabel(place: Place): void;
}

function icon(node: IconNode, size = 14): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** The impact meter, as on the globe: that many of three rising bars lit in GDACS's colour. */
export function impactMeter(level: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'meter');
  svg.setAttribute('viewBox', '0 0 13 10');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '10');
  svg.setAttribute('role', 'img');
  const word = `${IMPACT_WORD[level] ?? 'Unknown'} impact`;
  svg.setAttribute('aria-label', word);
  const title = document.createElementNS(NS, 'title');
  title.textContent = `${word} (GDACS)`;
  svg.append(title);
  for (let i = 0; i < 3; i++) {
    const bar = document.createElementNS(NS, 'rect');
    const bh = 4 + i * 3;
    bar.setAttribute('x', String(i * 5));
    bar.setAttribute('y', String(10 - bh));
    bar.setAttribute('width', '3');
    bar.setAttribute('height', String(bh));
    bar.setAttribute('fill', i < level ? IMPACT_COLOR[level] : 'rgba(175, 215, 240, 0.22)');
    svg.append(bar);
  }
  return svg;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

// ---- the weather, drawn ------------------------------------------------------------------

const WEATHER_ICONS: Record<WeatherIcon, IconNode> = {
  clear: Sun,
  'clear-night': Moon,
  partly: CloudSun,
  'partly-night': CloudMoon,
  cloudy: Cloudy,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunder: CloudLightning,
  hail: CloudHail,
};

/** The weather now: its picture, the temperature, what it's like, and the day's high and low. */
function nowBlock(w: LocalWeather, imperial: boolean): HTMLElement {
  const kind = weatherIcon(w.code, w.isDay);
  const box = el('div', `now wx-${kind}`);
  const pic = icon(WEATHER_ICONS[kind], 40);
  pic.setAttribute('stroke-width', '1.4');
  const main = el('div', 'now-main');
  main.append(el('span', 'now-temp', temp(w.tempC, imperial)), el('span', 'now-word', weatherWord(w.code, w.isDay)));
  const side = el('div', 'now-side');
  if (Math.abs(w.feelsC - w.tempC) >= 2) side.append(el('span', '', `Feels ${temp(w.feelsC, imperial)}`));
  if (w.hiC !== null && w.loC !== null) {
    const hilo = el('span', 'hilo');
    hilo.append(el('b', 'hi', `↑${temp(w.hiC, imperial).slice(0, -1)}`), el('b', 'lo', `↓${temp(w.loC, imperial).slice(0, -1)}`));
    hilo.title = 'Today’s high and low';
    side.append(hilo);
  }
  box.append(pic, main, side);
  return box;
}

/** Wind (an arrow the way it blows), humidity and the day's peak UV, as chips. */
function weatherChips(w: LocalWeather, imperial: boolean): HTMLElement {
  const row = el('div', 'chips');
  const chip = (node: IconNode, text: string, title: string, className = '') => {
    const c = el('span', `chip ${className}`);
    c.title = title;
    const svg = icon(node, 13);
    c.append(svg, document.createTextNode(text));
    row.append(c);
    return svg;
  };
  if (Number.isFinite(w.windKmh)) {
    const gust = Number.isFinite(w.gustKmh) && w.gustKmh >= w.windKmh + 10 ? `, gusts ${speed(w.gustKmh, imperial).split(' ')[0]}` : '';
    if (w.windKmh < 2) chip(Wind, 'Calm', 'Wind');
    else if (!Number.isFinite(w.windDir)) chip(Wind, `${speed(w.windKmh, imperial)}${gust}`, 'Wind');
    else {
      // Reported as where it blows from; the arrow points where it's going.
      const arrow = chip(Navigation2, `${compass(w.windDir)} ${speed(w.windKmh, imperial)}${gust}`, `Wind from the ${compass(w.windDir)}`, 'wind');
      arrow.style.transform = `rotate(${w.windDir + 180}deg)`;
    }
  }
  if (Number.isFinite(w.humidity)) chip(Droplets, `${Math.round(w.humidity)}%`, 'Humidity', 'humid');
  if (w.uv !== null) {
    const band = uvBand(w.uv);
    chip(Sun, `UV ${Math.round(w.uv)} ${band}`, 'UV index, today’s peak', `uv uv-${band.replace(' ', '-')}`);
  }
  return row;
}

/** Sunrise and sunset by their icons, and the daylight between. Null without both times. */
function sunTimes(w: LocalWeather): HTMLElement | null {
  if (!w.sunrise || !w.sunset) return null;
  const row = el('div', 'sun-times');
  const time = (node: IconNode, text: string, title: string) => {
    const s = el('span', 'sun-time');
    s.title = title;
    s.append(icon(node, 16), document.createTextNode(text));
    return s;
  };
  row.append(time(Sunrise, w.sunrise, 'Sunrise'), time(Sunset, w.sunset, 'Sunset'));
  if (w.daylightS !== null) row.append(el('span', 'daylight', `${daylightText(w.daylightS)} of daylight`));
  return row;
}

export class PlaceCard {
  private place: Place | undefined;
  private report: PlaceReport = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private holdMs = SHOW_MS;
  private isCity = false;
  private held = false;
  private readonly body: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly unlabelButton: HTMLButtonElement;

  /** `toast`: its window, whose × should call hide(). */
  constructor(
    private readonly toast: Toast,
    private readonly handlers: PlaceCardHandlers,
  ) {
    const root = toast.el;
    root.setAttribute('aria-live', 'polite');
    this.sub = el('p', 'sub');
    this.body = el('div', 'body');
    const footer = el('footer', '');
    this.unlabelButton = el('button', 'unlabel', 'Remove label');
    this.unlabelButton.type = 'button';
    this.unlabelButton.addEventListener('click', () => {
      if (this.place) this.handlers.unlabel(this.place);
      this.hide();
    });
    const credit = el('a', 'credit', 'Weather: Open-Meteo');
    credit.href = 'https://open-meteo.com/';
    credit.target = '_blank';
    credit.rel = 'noopener';
    footer.append(this.unlabelButton, credit);
    toast.body.append(this.sub, this.body, footer);

    // Held open while being read.
    const hold = (on: boolean) => {
      this.held = on;
      if (on) clearTimeout(this.timer);
      else this.arm();
    };
    root.addEventListener('pointerenter', () => hold(true));
    root.addEventListener('pointerleave', () => hold(root.contains(document.activeElement)));
    root.addEventListener('focusin', () => hold(true));
    root.addEventListener('focusout', (e) => hold(root.contains(e.relatedTarget as Node) || root.matches(':hover')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.shown && !(e.target as Element | null)?.closest?.('input')) this.hide();
    });
  }

  get shown() {
    return this.toast.shown;
  }

  /** A city's card: it stays until the viewer moves on (another click, a search, × or Esc). */
  get city() {
    return this.isCity && this.shown;
  }

  /** Open for a place while its report loads (`city`: a city clicked on the globe). */
  show(place: Place, labelled: boolean, city = false) {
    this.place = place;
    this.isCity = city;
    this.toast.setTitle(place.name);
    this.sub.textContent = place.detail || formatCoordinates(place.lat, place.lon);
    this.unlabelButton.hidden = !labelled;
    this.report = {};
    this.body.replaceChildren(el('p', 'loading', 'Checking the weather and alerts…'));
    this.toast.show(true);
    this.holdMs = SHOW_MS;
    this.arm();
  }

  /** Part of the report for `place`, if the card is still showing it. */
  fill(place: Place, part: PlaceReport, imperial: boolean, now = Date.now()) {
    if (place !== this.place || !this.shown) return;
    const report = (this.report = { ...this.report, ...part });
    // A searched place that turns out to be a city stays like a clicked one.
    if (report.facts) this.isCity = true;
    const w = report.weather;
    const where = report.facts?.where || place.detail || formatCoordinates(place.lat, place.lon);
    this.sub.textContent = w ? `${where} · ${localClock(now, w.utcOffsetS)} local (${w.tzAbbr && !/^GMT[+-]/.test(w.tzAbbr) ? w.tzAbbr : offsetLabel(w.utcOffsetS)})` : where;

    const rows: HTMLElement[] = [];
    if (report.facts?.lines.length) rows.push(el('p', 'facts', report.facts.lines.join(' · ')));
    if (w) {
      rows.push(nowBlock(w, imperial));
      const chips = weatherChips(w, imperial);
      if (chips.childElementCount) rows.push(chips);
      const times = sunTimes(w);
      const sun = sunLine(w);
      if (times) rows.push(times);
      else if (sun) {
        const p = el('p', 'sun');
        p.append(icon(Sunrise), document.createTextNode(sun));
        rows.push(p);
      }
    } else if (w === null) {
      rows.push(el('p', 'detail', 'Weather unavailable right now.'));
    } else {
      rows.push(el('p', 'loading', 'Checking the weather…'));
    }

    if (report.about) {
      const about = el('p', 'about');
      if (report.about.description) about.append(el('strong', '', `${report.about.description}. `));
      about.append(document.createTextNode(report.about.extract));
      // Outside the clamped paragraph, so it always shows (and credits the text, CC BY-SA).
      const more = el('a', 'wiki', 'More on Wikipedia');
      more.href = report.about.url;
      more.target = '_blank';
      more.rel = 'noopener';
      rows.push(about, more);
    }

    if (report.buoy) {
      const row = el('p', 'buoy');
      const open = el('button', '', 'Open');
      open.type = 'button';
      open.addEventListener('click', report.buoy.open);
      row.append(el('span', '', report.buoy.text), open);
      rows.push(row);
    }

    const alerts = sortAlerts(report.alerts ?? []);
    if (alerts.length) {
      const list = el('ul', 'alerts');
      list.setAttribute('aria-label', 'Alerts');
      for (const a of alerts) {
        const li = el('li', `alert ${a.level}`);
        const title = el('span', 'alert-title', a.title);
        if (a.impact) title.append(impactMeter(a.impact));
        li.append(title, el('span', 'alert-detail', a.detail));
        list.append(li);
      }
      rows.push(list);
    } else if (!report.alerts) {
      rows.push(el('p', 'loading', 'Checking for alerts…'));
    } else if (report.checked?.length) {
      rows.push(el('p', 'no-alerts', `No active alerts (${report.checked.join(', ')})`));
    }
    this.body.replaceChildren(...rows);
    this.holdMs = alerts.length ? SHOW_ALERTS_MS : SHOW_MS;
    this.arm();
  }

  hide() {
    clearTimeout(this.timer);
    this.toast.show(false);
    this.place = undefined;
    this.held = false;
    this.isCity = false;
  }

  private arm() {
    clearTimeout(this.timer);
    if (!this.held && !this.isCity && this.shown) this.timer = setTimeout(() => this.hide(), this.holdMs);
  }
}
