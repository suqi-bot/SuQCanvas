---
kind: dependency_management
name: 基于 npm + Vite 的多包依赖管理（含 PDF.js 资源预拷贝与双构建模式）
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - promo/package.json
    - vite.config.ts
    - scripts/build.mjs
    - scripts/copy-pdfjs-assets.mjs
    - .env.example
    - .env.lan
    - .env.online
---

## 1. 使用的系统/工具

- **包管理器**：npm（通过 `package-lock.json` 锁定版本），仓库根目录与 `promo/` 子目录各有一份独立的 `package.json`，形成两个相互隔离的 Node.js 工程。
- **前端构建器**：Vite（`vite.config.ts` 使用 `@vitejs/plugin-react`、`@tailwindcss/vite`），并通过自定义脚本 `scripts/build.mjs` 驱动多目标构建。
- **运行时依赖**：React 19、Zustand、XState/xyflow、Dexie、pdfjs-dist、ali-oss、supabase-js、ws 等。
- **测试/类型/样式工具链**：TypeScript 6、vitest、oxlint、Tailwind CSS v4。
- **宣传片录制**：`promo/package.json` 单独声明 `playwright-core`，用于自动化录制演示视频。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 根应用依赖声明、脚本入口、版本号（`1.3.0`）、`type: module` |
| `package-lock.json` | 锁定所有依赖精确版本 |
| `promo/package.json` | 宣传片录制工程的独立依赖（仅 `playwright-core`） |
| `vite.config.ts` | Vite/Tailwind/Vitest 配置，定义 `base: '/SuQCanvas/'`、开发代理、测试环境 |
| `scripts/build.mjs` | 统一编排 `online` / `lan` / `all` 三种构建模式，调用 Vite 并输出到 `dist/` 或 `dist-lan/` |
| `scripts/copy-pdfjs-assets.mjs` | 在构建前把 `node_modules/pdfjs-dist` 的 `cmaps`、`standard_fonts`、`wasm` 复制到 `public/pdfjs` |
| `.env.example`、`.env.lan`、`.env.online` | 按环境分离的变量约定（由 `build.mjs` 中的 `loadEnvValue` 顺序读取 `.env` → `.env.local` → `.env.online` → `.env.online.local`） |
| `tsconfig.app.json` / `tsconfig.node.json` | 分别约束前端与 Node 侧 TypeScript 编译选项 |

## 3. 架构与约定

### 3.1 单仓多包结构
仓库采用“一个 Git 仓库、多个 npm 包”的布局：
- 根 `package.json` 管理 SuQCanvas 主应用；
- `promo/package.json` 管理宣传片录制流水线；
- 两者互不引用，各自维护自己的 `node_modules` 与 `package-lock.json`。

### 3.2 依赖来源与私有化策略
- 全部第三方库通过 npm 公共注册表安装，未见 `.npmrc`、`GOPRIVATE` 或私有 registry 配置。
- 对 `pdfjs-dist` 采取**资源预拷贝**策略：构建前运行 `scripts/copy-pdfjs-assets.mjs`，将 PDF.js 的 cmaps、标准字体和 WASM 二进制从 `node_modules/pdfjs-dist` 复制到 `public/pdfjs`，使最终产物可离线部署且不依赖运行时下载。该步骤被嵌入到 `predev`、`predev:lan` 以及 `scripts/build.mjs` 中，确保每次构建都同步最新资源。

### 3.3 构建模式驱动的依赖行为
`scripts/build.mjs` 根据传入参数选择构建目标：
- `online`：输出到 `dist/`，并在构建前检查 `.env.online*` 中是否存在 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`，缺失时打印警告。
- `lan`：输出到 `dist-lan/`，用于局域网分发。
- `all`：依次构建 online 与 lan。
- 通过 `--mode` 传递给 Vite，配合 `src/appVersion.ts`、`src/buildMode.ts` 等源码分支实现不同环境的差异化依赖加载。

### 3.4 环境变量与外部服务依赖
- Supabase 客户端 (`@supabase/supabase-js`) 与 OSS 客户端 (`ali-oss`) 作为运行时依赖引入，凭据通过 `.env.*` 注入，不在代码中硬编码。
- LAN 模式通过 `ws` 模块提供本地 WebSocket 中继（见 `server/lan-server.mjs`），无需公网依赖。

## 4. 约定与约束

- **版本锁定**：所有依赖版本由 `package-lock.json` 锁定，升级需重新生成锁文件以保证可重现构建。
- **ESM 优先**：根与 promo 包的 `package.json` 均声明 `"type": "module"`，所有脚本以 `.mjs` 形式编写并使用 `import`。
- **构建前置钩子**：PDF.js 资源复制通过 `predev` / `predev:lan` 钩子自动执行，开发者只需运行 `npm run dev` 或 `npm run dev:lan` 即可保证资源就绪。
- **环境隔离**：在线版与局域网版的差异通过 `.env.online` / `.env.lan` 及 `build.mjs` 的 `loadEnvValue` 顺序解析实现，禁止在代码中直接读取 `process.env` 以外的变量源。
- **无 vendoring**：除 `public/pdfjs` 下的 PDF.js 静态资源外，未使用 vendor 目录或 git submodule 方式管理第三方代码；所有 JS 依赖均走 npm。
- **子包独立**：`promo/` 是独立 npm 包，不能复用根工程的 `node_modules`，必须单独 `npm install`。

总体而言，该仓库的依赖管理以 npm lockfile 为核心，辅以 Vite 多模式构建脚本与环境变量约定，并通过预拷贝 PDF.js 资源的方式满足离线部署需求。