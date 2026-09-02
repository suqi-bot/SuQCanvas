---
kind: error_handling
name: 前端应用中的错误处理：静默降级、Toast 提示与结构化 Promise 结果
category: error_handling
scope:
    - '**'
source_files:
    - src/sync/lanClient.ts
    - src/sync/cloudSync.ts
    - src/sync/ossClientImpl.ts
    - src/io/importExport.ts
    - src/store/uiStore.ts
    - src/components/Toasts.tsx
---

## 1. 整体方法

SuQCanvas 是一个纯前端（Vite + React + TypeScript）单仓工程，没有后端中间件或统一的异常捕获框架。代码库采用**“失败即降级 + 用户可见 Toast”**的轻量策略：I/O 和网络调用出错时不向上抛出未捕获异常，而是记录日志、返回空值/默认值，并通过 `toast(message, kind)` 向用户反馈；仅对**输入校验类**的错误使用 `throw new Error(...)` 立即中断流程。

## 2. 关键文件与位置

- **UI 通知层**：`src/store/uiStore.ts` 定义 `ToastKind = 'info' | 'error' | 'success'`、`pushToast` 与全局 `toast()` 导出；`src/components/Toasts.tsx` 渲染到页面底部。
- **局域网协作**：`src/sync/lanClient.ts` 是错误处理最集中的模块——WebSocket 连接、消息解析、项目/素材传输均在此处做 try/catch、超时、断线重连与状态回退。
- **云端同步**：`src/sync/cloudSync.ts` 通过 Supabase 操作数据库，所有 I/O 分支统一以 `console.warn` + 返回空值/`false` 的方式降级。
- **OSS 存储**：`src/sync/ossClientImpl.ts` 封装阿里云 OSS 客户端，上传/下载/签名 URL 失败时 `console.warn` 并返回空串/null。
- **导入导出**：`src/io/importExport.ts` 在解压/JSON 解析等不可恢复的格式错误时 `throw new Error(...)`，由上层 `exportCurrentProject` 用 try/catch 捕获后 toast 提示。

## 3. 架构与约定

### 3.1 输入校验 → throw
`resolveLanUrl` 对空地址、非法协议、HTTPS 页面误用 `ws://` 等情况直接 `throw new Error('...')`，调用方 `lanConnect` 用 `try/catch` 捕获后设置 LAN 状态为 `error` 并 toast 提示。这是本仓库中唯一集中使用 `throw` 的地方，用于**参数合法性校验**这一明确边界。

### 3.2 外部 I/O → 静默降级 + console.warn
Supabase 调用遵循固定模式：
```ts
const { error } = await supabase.from(...).upsert(...)
if (error) console.warn('xxx失败:', error.message)
```
对应函数返回空数组、`null`、`false` 或 `void`，由调用者决定后续行为（如 `fetchCloudProjects` 返回 `[]`，`upsertProjectToCloud` 返回 `false`）。OSS 客户端同样如此：`downloadAssetFromOss` 失败返回 `null`，`getOssUrl` 失败返回 `null`，`uploadThumbToOss` 失败被 `importProjectFile` 用独立 `try/catch` 忽略，保证主文件上传不受缩略图影响。

### 3.3 WebSocket 通信 → 健壮的消息路由
`lanClient.ts` 的 `sock.onmessage` 先 `JSON.parse`，解析失败直接 `return`（丢弃畸形消息），再交给 `handleMessage` 按 `msg.t` 分发。每条消息分支都做了字段存在性检查（如 `if (!projectId || msg.projectId !== lan.activeProjectId) return`），避免脏数据污染画布。

### 3.4 超时与重试
- **自动重连**：基于指数退避（`RECONNECT_BASE_MS * 2 ** reconnectAttempts`，上限 `RECONNECT_MAX_MS`），首次断开 toast 提示“正在自动重连…”，成功恢复后 toast 提示“已恢复局域网协作连接”。
- **请求超时**：`fetchProjectFromLan`、`fetchLanBackups`、`restoreProjectFromLan` 使用 `setTimeout` 在 8s 内无响应则 resolve 空结果，防止 UI 永久挂起。
- **素材传输空闲超时**：`ASSET_IDLE_TIMEOUT_MS = 60_000`，长时间无分片到达则判定失败并唤醒等待者；断线时保留已收分片，重连后可从断点续传。

### 3.5 并发安全与墓碑机制
删除传播通过 `sync-del` 消息 + `TOMBSTONE_MS = 60_000` 墓碑表实现：收到删除后立即标记 id，窗口期内晚到的旧快照不会复活该节点/边；本地撤销删除时清除墓碑。这属于错误恢复层面的设计，确保网络乱序/延迟不会导致数据不一致。

### 3.6 用户可见的错误反馈
所有可感知的错误最终通过 `toast(message, kind)` 呈现：
- 连接失败：`toast('无法连接局域网中继，请检查地址和反向代理配置', 'error')`
- 项目被删：`toast('当前协作项目已从局域网主机删除', 'error')`
- 权限不足：`toast('只有项目创建者（主机）可以删除项目', 'error')`
- 导入失败：`toast('导出失败' / '项目导入成功', 'error' | 'success')`
- 重连过程：`toast('局域网连接断开，正在自动重连…', 'info')`

## 4. 约定与约束

- **禁止向上抛出业务 I/O 异常**：Supabase、OSS、WebSocket 相关函数一律 catch 内部错误并返回语义化默认值，调用方不得假设这些调用“可能抛错”。
- **输入校验必须抛错**：`resolveLanUrl` 等入口函数对非法输入直接 `throw`，由调用方统一捕获并转为 UI 提示。
- **所有异步 I/O 必须有超时或降级路径**：LAN 项目拉取、备份列表、备份恢复均有 8s 超时；OSS 下载失败返回 null；Supabase 写入失败返回 false/void。
- **用户反馈必须区分类型**：`toast` 的 `kind` 严格使用 `'info' | 'error' | 'success'` 三态，错误场景一律用 `'error'`。
- **不依赖全局 unhandledrejection/uncaughtException**：仓库中没有注册全局异常处理器，错误处理完全靠各模块显式 try/catch 与返回值约定完成。
- **无自定义 Error 子类**：未发现 `class XxxError extends Error` 的定义，错误仅通过字符串消息区分。
- **无 panic/recover**：作为浏览器端 TS 工程，不存在 `panic`；`try/catch` 仅包裹 JSON 解析、URL 构造等可能抛错的局部逻辑。
