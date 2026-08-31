import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/ui/ui.ts', 'src/types/**'],
      thresholds: { statements: 80, lines: 80, functions: 75, branches: 70 }
    }
  }
});
