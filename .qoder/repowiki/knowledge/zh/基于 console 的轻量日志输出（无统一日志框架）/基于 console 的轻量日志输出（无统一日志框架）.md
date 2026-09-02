---
kind: logging_system
name: 基于 console 的轻量日志输出（无统一日志框架）
category: logging_system
scope:
    - '**'
source_files:
    - server/lan-server.mjs
    - promo/record/record.mjs
    - promo/capture.mjs
    - promo/apple/build-demo.mjs
    - promo/apple/fetch-photos.mjs
    - docs/LEARNING.md
---

## 1. 使用的系统/方案

仓库没有引入任何第三方日志库或结构化日志框架。前端（`src/`）与构建脚本中未出现 `console.log/warn/error/info/debug` 调用，也没有自定义 logger 模块；后端局域网服务器 `server/lan-server.mjs` 直接使用 Node.js 内置的 `console.log`、`console.warn`、`console.error` 进行输出。

## 2. 关键文件

- `server/lan-server.mjs`：唯一集中使用日志输出的核心文件，所有业务日志均在此处通过 `console.*` 打印。
- `promo/record/record.mjs`、`promo/capture.mjs`、`promo/apple/*.mjs`：宣传片录制脚本，同样使用裸 `console.*` 输出进度与错误信息。
- `docs/LEARNING.md`：文档中提到“云失败仅 console.warn（不阻塞本地保存，离线可用）”，体现了对前端错误处理与日志级别的使用约定。

## 3. 架构与约定

### 日志前缀规范
所有服务器端日志统一以 `[SuQCanvas LAN]` 作为行首前缀，便于在终端中过滤和识别来源，例如：
- `[SuQCanvas LAN] Failed to load projects: ...`
- `[SuQCanvas LAN] Expired backup removed: ...`
- `[SuQCanvas LAN] Orphaned asset deleted: ...`
- `[SuQCanvas LAN] Server: http://0.0.0.0:8790/SuQCanvas/`

### 日志级别使用
- `console.log`：用于启动信息、正常业务流程事件（如备份清理、资产回收、服务监听地址等）。`runMaintenance` 中的过期备份删除、孤儿资产删除、以及启动时打印端口与数据目录路径均使用 `log`。
- `console.warn`：用于可恢复的错误或降级场景，如加载项目/孤儿标记文件失败、写入备份失败、封面缓存失败、ffmpeg 混流失败等。这些调用通常包裹在 try/catch 中，warn 后继续执行后续逻辑。
- `console.error`：用于不可恢复或严重错误，如保存项目失败、HTTP 500 响应、缺少 ffmpeg 等致命问题。

### 日志内容结构
日志采用**人类可读的字符串拼接**形式，而非 JSON 结构化格式。每条日志包含：
- 固定前缀 `[SuQCanvas LAN]`
- 简要描述性消息
- 相关上下文（如文件名、assetId、projectId、错误对象）

### 前端日志策略
前端代码（`src/`）中未发现任何 `console.*` 调用，说明当前版本的前端不主动输出调试日志。根据 `docs/LEARNING.md` 的描述，云端同步失败时使用 `console.warn` 且不影响本地保存，体现“非阻塞式警告”的设计意图。

### 构建/脚本日志
宣传片生成脚本（`promo/`）使用更随意的 `console.log/warn/error` 输出，带有简单的阶段标识（如 `▶` 符号），主要用于录制流水线的人机交互反馈，不属于应用运行时日志。

## 4. 约定与约束

- **无前缀则无法区分来源**：由于只有 `server/lan-server.mjs` 使用 `[SuQCanvas LAN]` 前缀，其他位置（如 promo 脚本）的日志缺乏统一前缀，依赖调用者自行添加标识。
- **无日志级别配置**：没有环境变量或配置文件控制日志级别，所有 `console.*` 都会输出到标准输出。
- **无结构化字段**：日志为纯文本，无法直接解析为结构化字段（如 timestamp、level、component 等）。
- **无日志收集/持久化**：日志仅输出到 stdout/stderr，由运行环境（如 Docker、systemd、终端）负责收集。
- **错误处理模式**：大多数 I/O 操作使用 try/catch + `console.warn/error` 的模式，错误不会中断主流程，保证服务可用性。
- **敏感信息**：日志中包含 IP 地址、端口、文件路径等信息，部署时需考虑日志脱敏需求。

## 总结

该仓库采用最简化的日志方式：后端使用带统一前缀的 `console.*` 输出，前端基本不输出日志，脚本层使用裸 `console.*`。没有统一的日志抽象层、没有结构化日志、没有日志级别开关，适合小型局域网工具的定位。若需扩展，建议在前端引入结构化日志并统一输出通道，在后端将 `console.*` 替换为可配置的日志器。