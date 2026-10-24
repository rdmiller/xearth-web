// The hazards panel: bottom left like the satellite one, opened from the layer dock
// or Shift+X. Each hazard layer is a row with its icon, its sources nested under it
// (hazardSources.ts has the tree and what a click does).

import { Activity, CloudFog, CloudLightning, Flame, Tornado, TriangleAlert, Waves, Zap, type IconNode } from 'lucide';
import { CheckTree } from './checkTree';
import { hazardState, HAZARD_TREE, type HazardLayer, type HazardTreeNode } from './hazardSources';
import type { Settings } from './params';

const COLLAPSED_KEY = 'xearth.hazardTree.collapsed';

/** The layer dock's icons, which these rows replaced there. */
export const HAZARD_ICONS: Record<HazardLayer, IconNode> = {
  storms: Tornado,
  severe: CloudLightning,
  fires: Flame,
  quakes: Activity,
  lightning: Zap,
  events: TriangleAlert,
  ash: CloudFog,
  tsunami: Waves,
};

type Row = HazardTreeNode & { icon?: IconNode };

export class HazardTree extends CheckTree<Row> {
  constructor(panel: HTMLElement, toggle: (node: HazardTreeNode) => void) {
    super(
      panel,
      HAZARD_TREE.map((n) => ({ ...n, icon: HAZARD_ICONS[n.key] })),
      COLLAPSED_KEY,
      { toggle },
    );
  }

  /** Reflect the settings; `counts` by layer or source key, where there's something to count. */
  refresh(s: Settings, counts: Record<string, number> = {}) {
    this.paint({ state: (n) => hazardState(n, s), count: (n) => counts[n.key] ?? 0 });
  }
}
