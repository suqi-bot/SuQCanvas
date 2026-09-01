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
    - src/buildMode.ts
    - src/sync/ossConfig.ts
    - src/sync/supabaseClient.ts
    - src/store/settingsStore.ts
    - scripts/build.mjs
    - package.json
---

## 1. 整体方案

该仓库使用 **Vite 原生环境变量机制**（`import.meta.env.*`）配合多个 `.env*` 文件实现配置管理，并通过自定义 `scripts/build.mjs` 脚本以 `--mode lan|online` 切换构建目标，从而在同一份源码中产出“局域网版”和“在线版”两个独立产物。

- 构建期常量：所有配置均通过 `VITE_*` 前缀暴露给前端，在构建时被 Vite 替换为字面量常量，未使用的分支会被摇树移除（如 Supabase/OSS 客户端仅在 online 构建中进入产物）。
- 运行期设置：用户偏好（主题等）通过 `localStorage` + URL 参数读取，由 Zustand store (`src/store/settingsStore.ts`) 管理。
- 服务端/工具侧：局域网中继地址、Supabase 函数等另有独立配置，但本仓库前端侧统一走 `VITE_*` 环境变量。

## 2. 关键文件

- `.env.example`：完整的环境变量清单与注释，定义 `VITE_BUILD_TARGET`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_LAN_WS_URL`、`VITE_OSS_REGION/BUCKET/ACCESS_KEY_ID/ACCESS_KEY_SECRET/STS_URL`。
- `.env.lan`：局域网构建模式，设置 `VITE_BUILD_TARGET=lan`，默认不启用云同步与 OSS。
- `.env.online`：在线构建模式，设置 `VITE_BUILD_TARGET=online`；真实密钥应放入 `.env.online.local`（被 gitignore 保护）。
- `vite.config.ts`：定义 `base: '/SuQCanvas/'`、开发服务器 `/lan-ws` 反向代理到 `ws://127.0.0.1:8790`、测试环境为 node。
- `src/buildMode.ts`：导出 `IS_LAN_BUILD` / `IS_ONLINE_BUILD` 布尔常量，由 `import.meta.env.VITE_BUILD_TARGET` 决定，用于死代码消除。
- `src/sync/ossConfig.ts`：根据 `VITE_BUILD_TARGET` 与环境变量判断 OSS 是否已配置，并提供资源 key 生成规则（`assets/{id}.bin`、`assets/{id}.thumb`）。
- `src/sync/supabaseClient.ts`：仅当 `IS_ONLINE_BUILD` 且 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 存在时才创建 Supabase 客户端，否则返回 null。
- `src/store/settingsStore.ts`：运行时用户设置（theme），优先级为 URL 参数 > localStorage > 默认 dark。
- `scripts/build.mjs`：统一构建入口，按 `--mode lan|online` 调用 Vite，输出到 `dist-lan/` 或 `dist/`，并检查在线版缺失的 Supabase 环境变量。
- `package.json`：脚本别名 `dev:lan`、`build:online`、`build:lan`、`package:lan` 等封装不同构建场景。

## 3. 架构与约定

### 3.1 构建目标分层
- 通过 `VITE_BUILD_TARGET` 区分 `lan` 与 `online`。`buildMode.ts` 将其编译为字面量布尔值，后续模块用 `if (IS_ONLINE_BUILD)` 包裹云端能力，使局域网构建产物不包含 Supabase/OSS 依赖。
- 构建脚本 `scripts/build.mjs` 支持三种模式：`node scripts/build.mjs`（交互选择）、`node scripts/build.mjs online|lan|all`（CI/自动化友好，非 TTY 默认全部构建）。
- 输出目录分离：online → `dist/`，lan → `dist-lan/`，避免互相覆盖。

### 3.2 环境变量加载顺序
`scripts/build.mjs` 中的 `loadEnvValue` 按 `.env` → `.env.local` → `.env.online` → `.env.online.local` 顺序查找键值，若均未找到则回退到 `process.env[name]`。这允许本地覆盖线上模板配置。

### 3.3 功能开关策略
- **Supabase 登录/云同步**：`supabaseClient.ts` 仅在 online 构建且 URL+Key 都存在时初始化客户端，否则 `isCloudConfigured()` 返回 false，上层逻辑可降级到纯本地模式。
- **OSS 媒体上传**：`ossConfig.ts` 的 `isOssConfigured()` 要求 region + bucket + (accessKeyId 或 stsUrl) 三者齐全才启用，否则媒体仅存 IndexedDB。
- **局域网中继**：`VITE_LAN_WS_URL` 为空时默认使用当前站点的 `/lan-ws` 反向代理（开发期由 vite.config.ts 代理到本机 8790 端口）。

### 3.4 运行时用户设置
`settingsStore.ts` 将 theme 持久化到 `localStorage`（key `suqcanvas:theme`），并支持通过 URL 参数 `?theme=light|dark` 覆盖，启动时自动应用 class 到 `<html>`。

## 4. 约定与约束

- **所有前端可注入的配置必须以 `VITE_` 开头**，由 Vite 暴露为 `import.meta.env.*`（见 `.env.example` 全量清单）。
- **敏感信息不得提交进仓库**：`.env.online` 中明确提示将真实密钥复制到 `.env.online.local`；`.env.example` 仅含占位值。
- **构建目标必须通过 `--mode` 切换**：`package.json` 的脚本统一通过 `vite --mode lan|online` 调用，禁止直接修改 `.env` 后复用同一构建产物。
- **局域网构建默认禁用云端能力**：`IS_LAN_BUILD` 为 true 时，Supabase 客户端始终为 null，OSS 检测始终为 false，确保离线安全。
- **资源命名约定**：OSS 上资源路径固定为 `assets/{assetId}.bin` 与 `assets/{assetId}.thumb`（`ossConfig.ts` 中硬编码）。
- **开发期 WebSocket 反代**：`vite.config.ts` 将 `/lan-ws` 代理到 `ws://127.0.0.1:8790`，生产部署需自行提供同域名反向代理。
- **主题持久化 key 固定为 `suqcanvas:theme`**，变更会影响已有用户的主题状态迁移。