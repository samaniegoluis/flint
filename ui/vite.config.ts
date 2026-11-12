import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The page is served by the app from app://localhost/ (webui's serve_dir), so assets
// use relative URLs and stay in one folder that scripts/build-gui.sh copies into the
// app bundle.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    // Milestone 38: the extra monitors' windows load their own small page.
    rollupOptions: {
      input: { main: 'index.html', monitor: 'monitor.html' },
    },
    // macOS 12 (the app's minimum, Safari 15) and WebKitGTK run ES2022. Vite's
    // default target (Safari 14) lowers `||=`, and esbuild 0.25 lowers xterm.js's
    // `(r ||= {})` in requestMode into an assignment to an undeclared variable: every
    // DECRQM query (vim sends one at start) threw and froze the terminal for good.
    target: ['es2022', 'safari15'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
