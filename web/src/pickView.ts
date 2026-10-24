// The window for something clicked on the globe, in the ISS and buoy windows' style:
//
//   header   its name; a chip with how old it is or what state it's in
//   meta     what kind of thing it is, in its colour, and where it is
//   tiles    its numbers (altitude and speed, magnitude and depth, wind and pressure…)
//   notes    a line or two of text: a pad, an area, a time
//   slot     another view's content, when it has more to say (the ISS's live telemetry)
//   foot     Follow / Stop following for things that move, and a link to the source
//
// The DOM is built once; an update only touches what changed, so a followed satellite's
// numbers can tick over every second.

import { el, label, put } from './issView';
import { safeHref, type PickDetail } from './picks';
import type { Toast } from './toasts';

const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;

export class PickPanelView {
  private readonly kind: HTMLElement;
  private readonly where: HTMLElement;
  private readonly tiles: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly follow: HTMLButtonElement;
  private readonly link: HTMLAnchorElement;
  /** Above the foot, for another view to put its content in (issView.ts docks there). */
  readonly slot: HTMLElement;
  private tileKeys = '';

  constructor(
    private readonly toast: Toast,
    /** Follow (true) or stop following (false). */
    onFollow: (follow: boolean) => void,
  ) {
    const content = el('div', 'iss-content pick-content');
    const meta = el('div', 'iss-meta');
    this.kind = el('span', 'iss-chip');
    this.where = el('span', 'iss-time');
    meta.append(this.kind, this.where);
    this.tiles = el('div', 'iss-tiles');
    this.notes = el('div', 'pick-notes');
    this.slot = el('div', 'pick-slot');
    const foot = el('div', 'pick-foot');
    this.follow = el('button', 'pick-follow');
    this.follow.type = 'button';
    this.follow.addEventListener('click', () => onFollow(this.follow.getAttribute('aria-pressed') !== 'true'));
    this.link = el('a', 'pick-link');
    this.link.target = '_blank';
    this.link.rel = 'noopener';
    foot.append(this.follow, this.link);
    content.append(meta, this.tiles, this.notes, this.slot, foot);
    toast.body.append(content);
  }

  /** Show a pick's details (or close with undefined); `following`: the view is following it. */
  update(d: PickDetail | undefined, following: boolean) {
    this.toast.show(!!d);
    if (!d) return;
    this.toast.setTitle(d.title);
    this.toast.setStatus(d.status?.text ?? '', d.status?.tone);
    this.toast.el.style.setProperty('--pick', d.color);
    put(this.kind, d.kind);
    put(this.where, d.lat !== undefined && d.lon !== undefined ? `${fmtLat(d.lat)} ${fmtLon(d.lon)}` : '');

    // Rebuild the tiles only when the set of them changes; otherwise just their values.
    const keys = d.tiles.map((t) => t.label).join('|');
    if (keys !== this.tileKeys) {
      this.tileKeys = keys;
      this.tiles.replaceChildren(
        ...d.tiles.map((t) => {
          const tile = el('div', 'iss-tile');
          tile.append(label(t.label), el('div', 'iss-value'));
          return tile;
        }),
      );
    }
    d.tiles.forEach((t, i) => {
      const value = this.tiles.children[i].lastElementChild as HTMLElement;
      put(value, t.value);
      value.title = t.value;
    });
    this.tiles.hidden = !d.tiles.length;

    const notes = d.notes.filter(Boolean);
    if (notes.join('\n') !== [...this.notes.children].map((n) => n.textContent).join('\n')) {
      this.notes.replaceChildren(...notes.map((n) => el('p', '', n)));
    }

    this.follow.hidden = !d.followable;
    this.follow.setAttribute('aria-pressed', String(following));
    put(this.follow, following ? 'Stop following' : 'Follow');
    // Every pick's link passes the same https check here, whichever feed built it.
    const href = safeHref(d.link?.href);
    this.link.hidden = !href;
    if (d.link && href) {
      if (this.link.getAttribute('href') !== href) this.link.href = href;
      put(this.link, `${d.link.text} ↗`);
    }
  }
}
