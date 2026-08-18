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
npm run dev      # 开发模式
npm run build    # 生产构建（tsc + vite）
npm run preview  # 预览生产构建
npm run lint     # oxlint
npm test         # vitest（导入导出往返一致性测试）
```

## 宝塔部署局域网协作

只上传 `dist` 静态文件不包含局域网中继服务。服务器还需要保留 `server/`、`package.json` 和
`package-lock.json`，安装依赖并单独启动中继：

```bash
npm ci --omit=dev
npm run lan
# 或用 PM2 守护：pm2 start server/lan-server.mjs --name suqcanvas-lan
```

网页使用 HTTPS 时，浏览器会禁止连接 `ws://`。生产环境应让中继运行在服务器的 `8790` 端口，
不直接暴露公网，再由站点域名反向代理为 `wss://`。

在宝塔站点的 Nginx 配置中加入（放在对应的 `server {}` 内）：

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
```

重载 Nginx 后，应用会默认连接 `wss://当前域名/lan-ws`，无需开放公网 `8790` 端口。若构建时需要使用其他地址，可设置 `VITE_LAN_WS_URL` 后重新执行 `npm run build`。

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
- [ ] 协作分享

## License

MIT
