// Toast windows: the panels down the right edge — frame rate, ISS telemetry, data feeds, a
// searched place. One manager gives them all the same shell (width, glass, a header with the
// title, a status chip and ×, and a body) and stacks them in a fixed order in one column
// between the top of the window and the dock, so they never overlap or drift apart in style.
//
// Space: the column is as tall as the window allows. When the windows don't fit, the ones that
// may shrink give up height first and their bodies scroll; small fixed panels (frame rate,
// ISS) keep theirs, and a searched place keeps up to half the column, since it's what was
// just asked for. Long titles and status chips end in an ellipsis rather than wrap, and a
// click on a title folds that window down to its header.

export type ToastTone = 'ok' | 'warn' | 'bad' | 'info';

export interface ToastSpec {
  /** Element id, which the window's own styles hang off ("feeds", "place-card"). */
  id: string;
  title: string;
  /** Stacking order, top to bottom. */
  order: number;
  /** Title and rule colour (CSS); the HUD cyan unless given. */
  accent?: string;
  /** How readily it gives up height when the column is full; 0 keeps its natural height. */
  shrink?: number;
  /** The most of the column's height it may take (0–1); past that its body scrolls. */
  maxShare?: number;
  /** Shows ×; called when it's pressed (the owner decides what closing means). */
  onClose?: () => void;
}

/** Where a window of this order goes among those already placed (orders ascending). */
export function slotFor(orders: readonly number[], order: number): number {
  const i = orders.findIndex((o) => o > order);
  return i < 0 ? orders.length : i;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

export class Toast {
  readonly el: HTMLElement;
  /** The window's content: everything below the header is the owner's. */
  readonly body: HTMLElement;
  private readonly titleButton: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private wanted = false;

  constructor(
    readonly spec: ToastSpec,
    private readonly manager: ToastManager,
  ) {
    this.el = el('section', 'toast-window');
    this.el.id = spec.id;
    this.el.hidden = true;
    this.el.style.setProperty('--shrink', String(spec.shrink ?? 1));
    if (spec.accent) this.el.style.setProperty('--accent', spec.accent);
    if (spec.maxShare !== undefined) this.el.style.maxHeight = `${spec.maxShare * 100}%`;

    const header = el('header', 'toast-head');
    this.titleButton = el('button', 'toast-title', spec.title);
    this.titleButton.type = 'button';
    this.titleButton.setAttribute('aria-expanded', 'true');
    this.titleButton.title = 'Fold or unfold';
    this.titleButton.addEventListener('click', () => this.fold());
    this.statusEl = el('span', 'toast-status');
    header.append(this.titleButton, this.statusEl);
    if (spec.onClose) {
      const close = el('button', 'toast-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', `Close ${spec.title}`);
      close.addEventListener('click', () => spec.onClose?.());
      header.append(close);
    }
    this.body = el('div', 'toast-body');
    this.el.setAttribute('aria-label', spec.title);
    this.el.append(header, this.body);
    this.el.addEventListener('animationend', (e) => {
      if (e.target !== this.el) return;
      this.el.classList.remove('in');
      if (this.el.classList.contains('out')) {
        this.el.classList.remove('out');
        if (!this.wanted) this.el.hidden = true;
      }
    });
  }

  get shown() {
    return this.wanted;
  }

  setTitle(title: string) {
    if (this.titleButton.textContent === title) return;
    this.titleButton.textContent = title;
    this.el.setAttribute('aria-label', title);
  }

  /** The chip at the right of the header ("● AOS", "2 STALE"); empty hides it. */
  setStatus(text: string, tone: ToastTone = 'info') {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
    if (this.statusEl.dataset.tone !== tone) this.statusEl.dataset.tone = tone;
  }

  show(open: boolean) {
    if (open === this.wanted) return;
    this.wanted = open;
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden;
    this.el.classList.remove('in', 'out');
    if (open) {
      this.el.hidden = false;
      if (animate) this.el.classList.add('in');
    } else if (animate) {
      this.el.classList.add('out');
      // In case the animation never runs (e.g. the window was already off screen).
      setTimeout(() => {
        if (!this.wanted) this.el.hidden = true;
      }, 300);
    } else {
      this.el.hidden = true;
    }
    this.manager.changed();
  }

  /** Fold down to the header, or open back up. */
  fold(folded = !this.el.classList.contains('folded')) {
    this.el.classList.toggle('folded', folded);
    this.titleButton.setAttribute('aria-expanded', String(!folded));
    this.manager.changed();
  }
}

export class ToastManager {
  private readonly toasts: Toast[] = [];
  /** Called when windows open, close or fold (labels on the globe make room). */
  onChange: () => void = () => {};

  constructor(private readonly root: HTMLElement) {}

  add(spec: ToastSpec): Toast {
    const toast = new Toast(spec, this);
    const i = slotFor(
      this.toasts.map((t) => t.spec.order),
      spec.order,
    );
    this.root.insertBefore(toast.el, this.toasts[i]?.el ?? null);
    this.toasts.splice(i, 0, toast);
    return toast;
  }

  changed() {
    this.onChange();
  }

  /** Screen boxes of the windows showing, for labels on the globe to keep clear of. */
  rects(): { x: number; y: number; w: number; h: number }[] {
    return this.toasts.flatMap((t) => {
      if (t.el.hidden) return [];
      const r = t.el.getBoundingClientRect();
      return r.height ? [{ x: r.left, y: r.top, w: r.width, h: r.height }] : [];
    });
  }
}
