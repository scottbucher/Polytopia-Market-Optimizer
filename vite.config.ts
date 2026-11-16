/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // Solver tests run real searches; shared CI machines can be slow.
  test: { testTimeout: 30000 },
});
