import { DEFAULTS, getSettings, saveSettings } from "./settings.js";

const fields = ["apiKey", "baseUrl", "model", "targetLang"];
const statusEl = document.getElementById("status");

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function readForm() {
  const values = {};
  for (const name of fields) {
    values[name] = document.getElementById(name).value.trim() || DEFAULTS[name];
  }
  return values;
}

async function save() {
  const values = readForm();
  let url;
  try {
    url = new URL(values.baseUrl);
  } catch {
    setStatus("接口地址格式不对", "error");
    return false;
  }
  if (url.origin !== new URL(DEFAULTS.baseUrl).origin) {
    // 不带端口的匹配模式覆盖该主机的所有端口
    const granted = await chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
    if (granted === false) {
      setStatus("没有获得访问该接口地址的权限，未保存", "error");
      return false;
    }
  }
  await saveSettings(values);
  setStatus("已保存", "ok");
  return true;
}

document.getElementById("save").addEventListener("click", save);

document.getElementById("test").addEventListener("click", async () => {
  if ((await save()) === false) return;
  setStatus("正在测试…");
  const res = await chrome.runtime.sendMessage({ type: "test" });
  if (res && res.ok) setStatus(`连接正常：${res.translation}`, "ok");
  else setStatus(`测试失败：${(res && res.error) || "没有返回译文"}`, "error");
});

getSettings().then((settings) => {
  for (const name of fields) document.getElementById(name).value = settings[name];
});
