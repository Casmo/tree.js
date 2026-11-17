# TSL-first materials; WebGPURenderer is the only supported renderer

All tree materials are three.js TSL node materials, and Growth and Season are driven on the GPU through uniforms and per-vertex attributes, so the library requires `WebGPURenderer` (from `three/webgpu`), which runs on WebGPU and falls back to WebGL2 by itself. "Works in any renderer" therefore means "any backend of WebGPURenderer"; the classic `WebGLRenderer` is deliberately not supported.

## Considered Options

- Built-in materials with CPU-side Growth/Season: works in both renderers, but animating Growth per frame on the CPU is slow and limits stylised effects.
- Dual shader paths (`onBeforeCompile` for WebGLRenderer plus TSL): most compatible, but every effect is written and maintained twice.
