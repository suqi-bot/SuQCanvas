# SuQCanvas

一款基于浏览器的**无限画布**应用。把图片、视频、音频、PDF、Markdown、文本等各类文件拖到同一张画布上，用连线组织它们的关系，并自动保存在本地。

## 功能特性

- **无限画布**：滚轮缩放、中键拖动视角、左键框选、双击空白新建文本
- **多媒体元素**：拖入即用
  - 图片（PNG / JPG / GIF / WebP / SVG）
  - 视频（MP4 / WebM / MOV，自动抽帧封面，离开视口自动卸载）
  - 音频（MP3 / WAV / OGG，内置播放器：进度 / 音量 / 静音）
  - PDF（首页缩略图 + 多页翻页查看器）
  - Markdown（即时渲染，暗色排版）
  - 纯文本（双击编辑）
  - 其他格式显示为文件卡片
- **连线系统**：节点四边锚点拖拽连接，支持
  - 线型：实线 / 虚线 / 点线
  - 路径：曲线 / 直线 / 阶梯 / 平滑阶梯
  - 箭头：无 / 起点 / 终点 / 双向
  - 颜色、粗细可调，选中后右侧面板批量编辑
- **数据安全**：
  - 所有媒体文件以 Blob 存入浏览器 IndexedDB，500ms 自动保存
  - 多项目管理：新建 / 打开 / 重命名 / 删除
  - 一键导出 `.sqcanvas` 项目文件（zip 打包画布 + 原始媒体），可迁移到任何浏览器导入还原
- **主题**：深色 / 白色主题一键切换，持久化记忆
- **其他**：Ctrl+A 全选、Ctrl+D 复制、Ctrl+V 粘贴图片、F 适应视图、MiniMap、空画布引导

## 快速开始

```bash
npm install
npm run dev      # 开发模式（在线版）
npm run dev:lan  # 开发模式（局域网版）
npm run lint     # oxlint
npm test         # vitest（导入导出往返一致性测试）
```

局域网版首次打开会要求填写中继地址（HTTP 页面默认填入 `ws://当前主机:8790`，HTTPS 页面默认填入 `wss://当前域名/lan-ws`，可手动覆盖）和协作名称；该名称会显示给同一项目中的其他成员。连接成功后会记住配置，之后自动重连；主页的“断开并返回局域网登录”按钮可断开连接并重新填写。连接入口也可通过工具栏右上角的“局域网”面板随时断开/重连。

## Windows 桌面应用

桌面版使用 Electron，首次打开即可创建离线项目，无需 Node.js、浏览器或服务器登录。

```bash
npm install
npm run desktop          # 构建并启动桌面应用
npm run package:desktop  # 构建 Windows x64 安装程序 -> release/desktop/
```

安装程序为 `release/desktop/SuQCanvas-1.3.0-Setup-x64.exe`，支持选择安装位置、桌面快捷方式和 `.sqcanvas` 文件关联。
本地开发若安装环境跳过依赖的安装脚本，先运行 `node node_modules/electron/install.js` 下载 Electron 运行时。

- **本地项目**：自动保存在 `%APPDATA%\SuQCanvas\` 下的应用 IndexedDB 中，项目包含原始素材；安装目录与数据目录分离，更新应用保留数据。
- **在线项目**：打开首页「在线项目」，使用原在线版的邮箱和密码登录，查看该账号的云端项目并下载完整本地副本。下载包含素材、封面与画布关系。编辑后可在画布工具栏或首页本地项目卡片点击「保存到云端」，选择更新原项目或另存为新云端项目。新下载的副本会记住原项目；旧版下载的副本首次保存时需手动选择原项目。保存会先上传素材，再按版本更新画布；云端已有新修改时停止覆盖，可下载最新版本核对或另存为新项目。本地仍自动保存，云端仅手动保存，登录和退出不会改变本地保存位置。
- **服务器项目**：首页右上角点击「连接服务器」，输入 `ws://服务器IP:8790` 或 `wss://域名/lan-ws`，即可查看服务器项目。
- **上传**：在本地项目卡片点击「同步到服务器」。服务器有同 ID 项目时不会覆盖，本版尚不支持增量同步或自动双向同步。
- **下载**：点击服务器项目的「下载到本地」，下载画布、原始素材和封面，生成独立项目与素材 ID。下载完成后可断网使用，服务器修改或删除不会影响该副本。
- **导入与导出**：浏览器已有项目先导出 `.sqcanvas`，再在桌面版导入；支持双击项目文件导入、`Ctrl+O` 打开文件选择器，以及原生导出保存对话框。
- **退出与备份**：关闭窗口前等待项目保存完成，传输中或保存失败时保留窗口。可从「文件 → 打开数据目录」定位数据；备份整个目录前先退出应用，也可直接导出单个项目。

