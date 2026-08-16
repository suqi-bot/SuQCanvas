-- ============================================================
-- SuQCanvas Supabase 初始化脚本
-- 用法：Supabase 控制台 -> SQL Editor -> New query -> 粘贴执行
-- 注：媒体文件（图片/视频/PDF）由阿里云 OSS 存储，assets 表仅存元数据
-- 注：本脚本同时适用于新建项目与旧项目升级（幂等，可重复执行）
-- ============================================================

-- 扩展：UUID 生成
create extension if not exists pgcrypto;

-- ---------- 项目表（画布数据） ----------
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null default '未命名项目',
  graph      jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  viewport   jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 素材表（媒体元数据，二进制在阿里云 OSS） ----------
-- 注意：id 使用 text 类型，因为应用生成的素材 id 形如 a_xxxxxx（非 UUID）
create table if not exists public.assets (
  id            text primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  name          text not null,
  mime          text not null default 'application/octet-stream',
  size          bigint not null default 0,
  kind          text not null,            -- image/video/audio/pdf/markdown/text/file/heading/sticky/shape
  oss_key       text not null,            -- OSS 对象 key，如 assets/<id>.bin
  oss_thumb_key text,                     -- 视频缩略图 key（可选）
  has_thumbnail boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_assets_kind on public.assets (kind);

-- ---------- 升级旧库：补充 user_id 列 ----------
alter table public.projects add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.assets  add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists idx_projects_user on public.projects (user_id);
create index if not exists idx_assets_user  on public.assets (user_id);

-- ---------- 自动更新时间触发器 ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------- 行级安全（按账号隔离：每个用户只能读写自己的数据） ----------
alter table public.projects enable row level security;
alter table public.assets  enable row level security;

-- 移除旧的全开放策略（匿名模式）
drop policy if exists "anonymous all projects" on public.projects;
drop policy if exists "anonymous all assets" on public.assets;

drop policy if exists "own projects" on public.projects;
create policy "own projects"
  on public.projects for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own assets" on public.assets;
create policy "own assets"
  on public.assets for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- 可选：历史匿名数据处理 ----------
-- 升级前产生的旧数据 user_id 为 null，登录后不可见。
-- 方案一：把旧数据划归某个账号（Auth -> Users 里复制该用户 UUID）：
--   update public.projects set user_id = '<user-uuid>' where user_id is null;
--   update public.assets  set user_id = '<user-uuid>' where user_id is null;
--
-- 方案二：直接清空旧数据（旧项目会从浏览器本地缓存重新上传到当前账号）：
--   delete from public.projects where user_id is null;
--   delete from public.assets  where user_id is null;
--
-- 注意：不要删除 OSS 里的旧文件（assets/*.bin），本地项目重新上传后仍会引用它们。
