// 后台：响应工具栏图标 / 快捷键，注入页面脚本；代页面调用翻译 API（页面本身受跨域限制）。
import { getSettings } from "./settings.js";
import { buildMessages, parseTranslations, looksBad } from "./prompt.js";

const REQUEST_TIMEOUT_MS = 60000;

class TranslateError extends Error {
  constructor(message, fatal = false) {
    super(message);
    this.fatal = fatal; // fatal：Key 无效、余额不足等，继续请求没有意义
  }
}

async function toggleTab(tabId) {
  const settings = await getSettings();
  if (settings.apiKey === "") {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const [{ result: injected }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__pageTranslator)
    });
    if (injected) {
      await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__pageTranslator.toggle() });
      return;
    }
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content.js"] });
  } catch (err) {
    // chrome://、扩展商店等页面不允许注入
    await chrome.action.setBadgeText({ tabId, text: "×" });
    await chrome.action.setTitle({ tabId, title: `这个页面不能翻译：${err.message}` });
  }
}

chrome.action.onClicked.addListener((tab) => toggleTab(tab.id));
self.toggleTab = toggleTab; // 供 test/e2e.mjs 在无法点击图标时触发

async function callApi(settings, segments, pageTitle, attempt = 0) {
  const url = settings.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: buildMessages(segments, settings.targetLang, pageTitle),
        response_format: { type: "json_object" },
        temperature: 1.0,
        stream: false
      })
    });
  } catch (err) {
    const reason = err.name === "AbortError" ? "请求超时" : err.message;
    throw new TranslateError(`网络请求失败：${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 401) throw new TranslateError("API Key 无效（401），请到设置页检查", true);
  if (resp.status === 402) throw new TranslateError("账户余额不足（402），请到 DeepSeek 平台充值", true);
  if ((resp.status === 429 || resp.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return callApi(settings, segments, pageTitle, attempt + 1);
  }
  if (resp.ok === false) {
    const detail = await resp.text().catch(() => "");
    throw new TranslateError(`接口返回 ${resp.status}：${detail.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== "string") throw new TranslateError("接口返回内容为空");
  return content;
}

// 返回与 segments 等长的数组，某段失败时该位置为 null。
async function translateSegments(segments, pageTitle = "") {
  const settings = await getSettings();
  if (settings.apiKey === "") throw new TranslateError("还没有填写 API Key", true);

  const content = await callApi(settings, segments, pageTitle);
  const parsed = parseTranslations(content, segments.length);

  if (parsed === null && segments.length > 1) {
    // 模型没按数组对齐返回时，退回逐段翻译
    return Promise.all(
      segments.map((seg) =>
        translateSegments([seg], pageTitle).then((r) => r[0]).catch((err) => {
          if (err.fatal) throw err;
          return null;
        })
      )
    );
  }
  if (parsed === null) return [null];
  return parsed.map((out, i) => (looksBad(segments[i], out) ? null : out));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "translate") {
    translateSegments(msg.texts, msg.pageTitle || "")
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((err) => sendResponse({ ok: false, error: err.message, fatal: Boolean(err.fatal) }));
    return true; // 异步返回
  }
  if (msg.type === "test") {
    translateSegments(["Hello, world. This is a connection test."])
      .then((translations) => sendResponse({ ok: translations[0] !== null, translation: translations[0] }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
  return false;
});
