---
kind: dependency_management
name: 基于 npm + lockfile 的依赖管理（主工程与宣传片子工程）
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
---

## 1. 使用的系统与工具

仓库采用 **npm** 作为包管理器，通过 `package.json` 声明依赖、`package-lock.json` 锁定版本，未使用 yarn/pnpm/bun 或其他锁文件格式。构建与开发由 Vite 驱动，TypeScript 编译通过 `tsc -b` 执行。

- 根工程 (`package.json`)：前端应用 + 局域网服务端 + 构建脚本的统一入口。
- 宣传片子工程 (`promo/package.json`)：独立的 Node.js 工程，仅依赖 `playwright-core` 用于录制演示视频。

两个工程各自维护独立的 `node_modules` 与锁文件，不存在跨工程的共享依赖或 monorepo 工具（如 pnpm workspace / lerna / nx）。

## 2. 关键文件

- `package.json`：定义项目名 `suqcanvas`、版本 `1.3.0`、`type: module`，以及所有运行时与开发时依赖。
- `package-lock.json`：npm v3 格式的锁文件，锁定根工程全部依赖的精确版本与校验和。
- `promo/package.json` + `promo/package-lock.json`：宣传片录制子工程的独立依赖声明与锁定。
- `scripts/build.mjs`、`scripts/copy-pdfjs-assets.mjs`、`scripts/package-lan.mjs`：构建期脚本，不引入额外运行时依赖。
- `.env.example`、`.env.lan`、`.env.online`：环境配置，不包含依赖源信息。

## 3. 架构与约定

### 3.1 依赖分类
根工程将依赖明确分为两类：
- **dependencies**（运行时）：`react`、`react-dom`、`@xyflow/react`、`pdfjs-dist`、`dexie`、`zustand`、`ws`、`ali-oss`、`ag-psd`、`fflate`、`react-markdown`、`@supabase/supabase-js`。
- **devDependencies**（构建/测试/类型）：`vite`、`typescript`、`vitest`、`oxlint`、`tailwindcss`、`@vitejs/plugin-react`、`@tailwindcss/vite`、各类 `@types/*`、`fake-indexeddb`。

这种划分使生产产物不包含开发工具链，符合常规的前端工程实践。

### 3.2 版本策略
- 运行时代码使用 `^` 范围符（如 `"react": "^19.2.8"`），允许小版本升级，但通过 `package-lock.json` 在首次安装时固定到具体版本。
- TypeScript 使用波浪号 `~`（`"typescript": "~6.0.2"`），限制补丁级更新，避免破坏编译行为。
- 宣传片子工程对 `playwright-core` 使用精确版本号 `1.62.1`，确保录制行为稳定可复现。

### 3.3 资源与第三方库的“类 vendoring”
仓库没有使用 `vendor/` 或 `third_party/` 目录来 vendoring 代码，但对某些大型二进制/静态资源采用了**直接提交到仓库**的方式：
- `public/pdfjs/`：完整包含 PDF.js 的 `cmaps/`、`standard_fonts/`、`wasm/` 等静态资源，配合 `scripts/copy-pdfjs-assets.mjs` 在 `predev`/`predev:lan` 钩子中复制必要文件。
- `promote/raw/`、`promo/apple/work/photos/` 等目录存放演示素材。

这些资源随源码一起受版本控制，避免了构建时对远程资源的依赖，属于一种“资源级 vendoring”。

### 3.4 私有源与镜像
- 未发现 `.npmrc`、`npm_config_registry` 环境变量或 CI 中的私有 registry 配置。
- `promo/package-lock.json` 中 `resolved` 字段指向 `https://registry.npmjs.org/...`，表明默认使用官方 npm 源。
- 无 `GOPRIVATE`、`GOFLAGS` 等 Go 相关配置（本项目非 Go 工程）。

## 4. 约定与约束

- **每个工作区独立管理依赖**：根工程与 `promo/` 子工程各自拥有独立的 `package.json` 与 `package-lock.json`，互不引用。
- **锁文件必须提交**：`package-lock.json` 存在于根目录与 `promo/` 目录，说明团队要求提交锁文件以保证可重复安装。
- **构建前自动复制 PDF.js 资源**：通过 `predev` 与 `predev:lan` 钩子调用 `scripts/copy-pdfjs-assets.mjs`，确保开发/局域网模式启动前资源就位。
- **生产构建排除 devDependencies**：通过 `build` 脚本顺序执行 `tsc -b && node scripts/build.mjs`，最终产物由 Vite 打包，不包含开发工具链。
- **无全局依赖注入**：所有依赖通过 npm 安装到 `node_modules`，未使用全局安装的 CLI 工具（如全局 `vite`、`typescript`）。
- **Node 版本约束**：宣传片子工程的 `playwright-core` 要求 `node >= 20`，暗示该子工程需在较新的 Node 环境下运行；根工程未显式声明 `engines`，但依赖生态（Vite 8、React 19、TypeScript 6）同样需要较新 Node。

## 5. 总结

该仓库采用最标准的 npm + lockfile 方案管理依赖，结构清晰、职责分离（主工程 vs 宣传片子工程）。对于体积大且不宜动态拉取的 PDF.js 资源，采用“资源级 vendoring”方式直接纳入版本控制，从而保证离线构建与局域网部署的稳定性。未发现私有 registry、monorepo 工具或更复杂的依赖治理机制。