桌面版连接服务器不会自动加入协作房间或上传本地改动。现有局域网网页版继续提供实时协作，中继服务仍需在服务器单独部署。
当前安装包未配置代码签名及自动更新；发布签名和更新服务留待后续配置。

桌面构建默认复用 `.env.online.local` 中的公开连接配置，也可在 `.env.desktop.local` 覆盖：
`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（公开 anon/publishable key）、`VITE_OSS_REGION`、`VITE_OSS_BUCKET`、`VITE_OSS_STS_URL`。
不要配置 Supabase `service_role`/secret key 或永久 OSS AccessKey；桌面素材下载使用当前登录令牌向 STS 服务获取短期凭证。
未配置云端服务时，本地与局域网功能仍可使用。自行部署时，STS 和 OSS CORS 需允许桌面应用源 `suqcanvas://app`。

## 打包网页版（在线版 / 局域网版）

应用分为两个版本，打包时可任选：

- **在线版**：Supabase 账号登录 + 云同步 + OSS 媒体存储，不含局域网协作入口
- **局域网版**：无需登录，首次填写中继地址和设备名称后进入画布；项目按房间实时协作，并持久保存到运行中继服务的局域网主机

```bash
npm run build         # 交互选择：1) 在线版 2) 局域网版 3) 全部
npm run build:online  # 仅在线版   -> dist/
npm run build:lan     # 仅局域网版 -> dist-lan/
npm run package:lan   # 生成本地一键启动包和 ZIP -> release/
npm run build:all     # 两个都构建
npm run preview       # 预览 dist/ 生产构建
```

构建模式由 `.env.online` / `.env.lan` 中的 `VITE_BUILD_TARGET` 控制。
在线版的真实密钥请写入 `.env.online.local`（已被 git 忽略），不要提交到仓库。

本地包包含 Windows Node 运行时，解压后双击 `start-lan.bat` 即可同时启动网页和协作服务，无需安装依赖。首次启动会请求 Windows
防火墙权限；同一局域网的其他设备打开窗口中显示的地址即可加入，项目数据保存在包内 `server/data/`。

## 服务器部署局域网协作

局域网版上传 `dist-lan/` 静态文件即可使用（无需账号）。但仅上传静态文件不包含局域网中继服务，
服务器还需要保留 `server/`、`package.json` 和 `package-lock.json`，安装依赖并单独启动中继：

```bash
npm ci --omit=dev
npm run lan
# 或用 PM2 守护：pm2 start server/lan-server.mjs --name suqcanvas-lan

# Windows 首次部署时放行局域网中继端口（会弹出 UAC，仅允许本地子网访问）
npm run lan:open
```

局域网共享项目和素材默认保存在开启中继服务的设备：

```text
server/data/projects.json  # 共享项目数据
server/data/assets/        # 项目素材
server/data/backups/       # 已删除项目的 24 小时备份
```

**项目所有权与保留策略：**

- 项目首次保存时由中继盖章创建者（设备 ID 持久化在浏览器 localStorage），只有创建者可以删除项目
- 删除项目时，服务器自动在 `backups/` 目录保留 24 小时备份，超期后由维护任务自动清理
- 未被任何项目引用的素材同样保留 24 小时后清理；重新被引用则自动取消清理标记
- 本地 IndexedDB 中的素材也遵循相同的 24 小时宽限期
- 误删项目可在首页点击「恢复已删除」查看 24 小时内的备份并一键恢复，仅创建者可操作

