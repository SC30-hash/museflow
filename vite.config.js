import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// MuseFlow — single-page SPA build (all views in one index.html)
export default defineConfig({
  plugins: [tailwindcss()],
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: new URL('./index.html', import.meta.url).pathname,
    },
  },
});
