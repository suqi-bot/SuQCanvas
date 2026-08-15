-- ============================================================
-- SuQCanvas Supabase 初始化脚本
-- 用法：Supabase 控制台 -> SQL Editor -> New query -> 粘贴执行
-- 注：媒体文件（图片/视频/PDF）由阿里云 OSS 存储，assets 表仅存元数据
-- ============================================================

-- 扩展：UUID 生成
create extension if not exists pgcrypto;

-- ---------- 项目表（画布数据） ----------
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
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

-- ---------- 行级安全（匿名单空间：允许匿名读写） ----------
-- 注意：公开可写，任何拿到 anon key 的人都能改数据。
-- 如需用户隔离，改为基于 auth.uid() 的策略并接入 Supabase Auth。
alter table public.projects enable row level security;
alter table public.assets  enable row level security;

drop policy if exists "anonymous all projects" on public.projects;
create policy "anonymous all projects"
  on public.projects for all
  to anon, authenticated
  using (true) with check (true);

drop policy if exists "anonymous all assets" on public.assets;
create policy "anonymous all assets"
  on public.assets for all
  to anon, authenticated
  using (true) with check (true);
