// The feeds dashboard, in a toast window (toasts.ts): a row per data source on screen. Each
// shows how old its data is (a bar that fills and warms from green to red as the data
// ages past its usual age) and how long until the app checks again (a ring that drains
// to the next check). Rows slide in and out as layers are switched on and off, and
// flash when new data arrives; the window's status chip sums them up.
//
// It ticks once a second while open and the tab is visible, reading the rows afresh
// each time, so it never holds state of its own beyond what's on screen.

import {
  ageFraction,
  formatAgeShort,
  formatCountdown,
  formatStamp,
  freshness,
  shortCountdown,
  waitFraction,
  type FeedState,
} from './feeds';
import type { Toast } from './toasts';

export interface FeedRow {
  key: string;
  label: string;
  /** Short credit: "NOAA GMGSI". */
  source: string;
  state: FeedState;
  /** The usual age of the newest data, ms: older than this is late, twice this stale. */
  freshMs: number;
  /** Interval between checks, ms, for the ring; none for streams and on-demand fetches. */
  everyMs?: number;
  /** A stream: no polling, so the ring shows LIVE instead of a countdown. */
  live?: boolean;
  /** What to say in place of a countdown when there's no schedule ("while the Sun is in view"). */
  note?: string;
}

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;
const SVG = 'http://www.w3.org/2000/svg';

interface Card {
  el: HTMLLIElement;
  arc: SVGCircleElement;
  ringText: HTMLElement;
  fill: HTMLElement;
  bar: HTMLElement;
  ageText: HTMLElement;
  nextText: HTMLElement;
  changedAt?: number;
}

function span(className: string, text = ''): HTMLSpanElement {
  return Object.assign(document.createElement('span'), { className, textContent: text });
}

export class FeedBoard {
  private readonly list: HTMLUListElement;
  private readonly cards = new Map<string, Card>();
  private readonly empty: HTMLElement;
  private timer: ReturnType<typeof setInterval> | undefined;
  private shown = false;

  constructor(
    private readonly toast: Toast,
    private readonly rows: () => FeedRow[],
  ) {
    this.list = document.createElement('ul');
    this.list.className = 'feed-list';
    this.list.setAttribute('aria-label', 'Data sources');
    this.empty = span('feed-empty', 'No data layers on');
    toast.body.append(this.list, this.empty);
    document.addEventListener('visibilitychange', () => this.sync());
  }

  /** Show or hide the dashboard (from the `feeds` setting). */
  show(open: boolean) {
    if (open === this.shown) return;
    this.shown = open;
    this.toast.show(open);
    this.sync();
  }

