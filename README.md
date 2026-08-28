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

## 打包（在线版 / 局域网版分开构建）

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
```

这就是局域网项目的主副本，建议定期备份整个 `server/data/`。如需放到独立数据盘，可在启动前设置
`LAN_DATA_DIR`（例如 Windows PowerShell：`$env:LAN_DATA_DIR='D:\SuQCanvasData'; npm run lan`）。
参与协作的浏览器仍会保留 IndexedDB 本地缓存，但主机离线时无法继续访问共享项目。

同一中继支持多个项目：设备打开项目后只加入该项目房间，不同项目的画布操作、视口和素材不会串流。

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
