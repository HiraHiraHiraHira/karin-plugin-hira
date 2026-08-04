import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/apps/*.ts', 'src/web.config.ts'],
  dts: true,
  clean: true,
  format: ['esm'],
  hash: false,
  target: 'node18',
  outDir: 'lib',
  external: ['node-karin'],
  // tsdown 0.12.9 still emits these Rolldown transform options at the input root.
  // Normalize them before Rolldown 1.1 validates the input schema.
  inputOptions: (options) => {
    const legacyOptions = options as typeof options & {
      define?: Record<string, string>
      inject?: Record<string, string | [string, string]>
    }
    const define = legacyOptions.define
    const inject = legacyOptions.inject

    delete legacyOptions.define
    delete legacyOptions.inject
    legacyOptions.transform = {
      ...legacyOptions.transform,
      define,
      inject
    }

    return legacyOptions
  }
})
