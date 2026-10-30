// 翻译提示词与模型输出解析。一次请求翻译多段，用 JSON 数组保证译文与原文一一对应。

export function buildMessages(segments, targetLang, pageTitle = "") {
  const system = [
    "你是一个浏览器翻译插件的翻译引擎。用户正在浏览网页，插件会把页面上的段落发给你，帮助用户阅读。",
    `把输入 JSON 中 segments 数组的每一项翻译成${targetLang}。pageTitle 是网页标题，只用来理解主题，不要翻译它。`,
    "要求：",
    '- 输出 JSON：{"translations": ["...", "..."]}，数组长度和顺序必须与 segments 完全一致，一项对应一项。',
    "- 只输出译文，不加解释、注释或前后缀。",
    "- URL、代码、@用户名、#话题标签、数字和产品名保持原样。",
    "- 软件功能名、设置项和专业术语（例如 effort、prompt cache）保留英文原文，不要意译，保证同一个词在全文译法一致。",
    `- 某一项已经是${targetLang}或无需翻译时，原样返回该项。`,
    "- 译文要通顺自然，符合中文表达习惯，不要逐词直译。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify({ pageTitle, segments }) }
  ];
}

function stripFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// 返回与 segments 等长的译文数组；结构不对时返回 null，由调用方降级为逐段翻译。
export function parseTranslations(content, expectedLength) {
  let data;
  try {
    data = JSON.parse(stripFence(content));
  } catch {
    if (expectedLength === 1) return [stripFence(content)];
    return null;
  }
  const list = Array.isArray(data) ? data : data && data.translations;
  if (Array.isArray(list) === false || list.length !== expectedLength) return null;
  return list.map((item) => (typeof item === "string" ? item.trim() : ""));
}

const REFUSAL = /^(抱歉|对不起|很抱歉|I can't|I cannot|I'm sorry|Sorry)/i;

// 识别空结果、只给摘要（明显过短）或拒绝式回答。
export function looksBad(source, output) {
  if (typeof output !== "string" || output.trim() === "") return true;
  if (source.length > 200 && output.length < source.length * 0.15) return true;
  return REFUSAL.test(output.trim()) && REFUSAL.test(source.trim()) === false;
}
