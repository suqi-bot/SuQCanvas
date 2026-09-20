import { db, type AssetRecord, type ProjectRecord } from '../db/db'
import type { CloudAsset, CloudProject } from '../sync/cloudSync'
import { genUuid } from '../utils/uuid'
import { getDesktopCloudClient } from './cloudClient'
import { readCloudObject } from './cloudStorage'

async function userId(): Promise<string> {
  const { data, error } = await getDesktopCloudClient().auth.getUser()
  if (error || !data.user) throw new Error('登录已失效，请重新登录在线账号')
  return data.user.id
}

export async function listDesktopCloudProjects(): Promise<CloudProject[]> {
  const owner = await userId()
  const projects: CloudProject[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await getDesktopCloudClient().from('projects')
      .select('id,name,graph,viewport,created_at,updated_at').eq('user_id', owner)
      .order('updated_at', { ascending: false }).order('id').range(offset, offset + 99)
    if (error) throw new Error(`读取云端项目失败：${error.message}`)
    projects.push(...(data as CloudProject[]))
    if (data.length < 100) return projects
  }
}

export async function downloadDesktopCloudProject(
  projectId: string,
  onProgress: (message: string) => void = () => {},
): Promise<ProjectRecord> {
  const owner = await userId()
  const cloud = getDesktopCloudClient()
  onProgress('读取云端项目…')
  const { data, error } = await cloud.from('projects').select('*')
    .eq('user_id', owner).eq('id', projectId).maybeSingle()
  if (error) throw new Error(`读取云端项目失败：${error.message}`)
  if (!data) throw new Error('项目已删除或当前账号无权访问')
  const remote = data as CloudProject
  if (!Array.isArray(remote.graph?.nodes) || !Array.isArray(remote.graph?.edges)) {
    throw new Error('云端项目数据不完整')
  }
  const ids = [...new Set(remote.graph.nodes.flatMap((node) =>
    [node.data?.assetId, node.data?.coverAssetId].filter((id): id is string => !!id),
  ))]
  const metadata = new Map<string, CloudAsset>()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data: assets, error: assetError } = await cloud.from('assets').select('*')
      .eq('user_id', owner).in('id', ids.slice(offset, offset + 100))
    if (assetError) throw new Error(`读取素材信息失败：${assetError.message}`)
    for (const asset of assets as CloudAsset[]) metadata.set(asset.id, asset)
  }
  const missing = ids.find((id) => !metadata.has(id))
  if (missing) throw new Error('部分素材未上传到云端或当前账号无权访问，请先在在线版补齐素材')
  const assets: AssetRecord[] = []
  const idMap = new Map<string, string>()
  for (const [index, id] of ids.entries()) {
    const meta = metadata.get(id)!
    onProgress(`下载素材 ${index + 1}/${ids.length}：${meta.name}`)
    const blob = await readCloudObject(meta.oss_key, meta.mime)
    if (blob.size !== Number(meta.size)) throw new Error(`素材下载不完整：${meta.name}`)
    const thumbnail = meta.oss_thumb_key
      ? await readCloudObject(meta.oss_thumb_key, 'image/jpeg') : undefined
    const localId = genUuid()
    idMap.set(id, localId)
    assets.push({ id: localId, name: meta.name, mime: meta.mime, kind: meta.kind, size: blob.size, blob, thumbnail })
  }
  // Do not commit a download after the user switches accounts or signs out.
  if (await userId() !== owner) throw new Error('账号已切换，请重新下载')
  const now = Date.now()
  const local: ProjectRecord = {
    id: genUuid(), name: `${remote.name}（云端副本）`, createdAt: now, updatedAt: now,
    viewport: remote.viewport ?? { x: 0, y: 0, zoom: 1 },
    graph: { edges: remote.graph.edges, nodes: remote.graph.nodes.map((node) => ({
      ...node, selected: false, data: { ...node.data,
        ...(node.data.assetId ? { assetId: idMap.get(node.data.assetId)! } : {}),
        ...(node.data.coverAssetId ? { coverAssetId: idMap.get(node.data.coverAssetId)! } : {}),
      },
    })) },
  }
  onProgress('保存本地副本…')
  await db.transaction('rw', db.projects, db.assets, db.desktopCloudLinks, async () => {
    await db.assets.bulkAdd(assets)
    await db.projects.add(local)
    await db.desktopCloudLinks.put({ localProjectId: local.id, owner, projectId: remote.id,
      updatedAt: remote.updated_at, name: remote.name, localName: local.name })
  })
  return local
}
