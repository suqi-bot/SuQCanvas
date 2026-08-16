import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcBase = resolve(root, 'node_modules/pdfjs-dist')
const destBase = resolve(root, 'public/pdfjs')

for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  const src = resolve(srcBase, dir)
  const dest = resolve(destBase, dir)
  if (!existsSync(src)) {
    console.warn(`[pdfjs-assets] missing: ${src}`)
    continue
  }
  mkdirSync(destBase, { recursive: true })
  cpSync(src, dest, { recursive: true })
}

console.log('[pdfjs-assets] copied cmaps/standard_fonts/wasm -> public/pdfjs')