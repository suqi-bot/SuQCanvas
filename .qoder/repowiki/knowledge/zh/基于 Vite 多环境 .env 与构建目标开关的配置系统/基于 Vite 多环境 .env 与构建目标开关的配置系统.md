---
kind: configuration_system
name: 基于 Vite 多环境 .env 与构建目标开关的配置系统
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - .env.lan
    - .env.online
    - vite.config.ts
    - scripts/build.mjs
    - src/buildMode.ts
    - src/sync/ossConfig.ts
    - src/sync/ossClient.ts
    - src/sync/ossClientImpl.ts
    - src/sync/supabaseClient.ts
    - src/sync/lanClient.ts
---

## 1. 系统概览

本项目使用 **Vite 原生环境变量机制** 作为配置体系核心，通过 `.env` 系列文件 + `--mode` 参数实现「在线版」与「局域网版」两套构建产物共享同一源码、按构建目标裁剪能力的双版本分发。

- 构建期常量：所有以 `VITE_` 前缀的环境变量在构建时由 Vite 注入为 `import.meta.env.*` 字面量，并在 Tree-shaking 阶段被静态分析消除死分支。
- 运行期读取：应用代码仅通过 `import.meta.env.VITE_*` 访问配置，不依赖运行时配置文件加载器。
- 构建脚本：`scripts/build.mjs` 封装了 `vite build --mode <lan|online>` 调用，并负责按顺序加载 `.env` → `.env.local` → `.env.online` → `.env.online.local` 的优先级合并逻辑（见其 `loadEnvValue` 函数）。

## 2. 关键文件

- `.env.example`：配置项清单与注释说明，列出全部可配置的 `VITE_*` 变量及用途。
- `.env.lan`：局域网构建目标，设置 `VITE_BUILD_TARGET=lan`。
- `.env.online`：在线构建目标，设置 `VITE_BUILD_TARGET=online`；真实密钥应写入同目录的 `.env.online.local`（该文件被 gitignore）。
- `vite.config.ts`：定义 Vite base、开发服务器代理 `/lan-ws` 转发到 `ws://127.0.0.1:8790`，以及测试环境。
- `scripts/build.mjs`：统一构建入口，解析命令行参数选择构建目标，自动复制 PDF.js 资源，并在构建 online 模式时检查 Supabase 配置缺失并发出警告。
- `src/buildMode.ts`：导出 `IS_LAN_BUILD` / `IS_ONLINE_BUILD` 两个布尔常量，供全仓判断当前构建目标。
- `src/sync/ossConfig.ts`：集中读取 OSS 相关环境变量，提供 `isOssConfigured()` 判定是否启用云存储。
- `src/sync/ossClient.ts`：基于 `VITE_BUILD_TARGET` 动态 `import('./ossClientImpl')`，将阿里云 OSS 客户端按需懒加载，局域网构建产物中不包含 ali-oss 依赖。
- `src/sync/supabaseClient.ts`：读取 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 初始化 Supabase 客户端。
- `src/sync/lanClient.ts`：读取 `VITE_LAN_WS_URL` 决定局域网中继地址，未配置时回退到同域 `/lan-ws`。

## 3. 架构与约定

### 3.1 构建目标开关（Build Target）

通过 `VITE_BUILD_TARGET` 区分两种产物：
- `lan`：禁用登录、云同步与 OSS，仅保留本地 IndexedDB + 局域网协作。
- `online`：启用 Supabase 认证、OSS 媒体上传下载、云端项目同步。

该值在构建时被替换为字面量，配合条件表达式（如 `const IS_ONLINE = import.meta.env.VITE_BUILD_TARGET !== 'lan'`）使 Vite 在打包阶段移除不可达分支，从而让局域网产物体积更小且不包含第三方 SDK。

### 3.2 环境变量命名规范

所有暴露给前端的环境变量均遵循 `VITE_` 前缀约定（Vite 的公开变量规则），并按功能域分组：
- 构建目标：`VITE_BUILD_TARGET`
- Supabase：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`
- 阿里云 OSS：`VITE_OSS_REGION`、`VITE_OSS_BUCKET`、`VITE_OSS_ACCESS_KEY_ID`、`VITE_OSS_ACCESS_KEY_SECRET`、`VITE_OSS_STS_URL`
- 局域网中继：`VITE_LAN_WS_URL`

### 3.3 环境文件分层策略

| 文件 | 作用 | Git 状态 |
|---|---|---|
| `.env.example` | 模板，列出全部可选配置 | 提交 |
| `.env.lan` | 局域网构建目标声明 | 提交 |
| `.env.online` | 在线构建目标声明 + 占位注释 | 提交 |
| `.env.online.local` | 真实密钥（Supabase/OSS）存放处 | 被 `.gitignore` 忽略 |
| `.env` / `.env.local` | 通用覆盖，由 `build.mjs` 的 `loadEnvValue` 优先读取 | 通常本地使用 |

### 3.4 能力探测与降级

- `ossConfig.isOssConfigured()`：当 `VITE_BUILD_TARGET !== 'lan'` 且同时存在 `region` + `bucket` + (`accessKeyId` 或 `stsUrl`) 时才返回 true，否则 OSS 能力关闭。
- `ossClient.ts`：在非 online 模式下，所有 OSS 方法直接返回空结果或抛出明确错误（如 `getOssThumb` 抛 `'OSS 未配置'`），调用方无需感知构建目标差异。
- `lanClient.ts`：未配置 `VITE_LAN_WS_URL` 时默认使用当前站点的 `/lan-ws` 反向代理路径。

### 3.5 安全约定

- 生产密钥禁止写入 `.env.online`，必须放入 `.env.online.local`（受 gitignore 保护）。
- 阿里云 AK/SK 仅在开发模式使用；生产模式推荐使用 `VITE_OSS_STS_URL` 由后端签发临时凭证，避免在前端暴露长期密钥。
- Supabase anon key 虽为公开密钥，但仍建议通过 `.env.online.local` 管理。

## 4. 约束与规则

1. **新增前端可配置项必须加 `VITE_` 前缀**：只有带该前缀的变量才会被 Vite 注入到 `import.meta.env`，这是 Vite 框架强制行为。
2. **构建目标只能设为 `lan` 或 `online`**：`buildMode.ts` 与 `ossConfig.ts` 均以 `=== 'lan'` 作为分界，其他值会导致行为不确定。
3. **在线版构建必须提供 Supabase URL 与 Anon Key**：`scripts/build.mjs` 在构建 online 模式时会检测这两个变量并输出警告；缺少时将导致登录与云同步不可用。
4. **OSS 配置需满足最小完备集**：`isOssConfigured()` 要求 `region`、`bucket` 非空，且至少提供 `accessKeyId` 或 `stsUrl` 之一，否则 OSS 能力自动关闭。
5. **局域网版产物不得包含 OSS/Supabase 依赖**：通过 `VITE_BUILD_TARGET` 条件 + 动态 `import` 实现，确保 `dist-lan/` 不包含 ali-oss 等包。
6. **开发调试时 LAN WebSocket 代理固定为 `ws://127.0.0.1:8790`**：由 `vite.config.ts` 中的 `server.proxy['/lan-ws']` 指定，如需修改需同步更新服务端启动端口。