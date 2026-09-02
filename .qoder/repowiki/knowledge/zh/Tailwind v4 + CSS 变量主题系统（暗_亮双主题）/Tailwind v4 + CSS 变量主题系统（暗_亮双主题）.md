---
kind: frontend_style
name: Tailwind v4 + CSS 变量主题系统（暗/亮双主题）
category: frontend_style
scope:
    - '**'
source_files:
    - src/index.css
    - vite.config.ts
    - package.json
    - src/components/Toolbar.tsx
    - src/canvas/nodes/textStyle.ts
---

## 1. 使用的系统与工具

- **构建器**：Vite 8，通过 `@vitejs/plugin-react` 提供 React 支持。
- **样式框架**：**Tailwind CSS v4**（`tailwindcss ^4.3.3` + `@tailwindcss/vite ^4.3.3`），在 `vite.config.ts` 中以插件形式启用，并通过 `@import 'tailwindcss'` 引入。
- **主题方案**：纯 CSS 自定义属性（CSS Variables）+ Tailwind `@theme inline` 声明，实现**暗色（默认）**与**亮色（`html.light`）**两套主题。
- **UI 组件库**：无外部 UI 组件库；画布基于 `@xyflow/react`（React Flow），其余全部手写。
- **字体**：`PingFang SC`、`Microsoft YaHei`、`system-ui`、`-apple-system` 的无衬线字体栈。

## 2. 核心文件

| 文件 | 作用 |
|---|---|
| `src/index.css` | 全局样式入口：Tailwind 导入、`@theme inline` 设计令牌、`:root` 与 `html.light` 双主题变量、所有业务类（`.sq-*`）、React Flow 覆盖、Markdown / Toast / 播放器动画等 |
| `vite.config.ts` | 接入 `@tailwindcss/vite`，设置 `base: '/SuQCanvas/'` 与开发代理 |
| `package.json` | 声明 `tailwindcss`、`@tailwindcss/vite`、`@xyflow/react`、`react-markdown` 等依赖 |
| `src/components/Toolbar.tsx` | 典型使用 Tailwind 原子类的组件示例（如 `bg-panel`、`text-soft`、`hover:bg-hover`、`rounded-md`、`border-edge` 等） |
| `src/canvas/nodes/textStyle.ts` | 将节点数据映射为内联 `CSSProperties`（字号、颜色、粗细、下划线等），作为“行内样式”补充 |

## 3. 架构与设计约定

### 3.1 设计令牌（Design Tokens）

所有视觉常量集中在 `src/index.css` 中，通过 CSS 变量暴露给 Tailwind 和组件：

- 通过 `@theme inline { --color-app: var(--app); ... }` 将 `--app`、`--panel`、`--panel2`、`--hover`、`--edge`、`--edge2`、`--main`、`--soft`、`--mid`、`--dim`、`--faint` 等映射为 Tailwind 的 `color-*` 语义令牌，从而可在 JSX 中直接使用 `bg-panel`、`text-main`、`border-edge` 等类名。
- 业务专用变量（如 `--nodebg`、`--overlay`、`--accenttext`、`--codebg`、`--toastinfo-bg`、`--sq-track`、`--sq-thumb`、`--sq-accent` 等）供 `.sq-*` 类及内联样式引用。

### 3.2 暗/亮双主题

- 默认根节点使用深色调色板（`--app: #020617` 等）。
- 当 `<html class="light">` 时，同一组变量被覆写为浅色值，形成完整的亮色主题。
- 主题切换由 `settingsStore` 中的 `theme` / `toggleTheme` 驱动（见 `Toolbar.tsx` 中对 `useSettingsStore` 的使用）。

### 3.3 样式组织方式

- **全局层**：`src/index.css` 集中管理主题变量、全局 reset（`html, body, #root { height: 100% }`）、滚动条隐藏、字体、以及所有跨组件共享的 `.sq-*` 类。
- **原子类层**：组件 JSX 中大量使用 Tailwind 原子类进行布局、间距、圆角、边框、文字颜色等（如 `flex h-12 shrink-0 items-center gap-1 border-b border-edge bg-panel px-3`）。
- **组件内联样式**：对于随数据动态变化的样式（文本对齐、字号、字体、颜色、粗细、斜体、下划线、行高），通过 `buildTextStyle` 生成 `CSSProperties` 注入，避免在 JSX 中堆砌条件类名。
- **第三方样式覆盖**：对 `@xyflow/react` 的 `.react-flow__*` 类进行覆盖（节点光标、控制按钮背景/边框/文字色、选择模式下的 cursor 行为等）。

### 3.4 交互状态类约定

项目通过向 `<body>` 或容器添加特定 class 来切换画布交互模式，并配合 CSS 改变光标与连接热区：

- `.sq-select-mode`：选择模式，禁用抓取光标。
- `.sq-connect-mode`：连线模式，四边扩展连接热区（`.sq-handle-strip`），悬停/拖拽时高亮。
- `.sq-drag-mode`：拖动模式，pane 显示 grab/grabbing 光标。
- `.sq-drag-active`：拖拽复制模式，cursor 变为 copy。

这些 class 由 JS 状态驱动，CSS 仅负责表现。

### 3.5 动画与动效

- 统一使用 CSS `@keyframes` 定义：唱片旋转 (`sq-spin`)、均衡器跳动 (`sq-eq-bounce`)、频谱可视化 (`sq-vis-bounce`)、光晕呼吸 (`sq-halo-breathe`)、专辑淡入 (`sq-album-fade`) 等。
- 关键帧集中在 `src/index.css`，组件通过组合 class（如 `.sq-disc` + `.sq-disc-paused`）控制播放/暂停。

## 4. 约定与约束

- **禁止硬编码颜色**：除极个别固定强调色（如 `#38bdf8` 作为 accent/sky 系）外，所有界面颜色应通过 `var(--*)` 或 Tailwind 语义令牌引用，以保证暗/亮主题一致生效。
- **主题切换通过 `html.light`**：亮色主题通过给 `<html>` 添加 `light` class 触发，新增主题变量时应同时维护暗色与亮色两组赋值。
- **业务类前缀**：项目自有的通用样式类统一以 `.sq-` 开头（如 `.sq-toast-info`、`.sq-range`、`.sq-markdown`、`.sq-disc`、`.sq-handle`、`.sq-connect-mode` 等），避免与第三方库冲突。
- **React Flow 覆盖范围**：仅覆盖必要的 `.react-flow__*` 类（节点光标、controls 按钮、选择/连线模式光标），不重写其布局结构。
- **响应式策略**：未使用媒体查询；布局主要依赖 Flexbox 与 Tailwind 原子类（如 `h-12`、`shrink-0`、`overflow-x-auto`、`truncate`），适配不同屏幕尺寸。
- **Markdown 渲染样式**：通过 `.sq-markdown` 命名空间统一样式化 `react-markdown` 输出，包括标题、列表、代码块、引用、链接、表格等。
- **Toast 样式**：通过 `.sq-toast` 基类 + `.sq-toast-info/.success/.error` 变体区分信息/成功/错误三种状态，颜色来自主题变量。

## 5. 总结

该项目采用 **Tailwind CSS v4 + CSS 变量主题** 的前端风格体系：设计令牌集中声明于 `src/index.css`，通过 `@theme inline` 暴露给 Tailwind 原子类，再以 `html.light` 切换暗/亮双主题；业务样式以 `.sq-*` 命名空间组织，React Flow 等第三方样式按需覆盖；动画集中于 CSS keyframes，组件通过 class 组合控制状态。整体风格简洁、现代、可主题化，且无外部 UI 组件库依赖。