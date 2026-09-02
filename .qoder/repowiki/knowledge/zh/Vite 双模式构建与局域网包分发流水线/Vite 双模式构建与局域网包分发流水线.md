---
kind: build_system
name: Vite 双模式构建与局域网包分发流水线
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - vite.config.ts
    - scripts/build.mjs
    - scripts/copy-pdfjs-assets.mjs
    - scripts/package-lan.mjs
    - .env.lan
    - .env.online
    - src/buildMode.ts
    - server/lan-server.mjs
    - promo/package.json
---

## 1. 构建系统总览

本项目采用 **Vite + TypeScript** 作为前端构建核心，通过 `scripts/build.mjs` 统一编排在线版（云端同步）与局域网版（LAN 协作）两套产物；同时包含一个独立的 Node.js LAN 中继服务器 (`server/lan-server.mjs`)，以及为 Apple 风格宣传片录制的独立子工程 (`promo/`)。整个仓库没有 Makefile、Dockerfile 或 CI 配置文件，所有构建、打包、预览、测试均通过 `npm scripts` 驱动。

## 2. 关键文件与职责

- `package.json`：定义全部 npm 脚本入口，包括 `dev` / `dev:lan` / `build` / `build:online` / `build:lan` / `build:all` / `package:lan` / `test` / `preview` / `lan` / `lan:open`。
- `vite.config.ts`：配置 Vite 插件（React、Tailwind）、静态资源 base 路径 `/SuQCanvas/`、开发代理 `/lan-ws` 到 `ws://127.0.0.1:8790`，以及 Vitest 运行环境。
- `scripts/build.mjs`：构建编排器。支持参数 `online` / `lan` / `all` 或非 TTY 交互选择；调用 `node scripts/copy-pdfjs-assets.mjs` 拷贝 PDF.js 资源；读取 `.env` / `.env.local` / `.env.online` / `.env.online.local` 中的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 并警告缺失；使用 `vite build --mode <mode> --outDir <dist|dist-lan> --emptyOutDir` 分别产出在线版和局域网版。
- `scripts/copy-pdfjs-assets.mjs`：将 `node_modules/pdfjs-dist` 下的 `cmaps`、`standard_fonts`、`wasm` 目录复制到 `public/pdfjs`，供 PDF.js 运行时加载。
- `scripts/package-lan.mjs`：生成可分发的局域网安装包 `release/SuQCanvas-LAN.zip`。清理并重建 `release/SuQCanvas-LAN`，复制 `dist-lan`、`server/lan-server.mjs`、`node_modules/ws`、当前 `node.exe`、`start-lan.bat`、`scripts/start-lan.ps1`、`scripts/open-lan-firewall.ps1`，写入最小 `package.json` 与 `README.txt`，优先用 `tar.exe -a -c -f SuQCanvas-LAN.zip` 压缩，回退到 PowerShell `Compress-Archive`。
- `src/buildMode.ts`：暴露 `IS_LAN_BUILD` / `IS_ONLINE_BUILD` 常量，由构建时 `import.meta.env.VITE_BUILD_TARGET` 决定，被 Vite 替换为字面量后死分支代码会被摇树移除。
- `.env.lan` / `.env.online`：分别设置 `VITE_BUILD_TARGET=lan` 与 `online`，并声明在线版所需的 Supabase/OSS 环境变量模板。
- `server/lan-server.mjs`：基于 Node.js `http` + `ws` 的局域网中继服务器，默认端口 `8790`，数据目录 `server/data`，静态资源根 `dist-lan`，提供项目列表、WebSocket 实时协作、资产 HTTP Range 流式拉取、备份恢复与定期垃圾回收。
- `promo/package.json`：独立子工程，仅依赖 `playwright-core`，通过 `npm run record` 执行 `capture.mjs` 录制宣传片。

## 3. 架构与约定

