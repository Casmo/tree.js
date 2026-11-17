# Trees are generated procedurally, not shipped as assets

Every tree is computed at runtime from a Tree Definition plus a Seed; a Style is a preset Tree Definition with its material settings, not a model file. We chose this over shipping pre-authored glTF trees (or a hybrid of generated branches and authored foliage) because seed variations, Growth and Seasons fall out of a computed tree for free, the Tree Editor only has to edit parameters, and the package stays small.
