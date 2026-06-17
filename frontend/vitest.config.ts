import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/test/**',
        'src/**/*.d.ts',
        'src/types/**',
        'src/routeTree.gen.ts',
        'src/main.tsx',
      ],
      // include counts ALL src files (not just test-imported ones) so untested
      // components show up in the denominator — honest, not flattering. The
      // route-component + Send-form journey tests (#6/#11) lifted this from
      // ~39% to ~52%; floor sits just below current to catch regressions.
      thresholds: {
        statements: 50,
        branches: 52,
        functions: 47,
        lines: 50,
      },
    },
  },
})
