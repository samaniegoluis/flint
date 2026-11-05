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
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
