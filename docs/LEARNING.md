# SuQCanvas 云同步学习文档（Supabase + 阿里云 OSS）

> 项目数据（画布 JSON）走 Supabase PostgreSQL，媒体大文件走阿里云 OSS，本地 IndexedDB 作为离线缓存。

---

## 一、架构总览

```
┌─────────────┐   保存    ┌──────────────┐   上传    ┌──────────────┐
│   前端应用   │ ────────▶ │  Supabase     │ ◀─────── │  阿里云 OSS   │
│ (IndexedDB) │ 项目数据   │  projects表    │ 元数据   │  assets/*.bin │
│  离线缓存    │ ◀──────── │  assets表      │ ───────▶ │  (媒体二进制)  │
└─────────────┘   拉取    └──────┬───────┘   下载    └──────────────┘
                                 │ STS 凭证签发
                                 ▼
                        Edge Function (oss-sts)
```

- **Supabase 只存结构**：projects（画布 JSONB）+ assets（素材元数据，含 OSS key）
- **OSS 只存文件**：`assets/<id>.bin`、`assets/<id>.thumb`
- **IndexedDB**：本地缓存，秒开 + 离线可用，云端缺失时自动从 OSS 下载回填

---

## 二、Supabase 接入

### 1. 建表（SQL Editor 执行）

```sql
-- 项目表：画布数据
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null default '未命名项目',
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  viewport jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 素材表：只存元数据，二进制在 OSS
-- 注意：id 用 text 类型！应用生成的素材 id 形如 a_xxx，用 uuid 会 400 报错
create table public.assets (
  id text primary key,
  name text not null,
  mime text not null,
  size bigint not null default 0,
  kind text not null,               -- image/video/audio/pdf/...
  oss_key text not null,            -- OSS 对象 key，如 assets/<id>.bin
  oss_thumb_key text,
  has_thumbnail boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_assets_kind on public.assets (kind);
```

### 2. 自动更新时间触发器

```sql
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();
```

### 3. 行级安全（RLS）——匿名单空间

```sql
alter table public.projects enable row level security;
alter table public.assets  enable row level security;

create policy "anonymous all projects"
  on public.projects for all
  to anon, authenticated
  using (true) with check (true);

create policy "anonymous all assets"
  on public.assets for all
  to anon, authenticated
  using (true) with check (true);
```

> 如需用户隔离：改为 `using (auth.uid() = user_id)` 并在表上加 `user_id` 列。

### 4. 前端客户端（src/sync/supabaseClient.ts）

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = url && anonKey ? createClient(url, anonKey) : null
```

未配置环境变量 → 自动降级纯本地模式。

### 5. 常用 API

```ts
// 列表（按更新时间倒序）
await supabase.from('projects').select('*').order('updated_at', { ascending: false })

// upsert 保存
await supabase.from('projects').upsert({ id, name, graph, viewport })

// 素材元数据
await supabase.from('assets').upsert({ id, name, mime, size, kind, oss_key })
await supabase.from('assets').delete().eq('id', id)
await supabase.from('assets').select('*').in('id', [...ids])
```

---

## 三、云同步策略（src/sync/cloudSync.ts）

原则：**云为主 + 本地缓存**，离线可用。

### 列表合并（syncProjectList）

| 情况 | 处理 |
|---|---|
| 本地有、云无 | 上传迁移到云（首次使用自动迁移旧数据） |
| 云有、本地无 | 下载并缓存到 IndexedDB |
| 两边都有 | 取 `updated_at` 较新者，回写较旧方 |

### 加载项目（loadProjectBest）

```
本地缓存 与 云端版本 对比 updated_at → 取较新，并回写另一侧
```

### 保存（saveNow）

```
本地 IndexedDB 更新 + 云端 upsert 双写
云失败仅 console.warn（不阻塞本地保存，离线可用）
```

---

## 四、阿里云 OSS 接入

### 1. 前置准备

- 创建 Bucket（如华东1 `suqcanvasdata`）
- RAM 用户 + AccessKey（**开发测试用**；生产禁止放前端）
- **CORS 配置**（必须，否则浏览器跨域 404/403）：
  - 允许来源 `*`，方法 `GET, PUT, POST, DELETE, HEAD`，Header `*`，暴露 `ETag`

### 2. RAM 角色（生产安全方案：STS 临时凭证）

**信任策略**（创建角色时填，**不能带 Resource 字段**，否则报语法错误）：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "RAM": ["acs:ram::<主账号ID>:root"]
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**权限策略**（角色创建后，附加到角色，只授权 assets/ 目录）：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject", "oss:GetObject", "oss:DeleteObject", "oss:ListObjects"],
      "Resource": [
        "acs:oss:*:*:suqcanvasdata",
        "acs:oss:*:*:suqcanvasdata/assets/*"
      ]
    }
  ]
}
```

