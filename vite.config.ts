/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // Solver tests run real searches; shared CI machines can be slow.
  // Only the repo's own tests (not copies under .claude/worktrees), with or without --dir test.
  test: { dir: 'test', include: ['**/*.test.ts'], testTimeout: 30000 },
});
