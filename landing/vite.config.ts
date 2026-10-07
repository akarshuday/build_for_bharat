import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Build straight into the folder Express already serves at "/"
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: '../public/landing-dist', emptyOutDir: true },
});
