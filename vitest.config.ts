import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `dist` and `.claude/worktrees` hold copies of this source. Running their
    // tests reports failures against code nobody is editing, which buries the
    // ones that matter.
    // packages/avatar-camera has its own dependencies, which the runner does
    // not install, so its tests run from there (npm test in that folder).
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', 'packages/avatar-camera/**'],
  },
});