RAM 用户需附加 `AliyunSTSAssumeRoleAccess` 才有 AssumeRole 权限。
角色 ARN：`acs:ram::<主账号ID>:role/<角色名>`

### 3. STS 凭证签发（supabase/functions/oss-sts/index.ts）

Edge Function 充当凭证中转，**AccessKey 只存在于服务端 Secrets，永不进前端**。

**调用阿里云 STS AssumeRole API**（RPC 签名流程）：

```
1. 组装参数（Action=AssumeRole, RoleArn, DurationSeconds=3600, Format=JSON...）
2. 参数按 key 字典序排序 → URL 编码（RFC3986）→ join('&') 得 canonical
3. StringToSign = "GET&%2F&" + percentEncode(canonical)
4. Signature = base64( HMAC-SHA1(AKSecret + "&", StringToSign) )
5. GET https://sts.aliyuncs.com/?canonical&Signature=...
```

**Edge Function Secrets**（控制台 Edge Functions → Secrets）：

| 密钥 | 值 |
|---|---|
| `ALIYUN_AK_ID` | RAM 用户 AccessKey ID |
| `ALIYUN_AK_SECRET` | 对应 Secret |
| `ALIYUN_ROLE_ARN` | `acs:ram::...:role/suqcanvas-oss-role` |

返回：`{ accessKeyId, accessKeySecret, securityToken, expiration }`（1h 有效）。

**部署**：控制台 Edge Functions → Create function（`oss-sts`，Verify JWT 开启）→ 粘贴代码 → Deploy → 配置 Secrets。

### 4. 前端封装（src/sync/ossClient.ts）

```ts
uploadAssetToOss(id, blob)      // put  assets/<id>.bin，返回 oss_key
uploadThumbToOss(id, blob)      // put  assets/<id>.thumb
downloadAssetFromOss(id)        // get，返回 Blob
getOssUrl(id)                   // 签名 URL（1h 有效，私有桶用）
```

**凭证策略**：
- 配置了 `VITE_OSS_STS_URL` → 自动向 Edge Function 请求临时凭证（带 `Authorization: Bearer <anon key>`）
- 否则用 `VITE_OSS_ACCESS_KEY_ID / VITE_OSS_ACCESS_KEY_SECRET`（仅开发调试）

```ts
// 配置（.env）
VITE_OSS_REGION=oss-cn-hangzhou
VITE_OSS_BUCKET=suqcanvasdata
VITE_OSS_STS_URL=https://<ref>.supabase.co/functions/v1/oss-sts
```

### 5. 媒体数据流

```
导入文件 ──▶ IndexedDB（离线缓存）──▶ 后台异步上传 OSS ──▶ 元数据写 Supabase assets 表
                    │
                    ▼
打开项目 ──▶ 本地有资源 → 秒开
         └─ 本地缺失（新设备/清缓存）→ OSS 下载 → 回填 IndexedDB → 渲染
```

---

## 五、验证清单

### 本地验证

```bash
# 1. 检查 Supabase 连接与表结构
node -e "const {createClient}=require('@supabase/supabase-js');const sb=createClient(URL,KEY);sb.from('projects').select('*').then(r=>console.log(r.error?r.error.message:'OK'))"

# 2. 检查 OSS 读写（Node 环境用 AK 直连测试）
node -e "const OSS=require('ali-oss');const c=new OSS({region,bucket,accessKeyId,accessKeySecret,secure:true});c.list({prefix:'assets/'}).then(r=>console.log(r.objects.map(o=>o.name)))"

# 3. 检查 STS 签发
curl https://<ref>.supabase.co/functions/v1/oss-sts -H "Authorization: Bearer <anon key>"
```

