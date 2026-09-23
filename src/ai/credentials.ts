export interface AiCredentials {
  comfyKey: string
  cloudKey: string
  llmKey: string
}

/** 网页版专用凭据键；与 AI 配置设置分离，避免混进项目/设置导出。 */
export const CREDENTIALS_STORAGE = 'suqcanvas-ai-credentials-v1'
/** 桌面版数据目录中的独立文件名（userData/ai-credentials.json）。 */
export const CREDENTIALS_FILE = 'ai-credentials.json'

export const emptyCredentials = (): AiCredentials => ({ comfyKey: '', cloudKey: '', llmKey: '' })

function sanitize(value: unknown): AiCredentials {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof AiCredentials, unknown>>
  const pick = (key: keyof AiCredentials) => (typeof source[key] === 'string' ? (source[key] as string) : '')
  return { comfyKey: pick('comfyKey'), cloudKey: pick('cloudKey'), llmKey: pick('llmKey') }
}

/** 按字段合并：非空优先，避免空文件/空回退清掉已有 Key。 */
export function mergeCredentials(...sources: unknown[]): AiCredentials {
  const sanitized = sources.map(sanitize)
  return {
    comfyKey: sanitized.find((item) => item.comfyKey)?.comfyKey ?? '',
    cloudKey: sanitized.find((item) => item.cloudKey)?.cloudKey ?? '',
    llmKey: sanitized.find((item) => item.llmKey)?.llmKey ?? '',
  }
}

function readLocalStorage(): AiCredentials {
  try {
    return sanitize(JSON.parse(localStorage.getItem(CREDENTIALS_STORAGE) || '{}'))
  } catch {
    return emptyCredentials()
  }
}

/** 同步读取 localStorage 镜像，便于 store 初始化。 */
export function loadCredentialsSync(): AiCredentials {
  return readLocalStorage()
}

/** 从独立文件 / localStorage 恢复完整凭据（按字段取非空）。 */
export async function loadCredentials(): Promise<AiCredentials> {
  let fromFile = emptyCredentials()
  const bridge = typeof window !== 'undefined' ? window.suqDesktop : undefined
  if (bridge?.readAiCredentials) {
    try {
      fromFile = sanitize(await bridge.readAiCredentials())
    } catch {
      /* 回退到 localStorage */
    }
  }
  return mergeCredentials(fromFile, readLocalStorage())
}

/** 串行写入桌面文件，避免快速连续保存时旧值覆盖新值。 */
let writeChain: Promise<void> = Promise.resolve()

/** 写入独立凭据存储：桌面写 userData 文件，同时镜像到 localStorage。 */
export function saveCredentials(credentials: AiCredentials): Promise<void> {
  const clean = sanitize(credentials)
  try {
    localStorage.setItem(CREDENTIALS_STORAGE, JSON.stringify(clean))
  } catch {
    /* 隐私模式等场景忽略 */
  }
  const bridge = typeof window !== 'undefined' ? window.suqDesktop : undefined
  if (!bridge?.writeAiCredentials) return Promise.resolve()
  writeChain = writeChain.then(async () => {
    try { await bridge.writeAiCredentials!(clean) } catch { /* 文件写入失败时仍保留 localStorage */ }
  })
  return writeChain
}

/** 启动时用文件内容补全内存中的空 Key；已有非空值不被空回退覆盖。 */
export async function hydrateCredentials(): Promise<AiCredentials> {
  const credentials = await loadCredentials()
  const merged = mergeCredentials(credentials, readLocalStorage())
  try {
    localStorage.setItem(CREDENTIALS_STORAGE, JSON.stringify(merged))
  } catch { /* ignore */ }
  return merged
}