### 3.1 双模式构建
- 通过 Vite `--mode` 区分 `online` 与 `lan` 两种构建目标，对应输出目录分别为 `dist/` 与 `dist-lan/`。
- 构建前自动执行 `predev` / `predev:lan` 钩子调用 `copy-pdfjs-assets.mjs`，确保 PDF.js 资源可用。
- 在线版构建会检查 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY` 是否存在于 `.env*` 文件中，缺失则打印警告。
- 源码中通过 `src/buildMode.ts` 的 `IS_LAN_BUILD` / `IS_ONLINE_BUILD` 在编译期进行分支裁剪，避免运行时代码膨胀。

### 3.2 产物与部署
- 在线版：`dist/` 静态站点，部署到任意 Web 服务器或 CDN，base 路径为 `/SuQCanvas/`。
- 局域网版：`dist-lan/` 静态站点 + `server/lan-server.mjs` 进程，启动后监听 `0.0.0.0:8790`，自动扫描本机 IPv4 地址并打印局域网访问 URL。
- 安装包：`npm run package:lan` 生成 `release/SuQCanvas-LAN.zip`，内含 Node 运行时、防火墙脚本与说明，双击 `start-lan.bat` 即可在 Windows 上启动。

### 3.3 局域网中继协议约定
- WebSocket 消息以 `t` 字段标识类型：`hello`、`project-list-request`、`join-project`、`leave-project`、`project-save`、`project-delete`、`backup-list-request`、`backup-restore`、`sync`、`viewport`、`cursor`、`editing`、`activity`、`asset-meta`、`asset-chunk`、`asset-thumb`、`asset-request`、`asset-http`。
- 资产存储按 SHA-256(assetId) 命名，每个资产产生 `.json`（元数据）、`.bin`（数据）、`.thumb`（封面）三件套。
- 视频类资产优先通过 HTTP Range 流式拉取（`/SuQCanvas/assets/<id>`），而非整份经 WebSocket 下发，避免局域网带宽打满。
- 项目删除后先备份至 `data/backups/projects/<projectId>_<timestamp>.json`，保留 24 小时后由定时维护任务清理。
- 未引用资产进入“孤儿标记”流程，标记超过 24 小时才真正删除。

### 3.4 开发与调试
- `npm run dev`：在线模式开发，`npm run dev:lan`：局域网模式开发（`--host 0.0.0.0` 暴露到局域网）。
- 开发服务器通过代理将 `/lan-ws` 转发到本地 `ws://127.0.0.1:8790`，配合 `npm run lan` 启动的 LAN 服务器实现联调。
- `npm run preview`：预览已构建产物。

### 3.5 测试与代码质量
- 单元测试通过 `vitest run` 执行，测试环境为 `node`。
- 代码检查通过 `oxlint` 执行。

## 4. 约束与规则

- 构建产物必须通过 `scripts/build.mjs` 统一触发，禁止直接调用 `vite build` 绕过 PDF.js 资源拷贝与环境变量检查。
- 在线版敏感配置（Supabase URL/Key、OSS Region/Bucket/STS URL）必须放入 `.env.online.local`，不得提交到版本库。
- 局域网包的发布结构固定为 `release/SuQCanvas-LAN/{dist-lan, server, node_modules/ws, runtime/node.exe, start-lan.bat, scripts/*}`，压缩包命名为 `SuQCanvas-LAN.zip`。
- LAN 服务器数据目录可通过 `LAN_DATA_DIR` 环境变量覆盖，Web 根目录可通过 `LAN_WEB_ROOT` 覆盖，端口默认 `8790` 可通过 `PORT` 覆盖。
- 资产 ID 必须匹配正则 `^[A-Za-z0-9_-]{1,160}$`，否则服务端拒绝处理。
- 项目删除权限受 `creatorId` 保护：首次保存后只有创建者设备可删除；旧项目无 `creatorId` 时允许任意删除。
- 宣传片录制是独立子工程，位于 `promo/`，通过 `npm run record` 调用 Playwright 录制，不纳入主工程构建流程。

## 5. 适用性判断

本仓库存在完整的构建脚本、多模式构建配置、产物打包脚本与局域网服务，属于典型的 JavaScript/Vite 前端构建系统，因此本类别适用。
