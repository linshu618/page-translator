// 端到端测试：用本机 Edge 加载插件，在后台脚本里替换 fetch 模拟 DeepSeek 接口，不消耗真实额度。
// 用法：node test/e2e.mjs
import { chromium } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const edge = process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

// 测试副本：额外授予所有网址权限（真实使用时由点击图标临时授予 activeTab）
const work = mkdtempSync(join(tmpdir(), "pt-e2e-"));
const extDir = join(work, "ext");
cpSync(root, extDir, { recursive: true, filter: (src) => src.includes("node_modules") === false && src.includes(`${join(root, "test")}`) === false });
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf-8"));
manifest.host_permissions.push("<all_urls>");
writeFileSync(join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const fixture = readFileSync(join(root, "test", "fixture.html"));
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fixture);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  executablePath: edge,
  headless: false,
  args: ["--headless=new", `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1200, height: 800 }
});

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (ok === false) failures += 1;
}

try {
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extId = sw.url().split("/")[2];

  // 模拟接口：正常返回“【译】+原文”；包含 Charge money 的批次故意返回错误长度，验证逐段降级
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ apiKey: "test-key" });
    globalThis.__requests = [];
    globalThis.__mockStatus = 200;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      const segments = JSON.parse(body.messages[1].content).segments;
      globalThis.__requests.push({ url, auth: init.headers.Authorization, model: body.model, segments });
      if (globalThis.__mockStatus !== 200) return new Response("{}", { status: globalThis.__mockStatus });
      let translations = segments.map((s) => s.startsWith("An intentionally untranslated") ? "" : "【译】" + s);
      if (segments.length > 1 && segments.some((s) => s.includes("Charge money"))) translations = translations.slice(1);
      const content = JSON.stringify({ translations });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    };
  });

  const page = await context.newPage();
  await page.goto(pageUrl);
  const toggle = () =>
    sw.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      await self.toggleTab(tab.id);
    }, pageUrl);
  const tr = (id) => page.locator(`#${id} > .pt-translation`);
  const badge = (url = pageUrl) => sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return chrome.action.getBadgeText({ tabId: tab.id });
  }, url);

  check("初始工具栏徽标为关", (await badge()) === "关");
  await toggle();
  check("开启后工具栏徽标为开", (await badge()) === "开");
  await page.waitForSelector("#p1 > .pt-translation:not(.pt-loading)", { timeout: 10000 });

  check("段落被翻译", (await tr("p1").textContent()).startsWith("【译】Most side projects"));
  check("文章内 header 里的标题被翻译", (await tr("title").count()) === 1);
  check("li 内有 p 时只翻译最内层", (await tr("li2p").count()) === 1 && (await tr("li2").count()) === 0);
  await page.waitForSelector("#li2p > .pt-translation:not(.pt-loading)");
  check("批次长度不对时逐段降级成功", (await tr("li2p").textContent()) === "【译】Charge money from day one.");
  check("中文段落被跳过", (await tr("zh").count()) === 0);
  check("代码块被跳过", (await page.locator("pre .pt-translation").count()) === 0);
  check("导航被跳过", (await page.locator("nav .pt-translation").count()) === 0);
  check("页脚被跳过", (await tr("foot").count()) === 0);
  check("远处段落暂不翻译（省额度）", (await tr("far").count()) === 0);

  const reqs = await sw.evaluate(() => globalThis.__requests);
  check("请求发往 DeepSeek 接口", reqs[0].url === "https://api.deepseek.com/chat/completions", reqs[0].url);
  check("带上 API Key 与默认模型", reqs[0].auth === "Bearer test-key" && reqs[0].model === "deepseek-chat");

  await page.waitForSelector("#dynamic > .pt-translation:not(.pt-loading)", { timeout: 5000 });
  check("动态加入的段落自动翻译", (await tr("dynamic").textContent()).startsWith("【译】This paragraph was added"));

  await page.locator("#far").scrollIntoViewIfNeeded();
  await page.waitForSelector("#far > .pt-translation:not(.pt-loading)", { timeout: 5000 });
  check("滚动到远处段落后翻译", (await tr("far").count()) === 1);

  // 模拟关闭滚动锚定的网页，以及在阅读位置附近出现的单段失败。
  await page.addStyleTag({ content: "html { overflow-anchor: none; scroll-behavior: smooth }" });
  await page.locator("#far").evaluate((el) => {
    el.insertAdjacentHTML("afterend", '<p id="failed">An intentionally untranslated paragraph.</p><div class="spacer"></div>');
    window.scrollBy({ top: el.getBoundingClientRect().top - Math.round(innerHeight / 3) + 5, behavior: "instant" });
  });
  const toast = page.locator("#pt-toast");
  await page.locator("#failed > .pt-failed").waitFor();
  check("新失败显示失败提示", (await toast.textContent()).includes("1 段失败"));
  const farTop = () => page.locator("#far").evaluate((el) => el.getBoundingClientRect().top);
  const readingPosition = await farTop();

  await toggle();
  check("再点一次切回原文", (await tr("p1").isVisible()) === false);
  check("关闭后工具栏徽标为关", (await badge()) === "关");
  const originalReadingPosition = await farTop();
  check("隐藏译文后保持阅读位置", Math.abs(originalReadingPosition - readingPosition) <= 1);
  await toggle();
  check("第三次点击恢复译文", await tr("p1").isVisible());
  check("恢复译文后保持阅读位置", Math.abs((await farTop()) - originalReadingPosition) <= 1);
  check("恢复译文时不重复弹出旧失败", (await toast.isVisible()) === false);
  check("旧失败仍显示段落内重试入口", await page.locator("#failed > .pt-failed").isVisible());
  check("切换不会重复插入译文", (await page.locator("#p1 .pt-translation").count()) === 1);

  const other = await context.newPage();
  await other.goto(`${pageUrl}?other`);
  check("翻译状态按标签页独立显示", (await badge()) === "开" && (await badge(other.url())) === "关");
  await other.close();

  // Key 无效：提示并给出打开设置的按钮
  await sw.evaluate(() => { globalThis.__mockStatus = 401; });
  const page2 = await context.newPage();
  await page2.goto(pageUrl);
  await page2.bringToFront();
  await sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({ url: u });
    await self.toggleTab(tabs[tabs.length - 1].id);
  }, pageUrl);
  await page2.waitForSelector("#pt-toast button", { timeout: 10000 });
  check("Key 无效时提示错误", (await page2.locator("#pt-toast").textContent()).includes("API Key 无效"));
  check("失败段落可点击重试", (await page2.locator("#p1 > .pt-failed").count()) === 1);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extId}/src/options.html`);
  check("设置页读取默认值", (await options.inputValue("#baseUrl")) === "https://api.deepseek.com" && (await options.inputValue("#model")) === "deepseek-chat");

  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(root, "test", "screenshot.png") });
  await page.reload();
  check("刷新后工具栏徽标恢复为关", (await badge()) === "关");
  await Promise.all([toggle(), toggle()]);
  check("快速点击两次后徽标与页面均为关闭", (await badge()) === "关" && (await page.locator("html.pt-hidden").count()) === 1);
} catch (err) {
  failures += 1;
  console.error("ERROR", err);
} finally {
  await context.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
