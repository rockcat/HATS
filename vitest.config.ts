import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `dist` and `.claude/worktrees` hold copies of this source. Running their
    // tests reports failures against code nobody is editing, which buries the
    // ones that matter.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
