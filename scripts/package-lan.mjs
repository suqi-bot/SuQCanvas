import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = join(root, 'release')
const packageRoot = join(releaseRoot, 'SuQCanvas-LAN')
const zipPath = join(releaseRoot, 'SuQCanvas-LAN.zip')

await rm(packageRoot, { recursive: true, force: true })
await rm(zipPath, { force: true })
await mkdir(join(packageRoot, 'server', 'data', 'assets'), { recursive: true })
await mkdir(join(packageRoot, 'scripts'), { recursive: true })
await mkdir(join(packageRoot, 'node_modules'), { recursive: true })
await mkdir(join(packageRoot, 'runtime'), { recursive: true })

await Promise.all([
  cp(join(root, 'dist-lan'), join(packageRoot, 'dist-lan'), { recursive: true }),
  cp(join(root, 'server', 'lan-server.mjs'), join(packageRoot, 'server', 'lan-server.mjs')),
  cp(join(root, 'node_modules', 'ws'), join(packageRoot, 'node_modules', 'ws'), { recursive: true }),
  cp(process.execPath, join(packageRoot, 'runtime', 'node.exe')),
  cp(join(root, 'start-lan.bat'), join(packageRoot, 'start-lan.bat')),
  cp(join(root, 'scripts', 'start-lan.ps1'), join(packageRoot, 'scripts', 'start-lan.ps1')),
  cp(join(root, 'scripts', 'open-lan-firewall.ps1'), join(packageRoot, 'scripts', 'open-lan-firewall.ps1')),
])

await writeFile(
  join(packageRoot, 'package.json'),
  `${JSON.stringify({ name: 'suqcanvas-lan-local', private: true, type: 'module' }, null, 2)}\n`,
)
await writeFile(
  join(packageRoot, 'README.txt'),
  [
    'SuQCanvas LAN local package',
    '',
    '1. Double-click start-lan.bat and approve the Windows firewall prompt.',
    '2. Open the displayed LAN URL on other devices in the same local network.',
    '3. Keep the command window open while collaborating.',
    '',
    'Shared projects and assets are stored under server\\data.',
  ].join('\r\n'),
)

let archive = spawnSync(
  'tar.exe',
  ['-a', '-c', '-f', zipPath, 'SuQCanvas-LAN'],
  { cwd: releaseRoot, stdio: 'inherit' },
)
if (archive.status !== 0) {
  archive = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${packageRoot.replaceAll("'", "''")}' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`,
    ],
    { cwd: root, stdio: 'inherit' },
  )
}
if (archive.status !== 0) process.exit(archive.status ?? 1)

console.log(`\nLocal package: ${packageRoot}`)
console.log(`ZIP archive:   ${zipPath}`)
