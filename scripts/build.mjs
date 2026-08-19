/**
 * 打包脚本：支持选择构建 在线版 / 局域网版 / 全部。
 * 用法：
 *   node scripts/build.mjs          交互选择（非 TTY 环境默认构建全部）
 *   node scripts/build.mjs online   仅在线版   -> dist/
 *   node scripts/build.mjs lan      仅局域网版 -> dist-lan/
 *   node scripts/build.mjs all      两者都构建
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const TARGETS = {
  online: { label: '在线版（云端同步）', mode: 'online', outDir: 'dist' },
  lan: { label: '局域网版（局域网协作）', mode: 'lan', outDir: 'dist-lan' },
}

function run(scriptPath, args = []) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function copyPdfjsAssets() {
  run(resolve(root, 'scripts/copy-pdfjs-assets.mjs'))
}

function loadEnvValue(name) {
  for (const file of ['.env', `.env.local`, '.env.online', '.env.online.local']) {
    const p = resolve(root, file)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return process.env[name] ?? ''
}

function warnOnlineMissingEnv() {
  const url = loadEnvValue('VITE_SUPABASE_URL')
  const key = loadEnvValue('VITE_SUPABASE_ANON_KEY')
  if (!url || !key) {
    console.warn(
      '\n⚠ 未检测到 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，' +
        '在线版将无法登录和云同步（可写入 .env.online.local）。\n',
    )
  }
}

function build(target) {
  const { label, mode, outDir } = TARGETS[target]
  console.log(`\n▶ 构建${label} -> ${outDir}/\n`)
  const viteBin = resolve(root, 'node_modules/vite/bin/vite.js')
  const r = spawnSync(
    process.execPath,
    [viteBin, 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir'],
    { cwd: root, stdio: 'inherit' },
  )
  if (r.status !== 0) process.exit(r.status ?? 1)
}

async function askTarget() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolveAns) => {
    rl.question(
      '请选择打包版本：\n' +
        '  1) 在线版\n' +
        '  2) 局域网版\n' +
        '  3) 全部\n' +
        '输入序号后回车（默认 3）：',
      (a) => resolveAns(a.trim()),
    )
  })
  rl.close()
  if (answer === '1') return ['online']
  if (answer === '2') return ['lan']
  return ['online', 'lan']
}

const arg = process.argv[2]
const map = { online: ['online'], lan: ['lan'], all: ['online', 'lan'] }
const targets = map[arg] ?? (process.stdin.isTTY ? await askTarget() : ['online', 'lan'])

copyPdfjsAssets()
if (targets.includes('online')) warnOnlineMissingEnv()
for (const t of targets) build(t)

console.log('\n✔ 打包完成')
for (const t of targets) console.log(`  ${TARGETS[t].label}: ${TARGETS[t].outDir}/`)
