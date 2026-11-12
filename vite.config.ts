/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: true },
  test: { environment: 'jsdom', include: ['src/**/*.test.tsx'] },
});