这就是局域网项目的主副本，建议定期备份整个 `server/data/`。如需放到独立数据盘，可在启动前设置
`LAN_DATA_DIR`（例如 Windows PowerShell：`$env:LAN_DATA_DIR='D:\SuQCanvasData'; npm run lan`）。
参与协作的浏览器仍会保留 IndexedDB 本地缓存，但主机离线时无法继续访问共享项目。

同一中继支持多个项目：设备打开项目后只加入该项目房间，不同项目的画布操作、视口和素材不会串流。

**将浏览器本地项目同步到服务器：**连接局域网服务器后，在首页尚未共享的项目卡片上点击「同步到服务器」。
应用会上传画布、引用的原始素材和封面，显示上传进度，并在服务器保存完成后将项目显示为共享项目；本地副本保留。
同步其他项目不会切换当前画布。素材缺失或网络中断会提示失败，可补齐素材或重连后重试。
服务器已存在相同 ID 的项目时拒绝覆盖，请打开共享项目继续编辑。此功能需要同时更新网页和 `server/lan-server.mjs` 并重启中继。

网页使用 HTTPS 时，浏览器会禁止连接 `ws://`。生产环境应让中继运行在服务器的 `8790` 端口，
不直接暴露公网，再由站点域名反向代理为 `wss://`。以宝塔站点的 Nginx 为例，在对应的 `server {}` 内加入：

```nginx
location /lan-ws {
    proxy_pass http://127.0.0.1:8790;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# 视频封面抓帧/列表封面走局域网素材 HTTP 流式拉流，同样需要反代到中继，
# 否则跨域读取素材跨域头缺失、封面无法生成（视频播放不受影响）
location /SuQCanvas/assets/ {
    proxy_pass http://127.0.0.1:8790;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

重载 Nginx 后，应用会默认连接 `wss://当前域名/lan-ws`，无需开放公网 `8790` 端口。若构建时需要使用其他地址，可在 `.env.lan` 中设置 `VITE_LAN_WS_URL` 后重新执行 `npm run build:lan`。局域网直连时（HTTP 页面）应用会默认连接 `ws://当前主机:8790`。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | React 19 + TypeScript + Vite 8 |
| 画布引擎 | @xyflow/react (React Flow v12) |
| 状态 | Zustand |
| 本地存储 | Dexie (IndexedDB) + fflate (zip 打包) |
| PDF | pdfjs-dist（懒加载分包） |
| Markdown | react-markdown |
| 样式 | Tailwind CSS v4 + CSS 变量主题令牌 |

## 目录结构

```
src/
  canvas/            # 画布与节点
    nodes/           # ImageNode / VideoNode / AudioNode / TextNode
                     # PdfNode / MarkdownNode / FileCardNode + 外壳
    edges/           # StyledEdge（多样式自定义边）
    CanvasBoard.tsx  # 拖放 / 粘贴 / 快捷键 / 主题
  store/             # canvasStore / projectStore / uiStore / settingsStore
  db/                # Dexie schema（assets + projects）
  io/                # 文件识别导入 / .sqcanvas 导出导入
  media/             # Blob URL 注册表 / pdf.js 封装
  components/        # 工具栏 / Inspector / 项目管理 / PDF 查看器 / Toast
```

## 快捷键

| 按键 | 功能 |
|---|---|
| 左键拖动空白 | 框选 |
| 左键拖动元素 | 移动元素 |
| 中键拖动 | 平移视角 |
| 滚轮 / Ctrl+滚轮 | 缩放 |
| 双击空白 | 新建文本 |
| Ctrl+A / Ctrl+D | 全选 / 复制选中 |
| Ctrl+V | 粘贴剪贴板图片 |
| F | 适应视图 |
| Delete / Backspace | 删除选中 |

## 路线图

- [x] 媒体节点（图片 / 视频 / 音频 / 文件卡片）
- [x] 文本 / PDF / Markdown 节点
- [x] 连线 + 多样式 + Inspector 面板
- [x] 自动保存 + 项目管理 + 导出导入
- [x] 深色 / 白色主题
- [ ] Word / Excel / PPT 预览
- [ ] 分组 / 容器
- [ ] 对齐参考线
- [x] 局域网多人协作与主机持久化

## License

MIT