  private sync() {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.shown || document.hidden) return;
    this.render();
    this.timer = setInterval(() => this.render(), 1000);
  }

  /** Redraw now, e.g. right after a check finishes, rather than on the next tick. */
  refresh() {
    if (this.shown && !document.hidden) this.render();
  }

  private render() {
    const now = Date.now();
    const rows = this.rows();
    const keys = new Set(rows.map((r) => r.key));
    for (const [key, card] of this.cards) {
      if (keys.has(key)) continue;
      this.cards.delete(key);
      this.leave(card.el);
    }
    let before: Element | null = this.list.firstElementChild;
    for (const row of rows) {
      let card = this.cards.get(row.key);
      const isNew = !card;
      if (!card) {
        card = this.card(row);
        this.cards.set(row.key, card);
      }
      // Keep the cards in the rows' order, skipping any still sliding out.
      while (before && before.classList.contains('out')) before = before.nextElementSibling;
      if (card.el !== before) this.list.insertBefore(card.el, before);
      else before = before.nextElementSibling;
      this.update(card, row, now, isNew);
    }
    this.empty.hidden = rows.length > 0;
    this.summarise(rows, now);
  }

  /** The header chip: failures first, then stale data, else all clear. */
  private summarise(rows: FeedRow[], now: number) {
    const failed = rows.filter((r) => r.state.error).length;
    const stale = rows.filter((r) => r.state.dataAt !== undefined && freshness(now - r.state.dataAt, r.freshMs) === 'stale').length;
    if (failed) this.toast.setStatus(`${failed} failed`, 'bad');
    else if (stale) this.toast.setStatus(`${stale} stale`, 'warn');
    else this.toast.setStatus(rows.length ? 'all current' : '', 'ok');
  }

  private card(row: FeedRow): Card {
    const el = document.createElement('li');
    el.className = 'feed in';
    el.dataset.key = row.key;
    el.addEventListener('animationend', () => el.classList.remove('in', 'pulse'));

    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('width', '36');
    svg.setAttribute('height', '36');
    const circle = (cls: string) => {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', '18');
      c.setAttribute('cy', '18');
      c.setAttribute('r', String(RING_R));
      svg.append(c);
      return c;
    };
    circle('track');
    const arc = circle('arc');
    arc.setAttribute('stroke-dasharray', RING_C.toFixed(2));
    const ringText = span('ring-text');
    ring.append(svg, ringText);

    const body = document.createElement('div');
    body.className = 'body';
    const head = document.createElement('div');
    head.className = 'head';
    head.append(span('name', row.label), span('src', row.source));
    const age = document.createElement('div');
    age.className = 'age';
    const bar = span('bar');
    const fill = span('fill');
    bar.append(fill, span('tick'));
    const ageText = span('age-text');
    age.append(bar, ageText);
    const nextText = span('next');
    body.append(head, age, nextText);

    el.append(ring, body);
    return { el, arc, ringText, fill, bar, ageText, nextText, changedAt: row.state.changedAt };
  }

  private update(card: Card, row: FeedRow, now: number, isNew: boolean) {
    const s = row.state;
    const { el } = card;

    // New data since the card last looked: flash it, the way a toast announces itself.
    if (!isNew && s.changedAt !== card.changedAt && s.changedAt !== undefined) {
      el.classList.remove('pulse');
      void el.offsetWidth; // restart the animation
      el.classList.add('pulse');
    }
    card.changedAt = s.changedAt;

    // How old the data is.
    const age = s.dataAt !== undefined ? now - s.dataAt : undefined;
    const fresh = age !== undefined ? freshness(age, row.freshMs) : undefined;
    el.dataset.fresh = fresh ?? 'none';
    card.fill.style.width = `${((age !== undefined ? ageFraction(age, row.freshMs) : 0) * 100).toFixed(1)}%`;
    card.bar.title = `Usually under ${formatAgeShort(row.freshMs)} old`;
    card.ageText.textContent =
      s.dataAt !== undefined && age !== undefined
        ? `${formatStamp(s.dataAt, now)} · ${formatAgeShort(age)} old`
        : s.checkedAt !== undefined
          ? s.error
            ? 'no data'
            : 'no data yet'
          : 'loading…';

    // When the next check is.
    el.classList.toggle('busy', s.busy);
    el.classList.toggle('error', !!s.error);
    el.classList.toggle('live', !!row.live);
    const sinceCheck = s.checkedAt !== undefined ? now - s.checkedAt : undefined;
    const checked = sinceCheck === undefined ? '' : sinceCheck < 5000 ? 'just checked' : `checked ${formatAgeShort(sinceCheck)} ago`;
    let ring = 1;
    let ringLabel = '';
    let next: string;
    if (row.live) {
      ringLabel = 'LIVE';
      next = s.dataAt !== undefined ? 'live stream' : 'connecting…';
    } else if (s.busy) {
      ringLabel = '';
      next = s.checkedAt === undefined ? 'checking…' : `${checked} · checking…`;
    } else if (s.nextAt !== undefined) {
      const left = s.nextAt - now;
      ring = row.everyMs ? 1 - waitFraction(s.nextAt, row.everyMs, now) : 0;
      ringLabel = left > 0 ? shortCountdown(left) : 'due';
      next = [s.error ? 'failed' : checked, left > 0 ? `next in ${formatCountdown(left)}` : 'next check due', row.note].filter(Boolean).join(' · ');
    } else {
      ring = 0;
      ringLabel = '—';
      next = [s.error ? 'failed' : checked, row.note].filter(Boolean).join(' · ') || 'not checked yet';
    }
    card.arc.setAttribute('stroke-dashoffset', (RING_C * (1 - ring)).toFixed(2));
    card.ringText.textContent = ringLabel;
    card.nextText.textContent = next;
    card.nextText.title = s.error ? `Last check failed: ${s.error}` : '';
  }

  private leave(el: HTMLElement) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return void el.remove();
    el.classList.remove('in', 'pulse');
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // in case the animation never runs (hidden tab)
  }
}
