---
kind: dependency_management
name: 基于 npm + lockfile 的多包依赖管理（前端应用与宣传片脚本）
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - promo/package.json
    - promo/package-lock.json
    - scripts/copy-pdfjs-assets.mjs
    - scripts/build.mjs
    - scripts/package-lan.mjs
    - server/lan-server.mjs
    - supabase/functions/oss-sts/index.ts
---

## 1. 使用的系统与工具

- **包管理器**：npm（通过 `package-lock.json` lockfileVersion 3 确认），仓库内未发现 pnpm、yarn、bun 等替代工具的 manifest。
- **构建/开发工具链**：Vite 8 + TypeScript 6 + Vitest，均作为 devDependencies 声明在根 `package.json`。
- **私有/第三方注册表**：未检出 `.npmrc`、`NPM_CONFIG_REGISTRY` 或 `npm_config_registry` 配置；所有 `resolved` URL 指向 `https://registry.npmjs.org`，即默认公共 npm 源。无私有 registry 或镜像站配置。
- **vendoring**：项目不 vendoring 任何 JS 依赖；但将 PDF.js 的 cmaps、standard_fonts、wasm 等资源以静态文件形式直接放入 `public/pdfjs/`，由 `scripts/copy-pdfjs-assets.mjs` 在 `predev` / `predev:lan` 钩子中拷贝进构建产物，属于“资源级 vendoring”。

## 2. 关键文件

- `package.json`：根工程依赖清单，定义 `suqcanvas` 应用的运行时依赖（如 `react`、`@xyflow/react`、`pdfjs-dist`、`ali-oss`、`dexie`、`zustand`、`ws`、`@supabase/supabase-js`、`ag-psd`、`fflate`、`react-markdown`）及开发依赖（vite、typescript、vitest、oxlint、tailwindcss 等）。
- `package-lock.json`：锁定全部依赖树版本与完整性校验 hash，确保多环境安装一致。
- `promo/package.json` + `promo/package-lock.json`：独立子包 `suqcanvas-promo-video`，仅依赖 `playwright-core` 用于录制 Apple 风格宣传片。
- `scripts/copy-pdfjs-assets.mjs`：构建前把 `node_modules/pdfjs-dist` 中的 cmaps/fonts/wasm 复制到 `public/pdfjs/`，使 PDF.js 资源随静态资源一起发布。
- `scripts/build.mjs`、`scripts/package-lan.mjs`：根据 `--mode lan` / `online` 输出不同构建产物，并打包局域网分发包。
- `server/lan-server.mjs`：局域网运行时 Node 服务，使用 `ws` 提供 WebSocket 中继。
- `supabase/functions/oss-sts/index.ts`：Supabase Edge Function，使用 Deno 运行时 `serve` 从 `https://deno.land/std...` 引入标准库，是仓库中唯一的 Deno 依赖来源。

## 3. 架构与约定

- **单仓多包**：根目录维护主应用依赖，`promo/` 子目录维护独立的宣传片脚本依赖，两者互不共享 node_modules，各自拥有独立的 `package.json` 与 `package-lock.json`。
- **版本范围策略**：运行时依赖普遍使用 `^` 语义化版本范围（如 `react ^19.2.8`、`vite ^8.2.0`、`pdfjs-dist ^6.2.108`），而 `typescript` 使用 `~6.0.2` 进行补丁级锁定；实际可复现版本由 `package-lock.json` 固化。
- **构建前置脚本**：通过 `predev` / `predev:lan` 自动执行 PDF.js 资源拷贝，避免手动同步资源导致构建不一致。
- **环境变量隔离**：`.env.example`、`.env.lan`、`.env.online` 分别对应不同部署环境的配置，配合 Vite 的 `--mode` 切换。
- **Deno 边缘函数**：Supabase Edge Function 通过 HTTP 导入 Deno std 模块，不纳入 npm 依赖体系，需单独运行 Deno runtime。

## 4. 约定与约束

- **必须提交 lockfile**：根与 `promo/` 均提交 `package-lock.json`，禁止只提交 `package.json` 而不提交 lockfile，以保证 CI/本地安装结果可重现。
- **新增依赖需同时更新 lockfile**：通过 `npm install` 而非手工编辑 `package.json` 来添加/升级依赖，确保 `package-lock.json` 与依赖树一致。
- **PDF.js 资源必须随构建产出**：任何改动若影响 `pdfjs-dist` 版本，需重新执行 `predev` 钩子以同步 `public/pdfjs/` 下的 cmaps/fonts/wasm，否则 PDF 渲染会缺失资源。
- **局域网包构建顺序固定**：`package:lan` 先执行 `build:lan`（tsc + vite 构建），再调用 `scripts/package-lan.mjs` 打包，不可跳过 tsc 步骤。
- **无私有 registry**：当前仓库完全依赖公共 npm 源，若未来引入私有包，需在 `.npmrc` 或 CI 环境变量中配置 `registry`/`//registry.../:_authToken`。
- **pnpm/yarn 不被使用**：`.gitignore` 中虽列出 `pnpm-debug.log*`、`yarn-debug.log*` 等日志模式，但仓库中不存在 `pnpm-lock.yaml`、`yarn.lock`，表明这些只是通用忽略规则，实际强制使用 npm。
