// 用本机 Edge 把 SVG 图标渲染成插件需要的各尺寸 PNG。
// 用法：node scripts/make-icons.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const edge = process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#16a34a"/>
  <text x="64" y="66" text-anchor="middle" dominant-baseline="central"
        font-family="Microsoft YaHei, PingFang SC, sans-serif" font-weight="700"
        font-size="84" fill="#ffffff">译</text>
</svg>`;

mkdirSync(join(root, "icons"), { recursive: true });
const browser = await chromium.launch({ executablePath: edge });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}">`);
  await page.screenshot({ path: join(root, "icons", `icon${size}.png`), omitBackground: true });
}
await browser.close();
console.log("icons written");
