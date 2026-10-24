// The satellite tree: a panel (bottom left, opened from the layer dock or Shift+O)
// listing every satellite category as a tree of tri-state checkboxes, with a
// colour swatch, a count, and — for categories small enough — a labels toggle.
// The panel itself is checkTree.ts.

import { CheckTree } from './checkTree';
import { leaves, nodeState, SAT_TREE, type SatLeaf, type SatNode } from './satcategories';
import type { Settings } from './params';

const COLLAPSED_KEY = 'xearth.satTree.collapsed';

export interface SatTreeHandlers {
  /** A checkbox was clicked: toggle that node's categories. */
  toggle(node: SatNode): void;
  /** A labels button was clicked. */
  toggleLabels(leaf: SatLeaf): void;
}

export class SatTree extends CheckTree<SatNode> {
  constructor(panel: HTMLElement, handlers: SatTreeHandlers) {
    super(panel, SAT_TREE.children, COLLAPSED_KEY, { toggle: handlers.toggle, toggleLabels: (n) => handlers.toggleLabels(n as SatLeaf) });
  }

  /** Reflect the settings: ticks (with mixed branches), counts, labels toggles. */
  refresh(s: Settings, counts: Record<string, number>) {
    this.paint({
      state: (n) => nodeState(n, s),
      count: (n) => leaves(n).reduce((sum, l) => sum + (counts[l.key] ?? 0), 0),
      labels: (n) => s.satlabels.includes(n.key),
    });
  }
}
