// The place search: a HUD box near the top (opened with / or the dock's Find
// button) that takes a place name or coordinates. Results come in three
// kinds: typed coordinates, the app's own cities (instant), and the
// geocoder's places (after a short pause in typing). "My location" asks the
// browser for the viewer's position — only when picked.
//
// A combobox: arrow keys move through the results, Enter goes, Escape (or a
// click elsewhere) closes.

import { formatCoordinates, geocode, mergePlaces, parseCoordinates, searchCities, type Place } from './places';

const DEBOUNCE_MS = 250;
const MY_LOCATION = Symbol('my location');

type Option = Place | typeof MY_LOCATION;

export interface SearchHandlers {
  go(place: Place): void;
  /** For "My location" failing, a geocoder outage. */
  toast(message: string): void;
}

export class PlaceSearch {
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private readonly status: HTMLElement;
  private options: Option[] = [];
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: AbortController | undefined;
  private readonly cache = new Map<string, Place[]>();

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: SearchHandlers,
  ) {
    this.input = root.querySelector('input') as HTMLInputElement;
    this.list = root.querySelector('[role="listbox"]') as HTMLUListElement;
    this.status = root.querySelector('.search-status') as HTMLElement;
    this.input.addEventListener('input', () => this.changed());
    this.input.addEventListener('keydown', (e) => this.key(e));
    // Close on a click anywhere else.
    document.addEventListener('pointerdown', (e) => {
      if (!this.root.hidden && !this.root.contains(e.target as Node)) this.toggle(false);
    });
  }

  get open() {
    return !this.root.hidden;
  }

  toggle(open = !this.open) {
    this.root.hidden = !open;
    if (open) {
      this.input.select();
      this.input.focus();
      this.changed();
    } else {
      this.inflight?.abort();
      this.input.blur();
    }
  }

  private changed() {
    const text = this.input.value;
    clearTimeout(this.timer);
    this.inflight?.abort();
    const coords = parseCoordinates(text);
    const local = searchCities(text);
    const base: Option[] = [];
    if (coords) base.push({ name: formatCoordinates(coords.lat, coords.lon), detail: 'Coordinates', ...coords });
    base.push(...local);
    if ('geolocation' in navigator && !text.trim()) base.unshift(MY_LOCATION);
    this.render(base, '');
    const q = text.trim();
    if (coords || q.length < 2) return;
    const cached = this.cache.get(q.toLowerCase());
    if (cached) {
      this.render([...base.filter((o) => o === MY_LOCATION), ...mergePlaces(local, cached)], cached.length || local.length ? '' : 'No places found');
      return;
    }
    this.status.textContent = 'Searching…';
    this.timer = setTimeout(async () => {
      const ctl = new AbortController();
      this.inflight = ctl;
      try {
        const remote = await geocode(q, ctl.signal);
        this.cache.set(q.toLowerCase(), remote);
        if (this.input.value.trim() !== q) return;
        const merged = mergePlaces(local, remote);
        this.render(merged, merged.length ? '' : 'No places found');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        this.render(base, local.length ? '' : 'Place search unavailable');
      }
    }, DEBOUNCE_MS);
  }

  private render(options: Option[], status: string) {
    this.options = options;
    this.active = 0;
    this.status.textContent = status;
    this.list.replaceChildren(
      ...options.map((o, i) => {
        const li = document.createElement('li');
        li.id = `place-${i}`;
        li.setAttribute('role', 'option');
        const name = Object.assign(document.createElement('span'), { className: 'place-name' });
        const detail = Object.assign(document.createElement('span'), { className: 'place-detail' });
        if (o === MY_LOCATION) {
          name.textContent = 'My location';
          detail.textContent = 'Asks your browser';
        } else {
          name.textContent = o.name;
          detail.textContent = o.detail || formatCoordinates(o.lat, o.lon);
        }
        li.append(name, detail);
        li.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the box
        li.addEventListener('click', () => this.pick(i));
        li.addEventListener('pointermove', () => this.highlight(i));
        return li;
      }),
    );
    this.input.setAttribute('aria-expanded', String(options.length > 0));
    this.highlight(0);
  }

  private highlight(i: number) {
    if (!this.options.length) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.active = (i + this.options.length) % this.options.length;
    [...this.list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === this.active)));
    this.input.setAttribute('aria-activedescendant', `place-${this.active}`);
    this.list.children[this.active]?.scrollIntoView({ block: 'nearest' });
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.highlight(this.active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.options.length) this.pick(this.active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.toggle(false);
    }
  }

  private pick(i: number) {
    const o = this.options[i];
    if (!o) return;
    this.toggle(false);
    if (o !== MY_LOCATION) {
      this.handlers.go(o);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => this.handlers.go({ name: 'My location', detail: '', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => this.handlers.toast(`Location unavailable: ${err.message || 'permission denied'}`),
      { maximumAge: 10 * 60_000, timeout: 15_000 },
    );
  }
}
