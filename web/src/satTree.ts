// The satellite tree: a panel (bottom left, opened from the layer dock or Shift+O)
// listing every satellite category as a tree of tri-state checkboxes, with a
// colour swatch, a count, and — for categories small enough — a labels toggle.
//
// The DOM is built once and only its state refreshed afterwards, so keyboard
// focus survives a click. Collapsed branches are remembered per viewer.

import {
  isBranch,
  leaves,
  nodeState,
  SAT_TREE,
  type SatBranch,
  type SatLeaf,
  type SatNode,
} from './satcategories';
import type { Settings } from './params';

const COLLAPSED_KEY = 'xearth.satTree.collapsed';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(keys: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    // Storage blocked (private window, previews): the tree just forgets.
  }
}

export interface SatTreeHandlers {
  /** A checkbox was clicked: toggle that node's categories. */
  toggle(node: SatNode): void;
  /** A labels button was clicked. */
  toggleLabels(leaf: SatLeaf): void;
}

interface Row {
  node: SatNode;
  box: HTMLInputElement;
  count: HTMLElement;
  labels?: HTMLButtonElement;
}

export class SatTree {
  private readonly rows: Row[] = [];
  private readonly collapsed = loadCollapsed();

  /** The button that opens the panel (the drawer's), told when it opens and closes. */
  opener: HTMLElement | undefined;

  constructor(
    private readonly panel: HTMLElement,
    handlers: SatTreeHandlers,
  ) {
    const list = panel.querySelector('ul[role="tree"]') as HTMLUListElement;
    list.append(...SAT_TREE.children.map((n) => this.item(n, handlers, 1)));
    panel.querySelector('.close')?.addEventListener('click', () => this.toggle(false));
  }

  get open() {
    return !this.panel.hidden;
  }

  toggle(open = !this.open) {
    this.panel.hidden = !open;
    this.opener?.setAttribute('aria-expanded', String(open));
    if (open) (this.panel.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
  }

  private item(node: SatNode, h: SatTreeHandlers, level: number): HTMLLIElement {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', String(level));
    const row = document.createElement('div');
    row.className = 'row';

    const caret = document.createElement('button');
    caret.className = 'caret';
    caret.type = 'button';
    if (isBranch(node)) {
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
    if (!isBranch(node)) {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.setProperty('--c', node.color);
      label.append(swatch);
    }
    label.append(name);

    const count = document.createElement('span');
    count.className = 'count';

    row.append(caret, label, count);
    const r: Row = { node, box, count };
    if (!isBranch(node) && node.labelable) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'labels';
      btn.textContent = 'Aa';
      btn.title = `Name labels for ${node.label}`;
      btn.setAttribute('aria-label', `Name labels for ${node.label}`);
      btn.addEventListener('click', () => h.toggleLabels(node));
      row.append(btn);
      r.labels = btn;
    } else if (!isBranch(node)) {
      const spacer = document.createElement('span');
      spacer.className = 'labels-spacer';
      row.append(spacer);
    }
    li.append(row);
    this.rows.push(r);

    if (isBranch(node)) {
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      ul.append(...node.children.map((c) => this.item(c, h, level + 1)));
      li.append(ul);
      this.setCollapsed(li, node, this.collapsed.has(node.key), false);
    }
    return li;
  }

  private setCollapsed(li: HTMLLIElement, node: SatBranch, collapsed: boolean, save = true) {
    li.classList.toggle('collapsed', collapsed);
    li.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) this.collapsed.add(node.key);
    else this.collapsed.delete(node.key);
    if (save) saveCollapsed(this.collapsed);
  }

  /** Reflect the settings: ticks (with mixed branches), counts, labels toggles. */
  refresh(s: Settings, counts: Record<string, number>) {
    for (const r of this.rows) {
      const state = nodeState(r.node, s);
      r.box.checked = state === 'on';
      r.box.indeterminate = state === 'mixed';
      const n = leaves(r.node).reduce((sum, l) => sum + (counts[l.key] ?? 0), 0);
      r.count.textContent = n ? n.toLocaleString('en-US') : '';
      if (r.labels) {
        const on = s.satlabels.includes(r.node.key);
        r.labels.setAttribute('aria-pressed', String(on));
      }
    }
  }
}
