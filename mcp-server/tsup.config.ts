import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    stdio: 'src/stdio.ts',
    http: 'src/http.ts',
  },
  format: ['cjs'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  // Bundle everything except Prisma client (must be installed alongside the build)
  noExternal: [],
  external: ['@prisma/client'],
  sourcemap: true,
  splitting: false,
  // Keep shebang lines in entry files
  banner: {
    js: '',
  },
})
