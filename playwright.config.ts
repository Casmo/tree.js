import { defineConfig, devices } from '@playwright/test';

// A dedicated port (not Vite's default 5173) so tests never hit some other dev server.
const PORT = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  expect: {
    // Software rendering differs slightly between machines; compare loosely.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, threshold: 0.2 },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 640, height: 480 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 640, height: 480 },
        launchOptions: {
          // Headless WebGPU via SwiftShader (CPU) so it also runs on CI machines without a GPU.
          args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/examples/vanilla/`,
    reuseExistingServer: false,
  },
});