### 越权测试（确认权限最小化）

```js
// 用 STS 临时凭证尝试访问 assets/ 以外的对象，应被拒绝(403)
```

---

## 六、踩坑记录

1. **`assets.id` 类型必须是 `text`**：应用素材 id 是 `a_xxx` 字符串，uuid 类型插入会 400
   ```sql
   alter table public.assets alter column id type text using id::text;
   ```
2. **OSS 未配 CORS** → 浏览器预检失败（No 'Access-Control-Allow-Origin'）
3. **STS 信任策略不能有 Resource 字段**，只写 Principal + Action
4. **`.env` 修改后必须重启 dev server**（Vite 启动时读取）
5. **AK 放前端仅限开发**，上线前删 AK、改用 `VITE_OSS_STS_URL`，并在 RAM 控制台删除明文 AccessKey
6. **Edge Function 需带 anon key 鉴权**：前端 fetch 要同时加 `Authorization: Bearer <anon key>` 和 `apikey: <anon key>`（只带 Authorization 会报 "No API key found in request"）

---

## 七、相关文件

```
src/sync/supabaseClient.ts   # Supabase 客户端（环境变量检测）
src/sync/cloudSync.ts        # 云为主双向同步（合并/拉取/推送/删除）
src/sync/ossClient.ts        # OSS 客户端（STS/AK 双模式）
src/sync/lanClient.ts        # 局域网协作（WebSocket 中继：画布同步/素材互传/跟随）
src/store/lanStore.ts        # 局域网状态（连接/在线用户/跟随）
src/media/blobRegistry.ts    # 本地缓存优先，缺失时 OSS → 局域网 兜底拉取
src/store/projectStore.ts    # init/load/save 对接云
src/io/fileLoader.ts         # 导入文件后自动上传 OSS + 局域网分发 + 元数据上云
server/lan-server.mjs        # 局域网中继服务器（npm run lan，默认端口 8790）
supabase/schema.sql          # 建表 SQL
supabase/functions/oss-sts/  # STS 凭证签发 Edge Function
```

---

## 八、局域网协作模式

不依赖公网，同一局域网内多设备实时协作。

### 1. 启动中继服务器

任选一台局域网机器（任意系统，装了 Node 即可）：

```bash
npm run lan
# 默认监听 0.0.0.0:8790，可用 PORT=9000 npm run lan 换端口
```

注意：只部署前端 `dist` 目录不会启动中继。宝塔服务器还需上传 `server/`、`package.json`、
`package-lock.json`，执行 `npm ci --omit=dev` 后用 PM2 等进程管理器持续运行中继。

输出 `本机局域网 IP`（Windows: `ipconfig`，Linux/Mac: `ifconfig`）。

### 2. 各设备连接

应用工具栏右侧「局域网」按钮 → 输入 `ws://<中继机IP>:8790` → 连接。
昵称可留空自动生成。连接后自动完成初始同步。

如果应用部署在 HTTPS 站点，不能从浏览器连接明文 `ws://`。请在站点 Nginx 中把同域名的
`/lan-ws` 反向代理到 `http://127.0.0.1:8790`，并启用 WebSocket 的 `Upgrade` / `Connection`
请求头；客户端会自动使用 `wss://<当前域名>/lan-ws`。完整宝塔配置见项目 `README.md`。

### 3. 功能

- **画布实时同步**：节点/连线/文字/位置自动广播（150ms 节流），新设备加入自动收到当前画布
- **素材互传**：图片/视频/PDF 等以 256KB 分片广播；新设备缺失素材时按需向在线的设备请求
- **在线用户列表**：显示昵称与 IP，可一键「跟随」某用户视角（平移/缩放实时跟随）
- **与云端并存**：局域网模式与 Supabase/OSS 云同步互不干扰；素材加载优先级 本地缓存 → OSS → 局域网

### 4. 协议

文本 JSON 消息：`hello` / `welcome` / `users` / `leave` / `peer-joined` / `sync`（nodes+edges 全量）/ `viewport` / `asset-meta` / `asset-chunk`（base64 分片，支持 `to` 定向）/ `asset-request`。二进制统一 base64 封装，中继只转发不解析。

