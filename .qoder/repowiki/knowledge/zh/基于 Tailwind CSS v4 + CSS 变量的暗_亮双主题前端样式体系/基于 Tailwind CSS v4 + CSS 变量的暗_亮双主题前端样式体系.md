---
kind: frontend_style
name: 基于 Tailwind CSS v4 + CSS 变量的暗/亮双主题前端样式体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/index.css
    - vite.config.ts
    - package.json
    - src/App.tsx
---

## 1. 使用的系统与工具
- 构建与样式管线：Vite + `@vitejs/plugin-react`，通过 `@tailwindcss/vite`（Tailwind CSS v4）注入样式。
- 样式语言：纯 CSS + Tailwind 原子类；无 SCSS/Less/Sass 预处理。
- 主题系统：以 CSS Custom Properties（CSS 变量）为核心设计令牌，配合 Tailwind v4 的 `@theme inline` 将变量映射为 `color-*` 语义化 token。
- 运行时主题切换：在 `<html>` 上切换 `.light` 类名即可切换整套配色，实现暗色默认 + 亮色可选的双主题。
- 第三方 UI 定制：对 React Flow（`react-flow__*`）、PDF.js、Toast 等外部组件进行覆盖式样式适配。

## 2. 关键文件
- `src/index.css`：唯一全局样式入口，集中定义 Tailwind theme、CSS 变量、动画、Markdown 渲染样式、播放器视觉特效以及 React Flow 覆盖样式。
- `vite.config.ts`：注册 `tailwindcss()` 插件，并设置应用 base 路径 `/SuQCanvas/`。
- `package.json`：声明 `tailwindcss ^4.3.3`、`@tailwindcss/vite ^4.3.3`、`@vitejs/plugin-react`、`react`、`@xyflow/react` 等依赖。
- `src/App.tsx`：示例展示如何使用 Tailwind 原子类（`bg-app`、`text-main`、`flex`、`items-center`、`rounded-xl`、`shadow-2xl`、`animate-spin` 等）组合布局。

## 3. 架构与设计约定
### 3.1 设计令牌（Design Tokens）
所有颜色、边框、阴影、透明度等视觉值均通过 CSS 变量集中管理，集中在 `:root` 下，并按用途分组：
- 基础色板：`--app`（页面背景）、`--panel` / `--panel2`（面板背景）、`--hover`（悬停态）、`--main` / `--soft` / `--mid` / `--dim` / `--faint`（文字层级）、`--edge` / `--edge2`（描边）。
- 画布节点：`--nodebg`、`--nodebar`、`--nodebarline`、`--dot`、`--handlering`。
- 代码块与 Markdown：`--codebg`、`--codefg`、`--prebg`、`--preborder`、`--precode`、`--mdtext`、`--mdhead`、`--mdlink`、`--mdborder`、`--quoteline`、`--quotetext`。
- 控件：`--ctrlbg`、`--ctrlborder`、`--ctrlfg`。
- 媒体播放：`--sq-track`、`--sq-thumb`、`--sq-accent`（组件级可覆盖的强调色）。
- Toast：`--toastinfo-*`、`--toastok-*`、`--toasterr-*` 三套信息/成功/错误配色。
- 遮罩与叠加：`--well`、`--minibg`、`--minimask`、`--overlay`。

这些变量通过 Tailwind v4 的 `@theme inline { --color-*: var(--xxx); }` 暴露为 `color-app`、`color-panel`、`color-main` 等 Tailwind 语义类，从而在 JSX 中可直接写 `bg-app`、`text-main`、`border-edge` 等原子类。

### 3.2 暗/亮双主题策略
- 默认暗色主题定义在 `:root`。
- 亮色主题通过 `html.light` 选择器重写全部相关变量，保持同一组 token 名称不变，仅替换色值。
- 主题切换由上层逻辑（未在本文档范围内）控制 `<html>` 的 `.light` 类。

### 3.3 响应式与布局
- 未使用 Tailwind 断点或容器查询；布局主要依赖 Flexbox（`flex`、`h-full`、`flex-col`、`flex-1`、`min-h-0`、`items-center`、`justify-center`）。
- 画布区域通过 `min-h-0 flex-1` 确保在父容器内正确伸缩。
- 全局滚动行为通过 `overscroll-behavior: none` 禁用回弹。

### 3.4 组件级样式约定
- 自定义类名前缀统一使用 `sq-`（如 `.sq-toast`、`.sq-disc`、`.sq-range`、`.sq-markdown`、`.sq-lyric`、`.sq-handle`、`.sq-connect-mode`、`.sq-select-mode`、`.sq-drag-mode`），避免与第三方库冲突。
- 对 React Flow 的覆盖类名直接命中其内置 class（`react-flow__node`、`react-flow__controls-button`、`react-flow__pane` 等），并通过 `.sq-select-mode`、`.sq-connect-mode`、`.sq-drag-active` 等状态类组合控制不同交互模式下的光标与高亮。
- 媒体播放器视觉特效集中在 `index.css`：唱片旋转（`sq-spin`）、均衡器跳动（`sq-eq-bounce`）、频谱条（`sq-vis-bounce`）、歌词发光与倒影（`sq-lyric-glow`、`sq-lyric-mirror`）、唱片纹理与光晕（`sq-disc-grooves`、`sq-disc-shine`、`sq-disc-halo`）。

### 3.5 第三方样式覆盖
- React Flow：隐藏 attribution、调整 node 拖拽光标、控制面板按钮背景/边框/颜色、连接手柄尺寸与可见性。
- PDF.js：通过 `public/pdfjs` 提供字体与 CMap 资源，样式层面无额外覆盖。
- Toast：自定义 `.sq-toast-info/success/error` 三态样式，使用设计令牌中的 toast 变量。

## 4. 约定与约束
- **颜色来源**：所有颜色必须来自 `src/index.css` 中定义的 CSS 变量，禁止在组件中硬编码十六进制色值（除少数强调色如 `#38bdf8` 作为 accent 兜底外）。
- **主题一致性**：新增颜色必须同时出现在暗色 `:root` 和亮色 `html.light` 两套变量中，保证主题切换后不出现缺失色。
- **命名规范**：项目自定义 CSS 类统一使用 `sq-` 前缀；React Flow 覆盖类直接使用其官方 class 名；Tailwind 原子类优先于手写 CSS。
- **动画与性能**：频繁动画元素使用 `will-change: transform` 提示浏览器优化（如 `.sq-disc`、`.sq-handle`、`.sq-disc-halo`）。
- **Tailwind 版本**：使用 Tailwind CSS v4 的 `@import 'tailwindcss'` 与 `@theme inline` 语法，而非 v3 的 `tailwind.config.*` 配置文件。
- **构建产物**：样式由 Vite 在开发/构建时编译进 bundle，无独立 CSS 文件输出；base 路径固定为 `/SuQCanvas/`，部署时需考虑子目录路径。
- **无预处理器**：仓库中未发现 `.scss`、`.less`、`.sass` 文件，也不存在 PostCSS 配置；样式即 CSS + Tailwind。