import { db, type DesktopCloudLink } from '../db/db'
import { genUuid } from '../utils/uuid'
import { assetKey, thumbKey } from '../sync/ossConfig'
import { getDesktopCloudClient } from './cloudClient'
import { writeCloudObject } from './cloudStorage'

export interface CloudSaveTarget {
  owner: string
  projectId: string
  updatedAt: string | null
  name: string
}

const saving = new Set<string>()
const conflict = '云端项目已修改或删除，本次未覆盖。请下载最新版本核对，或另存为新云端项目。'

/** Upload immutable asset copies, then atomically compare-and-update the project row. */
export async function saveDesktopCloudProject(localProjectId: string, target: CloudSaveTarget,
  progress: (message: string) => void = () => {}): Promise<void> {
  if (saving.has(localProjectId)) throw new Error('此项目正在保存到云端')
  saving.add(localProjectId)
  try {
    const cloud = getDesktopCloudClient()
    const checkOwner = async () => {
      const { data, error } = await cloud.auth.getUser()
      if (error || !data.user) throw new Error('请先在首页「在线项目」登录账号')
      if (data.user.id !== target.owner) throw new Error('账号已切换，请重新保存')
    }
    await checkOwner()
    const local = await db.projects.get(localProjectId)
    if (!local) throw new Error('本地项目不存在')
    const { data: current, error: readError } = await cloud.from('projects').select('id,updated_at')
      .eq('user_id', target.owner).eq('id', target.projectId).maybeSingle()
    if (readError) throw new Error(`读取云端版本失败：${readError.message}`)
    if (target.updatedAt === null ? !!current : !current || current.updated_at !== target.updatedAt) throw new Error(conflict)

    const ids = [...new Set(local.graph.nodes.flatMap((node) =>
      [node.data.assetId, node.data.coverAssetId].filter((id): id is string => !!id)))]
    const records = await db.assets.bulkGet(ids)
    // Validate all local files before making any remote writes.
    if (records.some((asset) => !asset || !asset.blob || asset.blob.size !== asset.size)) {
      throw new Error('本地素材缺失或不完整，请补齐后再保存到云端')
    }
    const link: DesktopCloudLink = { localProjectId, owner: target.owner, projectId: target.projectId,
      updatedAt: target.updatedAt, name: target.name, localName: local.name }
    // Remember the new ID before insertion so a lost response cannot create duplicate projects on retry.
    if (target.updatedAt === null) await db.desktopCloudLinks.put(link)
    const idMap = new Map<string, string>()
    for (const [index, record] of records.entries()) {
      const asset = record!
      await checkOwner()
      progress(`上传素材 ${index + 1}/${records.length}：${asset.name}`)
      const id = genUuid()
      const key = assetKey(id)
      const thumbnailKey = asset.thumbnail ? thumbKey(id) : null
      await writeCloudObject(key, asset.blob, target.owner)
      if (thumbnailKey) await writeCloudObject(thumbnailKey, asset.thumbnail!, target.owner)
      await checkOwner()
      const { error } = await cloud.from('assets').insert({ id, user_id: target.owner,
        name: asset.name, mime: asset.mime, size: asset.size, kind: asset.kind,
        oss_key: key, oss_thumb_key: thumbnailKey, has_thumbnail: !!thumbnailKey })
      if (error) throw new Error(`保存素材信息失败：${error.message}`)
      idMap.set(asset.id, id)
    }
    await checkOwner()
    progress('保存云端画布…')
    const payload = { name: target.name, viewport: local.viewport,
      graph: { edges: local.graph.edges, nodes: local.graph.nodes.map((node) => ({
        ...node, selected: false, data: { ...node.data,
          ...(node.data.assetId ? { assetId: idMap.get(node.data.assetId)! } : {}),
          ...(node.data.coverAssetId ? { coverAssetId: idMap.get(node.data.coverAssetId)! } : {}),
        },
      })) }, updated_at: new Date().toISOString() }
    const query = target.updatedAt === null
      ? cloud.from('projects').insert({ ...payload, id: target.projectId, user_id: target.owner })
      : cloud.from('projects').update(payload).eq('user_id', target.owner)
        .eq('id', target.projectId).eq('updated_at', target.updatedAt)
    const { data: saved, error } = await query.select('id,updated_at').maybeSingle()
    if (error) throw new Error(`云端保存未确认：${error.message}。请刷新在线项目核对后再重试。`)
    if (!saved) throw new Error(conflict)
    await db.desktopCloudLinks.put({ ...link, updatedAt: saved.updated_at })
  } finally { saving.delete(localProjectId) }
}
