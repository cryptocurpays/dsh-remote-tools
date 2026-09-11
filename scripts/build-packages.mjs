#!/usr/bin/env node
/**
 * Transpile plugin sources to `lib/index.js` without typechecking or harness
 * project references. Every `@deepseek-ai/*` and npm import stays external so
 * the running dsh installation satisfies peers at load time.
 */
import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** @type {readonly string[]} */
const packages = [
  'remote-hosts',
  'remote-hosts-jumpserver',
  'remote-hosts-file',
  'terminal-ssh',
  'tool-remote',
]

for (const pkg of packages) {
  const entry = join(root, 'packages', pkg, 'src', 'index.ts')
  const outfile = join(root, 'packages', pkg, 'lib', 'index.js')
  mkdirSync(dirname(outfile), { recursive: true })
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    bundle: true,
    packages: 'external',
    external: ['yaml'],
    sourcemap: true,
    logLevel: 'info',
  })
}
