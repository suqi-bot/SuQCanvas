# AI 生图

画布工具栏 → **AI 生图**。

## 本地 ComfyUI

1. 地址填写 `http://127.0.0.1:8188`，本地无鉴权时 Key 留空。
2. 点击「测试连接」，再点击「读取最近成功工作流」。也可导入 ComfyUI 导出的 **API 格式** JSON，普通画布 JSON 不适用。
3. 核对提示词输入节点。Qwen Image 2.1 通常选 `TextEncodeQwenImage21` 的 `prompt`；SD 工作流选择正向 `CLIPTextEncode` 的 `text`。
4. 输入画面描述并生成。模型、尺寸、步数、负面提示词等沿用原工作流，种子每次随机。只替换所选的一个文本输入，复杂多文本编码工作流请在 ComfyUI 先统一输入。
5. 预览后点击「加入当前画布」。图片通过已有素材导入流程保存，支持项目导出。

「保存配置」将地址、模型、工作流保存在当前设备浏览器存储，不随项目同步。API Key 只保留在内存，重启/刷新后重新输入。工作流 JSON 本身若含自定义节点凭据，保存前应在 ComfyUI 清除这些凭据。

调用流程：`GET /system_stats` 检查服务，`GET /history?max_items=20` 获取最近成功的工作流，`POST /prompt` 提交 API 工作流，轮询 `GET /history/{prompt_id}`，最后通过 `GET /view` 下载图片。等待上限 30 分钟，单个 HTTP 请求上限 3 分钟。停止等待不会中断服务端任务，可回到 ComfyUI 查看结果。

桌面版通过主进程直接连接 HTTP(S) 服务。Vite 开发版对 `http://127.0.0.1:8188` 提供固定本地代理。正式网页版及其他服务地址使用浏览器直连，服务需配置允许页面源的 CORS；HTTPS 页面应使用 HTTPS 服务或桌面版。`127.0.0.1` 始终表示运行画布的设备，不是局域网服务器。

## 云端 / 本地 OpenAI 兼容接口

选择「OpenAI 兼容 Images API」，填写 Base URL（通常含 `/v1`）、Key、模型名及服务商支持的尺寸。客户端调用 `POST {Base URL}/images/generations`，传入 `model/prompt/n:1/size`，支持 `data[].b64_json` 或 `data[].url`。仅兼容 Chat API 的服务不能用于生图；异步任务式或其他专有协议暂不支持。下载返回的图片 URL 时不会携带 API Key。

## 提示词优化

不是生图的必需步骤。Qwen Image 等支持自然语言的模型可先直接输入中文。需要补足构图、光线、材质时，展开「AI 提示词优化」，单独填写文字模型地址、Key 和模型名。调用兼容的 `/chat/completions`，生成候选描述后由用户选择采用，不会自动消耗一次生图请求。可连接支持该协议的本地文字模型服务，也可连接云端服务。

API 参考：[ComfyUI 官方路由文档](https://docs.comfy.org/development/comfyui-server/comms_routes)。
