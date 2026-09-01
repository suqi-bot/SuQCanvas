---
kind: logging_system
name: 基于原生 console 的轻量日志输出（无统一日志框架）
category: logging_system
scope:
    - '**'
source_files:
    - server/lan-server.mjs
    - scripts/build.mjs
    - promo/capture.mjs
    - promo/record/record.mjs
    - promo/record/run.mjs
    - promo/record/serve-dist.mjs
    - promo/apple/build-demo.mjs
    - promo/apple/fetch-photos.mjs
---

## 1. 使用的系统/方法

仓库没有引入任何第三方日志框架（如 winston、pino、bunyan、log4js 等），也没有自定义 logger 模块。前后端全部使用 Node.js / 浏览器原生的 `console.log`、`console.warn`、`console.error` 直接输出日志。

- 前端（`src/`）：未发现任何 `console.*` 调用，也未发现 import 了日志库；前端通过 Zustand store 与 UI 组件交互，错误处理以状态反馈为主，不主动写日志。
- 局域网服务器（`server/lan-server.mjs`）：所有运行期日志均通过 `console.log` / `console.warn` / `console.error` 输出，并以 `[SuQCanvas LAN]` 作为统一前缀。
- 构建与宣传片脚本（`scripts/build.mjs`、`promo/**/*.mjs`）：同样直接使用 `console.log` / `console.warn` / `console.error`，部分脚本用 `▶` 符号标记步骤。

## 2. 关键文件

- `server/lan-server.mjs`：局域网协作服务端，集中承载所有业务日志（项目加载失败、资产 GC、备份清理、WebSocket 消息处理异常等）。
- `scripts/build.mjs`：Vite 在线/局域网双版本构建入口，输出构建阶段提示与缺失环境变量警告。
- `promo/capture.mjs`、`promo/record/*.mjs`、`promo/apple/*.mjs`：宣传片录制流水线中的 ffmpeg、Playwright、资源下载等步骤日志。

## 3. 架构与约定

### 日志级别策略
采用最基础的三级区分：
- `console.log`：正常流程信息（启动地址、数据目录、构建进度、帧捕获计数、过期备份删除、孤儿资产删除等）。
- `console.warn`：可恢复或降级场景（加载 projects.json 失败、保存 orphan marks 失败、扫描 assets 失败、ffmpeg libx264 不可用退回 mpeg4、混流背景音乐失败输出无声视频等）。
- `console.error`：严重错误（未找到 ffmpeg、保存项目失败、保存 orphan marks 失败等）。

### 结构化字段
没有 JSON 结构化日志。唯一的形式化结构是**统一前缀**：局域网服务端的每条日志都以 `[SuQCanvas LAN]` 开头，便于在终端中过滤该服务的输出。

### 输出目标
所有日志都输出到标准输出/标准错误，由进程管理器或终端负责收集。没有配置文件、没有 sink 抽象、没有按模块路由。

### 前端日志
前端代码中未出现 `console.*` 调用，说明当前版本有意不在浏览器侧产生运行时日志；若需要调试，应通过浏览器开发者工具控制台查看。

## 4. 约定与约束

- **无前缀规范**：仅局域网服务端强制使用 `[SuQCanvas LAN]` 前缀；构建脚本和宣传片脚本各自随意使用文本前缀（如 `▶`、`[pageerror]`、`[serve-dist]`），没有跨脚本的统一前缀约定。
- **无日志开关**：不存在环境变量控制日志级别或关闭日志（例如没有 `LOG_LEVEL`、`DEBUG` 等变量）。
- **无异步日志队列**：所有 `console.*` 调用都是同步阻塞式写入，未做缓冲或批处理。
- **错误路径仍走 console**：即使是在 Promise `.catch` 中，也继续使用 `console.warn` / `console.error` 记录错误，而不是抛出或静默忽略。
- **文档约束**：`docs/LEARNING.md` 中有一条关于云失败的策略说明“云失败仅 console.warn（不阻塞本地保存，离线可用）”，体现了对 warn 级别的语义约定——用于非致命、可降级的问题。

总结：这是一个极简的日志体系——没有框架、没有配置、没有结构化格式，仅靠 `console.*` + 局域网服务端的 `[SuQCanvas LAN]` 前缀来组织输出，适用于单进程局域网服务与少量 Node 脚本的调试与运维场景。