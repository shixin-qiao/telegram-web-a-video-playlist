// ==UserScript==
// @name         Telegram Web A 视频播完自动切换
// @name:en      Telegram Web A Video Playlist
// @name:zh-CN   Telegram Web A 视频播完自动切换
// @namespace    local.codex.telegram
// @version      1.7.0
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
// @downloadURL  https://raw.githubusercontent.com/shixin-qiao/telegram-web-a-video-playlist/main/src/telegram-web-a-video-playlist.user.js
// @updateURL    https://raw.githubusercontent.com/shixin-qiao/telegram-web-a-video-playlist/main/src/telegram-web-a-video-playlist.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @sandbox      JavaScript
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
  const SWITCH_TIMEOUT = 1600;        // 单次切换的最长等待时间，超过后先重试，而不是直接判定为末尾
  const SWITCH_MAX_RETRIES = 2;       // 切换超时后的重试次数，避免加载慢时误判为已到末尾
  const SKIP_DELAY = 150;             // 跳过图片前的短暂停顿
  const MAX_SKIPS = 50;               // 一次连播最多跳过多少条媒体，避免死循环
  const MAX_ADVANCE_TIME = 60000;     // 一次连播的最长持续时间
  const IMAGE_READY_TIMEOUT = 2500;   // 图片尚未加载出 URL 时，最多等待多久再继续
  const VIDEO_READY_TIMEOUT = 5000;   // 等待新视频出现并开始播放的最长时间
  const ADVANCING_RESET_DELAY = 800;  // 兜底：连播结束后多久允许再次触发
  const VIEWER_CHECK_INTERVAL = 500;  // 检查媒体查看器是否已关闭的间隔
  const GESTURE_WATCH_TIME = 1500;    // 用户点击后，多长时间内等待查看器打开视频并请求全屏
  const GESTURE_POLL_INTERVAL = 50;
  const ESC_GUARD_TIME = 500;         // 退出整页全屏后多久内的 Esc 不交给 Telegram（避免顺带关闭查看器）

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const pageDocument = pageWindow.document;

  let isAdvancing = false;
  // 用户在本次查看器会话中手动退出过整页全屏：不再主动全屏
  let userExitedFullscreen = false;
  let fullscreenRequestPending = false;
  // 是否由脚本主动退出全屏（用于区分用户手动退出）
  let scriptExitingFullscreen = false;
  let viewerWasOpen = false;
  let fullscreenRejectedLogged = false;
  // 上一次的全屏元素，用于判断进入/退出的是不是脚本的整页全屏
  let lastFullscreenElement = null;
  let lastTransitionWasPage = false;
  let pageFullscreenExitedAt = 0;
  let gestureWatchTimer = 0;

  /* ---------- 基础工具 ---------- */

  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const log = (...args) => {
    console.log(LOG_PREFIX, ...args);
  };

  // 不用 alert：弹出对话框会让浏览器强制退出全屏
  const toast = (text) => {
    log(text);
    const root = document.body || document.documentElement;
    if (!root) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
      'z-index:2147483647', 'padding:8px 16px', 'border-radius:8px',
      'background:rgba(0,0,0,.8)', 'color:#fff', 'font:14px/1.4 system-ui,sans-serif',
      'pointer-events:none',
    ].join(';');
    root.appendChild(el);
    window.setTimeout(() => el.remove(), 2000);
  };

  /* ---------- 对 Telegram 隐藏整页全屏 ----------
   * Telegram Web A 只要读到 document.fullscreenElement 有值（或收到 fullscreenchange），
   * 就会进入自己的“全屏模式”：给视频打开原生控件（双重进度条），并注销查看器的方向键/点击导航。
   * 脚本请求的是整页（documentElement）全屏，对 Telegram 而言页面布局没有任何变化，
   * 所以这里让 Telegram 看不到它：
   * - 改写 Document.prototype 上的全屏相关 getter，整页全屏时返回 null / false；
   * - 在 window 捕获阶段拦下整页全屏的 fullscreenchange，不让它传到 Telegram 的监听器。
   * Telegram 播放器自己的全屏按钮（全屏的是视频容器，不是 documentElement）不受影响。
   * 这样连播期间可以一直保持全屏，不需要每条视频退出再重进（重进没有用户手势会被浏览器拒绝）。
   */

  const realGetters = {};
  let hidePatched = false;

  const realFullscreenElementOf = (doc) => {
    const getter = realGetters.fullscreenElement || realGetters.webkitFullscreenElement;
    try {
      return (getter ? getter.call(doc) : doc.fullscreenElement) || null;
    } catch (error) {
      return null;
    }
  };

  const getRealFullscreenElement = () => realFullscreenElementOf(pageDocument);

  const isPageFullscreen = () => {
    const el = getRealFullscreenElement();
    return Boolean(el) && el === pageDocument.documentElement;
  };

  const patchFullscreenGetters = () => {
    try {
      const proto = pageWindow.Document.prototype;
      const elementProps = ['fullscreenElement', 'webkitFullscreenElement', 'webkitCurrentFullScreenElement'];
      const booleanProps = ['fullscreen', 'webkitIsFullScreen'];

      [...elementProps, ...booleanProps].forEach((prop) => {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (desc && desc.get && desc.configurable) realGetters[prop] = desc.get;
      });

      [...elementProps, ...booleanProps].forEach((prop) => {
        const originalGet = realGetters[prop];
        if (!originalGet) return;
        const hiddenValue = booleanProps.includes(prop) ? false : null;
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        Object.defineProperty(proto, prop, {
          configurable: true,
          enumerable: desc.enumerable,
          get() {
            const el = realFullscreenElementOf(this);
            if (el && el === this.documentElement) return hiddenValue;
            return originalGet.call(this);
          },
        });
      });

      hidePatched = Boolean(realGetters.fullscreenElement || realGetters.webkitFullscreenElement);
    } catch (error) {
      hidePatched = false;
      log(T('无法隐藏整页全屏，退回到“播完先退出全屏”模式', 'Could not hide page fullscreen; falling back to exiting fullscreen before advancing'), error);
    }
  };

  patchFullscreenGetters();

  /* ---------- 菜单命令 ---------- */

  const setDirection = (direction) => {
    GM_setValue(DIRECTION_KEY, direction);
    toast(T(
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
    toast(T(
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
    toast(T(
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
    toast(T(
      `连播时跳过图片已${next ? '开启' : '关闭'}`,
      `Skip images ${next ? 'enabled' : 'disabled'}`
    ));
  };

  GM_registerMenuCommand(T('切换方向：下一条 ▶', 'Direction: Next ▶'), () => setDirection('next'));
  GM_registerMenuCommand(T('切换方向：上一条 ◀', 'Direction: Previous ◀'), () => setDirection('previous'));
  GM_registerMenuCommand(T('自动全屏：开 / 关', 'Auto Fullscreen: On / Off'), toggleAutoFullscreen);
  GM_registerMenuCommand(T('连播：开 / 关', 'Playlist: On / Off'), togglePlaylist);
  GM_registerMenuCommand(T('跳过图片：开 / 关', 'Skip Images: On / Off'), toggleSkipImages);

  /* ---------- 读取媒体查看器当前状态 ---------- */

  const getViewer = () => document.querySelector('#MediaViewer[open]');

  const isViewerVideo = (target) => {
    const viewer = getViewer();
    return target instanceof HTMLVideoElement
      && target.id === 'media-viewer-video'
      && viewer?.contains(target)
      ? target
      : undefined;
  };

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
        key: 'vp:' + (poster ? poster.currentSrc || poster.src : ''),
      };
    }

    // 图片：即使 src 还没就绪（懒加载）也识别为图片，避免被当成未知媒体后误判切换失败
    const img = slide.querySelector('.MediaViewerContent img') || slide.querySelector('img');
    if (img) {
      const src = (img.currentSrc || img.src || '').trim();
      return {
        type: 'image',
        image: img,
        loading: !src,
        key: src ? 'i:' + src : 'i:loading',
      };
    }

    // 部分图片会渲染成 canvas
    const canvas = slide.querySelector('canvas');
    if (canvas) {
      return { type: 'image', image: canvas, loading: false, key: 'c' };
    }

    return { type: 'other', element: slide.firstElementChild, key: 'o' };
  };

  /* ---------- 全屏控制 ----------
   * 全屏的是整页 documentElement 而不是 <video>：元素稳定，Telegram 切换媒体时
   * 重新渲染播放器也不会中断全屏；配合上面的隐藏，连播全程只需要一次全屏请求。
   */

  const exitViewerFullscreen = () => {
    if (!isPageFullscreen()) return Promise.resolve();
    scriptExitingFullscreen = true;
    try {
      const promise = pageDocument.exitFullscreen();
      if (promise && typeof promise.then === 'function') {
        return promise.then(() => undefined, () => { scriptExitingFullscreen = false; });
      }
    } catch (error) {
      scriptExitingFullscreen = false;
    }
    return Promise.resolve();
  };

  // 隐藏失败时的兜底：退出全屏并等 Telegram 恢复导航
  const exitFullscreenAndWait = async () => {
    await Promise.race([exitViewerFullscreen(), delay(900)]);
    await delay(80);
  };

  const ensureViewerFullscreen = (reason) => {
    if (!isAutoFullscreenEnabled() || userExitedFullscreen) return;
    if (getRealFullscreenElement()) return;
    if (fullscreenRequestPending) return;

    const target = pageDocument.documentElement;
    if (!target || typeof target.requestFullscreen !== 'function') return;

    fullscreenRequestPending = true;
    const done = () => {
      fullscreenRequestPending = false;
    };
    log(T(`请求自动全屏（整页，触发：${reason}）`, `Requesting auto fullscreen (page level, trigger: ${reason})`));
    try {
      const promise = target.requestFullscreen({ navigationUI: 'hide' });
      if (promise && typeof promise.then === 'function') {
        promise.then(
          () => {
            done();
            log(T('自动全屏成功', 'Auto fullscreen entered'));
          },
          (error) => {
            done();
            if (!fullscreenRejectedLogged) {
              fullscreenRejectedLogged = true;
              log(T(
                '自动全屏被浏览器拦截（需要用户操作），点一下视频画面即可进入全屏',
                'Auto fullscreen was blocked (a user gesture is required); click the video once to enter fullscreen'
              ), error);
            }
          }
        );
      } else {
        done();
      }
    } catch (error) {
      done();
      log(T('自动全屏请求异常', 'Auto fullscreen request threw an error'), error);
    }
  };

  // 浏览器只允许在用户操作后约 5 秒内请求全屏。
  // 旧版在 play 事件里请求：视频加载慢时 play 晚于这个时间窗，全屏就失败（“时灵时不灵”）。
  // 现在在用户点击/按键的那一刻开始，等查看器打开视频后立刻请求，保证在时间窗内。
  const onUserGesture = (event) => {
    if (!event.isTrusted) return;
    if (event.type === 'keydown' && ['Escape', 'F11', 'Tab'].includes(event.key)) return;
    if (!isAutoFullscreenEnabled() || userExitedFullscreen) return;
    if (getRealFullscreenElement()) return;

    const viewer = getViewer();
    if (viewer) {
      // 查看器已打开时，只有点视频画面或用方向键切换才触发，避免点“关闭”等按钮时闪一下全屏
      const target = event.target instanceof Element ? event.target : null;
      const onVideo = event.type === 'click'
        && target && target.closest('.VideoPlayer, #media-viewer-video');
      const isArrow = event.type === 'keydown' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
      if (!onVideo && !isArrow) return;
    }

    const startedAt = Date.now();
    window.clearTimeout(gestureWatchTimer);
    const check = () => {
      if (getRealFullscreenElement() || userExitedFullscreen) return;
      const media = getActiveMedia();
      if (media && media.type === 'video') {
        ensureViewerFullscreen(event.type);
        return;
      }
      if (Date.now() - startedAt < GESTURE_WATCH_TIME) {
        gestureWatchTimer = window.setTimeout(check, GESTURE_POLL_INTERVAL);
      }
    };
    check();
  };

  document.addEventListener('click', onUserGesture, true);
  document.addEventListener('keydown', onUserGesture, true);

  const resetViewerFullscreenState = () => {
    userExitedFullscreen = false;
    fullscreenRequestPending = false;
    fullscreenRejectedLogged = false;
  };

  /* ---------- 连播控制 ---------- */

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

  // 判断是否还是同一个媒体：key 不变且 DOM 元素没换，才算没切换
  const isSameMedia = (previous, current) => {
    if (!previous || !current) return false;
    if (previous.key !== current.key) return false;
    if (previous.video && current.video && previous.video !== current.video) return false;
    if (previous.image && current.image && previous.image !== current.image) return false;
    if (previous.element && current.element && previous.element !== current.element) return false;
    return true;
  };

  // 等待媒体切换完成
  // 返回 { status: 'changed', media } / { status: 'timeout', media } / { status: 'closed' }
  const waitForMediaChange = async (previousMedia) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < SWITCH_TIMEOUT) {
      const media = getActiveMedia();
      if (!media) return { status: 'closed' };
      if (!isSameMedia(previousMedia, media)) return { status: 'changed', media };
      await delay(SWITCH_POLL_INTERVAL);
    }
    const media = getActiveMedia();
    if (!media) return { status: 'closed' };
    if (!isSameMedia(previousMedia, media)) return { status: 'changed', media };
    return { status: 'timeout', media };
  };

  // 图片还没加载出 URL 时稍等它加载，避免因为拿不到地址而误判
  const waitForImageReady = async (image, timeout) => {
    if (!image || image.tagName !== 'IMG') return;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const src = (image.currentSrc || image.src || '').trim();
      if (src && image.complete) return;
      await delay(100);
    }
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
  // - 遇到图片且“跳过图片”开启：继续跳过（图片加载中会稍等）
  // - 遇到图片且“跳过图片”关闭：停在这张图片上
  // - 切换超时会先重试，仍无变化才视为已到末尾并退出全屏
  const advanceToNextVideo = async () => {
    const startedAt = Date.now();
    let skips = 0;
    let retries = 0;
    let foundNextMedia = false;

    const first = getActiveMedia();
    if (!first) {
      finishAdvancing();
      return;
    }
    let previousMedia = first;

    while (skips < MAX_SKIPS && Date.now() - startedAt < MAX_ADVANCE_TIME) {
      dispatchNavigationKey();
      skips += 1;

      const result = await waitForMediaChange(previousMedia);
      if (result.status === 'closed') break;

      if (result.status === 'timeout') {
        retries += 1;
        log(T(
          `连播切换超时（第 ${retries} 次），媒体可能加载较慢或已到末尾`,
          `Playlist switch timed out (attempt ${retries}); the media may be loading slowly or this is the end`
        ));
        if (retries >= SWITCH_MAX_RETRIES) break;
        continue;
      }

      retries = 0;
      const media = result.media;
      previousMedia = media;

      if (media.type === 'video') {
        foundNextMedia = await waitForVideo();
        break;
      }

      if (media.type === 'image' && !isSkipImagesEnabled()) {
        // 关闭“跳过图片”时停在这张图片上
        foundNextMedia = true;
        break;
      }

      if (media.type === 'image' && media.loading) {
        log(T('图片仍在加载，稍等后继续跳过', 'Image is still loading, waiting before skipping'));
        await waitForImageReady(media.image, IMAGE_READY_TIMEOUT);
      } else if (media.type === 'other') {
        log(T('遇到未识别的媒体，尝试继续跳过', 'Unknown media type, trying to skip it'));
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
    exitViewerFullscreen();
    resetViewerFullscreenState();
    isAdvancing = false;
  };

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
    // 兜底：仍处在用户操作的有效期内时才请求全屏，避免无意义的被拒请求
    const activation = navigator.userActivation;
    if (!activation || activation.isActive) ensureViewerFullscreen('play');
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

    if (document.pictureInPictureElement === video && document.exitPictureInPicture) {
      await document.exitPictureInPicture().catch(() => undefined);
    }
    // 整页全屏已对 Telegram 隐藏：保持全屏直接切换。
    // 只有隐藏失败（Telegram 能看到全屏、导航被禁用）时才退回旧做法：先退出全屏再切换。
    if (!hidePatched && isPageFullscreen()) {
      await exitFullscreenAndWait();
    }
    await delay(100);
    advanceToNextVideo().catch(() => {
      isAdvancing = false;
    });
  }, true);

  // window 捕获阶段最先收到事件：先更新脚本状态，再决定是否对 Telegram 隐藏
  const onFullscreenChange = (event) => {
    const current = getRealFullscreenElement();
    const previous = lastFullscreenElement;
    const docEl = pageDocument.documentElement;

    if (current !== previous) {
      lastFullscreenElement = current;
      lastTransitionWasPage = current === docEl || previous === docEl;

      if (current) {
        scriptExitingFullscreen = false;
        log(T(
          `进入全屏（${current === docEl ? '整页' : '其他元素'}）`,
          `Entered fullscreen (${current === docEl ? 'page' : 'other element'})`
        ));
      } else {
        const byScript = scriptExitingFullscreen;
        scriptExitingFullscreen = false;
        if (previous === docEl) pageFullscreenExitedAt = Date.now();
        log(T(
          `退出全屏（${previous === docEl ? '整页' : '其他元素'}，脚本主动=${byScript}）`,
          `Exited fullscreen (${previous === docEl ? 'page' : 'other element'}, byScript=${byScript})`
        ));
        // 整页全屏对 Telegram 隐藏后，Telegram 不会自己退出它；不是脚本退出的就是用户退出
        if (previous === docEl && !byScript) {
          userExitedFullscreen = true;
          log(T(
            '检测到手动退出全屏：本次查看器会话不再自动全屏',
            'Manual fullscreen exit detected: auto fullscreen disabled for this viewer session'
          ));
        }
      }
    }

    if (hidePatched && lastTransitionWasPage) {
      event.stopImmediatePropagation();
    }
  };

  window.addEventListener('fullscreenchange', onFullscreenChange, true);
  window.addEventListener('webkitfullscreenchange', onFullscreenChange, true);

  // Telegram 不知道页面处于全屏，Esc 退出全屏时会把它当成“关闭查看器”。
  // 整页全屏期间（和刚退出时）的 Esc 只用来退出全屏，不交给 Telegram。
  // 媒体查看器是原生 modal <dialog>：只拦 keydown 不够，Esc 的默认动作会让浏览器发出关闭请求，
  // 所以还要 preventDefault，并兜底拦下 dialog 的 cancel 事件（cancel 不冒泡，但捕获阶段能收到）。
  const shouldGuardEsc = () => (
    hidePatched && (isPageFullscreen() || Date.now() - pageFullscreenExitedAt < ESC_GUARD_TIME)
  );

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !shouldGuardEsc()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('cancel', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.id !== 'MediaViewer' || !shouldGuardEsc()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
