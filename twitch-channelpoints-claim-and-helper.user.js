// ==UserScript==
// @name         Twitch Auto Claim & Stream Bonus Helper (Unmuted)
// @namespace    TwitchScripts
// @version      2.8
// @description  Auto-claims channel points, set the quality to low, and reloads the stream if an error occurs.
// @author       Domopremo (Original) SulthanTriesToCode (Fork)
// @match        https://www.twitch.tv/*
// @icon         https://www.twitch.tv/favicon.ico
// @grant        none
// @license      MIT
// @run-at       document-start
// @downloadURL  https://github.com/SulthanTriesToCode/twitch-channelpoints-claim-and-helper/raw/refs/heads/main/twitch-channelpoints-claim-and-helper.user.js
// @updateURL    https://github.com/SulthanTriesToCode/twitch-channelpoints-claim-and-helper/raw/refs/heads/main/twitch-channelpoints-claim-and-helper.meta.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Feature: Trick site into thinking it's never hidden ---
  Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
  Object.defineProperty(document, 'webkitVisibilityState', { value: 'visible', writable: false });
  document.hasFocus = function () { return true; };
  const initialHidden = document.hidden;
  let didInitialPlay = false;
  let lastVideoPlaying = false;

  // visibilitychange events are captured and stopped
  document.addEventListener('visibilitychange', function (e) {
    if (document.hidden === false && initialHidden === true && didInitialPlay === false) {
      // Allow propagation to prevent black screen when a stream was opened in a new tab
    } else {
      e.stopImmediatePropagation();
    }
    if (document.hidden) {
      didInitialPlay = true;
    }

    // Try to play the video on Chrome
    if (typeof chrome !== 'undefined') {
      if (document.hidden === true) {
        const videos = document.getElementsByTagName('video');
        if (videos.length > 0) {
          lastVideoPlaying = !videos[0].paused && !videos[0].ended;
        } else {
          lastVideoPlaying = false;
        }
      } else {
        playVideo();
      }
    }
  }, true);

  function playVideo() {
    const videos = document.getElementsByTagName('video');
    if (videos.length > 0) {
      if ((didInitialPlay === false || lastVideoPlaying === true) && !videos[0].ended) {
        videos[0].play();
        didInitialPlay = true;
      }
    }
  }
  // -----------------------------------------------------------

  const CONFIG = {
    checkInterval: 5000,
    videoCheckInterval: 1000,
  };

  let state = {
    enabled: true,
    lastUrl: location.href,
    lastVideo: null,
  };

  const log = (...args) =>
    console.log('%c[Domopremo Twitch Helper]', 'color:#7fffd4;font-weight:bold;', ...args);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isVisible = el =>
    !!el && el.nodeType === 1 &&
    el.offsetParent !== null &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' &&
    getComputedStyle(el).display !== 'none';



  async function waitForSelector(selector, { root = document, timeout = 15000, interval = 100 } = {}) {
    const end = Date.now() + timeout;
    let el = root.querySelector(selector);
    while (!el && Date.now() < end) {
      await sleep(interval);
      el = root.querySelector(selector);
    }
    return el || null;
  }

  // Auto-Claim Channel Points
  function claimPoints() {
    if (!state.enabled) return;
    const btn = document.querySelector('button[aria-label="Claim Bonus"]');
    if (btn) {
      btn.click();
      log('🎁 Claimed channel points');
    }
  }

  // Adapted from change-video-quality.js
  async function setLowestQuality() {
    if (!state.enabled) return;

    log('📉 Attempting to set lowest quality...');

    // 1. Click Settings Button
    const settingsButton = await waitForSelector('[data-a-target="player-settings-button"]', { timeout: 5000 });
    if (!settingsButton) {
        log('❌ Settings button not found');
        return;
    }
    settingsButton.click();

    // 2. Click Quality Menu Item
    const qualityMenuBtn = await waitForSelector('[data-a-target="player-settings-menu-item-quality"]', { timeout: 5000 });
    if (!qualityMenuBtn) {
        log('❌ Quality menu item not found');
        return;
    }
    qualityMenuBtn.click();

    // 3. Wait for radio options
    const radioContainer = await waitForSelector('[data-a-target="tw-radio"]', { timeout: 5000 });
    if (!radioContainer) {
        log('❌ Radio options not found');
        return;
    }

    // 4. Select Quality
    const inputs = document.querySelectorAll('input[type="radio"]');
    if (inputs.length === 0) return;

    const PreferedQuality = "160p"; 
    let qualityFound = false;
    let targetInput = null;

    // Check if preferred quality exists
    for (let i = 0; i < inputs.length; i++) {
        const label = inputs[i].parentNode.textContent;
        if (label && label.includes(PreferedQuality)) {
            qualityFound = true;
            targetInput = inputs[i];
            break;
        }
    }

    if (qualityFound && targetInput) {
        targetInput.click();
        log('✅ Set to preferred quality: ' + PreferedQuality);
    } else {
        // Fallback to lowest (last option)
        const lastInput = inputs[inputs.length - 1];
        if (lastInput) {
            lastInput.click();
            const label = lastInput.parentNode.textContent;
            log('✅ Set to lowest available quality: ' + label);
        }
    }

    // 5. Close Settings (Click settings button again)
    const settingsButtonClose = await waitForSelector('[data-a-target="player-settings-button"]', { timeout: 5000 });
    if (settingsButtonClose) {
        settingsButtonClose.click();
    }
  }

  // Detect "Reload Player" button and click it
  function detectFrozenStream() {
    if (!state.enabled) return;
    try {
      const reloadPlayer = document.querySelector("[data-a-target='player-overlay-content-gate']").children[2].firstChild;
      if (reloadPlayer && reloadPlayer.firstChild && reloadPlayer.firstChild.children.length === 2) {
        reloadPlayer.click();
        log('🔁 Clicked "Reload Player" button');
      }
    } catch (err) {}
  }

  // Check for video element changes (replaces MutationObserver)
  function checkVideoChange() {
    const currentVideo = document.querySelector('video');
    if (currentVideo && currentVideo !== state.lastVideo) {
      state.lastVideo = currentVideo;
      log('🎬 New video element detected; running init actions');
      setTimeout(() => setLowestQuality(), 3000);
    }
  }

  // SPA navigation detection for Twitch
  function installSpaNavigationHooks() {
    const fire = () => window.dispatchEvent(new Event('locationchange'));
    const wrap = (type) => {
      const orig = history[type];
      return function (...args) {
        const ret = orig.apply(this, args);
        fire();
        return ret;
      };
    };
    try {
      history.pushState = wrap('pushState');
      history.replaceState = wrap('replaceState');
    } catch {}
    window.addEventListener('popstate', fire);

    setInterval(() => {
      if (location.href !== state.lastUrl) fire();
    }, 1000);

    window.addEventListener('locationchange', async () => {
      if (location.href === state.lastUrl) return;
      state.lastUrl = location.href;
      log('🔄 SPA navigation detected:', state.lastUrl);

      const v = await waitForSelector('video', { timeout: 15000 });
      if (v) {
        state.lastVideo = v;
        setTimeout(() => setLowestQuality(), 3000);
      }
    });
  }

  // Initialize
  installSpaNavigationHooks();

  // Main polling loops
  setInterval(() => {
    claimPoints();
    detectFrozenStream();
  }, CONFIG.checkInterval);

  setInterval(() => {
    checkVideoChange();
  }, CONFIG.videoCheckInterval);

  setTimeout(() => {
    setLowestQuality();
  }, 5000);
})();
