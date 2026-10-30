// 页面脚本：找出正文段落，接近可视区域时分批交给后台翻译，把译文插在原文下方。
// 再次点击图标时在“双语对照”和“只看原文”之间切换。
(() => {
  if (window.__pageTranslator) {
    window.__pageTranslator.toggle();
    return;
  }

  const GENERIC_BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, dt, dd, td, th";
  // X 页面里有大量界面标题（Post、Trending now 等），只取推文正文和长文正文
  const X_BLOCKS = [
    "[data-testid='tweetText']",
    "[data-testid='twitter-article-title']",
    "[data-testid='longformRichTextComponent'] :is(h1, h2, h3, h4, h5, h6, li, blockquote, div[data-block='true'])"
  ].join(", ");
  const SITE_BLOCKS = { "x.com": X_BLOCKS, "twitter.com": X_BLOCKS };
  const BLOCKS = SITE_BLOCKS[location.hostname.replace(/^(www|mobile)\./, "")] || GENERIC_BLOCKS;
  const ALWAYS_SKIP = [
    "nav", "aside", "button", "pre", "code", "kbd", "script", "style", "noscript",
    "textarea", "select", "svg", "[contenteditable='true']", "[role='navigation']",
    "[role='button']", ".pt-translation", "#pt-toast"
  ].join(", ");
  const CONTENT_ROOTS = "article, main, [role='main']";
  const BATCH_MAX_ITEMS = 12;
  const BATCH_MAX_CHARS = 3000;
  const CONCURRENCY = 3;

  const cache = new Map(); // 原文 -> 译文；X 等站点重绘 DOM 后可直接补回，不再请求
  const observed = new WeakSet();
  const queue = [];
  let active = true;
  let inflight = 0;
  let runningBatches = 0;
  let failedCount = 0;
  let fatalError = null;
  let scanTimer = null;
  let hideTimer = null;

  // ---------- 判断哪些元素需要翻译 ----------

  function needsTranslation(text) {
    const t = text.replace(/https?:\/\/\S+/g, "").trim();
    if (t.length < 2) return false;
    const letters = (t.match(/[A-Za-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ가-힯]/g) || []).length;
    if (letters === 0) return false;
    const han = (t.match(/[一-鿿]/g) || []).length;
    return han * 2 < letters; // 汉字已占主体的段落视为中文，跳过
  }

  function isCandidate(el) {
    if (el.closest(ALWAYS_SKIP)) return false;
    if (el.closest("header, footer") && el.closest(CONTENT_ROOTS) === null) return false;
    if (el.querySelector(BLOCKS)) return false; // 只取最内层的段落，避免重复翻译
    if (el.getClientRects().length === 0) return false;
    return needsTranslation(el.innerText);
  }

  function hasTranslation(el) {
    return el.querySelector(":scope > .pt-translation") !== null;
  }

  function getRoot() {
    const main = document.querySelector("main, [role='main']");
    if (main && main.innerText.length > 200) return main;
    return document.body;
  }

  // ---------- 译文节点 ----------

  function attachSpan(el, className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.setAttribute("lang", "zh-CN");
    span.textContent = text;
    el.appendChild(span);
    return span;
  }

  function fill(item, translation) {
    item.span.className = "pt-translation";
    item.span.textContent = translation;
    item.span.onclick = null;
    item.el.dataset.ptState = "done";
  }

  function markFailed(item) {
    failedCount += 1;
    item.el.dataset.ptState = "failed";
    item.span.className = "pt-translation pt-failed";
    item.span.textContent = "翻译失败，点击重试";
    item.span.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      failedCount -= 1;
      fatalError = null;
      item.span.className = "pt-translation pt-loading";
      item.span.textContent = "翻译中…";
      item.el.dataset.ptState = "pending";
      queue.push(item);
      pump();
    };
  }

  function processElement(el) {
    if (hasTranslation(el) || el.dataset.ptState === "pending") return;
    const text = el.innerText.trim();
    const cached = cache.get(text);
    if (cached !== undefined) {
      fill({ el, span: attachSpan(el, "pt-translation", cached) }, cached);
      return;
    }
    el.dataset.ptState = "pending";
    queue.push({ el, text, span: attachSpan(el, "pt-translation pt-loading", "翻译中…") });
    pump();
  }

  // ---------- 批量请求 ----------

  function takeBatch() {
    const batch = [];
    let chars = 0;
    while (queue.length > 0 && batch.length < BATCH_MAX_ITEMS) {
      const next = queue[0];
      if (batch.length > 0 && chars + next.text.length > BATCH_MAX_CHARS) break;
      batch.push(queue.shift());
      chars += next.text.length;
    }
    return batch;
  }

  function pump() {
    if (fatalError !== null) {
      queue.splice(0).forEach(markFailed);
      updateToast();
      return;
    }
    while (runningBatches < CONCURRENCY && queue.length > 0) {
      runBatch(takeBatch());
    }
    updateToast();
  }

  async function runBatch(batch) {
    runningBatches += 1;
    inflight += batch.length;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "translate",
        texts: batch.map((i) => i.text),
        pageTitle: document.title
      });
      if (res && res.ok) {
        batch.forEach((item, i) => {
          const tr = res.translations[i];
          if (typeof tr === "string" && tr !== "") {
            cache.set(item.text, tr);
            fill(item, tr);
          } else {
            markFailed(item);
          }
        });
      } else {
        if (res && res.fatal) fatalError = res.error;
        batch.forEach(markFailed);
        if (res && res.fatal === false) showToast(res.error, false);
      }
    } catch (err) {
      // 扩展被重新加载后，旧页面脚本与后台的连接会失效
      fatalError = `插件连接已失效，请刷新页面后重试（${err.message}）`;
      batch.forEach(markFailed);
    } finally {
      runningBatches -= 1;
      inflight -= batch.length;
      pump();
    }
  }

  // ---------- 扫描与监听 ----------

  const io = new IntersectionObserver(
    (entries) => {
      if (active === false) return;
      for (const entry of entries) {
        if (entry.isIntersecting === false) continue;
        io.unobserve(entry.target);
        observed.delete(entry.target);
        processElement(entry.target);
      }
    },
    { rootMargin: "1200px 0px" } // 提前翻译即将滚动到的内容，远处的段落不浪费额度
  );

  function scan() {
    if (active === false) return;
    for (const el of getRoot().querySelectorAll(BLOCKS)) {
      if (observed.has(el) || hasTranslation(el) || el.dataset.ptState === "pending") continue;
      if (isCandidate(el) === false) continue;
      if (cache.has(el.innerText.trim())) {
        processElement(el);
        continue;
      }
      observed.add(el);
      io.observe(el);
    }
    updateToast();
  }

  const mo = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  });

  // ---------- 状态提示 ----------

  let toast = null;

  function showToast(text, withSettingsButton) {
    if (toast === null) {
      toast = document.createElement("div");
      toast.id = "pt-toast";
      document.documentElement.appendChild(toast);
    }
    clearTimeout(hideTimer);
    toast.replaceChildren();
    const label = document.createElement("span");
    label.textContent = text;
    toast.appendChild(label);
    if (withSettingsButton) {
      const btn = document.createElement("button");
      btn.textContent = "打开设置";
      btn.onclick = () => chrome.runtime.sendMessage({ type: "openOptions" });
      toast.appendChild(btn);
    }
    toast.style.display = "flex";
  }

  function hideToast(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (toast) toast.style.display = "none";
    }, delay);
  }

  function updateToast() {
    if (active === false) return;
    if (fatalError !== null) {
      showToast(fatalError, true);
      return;
    }
    const pending = queue.length + inflight;
    if (pending > 0) {
      showToast(`翻译中… 剩余 ${pending} 段`, false);
    } else if (failedCount > 0) {
      showToast(`翻译完成，${failedCount} 段失败（点击红字重试）`, false);
      hideToast(4000);
    } else if (toast && toast.style.display !== "none") {
      showToast("翻译完成", false);
      hideToast(1500);
    }
  }

  // ---------- 开关 ----------

  function start() {
    active = true;
    document.documentElement.classList.remove("pt-hidden");
    mo.observe(document.body, { childList: true, subtree: true });
    showToast("正在查找正文…", false);
    scan();
    updateToast();
    if (queue.length + inflight === 0) hideToast(1500);
  }

  function stop() {
    active = false;
    document.documentElement.classList.add("pt-hidden");
    mo.disconnect();
    showToast("已切换为原文，再点一次显示译文", false);
    hideToast(1500);
  }

  window.__pageTranslator = {
    toggle() {
      if (active) stop();
      else start();
    }
  };

  start();
})();
