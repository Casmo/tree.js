// The sidebar, top to bottom. Later panels (parameters, effects, sculpt, glTF) are added here.
import { exportPanel } from './export-panel';
import { previewPanel } from './preview-panel';
import { startPanel } from './start-panel';
import { treePanel } from './tree-panel';
import type { Panel } from './types';

export type { Panel, PanelContext } from './types';

export const PANELS: Panel[] = [startPanel, previewPanel, treePanel, exportPanel];
