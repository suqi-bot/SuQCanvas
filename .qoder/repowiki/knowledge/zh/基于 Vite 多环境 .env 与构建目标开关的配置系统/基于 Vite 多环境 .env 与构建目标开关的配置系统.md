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
    - src/sync/supabaseClient.ts
    - package.json
---

## 1. 采用的方案

本项目采用 **Vite 原生环境变量 + 多 `.env` 文件 + 自定义构建脚本** 的组合方式实现配置管理，核心思路是：
- 通过 `VITE_BUILD_TARGET`（`lan` / `online`）在编译期决定产物行为，配合 `import.meta.env` 的 define 替换，将分支常量折叠为字面量，使无关模块被摇树移除。
- 使用多个 `.env.*` 文件区分不同部署场景（局域网、在线版、本地覆盖），由 `scripts/build.mjs` 按顺序读取并注入到 Vite 构建中。
- 敏感配置（Supabase URL/Key、OSS AK/STS）通过 `.env.online.local` 等仅本地存在的文件加载，避免误提交。

## 2. 关键文件与包

- `.env.example`：所有可配置项的模板与说明，包括 `VITE_BUILD_TARGET`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_LAN_WS_URL`、`VITE_OSS_*` 系列。
- `.env.lan` / `.env.online`：分别固定 `VITE_BUILD_TARGET=lan|online`，供 `npm run build:lan` / `build:online` 通过 `--mode lan|online` 选择。
- `vite.config.ts`：设置 `base: '/SuQCanvas/'`，并在开发服务器中把 `/lan-ws` 代理到 `ws://127.0.0.1:8790`。
- `scripts/build.mjs`：统一打包入口，按 `online` / `lan` / `all` 调用 Vite，并在构建前执行 `copy-pdfjs-assets.mjs`；内部 `loadEnvValue` 按 `.env → .env.local → .env.online → .env.online.local` 的顺序解析键值，作为 fallback 给 `process.env`。
- `src/buildMode.ts`：导出 `IS_LAN_BUILD` / `IS_ONLINE_BUILD`，由 `VITE_BUILD_TARGET` 编译期替换。
- `src/sync/ossConfig.ts`：根据 `VITE_BUILD_TARGET` 判断是否启用 OSS，并通过检查 `VITE_OSS_REGION`、`VITE_OSS_BUCKET`、`VITE_OSS_ACCESS_KEY_ID` / `VITE_OSS_STS_URL` 是否存在来判定 OSS 是否已配置。
- `src/sync/ossClient.ts`：利用 `IS_ONLINE` 常量做动态 `import('./ossClientImpl')`，局域网构建时整个 ali-oss 依赖不会被打包进产物。
- `src/sync/supabaseClient.ts`：仅在 `IS_ONLINE_BUILD` 且 `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` 均存在时才创建 Supabase 客户端，否则导出 `null`。
- `package.json`：暴露 `dev`、`dev:lan`、`build`、`build:online`、`build:lan`、`package:lan`、`lan`、`lan:open` 等脚本，封装构建与启动流程。

## 3. 架构与设计约定

### 3.1 构建目标驱动的多产物
- 通过 `VITE_BUILD_TARGET` 区分两种产物：
  - `lan`：无登录、无云同步/OSS，仅局域网协作。
  - `online`：启用 Supabase 登录 + 云同步 + OSS 存储。
- 构建脚本 `scripts/build.mjs` 以 `--mode lan|online` 调用 Vite，Vite 会将 `.env.<mode>` 中的变量注入 `import.meta.env`，并在编译期替换为字面量，从而让死代码分支被 tree-shaking 移除。

### 3.2 配置分层与优先级
- 环境变量加载顺序（由 `scripts/build.mjs` 的 `loadEnvValue` 定义）：`.env` → `.env.local` → `.env.online` → `.env.online.local` → `process.env`。同名键后者优先覆盖。
- `.env.example` 提供完整字段清单；`.env.lan` / `.env.online` 固定构建目标；真实密钥应放入 `.env.online.local`（该文件不在版本控制中）。

### 3.3 运行时能力探测
- `src/sync/ossConfig.ts` 的 `isOssConfigured()` 检查 OSS 相关环境变量是否齐全，返回布尔值供上层决定是否启用 OSS 功能。
- `src/sync/supabaseClient.ts` 的 `isCloudConfigured()` 同理检测 Supabase 是否可用。
- 这些探测函数使得同一份前端代码在不同构建产物中以不同能力集运行。

### 3.4 按需加载与产物瘦身
- `src/sync/ossClient.ts` 使用 `const IS_ONLINE = import.meta.env.VITE_BUILD_TARGET !== 'lan'` 作为条件，对 `./ossClientImpl` 进行动态 `import`。局域网构建时该分支不可达，ali-oss 依赖不会进入产物。
- 类似地，`supabaseClient.ts` 直接基于 `IS_ONLINE_BUILD` 决定是否实例化 Supabase 客户端，未启用时整个 `@supabase/supabase-js` 也不会被打包。

### 3.5 开发环境与反向代理
- `vite.config.ts` 将 `/lan-ws` 代理到本地 `ws://127.0.0.1:8790`，对应 `server/lan-server.mjs` 提供的局域网中继服务。
- `VITE_LAN_WS_URL` 允许在生产部署时指定远程 WebSocket 地址（HTTPS 站点需使用 `wss://`）。

## 4. 约定与约束

- **构建目标必须通过 `VITE_BUILD_TARGET` 设置**：默认值为 `online`，局域网版需显式设为 `lan`（见 `.env.example` 注释）。
- **在线版密钥不得写入 `.env.online`**：该文件会被版本控制，真实密钥应复制到 `.env.online.local`（见 `.env.online` 内注释警告）。
- **OSS 与 Supabase 均为可选**：不配置则应用退化为纯本地模式（媒体存 IndexedDB，无云同步）；`isOssConfigured()` / `isCloudConfigured()` 用于运行时能力探测。
- **局域网中继地址**：未设置 `VITE_LAN_WS_URL` 时默认使用当前站点的 `/lan-ws` 反向代理；HTTPS 部署时必须配置为 `wss://` 地址。
- **构建产物输出目录**：在线版输出到 `dist/`，局域网版输出到 `dist-lan/`，由 `scripts/build.mjs` 的 `TARGETS` 映射决定。
- **PDF.js 资源**：每次构建/开发前会先执行 `scripts/copy-pdfjs-assets.mjs`，确保 `public/pdfjs` 下的字体与 wasm 资源就位。
- **开发端口与主机**：`dev:lan` 通过 `--host 0.0.0.0` 暴露局域网访问；Windows 下可通过 `npm run lan:open` 打开防火墙规则。
- **Lint 与测试**：使用 oxlint（`.oxlintrc.json`）和 Vitest（`vitest/config`），测试环境为 `node`。

## 5. 总结

该配置系统的核心特征是 **“编译期构建目标 + 运行时能力探测”**：通过 Vite 的 `import.meta.env` 在打包阶段裁剪代码路径，再结合 `isXxxConfigured()` 函数在运行时安全地启用或禁用云端能力。这种设计让同一份源码既能产出轻量局域网版，又能产出带云能力的在线版，同时通过 `.env.*` 分层管理敏感配置，兼顾了安全性与可移植性。