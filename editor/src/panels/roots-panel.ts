// Roots (ADR 0007): add or remove the Definition's `roots` block and tune it. Their polygon detail
// is left to the Style.
import { DEFAULT_ROOTS } from '@casmo/tree.js';
import { blockPanel } from './block-panel';
import { ROOTS_FIELDS } from './fields';

export const rootsPanel = blockPanel({ key: 'roots', title: 'Roots', fields: ROOTS_FIELDS, defaults: DEFAULT_ROOTS, hint: 'No Roots: the Stems stand in the ground without them.' });
