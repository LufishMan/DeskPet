import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // 不注入 modulepreload polyfill，維持嚴格 CSP（§14.3 R5）
    modulePreload: { polyfill: false },
  },
});
