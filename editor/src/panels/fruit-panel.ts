// Fruit (ADR 0006): add or remove the Definition's `fruit` block and tune it. Its Season (amount
// and colour tracks) is in the Season Profile panel, shown while the tree has Fruit.
import { DEFAULT_FRUIT } from '@casmo/tree.js';
import { blockPanel } from './block-panel';
import { FRUIT_FIELDS } from './fields';

export const fruitPanel = blockPanel({ key: 'fruit', title: 'Fruit', fields: FRUIT_FIELDS, defaults: DEFAULT_FRUIT, hint: 'No Fruit: the tree bears none.' });
