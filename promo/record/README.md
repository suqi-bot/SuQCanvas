# SuQCanvas 产品宣传片 —— 真实应用录制流水线

本目录是一套**可复用的录制流水线**，用于为 SuQCanvas 制作 Apple 发布会风格的产品介绍视频。
它运行**真实应用**（而非动画模拟），加载精心布局的演示项目，用脚本驱动真实功能操作，
配合 Apple 式运镜（缓入缓出推拉）、大字幕卡、黑场转场与背景音乐，逐帧捕获并编码为 MP4。

> 已生成的成片：`promo/record/suqcanvas-promo.mp4`（1920×1080 · 12fps · 约 56 秒 · h264+aac）

## 一、快速开始（一键）

```bash
# 1. 确保已安装 ffmpeg（Windows: winget install Gyan.FFmpeg）
# 2. 从项目根目录运行（会自动构建在线版 + 生成 demo + 启动服务器 + 录制 + 编码 + 停止服务器）
node promo/record/run.mjs
```

参数：

| 参数 | 说明 | 默认 |
|---|---|---|
| `--fps <n>` | 录制帧率 | `12` |
| `--out <path>` | 输出 mp4 路径 | `promo/record/suqcanvas-promo.mp4` |
| `--skip-build` | 跳过 `npm run build:online`（用已有 dist/） | 无 |

## 二、分步手动流程

若想精确控制每一步：

```bash
# 1. 构建在线版（真实应用使用 dist/）
npm run build:online

# 2. 生成演示项目（含真实照片/Markdown/PDF/音频/视频素材与连线布局）
node promo/apple/build-demo.mjs
#    输出：promo/apple/demo.sqcanvas

# 3. 生成背景音乐（把 9s 环境音循环成 60s 并淡入淡出）
ffmpeg -y -stream_loop 6 -i promo/apple/work/ambient-demo.wav \
  -af "afade=t=in:st=0:d=2.5,afade=t=out:st=56:d=4,volume=0.85" \
  -t 60 -ac 2 -ar 44100 promo/record/bgm.wav

# 4. 启动静态服务器（真实应用服务，默认端口 4413）
node promo/record/serve-dist.mjs 4413

# 5. 另一终端运行录制脚本
node promo/record/record.mjs --fps 12 --out promo/record/suqcanvas-promo.mp4

# 6. 停止服务器（Ctrl+C 或访问 /__shutdown__）
```

## 三、架构说明

### 文件清单

| 文件 | 作用 |
|---|---|
| `serve-dist.mjs` | 轻量静态服务器，把 `/SuQCanvas/` 前缀映射到 `dist/`，无需 Vite |
| `promo-bridge.js` | **注入页面的控制桥**：`__promo.cam`（运镜）、`__promo.title`（字幕卡）、`__promo.blank`（黑场）、`__promo.progress`（进度条） |
| `record.mjs` | **主录制脚本**：加载真实应用 → 导入 demo → 逐帧捕获 → ffmpeg 编码 + 混音乐 |
| `run.mjs` | 一键入口，串起构建/生成/服务/录制/停止 |
| `../../apple/build-demo.mjs` | 生成演示项目 demo.sqcanvas（素材+布局+连线） |
| `../../apple/work/` | 素材目录：photos/、ambient-demo.wav、demo-video.mp4 |

### 关键技术点

1. **真实应用 + 游客模式**：在线版未配置 Supabase 时，设置 `localStorage.sq:guest=1` 即进入游客模式，无需登录即可加载本地项目。

2. **加载演示项目**：通过应用的"导入 .sqcanvas"文件输入框注入 `demo.sqcanvas`（Playwright `setInputFiles`），应用内部调用 `importProjectFile` 导入真实素材。

3. **Apple 式运镜**：`promo-bridge.js` 直接插值 `.react-flow__viewport` 的 CSS transform，用 `requestAnimationFrame` + easeOutCubic 实现缓入缓出。`focus(nodeEl, scale)` 通过**世界坐标**反推目标 viewport，保证跨运镜时节点始终居中（这是修复过的关键：用屏幕坐标会因当前缩放导致偏移）。

4. **为什么不用 Playwright recordVideo**：无头 Chromium 的 recordVideo 会产出约 30 秒黑场前导（合成缓冲问题），画面延迟且失真。改用 `page.screenshot` 逐帧捕获（JPEG 比 PNG 快很多，可跟上 12fps），再用 ffmpeg 合成。

5. **字幕卡/黑场**：注入全屏 overlay 层（高 z-index），title 淡入淡出，blank 用于转场，避免深色直接跳到极亮白色。

6. **背景音乐**：`-shortest` 混流把 bgm.wav 与视频对齐。

### 运镜桥 API（promo-bridge.js）

```js
window.__promo.cam.read()                      // 读取当前 viewport {s,tx,ty}
window.__promo.cam.glide(s, tx, ty, dur)       // 平滑运镜到目标 transform
window.__promo.cam.focus(nodeEl, scale, dur)   // 居中到某个节点
window.__promo.title(text, {size,sub,color})   // 显示大字幕卡，返回可 remove() 的对象
window.__promo.blank()                         // 全屏黑场，返回可 clear() 的对象
window.__promo.progress(pct)                   // 顶部进度条（可选）
```

## 四、修改剧本（镜头编排）

`record.mjs` 中的"剧本（时间轴）"段是核心，按镜头组织。每个镜头包含三种动作：

- **运镜**：`focusNode(id, scale, dur)` 或 `glideTo(s, tx, ty, dur)` 或 `fitView()`
- **真实操作**：点击工具按钮、点击/双击节点（如播放音频）、选中边（触发 Inspector）、切换主题
- **字幕/转场**：`title(...)` / `clearTitle()` / `blank()` / `clearBlank()`

新增镜头只需在剧本段按同样模式追加。时长用 `D(秒)` 表示。

调整背景音乐长度需同步：`bgm.wav` 的时长要 ≥ 视频时长。

## 五、演示项目（demo.sqcanvas）

由 `promo/apple/build-demo.mjs` 生成，包含：

- **素材**：6 张真实风景照片（picsum）、1 个 Ken Burns 风景视频、1 份 Markdown 笔记、1 份 PDF 脚本、1 段环境音频
- **节点**：标题、图片 ×6、视频、文本（关键词/引言）、Markdown、便签 ×3、形状 ×2、音频、文件卡
- **连线**：11 条多样式连线（不同颜色/箭头）

修改 `build-demo.mjs` 可调整布局/素材。重新运行即可再生成 `demo.sqcanvas`。

## 六、常见问题

- **下载照片失败**：运行 `node promo/apple/fetch-photos.mjs`（需外网访问 picsum）。
- **没有视频素材**：`demo-video.mp4` 由脚本用照片 + Ken Burns 效果生成；若无则运行 build-demo 前先按第四节重新生成。
- **fps 跟不上**：PNG 截图约 140ms/帧，需用 JPEG（约 60ms）。已默认 JPEG。
- **改动素材后不生效**：删除 `demo.sqcanvas` 重新构建，并清空浏览器 IndexedDB（`localStorage.sq:guest` 与 `suqcanvas` 库），或使用新的浏览器 profile。

## 七、视觉质量说明

本流水线产出的视频**内容正确**（运镜居中、字幕卡、真实应用、背景音乐均验证通过）。
由于生成环境的限制，**自动化视觉审美调优（如字体间距、配色、镜头节奏）需人工观看后微调**：
调整 `record.mjs` 剧本中的运镜缩放 `scale`、字幕 `size`/`color`、各镜头 `D(秒)` 时长即可快速迭代。
