---
kind: build_system
name: Vite + Node.js 双产物构建与局域网分发流水线
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - vite.config.ts
    - scripts/build.mjs
    - scripts/copy-pdfjs-assets.mjs
    - scripts/package-lan.mjs
    - scripts/start-lan.ps1
    - scripts/open-lan-firewall.ps1
    - start-lan.bat
    - server/lan-server.mjs
    - src/buildMode.ts
    - src/appVersion.ts
    - .env.example
---

## 1. 构建系统总览

本项目采用 **Vite（React + Tailwind）+ TypeScript** 作为前端构建核心，配合自研的 Node.js 脚本完成多目标构建、资源预处理、局域网服务端打包与 Windows 一键分发。整个流程由 `package.json` 中的 npm scripts 统一编排，不存在 Makefile / Dockerfile / CI 配置文件。

- 构建工具链：`vite@8` + `@vitejs/plugin-react` + `tailwindcss@4` + `typescript~6.0` + `vitest`。
- 产物形态：
  - `dist/` —— 在线版（云端 Supabase 同步），通过 Vite `--mode online` 构建。
  - `dist-lan/` —— 局域网版（本地 WebSocket 协作），通过 Vite `--mode lan` 构建。
  - `release/SuQCanvas-LAN.zip` —— 可独立分发的局域网包，内含静态站点、Node 运行时、启动脚本与防火墙规则脚本。
- 版本管理：应用版本号集中在 `src/appVersion.ts`（导出 `APP_VERSION = 'V1.3'`），npm 包版本在 `package.json` 的 `version` 字段（当前 `1.3.0`）。

## 2. 关键文件与职责

