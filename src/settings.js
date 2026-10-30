// 设置项默认值。API Key 存在 chrome.storage.local，不随浏览器账号同步。
export const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  targetLang: "简体中文"
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(values) {
  await chrome.storage.local.set(values);
}
