# 更新日志 / Changelog

本项目的所有重要变更都会记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
