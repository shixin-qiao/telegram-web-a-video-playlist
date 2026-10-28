# 更新日志 / Changelog

本项目的所有重要变更都会记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.6.1] - 2026-10-28

### 变更 Changed
- 脚本文件移动到 `src/telegram-web-a-video-playlist.user.js`，仓库根目录只保留文档与配置。
  Moved the userscript to `src/telegram-web-a-video-playlist.user.js`; the repository root now keeps only docs and config.
- `@downloadURL` / `@updateURL`、README 安装链接与贡献指南中的路径同步更新。
  Updated `@downloadURL` / `@updateURL`, README install links and CONTRIBUTING paths.

> 注意：因为安装/更新地址发生变化，已经安装旧版本的脚本无法自动检查更新，需要按 README 重新安装一次。
> Note: because the install/update URL changed, existing installations cannot auto-update; reinstall once from the README link.

## [1.6.0] - 2026-10-28

### 修复 Fixed
- 修复全屏播放时出现双重进度条、上一条/下一条按钮失灵、连播无法切换的问题。
  Fixed double progress bars, broken prev/next buttons and stalled playlist switching during fullscreen playback.
  原因：Telegram Web A 只要检测到页面上有任何全屏元素，就会进入「全屏模式」——给视频打开浏览器原生控件（与它自己的控件叠加成双重进度条），并注销媒体查看器的方向键和点击导航。现在视频播放结束后会先退出全屏，再切换下一条。
  Cause: Telegram Web A treats any fullscreen element as "fullscreen mode" — it enables native video controls (stacking with its own) and disables the media viewer's keyboard/click navigation. The script now exits fullscreen before advancing.

### 变更 Changed
- 连播流程改为：视频播放时自动全屏 → 播放结束先退出全屏 → 切换到下一条 → 下一条视频播放时再次尝试自动全屏。
  Playlist flow: auto fullscreen while playing → exit fullscreen when the video ends → advance → try fullscreen again on the next video.
- 重新进入全屏需要浏览器的用户手势，自动连播时可能被浏览器拒绝；被拒时保持普通模式继续连播，不中断。
  Re-entering fullscreen requires a user gesture and may be rejected during autoplay; the playlist then continues in normal mode without stopping.

## [1.5.3] - 2026-10-28

### 修复 Fixed
- 修复连播时全屏状态异常：用户手动全屏了视频元素、或 Telegram 在切换媒体时自行退出全屏，会被误判为「用户主动退出全屏」，导致本次查看器会话后续视频不再自动全屏。
  Fixed inconsistent fullscreen state during the playlist: manual video-element fullscreen or Telegram's own fullscreen cleanup while switching media was misread as a user exit, disabling auto fullscreen for the rest of the session.
- 现在只有「脚本请求的整页全屏被用户主动退出」才会停用自动全屏；媒体切换、元素替换造成的退出会在下一个视频播放时自动恢复全屏。
  Auto fullscreen is now disabled only when the script's page-level fullscreen is exited by the user; exits caused by media switching or element replacement are recovered on the next video.

### 新增 Added
- 控制台新增全屏状态日志（请求 / 进入 / 退出及退出原因），便于排查全屏问题。
  Added fullscreen state logs (request / enter / exit with reason) to the console for easier troubleshooting.

## [1.5.2] - 2026-10-28

### 修复 Fixed
- 修复个别图片（尤其是懒加载、`src` 尚未就绪的图片）识别失败，导致连播提前结束、停在该图片上的问题。
  Fixed some images (especially lazy-loaded ones without a ready `src`) not being recognized, which ended the playlist early.
- 切换判定改为同时比较媒体 key 与 DOM 元素，避免元素已替换但 key 相同造成误判。
  Media change detection now compares both the key and the DOM element, avoiding false negatives when the key stays the same.
- 切换超时不再直接当作已到末尾：会先重试 2 次，仍无法切换才退出全屏。
  A switch timeout no longer ends the playlist immediately: it retries twice before concluding the playlist has ended.
- 视频加载等待时间从 2.5 秒延长到 5 秒，避免网络较慢时提前放弃。
  Extended the video-ready wait from 2.5s to 5s for slower networks.

### 新增 Added
- 图片识别兼容 `src` 未就绪的 `<img>` 与 `<canvas>` 渲染的图片，加载中会短暂等待再继续跳过。
  Recognize images before `src` is ready and support canvas-rendered images; wait briefly while loading.
- 连播过程中出现切换超时、图片加载、未识别媒体时，控制台会输出 `[TG Playlist]` 日志，便于反馈问题。
  Added `[TG Playlist]` console logs for switch timeouts, image loading and unknown media types.

## [1.5.1] - 2026-10-18

### 新增 Added
- 脚本图标改为 SVG 手绘的左右双箭头图标，通过 `@icon` 元数据引用。
  Replaced the script icon with a hand-drawn SVG double-arrow icon, referenced via `@icon`.

## [1.5.0] - 2026-10-18

### 新增 Added
- 菜单新增「连播：开 / 关」与「跳过图片：开 / 关」两个独立开关（中英双语）。
  Added independent "Playlist" and "Skip images" menu toggles (Chinese/English).
- 脚本内置中英双语界面文案，中文优先，仅英文环境显示英文。
  Built-in Chinese/English UI text: Chinese-first, English only in English environments.
- 脚本元数据补充作者、许可证、主页、问题反馈与浏览器兼容声明。
  Added author, license, homepage, support URL and browser compatibility metadata.
- 自动全屏被浏览器拦截时，控制台会提示一次并说明会在下次播放时重试。
  A console hint is emitted once when auto fullscreen is blocked, explaining the retry.

### 变更 Changed
- 关闭「跳过图片」后，连播会停在下一条图片上，而不是继续向后寻找视频。
  With "Skip images" off, the playlist stops on the next image instead of continuing to the next video.

## [1.4.0] - 2026-10-18

### 变更 Changed
- 连播期间保持全屏，避免连播时二次全屏被浏览器拒绝（Fullscreen API 需要用户手势）。
  Keep fullscreen during the whole playlist to avoid a blocked second fullscreen request.
- 全屏对象从 `<video>` 改为整页 `documentElement`，避免 React 重渲染打断全屏。
  Fullscreen target changed from `<video>` to `documentElement` for stability.

## [1.3.0] - 2026-10-18

### 新增 Added
- 视频开始播放时自动全屏；播完退出全屏再切下一条（该策略在连播时不稳定，1.4.0 已调整）。
  Auto fullscreen on play; exit fullscreen before advancing (unstable in playlists, superseded by 1.4.0).

## [1.2.0] - 2026-10-18

### 新增 Added
- 视频播完自动切换，并自动跳过图片。
  Auto-advance after a video ends, skipping images.

## [1.1.0] - 2026-10-18

### 新增 Added
- 视频播完切换到下一条/上一条（原始版本）。
  Auto-advance to the next/previous media (initial version).
