# The library ships an opt-in Scene Pipeline that never changes the renderer

PR #51's concepts said whole-scene post-processing belongs to the app, but trees only look their best with tone mapping, anti-aliasing, ambient occlusion, bloom, fog and god rays around them, so the library now ships a suggested set of Scene Effects per Style (`SUGGESTED_SCENE_EFFECTS`) and an opt-in `createScenePipeline(renderer, scene, camera, { style })` in a separate `@casmo/tree.js/scene` entry point. It is a superset of `TreeEffects` (used instead of it) and is never applied by default. It never changes the renderer: tone mapping and the output colour space are applied inside the pipeline, not through `renderer.toneMapping`, and shadows are never switched on (god rays need a shadow-casting `sun` from the app and are skipped with a warning without one). The one scene change is fog, which three only supports through `scene.fogNode`; the pipeline remembers the app's value and restores it on `dispose()` or when fog is switched off. Every part is also exported on its own for apps with their own pipeline.

## Considered Options

- **Leave it to the app (PR #51's position)**: rejected. Every app would rebuild the same stack to make trees look as intended.
- **Put it in `@casmo/tree.js/effects`**: rejected. Apps that use only Tree Effects, including CDN users, would load the bloom, GTAO, AA, god rays and motion blur addon modules too.
- **Set `renderer.toneMapping` and enable shadows for the app**: rejected. tree.js runs inside games that own their renderer setup; changing it would be a surprise that lasts after `dispose()`.
- **Return the fog node only and never touch the scene**: rejected for the ready-made pipeline, where one call should give the whole look; the stand-alone `sceneFog()` does return a node for apps that assign it themselves.
