# Page Translator 一键翻译

一个 Chrome / Edge 浏览器插件：在任意网页点一下工具栏图标，正文就会逐段翻译成中文，译文显示在原文下方（双语对照）。默认调用 DeepSeek API。

## 安装

1. 打开 `chrome://extensions`（Edge 打开 `edge://extensions`）。
2. 打开右上角的 **开发者模式**。
3. 点 **加载已解压的扩展程序**，选择本目录 `E:\self-taught\page-translator`。
4. 第一次点插件图标会打开设置页，填入 DeepSeek 的 API Key（在 [platform.deepseek.com](https://platform.deepseek.com) 申请），点 **测试连接** 确认可用。

建议把插件固定到工具栏：点浏览器右上角的拼图图标，再点插件旁边的图钉。

## 使用

| 操作 | 效果 |
|---|---|
| 点图标，或按 `Alt+T` | 翻译当前页面 |
| 再点一次 | 隐藏译文，只看原文 |
| 再点一次 | 重新显示译文 |
| 点红色的“翻译失败，点击重试” | 重新翻译这一段 |

- 只翻译接近可视区域的段落，往下滚动时会继续翻译，长页面不会一次性用掉大量额度。
- X（Twitter）这类不断加载新内容的页面，新出现的推文会自动翻译。在 X 上只翻译推文正文和长文（Article）的标题与正文，不翻译 Post、Trending now 这类界面文字。
- 已经是中文的段落、代码块、导航栏、页脚会被跳过。
- 快捷键可以在 `chrome://extensions/shortcuts` 里修改。

## 设置项

| 项目 | 默认值 | 说明 |
|---|---|---|
| API Key | 空 | 只保存在本机浏览器（`chrome.storage.local`），不随账号同步 |
| 接口地址 | `https://api.deepseek.com` | 可换成其他兼容 OpenAI 格式的接口，保存时会请求访问该地址的权限 |
| 模型 | `deepseek-chat` | DeepSeek 调整模型名时在这里改 |
| 译文语言 | 简体中文 | 可选繁體中文 |

## 目录结构

```
manifest.json        插件清单（Manifest V3）
src/background.js    后台：响应点击、注入页面脚本、调用翻译 API、错误重试
src/content.js       页面脚本：找段落、按可视区域分批翻译、插入译文、切换原文
src/content.css      译文与状态提示的样式
src/prompt.js        提示词、JSON 解析、异常输出识别
src/settings.js      设置默认值与读写
src/options.*        设置页
icons/               图标（由 scripts/make-icons.mjs 生成）
test/                端到端测试
```

## 工作方式

1. 点击图标后，后台把 `content.js` 注入当前标签页（使用 `activeTab` 权限，只在你点击的页面上运行）。
2. 页面脚本找出最内层的正文段落，接近可视区域时排进队列。
3. 每批最多 12 段、约 3000 字符，最多 3 批并发，由后台以 JSON 数组形式发给 API，要求按原顺序返回译文。
4. 模型返回的数组长度不对时，自动改为逐段翻译；明显只给摘要或拒绝式的回答会标记为失败，可点击重试。
5. API Key 无效（401）或余额不足（402）时停止请求，右下角提示并提供“打开设置”按钮。

## 测试

需要上级目录 `E:\self-taught\node_modules` 里的 Playwright，以及本机的 Edge：

```bash
node test/e2e.mjs
```

测试会在后台脚本里替换 `fetch`，模拟 DeepSeek 接口，不消耗真实额度，覆盖段落识别、跳过规则、懒加载、动态内容、开关切换、降级与错误提示。运行后在 `test/screenshot.png` 生成效果截图。

## 注意

翻译结果用于自己阅读。把别人的文章译文公开发布（公众号、博客、公开仓库）需要原作者授权。
