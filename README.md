# Page Translator 一键网页翻译

**读英文网页遇到难句？点一下，中文译文就出现在原文下方。** 读技术文档、文章或 X（Twitter）帖子时，可以边读边对照，省去复制文字和来回切窗口。

- **滚到哪，翻到哪。** 扩展按阅读进度翻译正文。刷 X 加载出新帖子时，也会接着翻。
- **一键切回原文。** 点工具栏图标或按 `Alt+T` 切换。绿色「开」是双语对照，灰色「关」是只看原文。
- **代码块照常看。** 导航、代码块和已有的中文段落会被跳过。

## 安装和使用

1. [下载 ZIP](https://github.com/linshu618/page-translator/archive/refs/heads/main.zip) 并解压。安装扩展无需构建。
2. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。开启**开发者模式**，点击**加载已解压的扩展程序**，选择含有 `manifest.json` 的文件夹。
3. 第一次点击扩展图标时，在设置里填入自己的 [DeepSeek API Key](https://platform.deepseek.com/) 并保存。可以点**测试连接**确认可用。
4. 打开想读的网页，点扩展图标或按 `Alt+T` 开始翻译。某段翻译失败时，可以直接点击该段下方的红字重试。

## API 和隐私

默认使用 DeepSeek，也可在设置里更换兼容 OpenAI Chat Completions 的接口和模型，或把译文改为繁体中文。API Key 保存在本机浏览器。翻译时，网页标题和待翻译段落会发给你配置的服务，费用由该服务商按账户用量结算。

## 开发测试

测试需要 Node.js、Playwright 和本机浏览器。默认使用 Windows 上的 Edge，可通过环境变量 `BROWSER_PATH` 指定 Chrome 或 Edge 的可执行文件。测试模拟翻译接口，无需真实 API Key。

```sh
npm install --no-save --no-package-lock playwright
node test/e2e.mjs
```

本项目采用 [MIT 许可证](LICENSE)。