| 文件 | 作用 |
|---|---|
| `package.json` | 定义全部 npm scripts（`dev` / `build:online` / `build:lan` / `package:lan` / `test` / `lint` 等），声明依赖与 devDependencies |
| `vite.config.ts` | 配置 `base: '/SuQCanvas/'`、React/Tailwind 插件、开发代理 `/lan-ws` → `ws://127.0.0.1:8790`、Vitest 运行环境为 `node` |
| `scripts/build.mjs` | 主构建编排器：解析参数 `online|lan|all`，调用 `copy-pdfjs-assets.mjs`，按 mode 执行 `vite build --outDir dist|dist-lan`，并校验在线版所需环境变量 |
| `scripts/copy-pdfjs-assets.mjs` | 将 `node_modules/pdfjs-dist` 下的 `cmaps` / `standard_fonts` / `wasm` 复制到 `public/pdfjs`，供 PDF.js 运行时加载 |
| `scripts/package-lan.mjs` | 组装局域网发布包：复制 `dist-lan`、`server/lan-server.mjs`、`node_modules/ws`、嵌入的 `runtime/node.exe`、Windows 启动脚本，生成 `release/SuQCanvas-LAN.zip` |
| `scripts/start-lan.ps1` | 局域网启动脚本：自动检测或捆绑 Node 运行时、打开 Windows 防火墙端口 8790、打印本机与 LAN IP、设置 `NODE_OPTIONS --max-old-space-size=8192` 后启动 `lan-server.mjs` |
| `scripts/open-lan-firewall.ps1` | 创建/启用名为 `SuQCanvas LAN 8790` 的入站防火墙规则 |
| `start-lan.bat` | Windows 批处理入口，调用 PowerShell 启动局域网服务 |
| `server/lan-server.mjs` | 局域网协作服务端：HTTP 静态站点 + WebSocket 实时同步 + 资产流式传输 + 项目备份/清理维护任务 |
| `src/buildMode.ts` | 构建期常量注入：`IS_LAN_BUILD` / `IS_ONLINE_BUILD` 由 `import.meta.env.VITE_BUILD_TARGET` 决定，用于摇树死代码 |
| `.env.lan` / `.env.online` / `.env.example` | 不同构建目标的 Vite 环境变量（如 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`） |

## 3. 架构与约定

### 3.1 多模式构建
- 通过 Vite 的 `--mode` 机制区分在线版与局域网版。`scripts/build.mjs` 中定义 `TARGETS` 映射：`online` → `mode: 'online'`, `outDir: 'dist'`；`lan` → `mode: 'lan'`, `outDir: 'dist-lan'`。
- 构建前自动执行 `predev` / `predev:lan` 钩子调用 `copy-pdfjs-assets.mjs`，确保 PDF.js 资源可用。
- 构建时读取 `.env` / `.env.local` / `.env.online` / `.env.online.local` 中的 `VITE_*` 变量，缺失 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 时输出警告。
- `src/buildMode.ts` 暴露 `IS_LAN_BUILD` / `IS_ONLINE_BUILD` 两个编译时常量，由 Vite 在构建时替换字面量，使无关分支被 Tree-shaking 移除。

### 3.2 产物目录约定
- 在线版：`dist/`，部署到任意静态托管（Nginx / CDN / Supabase 等），`base` 设为 `/SuQCanvas/` 以适配子路径部署。
- 局域网版：`dist-lan/`，由 `server/lan-server.mjs` 作为静态根（默认 `WEB_ROOT = dist-lan`），并通过 HTTP 路由 `/SuQCanvas/assets/<assetId>` 提供带 Range 支持的流式素材下载。
- 发布包：`release/SuQCanvas-LAN/` 结构固定包含 `dist-lan/`、`server/`、`node_modules/ws/`、`runtime/node.exe`、`scripts/`、`start-lan.bat`、`README.txt` 及临时生成的 `package.json`。

### 3.3 局域网服务端集成
- `server/lan-server.mjs` 同时承担静态站点服务器与 WebSocket 协作中继，监听 `PORT`（默认 8790），数据目录 `LAN_DATA_DIR`（默认 `server/data`）持久化项目与资产。
- 资产采用 SHA-256 哈希命名：`assets/<sha256(id)>.bin/.json/.thumb`，支持断点续传（Range 头）与分片上传（WebSocket chunk）。未引用资产经 24 小时 GC 清理，项目删除后保留 24 小时备份。
- 启动时自动扫描局域网 IPv4 地址并打印 LAN 访问链接，便于同网设备直接打开。

### 3.4 开发与测试
- `npm run dev`：启动 Vite 开发服务器，自动代理 `/lan-ws` 到本地 8790 端口，方便前端联调局域网服务。
- `npm run test`：使用 Vitest（`environment: 'node'`）运行 `*.test.ts` 单元测试。
- `npm run lint`：使用 OxLint 进行代码检查。
- `npm run preview`：预览生产构建产物。

## 4. 约定与约束

- **构建入口统一**：所有构建动作必须通过 `npm run build:online` / `build:lan` / `build:all` 触发，禁止直接调用 `vite build`，以确保 PDF.js 资源拷贝与环境变量校验步骤不被跳过。
- **环境变量隔离**：在线版必需 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`，建议写入 `.env.online.local`；局域网版无需这些变量。
- **构建产物不可变**：`dist/` 与 `dist-lan/` 由构建脚本生成，不应手动修改；发布包由 `scripts/package-lan.mjs` 重新组装，避免遗漏依赖。
- **局域网包自包含**：发布包内嵌 `runtime/node.exe`，要求宿主 Windows 安装 Node.js 20+ 作为回退；若找不到则提示安装。
- **安全 ID 校验**：服务端对所有外部传入的 `id`、`projectId`、`assetId` 使用正则 `/^[A-Za-z0-9_-]{1,160}$/` 校验，防止路径穿越与非法操作。
- **大内存策略**：局域网启动脚本强制设置 `NODE_OPTIONS --max-old-space-size=8192`，以支撑大视频资产与多客户端并发场景。
- **无 CI/Docker**：仓库未包含 GitHub Actions / Jenkins 等 CI 配置，也未提供 Dockerfile；构建与发布目前为本地手工流程。

## 5. 适用性说明

本仓库存在完整的构建脚本、多模式构建配置、局域网服务端打包与分发流程，因此 `build_system` 类别完全适用。但由于没有容器化、CI 流水线或跨平台交叉编译逻辑，该体系主要面向本地开发与 Windows 局域网分发场景。