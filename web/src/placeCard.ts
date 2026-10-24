// The card shown after going to a place from the search: its local time, weather, sunrise
// and sunset, and any alerts there. A toast window (toasts.ts) that stays a while — it
// closes itself after a read (held open while the pointer or focus is on it), with ×, or
// with Escape.

import { createElement, Sunrise, type IconNode } from 'lucide';
import type { CityAbout } from './cities';
import { IMPACT_COLOR, IMPACT_WORD } from './hazards';
import { formatCoordinates, type Place } from './places';
import { conditionsLine, detailLine, localClock, offsetLabel, sortAlerts, sunLine, type LocalAlert, type LocalWeather } from './locale';
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

export class PlaceCard {
  private place: Place | undefined;
  private report: PlaceReport = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private holdMs = SHOW_MS;
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

  /** Open for a place while its report loads. */
  show(place: Place, labelled: boolean) {
    this.place = place;
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
    const w = report.weather;
    const where = report.facts?.where || place.detail || formatCoordinates(place.lat, place.lon);
    this.sub.textContent = w ? `${where} · ${localClock(now, w.utcOffsetS)} local (${w.tzAbbr && !/^GMT[+-]/.test(w.tzAbbr) ? w.tzAbbr : offsetLabel(w.utcOffsetS)})` : where;

    const rows: HTMLElement[] = [];
    if (report.facts?.lines.length) rows.push(el('p', 'facts', report.facts.lines.join(' · ')));
    if (w) {
      rows.push(el('p', 'conditions', conditionsLine(w, imperial)));
      const detail = detailLine(w, imperial);
      if (detail) rows.push(el('p', 'detail', detail));
      const sun = sunLine(w);
      if (sun) {
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
  }

  private arm() {
    clearTimeout(this.timer);
    if (!this.held && this.shown) this.timer = setTimeout(() => this.hide(), this.holdMs);
  }
}
