# 贡献指南 / Contributing

感谢你愿意为这个项目做贡献！无论是报告问题、提出建议还是提交代码，都很有帮助。
Thanks for your interest in contributing! Bug reports, feature ideas and pull requests are all welcome.

## 报告问题 / Reporting issues

- 请使用 [Issue 模板](https://github.com/shixin-qiao/telegram-web-a-video-playlist/issues/new/choose) 提交。
- 尽量说明：浏览器与版本、脚本版本、复现步骤、期望与实际行为。
- 按 `F12` 打开开发者工具，在控制台筛选 `[TG Playlist]`，把相关日志一并贴上。

- Please use the issue template and include your browser/version, script version,
  steps to reproduce, expected vs. actual behavior, and the `[TG Playlist]` console logs.

## 提交代码 / Pull requests

1. Fork 本仓库并从 `main` 创建分支：`feat/xxx` 或 `fix/xxx`。
2. 修改 `telegram-web-a-video-playlist.user.js`，保持原有代码风格（2 空格缩进、中文注释优先）。
3. 运行本地测试，确认通过。
4. 提交 PR 并在描述中说明改动目的、影响范围和验证方式。

1. Fork the repo and create a branch from `main`: `feat/xxx` or `fix/xxx`.
2. Edit `telegram-web-a-video-playlist.user.js` and keep the existing code style.
3. Run the local tests and make sure they pass.
4. Open a PR describing the purpose, impact and how it was verified.

## 本地开发 / Local development

脚本是单文件用户脚本，无构建步骤：
- 在 Tampermonkey 中新建脚本，粘贴代码即可调试；
- 关注媒体查看器的 DOM：`#MediaViewer[open]`、`.MediaViewerSlide--active`、`video#media-viewer-video`；
- 主要事件：`play`、`ended`、`fullscreenchange`，方向键切换通过 `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))` 模拟。

The script is a single-file userscript with no build step. Debug it by creating a new
Tampermonkey script locally. Key DOM: `#MediaViewer[open]`, `.MediaViewerSlide--active`,
`video#media-viewer-video`. Key events: `play`, `ended`, `fullscreenchange`.

## 行为准则 / Code of conduct

保持友善、就事论事。请勿在 Issue 或 PR 中讨论与服务条款相冲突的用法。
Be kind and constructive. Do not use issues or PRs to discuss anything that conflicts with
the service's terms of use.
