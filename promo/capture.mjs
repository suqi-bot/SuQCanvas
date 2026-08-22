import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const videoDir = path.join(__dirname, 'raw');
const htmlPath = path.join(__dirname, 'promo.html');
const outMp4 = path.join(__dirname, 'suqcanvas-intro.mp4');

fs.rmSync(videoDir, { recursive: true, force: true });
fs.mkdirSync(videoDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await page.waitForSelector('body.done', { timeout: 150000 });
await page.waitForTimeout(1200);

await context.close();
await browser.close();

const webm = fs.readdirSync(videoDir).find((f) => f.endsWith('.webm'));
if (!webm) {
  console.error('未找到录制的 webm 文件');
  process.exit(1);
}
const webmPath = path.join(videoDir, webm);
console.log('已录制:', webmPath);

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error('未找到 ffmpeg（先运行 npx playwright install ffmpeg 或安装完整版 ffmpeg）');
  process.exit(1);
}
console.log('ffmpeg:', ffmpeg);

fs.rmSync(outMp4, { force: true });
try {
  execFileSync(
    ffmpeg,
    [
      '-y', '-i', webmPath,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outMp4,
    ],
    { stdio: 'inherit' },
  );
} catch {
  console.warn('libx264 不可用，退回 mpeg4 编码');
  execFileSync(
    ffmpeg,
    ['-y', '-i', webmPath, '-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p', outMp4],
    { stdio: 'inherit' },
  );
}
console.log('输出:', outMp4);

function findFfmpeg() {
  const candidates = [];
  try {
    const p = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/)[0];
    if (p && fs.existsSync(p.trim())) candidates.push(p.trim());
  } catch {}
  const wingetBase = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetBase)) {
    for (const name of fs.readdirSync(wingetBase)) {
      if (!name.toLowerCase().startsWith('gyan.ffmpeg') && !name.toLowerCase().startsWith('btbn.ffmpeg')) continue;
      const p = findExe(path.join(wingetBase, name), 'ffmpeg.exe');
      if (p) candidates.push(p);
    }
  }
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (fs.existsSync(base)) {
    for (const name of fs.readdirSync(base)) {
      if (!name.startsWith('ffmpeg-')) continue;
      for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-win32.exe', 'ffmpeg.exe']) {
        const p = path.join(base, name, exe);
        if (fs.existsSync(p)) candidates.push(p);
      }
    }
  }
  return candidates[0] || null;
}

function findExe(dir, target) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findExe(p, target);
      if (found) return found;
    } else if (entry.name.toLowerCase() === target) {
      return p;
    }
  }
  return null;
}
