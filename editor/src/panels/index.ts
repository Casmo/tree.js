// The sidebar, top to bottom. Later panels (effects, sculpt, glTF) are added here.
import { branchesPanel } from './branches-panel';
import { effectsPanel } from './effects-panel';
import { exportPanel } from './export-panel';
import { fruitPanel } from './fruit-panel';
import { leavesPanel, materialsPanel, treePanel, trunkPanel, variationPanel } from './parameter-panels';
import { previewPanel } from './preview-panel';
import { sculptPanel } from './sculpt-panel';
import { seasonPanel } from './season-panel';
import { startPanel } from './start-panel';
import type { Panel } from './types';
import { windPanel } from './wind-panel';

export type { Panel, PanelContext } from './types';

export const PANELS: Panel[] = [
  startPanel,
  previewPanel,
  sculptPanel,
  effectsPanel,
  treePanel,
  trunkPanel,
  branchesPanel,
  leavesPanel,
  fruitPanel,
  materialsPanel,
  seasonPanel,
  windPanel,
  variationPanel,
  exportPanel,
];
