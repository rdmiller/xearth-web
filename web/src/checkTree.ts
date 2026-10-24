// A panel of tri-state checkboxes in a tree: the satellite categories (satTree.ts) and
// the hazards (hazardTree.ts). Each row has a caret for branches, a checkbox, a colour
// swatch or an icon, a name, a count and — where offered — a labels toggle.
//
// The DOM is built once and only its state refreshed afterwards, so keyboard focus
// survives a click. Collapsed branches are remembered per viewer.

import { createElement, type IconNode } from 'lucide';

export type TriState = 'on' | 'off' | 'mixed';

export interface CheckNode {
  key: string;
  label: string;
  /** Present (even empty) on a branch… */
  children?: readonly CheckNode[];
  /** …and on a leaf, a swatch… */
  color?: string;
  /** …or an icon. */
  icon?: IconNode;
  /** Few enough to label (the tree offers a labels toggle). */
  labelable?: boolean;
}

export interface CheckTreeHandlers<N extends CheckNode> {
  /** A checkbox was clicked. */
  toggle(node: N): void;
  /** A labels button was clicked; without this, the tree has no labels column. */
  toggleLabels?(leaf: N): void;
}

export interface CheckTreeState<N extends CheckNode> {
  state(node: N): TriState;
  /** Shown beside the name when non-zero. */
  count?(node: N): number;
  labels?(leaf: N): boolean;
}

function loadCollapsed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(key: string, keys: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...keys]));
  } catch {
    // Storage blocked (private window, previews): the tree just forgets.
  }
}

interface Row<N> {
  node: N;
  box: HTMLInputElement;
  count: HTMLElement;
  labels?: HTMLButtonElement;
}

const hasChildren = (n: CheckNode) => !!n.children?.length;

export class CheckTree<N extends CheckNode> {
  private readonly rows: Row<N>[] = [];
  private readonly collapsed: Set<string>;

  /** The button that opens the panel (the dock's), told when it opens and closes. */
  opener: HTMLElement | undefined;
  /** Told when the panel opens, so another one sharing its corner can close. */
  onOpen: (() => void) | undefined;

  constructor(
    private readonly panel: HTMLElement,
    roots: readonly N[],
    private readonly collapsedKey: string,
    handlers: CheckTreeHandlers<N>,
  ) {
    this.collapsed = loadCollapsed(collapsedKey);
    const list = panel.querySelector('ul[role="tree"]') as HTMLUListElement;
    list.append(...roots.map((n) => this.item(n, handlers, 1)));
    panel.querySelector('.close')?.addEventListener('click', () => this.toggle(false));
  }

  get open() {
    return !this.panel.hidden;
  }

  toggle(open = !this.open) {
    this.panel.hidden = !open;
    this.opener?.setAttribute('aria-expanded', String(open));
    if (open) {
      this.onOpen?.();
      (this.panel.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
    }
  }

  private item(node: N, h: CheckTreeHandlers<N>, level: number): HTMLLIElement {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', String(level));
    const row = document.createElement('div');
    row.className = 'row';
    const branch = hasChildren(node);

    const caret = document.createElement('button');
    caret.className = 'caret';
    caret.type = 'button';
    if (branch) {
      caret.setAttribute('aria-label', `Expand or collapse ${node.label}`);
      caret.addEventListener('click', () => this.setCollapsed(li, node, !li.classList.contains('collapsed')));
    } else {
      caret.disabled = true;
      caret.tabIndex = -1;
    }

    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => h.toggle(node));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = node.label;
    label.append(box);
    if (node.icon) {
      const svg = createElement(node.icon);
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('icon');
      label.append(svg);
    } else if (node.color) {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.setProperty('--c', node.color);
      label.append(swatch);
    }
    label.append(name);

    const count = document.createElement('span');
    count.className = 'count';

    row.append(caret, label, count);
    const r: Row<N> = { node, box, count };
    if (h.toggleLabels && !branch) {
      if (node.labelable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'labels';
        btn.textContent = 'Aa';
        btn.title = `Name labels for ${node.label}`;
        btn.setAttribute('aria-label', `Name labels for ${node.label}`);
        btn.addEventListener('click', () => h.toggleLabels!(node));
        row.append(btn);
        r.labels = btn;
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'labels-spacer';
        row.append(spacer);
      }
    }
    li.append(row);
    this.rows.push(r);

    if (branch) {
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      ul.append(...(node.children as N[]).map((c) => this.item(c, h, level + 1)));
      li.append(ul);
      this.setCollapsed(li, node, this.collapsed.has(node.key), false);
    }
    return li;
  }

  private setCollapsed(li: HTMLLIElement, node: N, collapsed: boolean, save = true) {
    li.classList.toggle('collapsed', collapsed);
    li.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) this.collapsed.add(node.key);
    else this.collapsed.delete(node.key);
    if (save) saveCollapsed(this.collapsedKey, this.collapsed);
  }

  /** Reflect the state: ticks (with mixed branches), counts, labels toggles. */
  paint(st: CheckTreeState<N>) {
    for (const r of this.rows) {
      const state = st.state(r.node);
      r.box.checked = state === 'on';
      r.box.indeterminate = state === 'mixed';
      const n = st.count?.(r.node) ?? 0;
      r.count.textContent = n ? n.toLocaleString('en-US') : '';
      r.labels?.setAttribute('aria-pressed', String(!!st.labels?.(r.node)));
    }
  }
}
