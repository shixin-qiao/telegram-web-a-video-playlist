// ==UserScript==
// @name         Telegram Web A 视频播完自动切换
// @name:en      Telegram Web A Video Playlist
// @name:zh-CN   Telegram Web A 视频播完自动切换
// @namespace    local.codex.telegram
// @version      1.5.1
// @description  Telegram Web A 媒体查看器视频连播器：视频播放时自动整页全屏，播放结束自动连播下一条/上一条，图片自动跳过；连播、自动全屏、跳过图片均可独立开关。
// @description:en  Telegram Web A media viewer video playlist: auto fullscreen on play, auto-play the next/previous video when one ends, and auto-skip images. Playlist, auto fullscreen and image skipping are configurable.
// @description:zh-CN  Telegram Web A 媒体查看器视频连播器：视频播放时自动整页全屏，播放结束自动连播下一条/上一条，图片自动跳过；连播、自动全屏、跳过图片均可独立开关。
// @match        https://web.telegram.org/a/*
// @run-at       document-start
// @noframes
// @icon         https://raw.githubusercontent.com/shixin-qiao/telegram-web-a-video-playlist/main/docs/icon.svg
// @author       shixin-qiao
// @license      MIT
// @homepageURL  https://github.com/shixin-qiao/telegram-web-a-video-playlist
// @supportURL   https://github.com/shixin-qiao/telegram-web-a-video-playlist/issues
// @compatible   chrome
// @compatible   edge
// @downloadURL  https://raw.githubusercontent.com/shixin-qiao/telegram-web-a-video-playlist/main/telegram-web-a-video-playlist.user.js
// @updateURL    https://raw.githubusercontent.com/shixin-qiao/telegram-web-a-video-playlist/main/telegram-web-a-video-playlist.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const DIRECTION_KEY = 'direction';
  const DEFAULT_DIRECTION = 'next';
  const AUTO_FULLSCREEN_KEY = 'autoFullscreen';
  const DEFAULT_AUTO_FULLSCREEN = true;
  const PLAYLIST_ENABLED_KEY = 'playlistEnabled';
  const DEFAULT_PLAYLIST_ENABLED = true;
  const SKIP_IMAGES_KEY = 'skipImages';
  const DEFAULT_SKIP_IMAGES = true;
  const LOG_PREFIX = '[TG Playlist]';

  // 语言：中文优先，仅英文环境使用英文
  const isEn = /^en/i.test(navigator.language || '');
  const T = (zh, en) => (isEn ? en : zh);

  // 连播参数
  const SWITCH_POLL_INTERVAL = 100;   // 检查媒体是否已切换的间隔
  const SWITCH_TIMEOUT = 1600;        // 单次切换的最长等待时间，超过视为无法切换（已到末尾）
  const SKIP_DELAY = 150;             // 跳过图片前的短暂停顿
  const MAX_SKIPS = 50;               // 一次连播最多跳过多少条媒体，避免死循环
  const MAX_ADVANCE_TIME = 60000;     // 一次连播的最长持续时间
  const VIDEO_READY_TIMEOUT = 2500;   // 等待新视频出现并开始播放的最长时间
  const ADVANCING_RESET_DELAY = 800;  // 兜底：连播结束后多久允许再次触发
  const VIEWER_CHECK_INTERVAL = 800;  // 检查媒体查看器是否已关闭的间隔

  let isAdvancing = false;
  // 用户在本次查看器会话中手动退出过全屏：不再主动全屏（无用户手势也无法再次全屏）
  let userExitedFullscreen = false;
  let fullscreenRequestPending = false;
  // 是否由脚本主动退出全屏（用于区分用户手动退出）
  let scriptExitingFullscreen = false;
  let viewerWasOpen = false;
  let fullscreenRejectedLogged = false;

  /* ---------- 菜单命令 ---------- */

  const setDirection = (direction) => {
    GM_setValue(DIRECTION_KEY, direction);
    window.alert(T(
      `Telegram 视频自动切换方向已设为：${direction === 'next' ? '下一条' : '上一条'}`,
      `Playback direction set to: ${direction === 'next' ? 'Next' : 'Previous'}`
    ));
  };

  const isAutoFullscreenEnabled = () => (
    GM_getValue(AUTO_FULLSCREEN_KEY, DEFAULT_AUTO_FULLSCREEN) !== false
  );

  const toggleAutoFullscreen = () => {
    const next = !isAutoFullscreenEnabled();
    GM_setValue(AUTO_FULLSCREEN_KEY, next);
    if (!next) exitViewerFullscreen();
    window.alert(T(
      `视频自动全屏已${next ? '开启' : '关闭'}`,
      `Auto fullscreen ${next ? 'enabled' : 'disabled'}`
    ));
  };

  const isPlaylistEnabled = () => (
    GM_getValue(PLAYLIST_ENABLED_KEY, DEFAULT_PLAYLIST_ENABLED) !== false
  );

  const togglePlaylist = () => {
    const next = !isPlaylistEnabled();
    GM_setValue(PLAYLIST_ENABLED_KEY, next);
    window.alert(T(
      `视频连播已${next ? '开启' : '关闭'}`,
      `Video playlist ${next ? 'enabled' : 'disabled'}`
    ));
  };

  const isSkipImagesEnabled = () => (
    GM_getValue(SKIP_IMAGES_KEY, DEFAULT_SKIP_IMAGES) !== false
  );

  const toggleSkipImages = () => {
    const next = !isSkipImagesEnabled();
    GM_setValue(SKIP_IMAGES_KEY, next);
    window.alert(T(
      `连播时跳过图片已${next ? '开启' : '关闭'}`,
      `Skip images ${next ? 'enabled' : 'disabled'}`
    ));
  };

  GM_registerMenuCommand(T('切换方向：下一条 ▶', 'Direction: Next ▶'), () => setDirection('next'));
  GM_registerMenuCommand(T('切换方向：上一条 ◀', 'Direction: Previous ◀'), () => setDirection('previous'));
  GM_registerMenuCommand(T('自动全屏：开 / 关', 'Auto Fullscreen: On / Off'), toggleAutoFullscreen);
  GM_registerMenuCommand(T('连播：开 / 关', 'Playlist: On / Off'), togglePlaylist);
  GM_registerMenuCommand(T('跳过图片：开 / 关', 'Skip Images: On / Off'), toggleSkipImages);

  /* ---------- 基础工具 ---------- */

  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const log = (...args) => {
    console.log(LOG_PREFIX, ...args);
  };

  const isViewerVideo = (target) => {
    const viewer = document.querySelector('#MediaViewer[open]');
    return target instanceof HTMLVideoElement
      && target.id === 'media-viewer-video'
      && viewer?.contains(target)
      ? target
      : undefined;
  };

  const dispatchNavigationKey = () => {
    const direction = GM_getValue(DIRECTION_KEY, DEFAULT_DIRECTION);
    const isPrevious = direction === 'previous';
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: isPrevious ? 'ArrowLeft' : 'ArrowRight',
      code: isPrevious ? 'ArrowLeft' : 'ArrowRight',
      bubbles: true,
      cancelable: true,
    }));
  };

  const leavePictureInPicture = async (video) => {
    if (document.pictureInPictureElement === video && document.exitPictureInPicture) {
      await document.exitPictureInPicture().catch(() => undefined);
    }
  };

  /* ---------- 读取媒体查看器当前状态 ---------- */

  const getViewer = () => document.querySelector('#MediaViewer[open]');

  const getActiveSlide = () => {
    const viewer = getViewer();
    return viewer ? viewer.querySelector('.MediaViewerSlide--active') : null;
  };

  const getActiveMedia = () => {
    const slide = getActiveSlide();
    if (!slide) return null;

    const video = slide.querySelector('video');
    if (video) {
      return {
        type: 'video',
        video,
        key: 'v:' + (video.currentSrc || video.src || ''),
      };
    }

    // 视频播放器已经渲染、video 元素还没创建时也按视频处理，避免被误判成图片跳过
    if (slide.querySelector('.VideoPlayer')) {
      const poster = slide.querySelector('.MediaViewerContent img') || slide.querySelector('img');
      return {
        type: 'video',
        video: null,
        key: 'vp:' + (poster ? poster.currentSrc || poster.src : '') + ':' + slide.querySelectorAll('*').length,
      };
    }

    const img = slide.querySelector('.MediaViewerContent img') || slide.querySelector('img');
    if (img && (img.currentSrc || img.src)) {
      return {
        type: 'image',
        key: 'i:' + (img.currentSrc || img.src),
      };
    }

    return { type: 'other', key: 'o:' + slide.querySelectorAll('*').length };
  };

  /* ---------- 全屏控制 ----------
   * 全屏的是整页 documentElement 而不是 <video>：
   * - 元素稳定，Web A 切换媒体时 React 重新渲染播放器不会中断全屏；
   * - 连播期间保持全屏，不需要在没有用户手势时再次 requestFullscreen（浏览器会拒绝）。
   */

  const exitViewerFullscreen = () => {
    if (!document.fullscreenElement || document.fullscreenElement !== document.documentElement) return;
    scriptExitingFullscreen = true;
    try {
      const promise = document.exitFullscreen();
      if (promise && typeof promise.then === 'function') {
        // fullscreenchange 是异步的，这里兜底复位标志
        promise.then(
          () => { scriptExitingFullscreen = false; },
          () => { scriptExitingFullscreen = false; }
        );
      }
    } catch (error) {
      scriptExitingFullscreen = false;
    }
  };

  const ensureViewerFullscreen = () => {
    if (!isAutoFullscreenEnabled() || userExitedFullscreen) return;
    if (document.fullscreenElement) return;
    if (fullscreenRequestPending) return;

    const target = document.documentElement;
    if (!target || typeof target.requestFullscreen !== 'function') return;

    fullscreenRequestPending = true;
    const done = () => {
      fullscreenRequestPending = false;
    };
    try {
      const promise = target.requestFullscreen();
      if (promise && typeof promise.then === 'function') {
        promise.then(done, () => {
          done();
          if (!fullscreenRejectedLogged) {
            fullscreenRejectedLogged = true;
            log(T(
              '自动全屏被浏览器拦截（需要用户手势），再次播放时会重试',
              'Auto fullscreen was blocked (a user gesture is required); it will retry on the next play'
            ));
          }
        });
      } else {
        done();
      }
    } catch (error) {
      done();
    }
  };

  const resetViewerFullscreenState = () => {
    userExitedFullscreen = false;
    fullscreenRequestPending = false;
  };

  /* ---------- 连播控制 ---------- */

  const ensureVideoPlays = (video) => {
    if (!video || !video.paused) return;
    try {
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => undefined);
      }
    } catch (error) {
      // 浏览器拦截自动播放时忽略，用户可以手动点击播放
    }
  };

  // 等待媒体切换完成；返回 null 表示查看器已关闭或切换超时（通常说明已到末尾）
  const waitForMediaChange = async (previousKey) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < SWITCH_TIMEOUT) {
      const media = getActiveMedia();
      if (!media) return null;
      if (media.key !== previousKey) return media;
      await delay(SWITCH_POLL_INTERVAL);
    }
    return null;
  };

  // 等待新视频元素出现并开始播放
  const waitForVideo = async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < VIDEO_READY_TIMEOUT) {
      const media = getActiveMedia();
      if (!media) return false;
      if (media.type === 'video' && media.video) {
        ensureVideoPlays(media.video);
        // 稍等片刻，确认媒体没有再被切换走
        await delay(150);
        const latest = getActiveMedia();
        if (latest && latest.type === 'video' && latest.video) {
          ensureVideoPlays(latest.video);
          return true;
        }
        continue;
      }
      await delay(120);
    }
    return false;
  };

  const finishAdvancing = () => {
    window.setTimeout(() => {
      isAdvancing = false;
    }, ADVANCING_RESET_DELAY);
  };

  // 视频播完后：保持全屏，向后（或向前）寻找下一个媒体
  // - 遇到视频：自动播放
  // - 遇到图片且“跳过图片”开启：继续跳过
  // - 遇到图片且“跳过图片”关闭：停在这张图片上
  // - 没有更多媒体：退出全屏
  const advanceToNextVideo = async () => {
    const startedAt = Date.now();
    let skips = 0;
    let foundNextMedia = false;

    const first = getActiveMedia();
    if (!first) {
      finishAdvancing();
      return;
    }
    let previousKey = first.key;

    while (skips < MAX_SKIPS && Date.now() - startedAt < MAX_ADVANCE_TIME) {
      dispatchNavigationKey();
      skips += 1;

      const media = await waitForMediaChange(previousKey);
      if (!media) {
        // 切换没有生效（已经是最后一条）或查看器已关闭，结束连播
        break;
      }
      previousKey = media.key;

      if (media.type === 'video') {
        foundNextMedia = await waitForVideo();
        break;
      }

      if (media.type === 'image' && !isSkipImagesEnabled()) {
        // 关闭“跳过图片”时停在这张图片上
        foundNextMedia = true;
        break;
      }

      // 图片 / 其他媒体：保持全屏，继续向后寻找视频
      await delay(SKIP_DELAY);
    }

    // 没有可停留的媒体（或查看器已关闭）：结束连播，退出全屏
    if (!foundNextMedia) {
      log(T('已到最后一条媒体，退出全屏', 'Reached the last media, exiting fullscreen'));
      exitViewerFullscreen();
    }
    finishAdvancing();
  };

  /* ---------- 查看器关闭处理 ---------- */

  const onViewerClosed = () => {
    if (document.fullscreenElement === document.documentElement) {
      exitViewerFullscreen();
    }
    resetViewerFullscreenState();
    fullscreenRejectedLogged = false;
    isAdvancing = false;
  };

  document.addEventListener('close', (event) => {
    if (event.target && event.target.id === 'MediaViewer') {
      onViewerClosed();
    }
  }, true);

  // 兜底：轮询检测查看器从打开变为关闭
  window.setInterval(() => {
    const isOpen = Boolean(getViewer());
    if (viewerWasOpen && !isOpen) {
      onViewerClosed();
    }
    viewerWasOpen = isOpen;
  }, VIEWER_CHECK_INTERVAL);

  /* ---------- 事件监听 ---------- */

  document.addEventListener('play', (event) => {
    const video = isViewerVideo(event.target);
    if (!video) return;
    // 循环视频（GIF）只播放一遍，播完才能触发 ended 继续连播
    if (video.loop) video.loop = false;
    // 视频开始播放时自动全屏（第一次由打开查看器的用户手势授权）
    ensureViewerFullscreen();
    // 视频已真正开始播放：允许它播完后触发下一轮连播
    isAdvancing = false;
  }, true);

  document.addEventListener('ended', async (event) => {
    const video = isViewerVideo(event.target);
    if (!video || isAdvancing) return;
    // 连播关闭时保留自动全屏能力，但不自动切换
    if (!isPlaylistEnabled()) return;

    isAdvancing = true;
    log(T('视频播放结束，准备连播下一条', 'Video ended, advancing to the next one'));
    // 只退出画中画，全屏保持，连播期间不再重新请求全屏
    await leavePictureInPicture(video);
    window.setTimeout(() => {
      advanceToNextVideo().catch(() => {
        isAdvancing = false;
      });
    }, 100);
  }, true);

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !scriptExitingFullscreen) {
      // 用户主动退出全屏：本次查看器会话不再自动全屏
      userExitedFullscreen = true;
    }
    scriptExitingFullscreen = false;
  }, true);
})();
