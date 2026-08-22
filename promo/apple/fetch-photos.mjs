// 下载候选演示照片（picsum 固定 ID，900x600）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, 'work', 'photos')
fs.mkdirSync(dir, { recursive: true })

const ids = [1015, 1016, 1018, 1035, 1036, 1039, 1043, 1059, 1062, 1067]
for (const id of ids) {
  const out = path.join(dir, `p${id}.jpg`)
  if (fs.existsSync(out)) { console.log('skip', id); continue }
  try {
    const res = await fetch(`https://picsum.photos/id/${id}/900/600`)
    if (!res.ok) { console.log('FAIL', id, res.status); continue }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(out, buf)
    console.log('ok', id, buf.length)
  } catch (e) {
    console.log('ERR', id, e.message)
  }
}
console.log('done')
