import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const configRoot = dirname(fileURLToPath(import.meta.url))

/**
 * Dev-only test config. Resolution: every package name (workspace @deepseek-ai/*
 * AND this bundle's own @cryptocurpays/*) maps to SOURCE through a raw alias
 * map built from tsconfig.base.json. A plain resolve.alias applies to every
 * importing file regardless of the vite root, so workspace source files pulled
 * into the graph never fall back to per-package node_modules built-lib links.
 *
 * Run from THIS directory with the dsh workspace's vitest binary:
 *   /path/to/deepseek-harness/node_modules/.bin/vitest run
 * The node_modules symlink here points at the dsh workspace for runtime deps.
 */
const tsconfig = JSON.parse(readFileSync(new URL('./tsconfig.base.json', import.meta.url), 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> }
}

const alias: Record<string, string> = {}
for (const [key, targets] of Object.entries(tsconfig.compilerOptions.paths)) {
  const target = targets[0]
  if (target !== undefined) alias[key] = resolve(configRoot, target)
}

/**
 * Workspace sources use standard TypeScript decorators; pre-transpile them
 * before the vite/oxc parser sees the file. Byte-for-byte mirror of the dsh
 * workspace's standardDecoratorPlugin in vitest.shared.ts.
 */
const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m
const decoratorPlugin = {
  name: 'dsh-standard-decorators',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    const file = id.split('?', 1)[0] ?? ''
    if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
    const result = ts.transpileModule(code, {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.ESNext,
        jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
        sourceMap: true,
      },
    })
    return {
      code: result.outputText
        .replace(
          /^(\s*)(__esDecorate\()/gmu,
          '$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2',
        )
        .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
      map: result.sourceMapText,
    }
  },
}

export default defineConfig({
  root: configRoot,
  resolve: { alias },
  plugins: [decoratorPlugin],
  // The config lives outside the dsh workspace; point the vite temp cache at a
  // writable location inside it instead of the default walk-up node_modules.
  cacheDir: resolve(configRoot, 'node_modules/.vite-remote-bundle'),
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.spec.ts'],
  },
})
