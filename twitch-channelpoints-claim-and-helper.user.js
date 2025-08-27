// ==UserScript==
// @name         Twitch Auto Claim & Stream Bonus Helper
// @namespace    TwitchScripts
// @version      2.7
// @description  Auto-claims channel points, set the quality to low, mutes the stream, and reloads the stream if an error occurs.
// @author       Domopremo (Original) SulthanTriesToCode (Fork)
// @match        https://www.twitch.tv/*
// @icon         https://www.twitch.tv/favicon.ico
// @grant        none
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  let enabled = true;
  let didAutoMute = false;
  let lastUrl = location.href;
  let lastVideo = null;

  const log = (...args) =>
    console.log('%c[Domopremo Twitch Helper]', 'color:#7fffd4;font-weight:bold;', ...args);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isVisible = el =>
    !!el && el.nodeType === 1 &&
    el.offsetParent !== null &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' &&
    getComputedStyle(el).display !== 'none';

  // Prefer the visible gear button (handles nested/duplicated elements)
  function getSettingsButton() {
    const btns = [...document.querySelectorAll('[data-a-target="player-settings-button"]')]
      .filter(isVisible);
    if (btns.length === 0) return null;
    // Heuristic: use the last visible instance (often the interactive one)
    return btns.at(-1);
  }

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
    if (!enabled) return;
    const btn = document.querySelector('button[aria-label="Claim Bonus"]');
    if (btn) {
      btn.click();
      log('🎁 Claimed channel points');
    }
  }

  // Auto-Mute Stream ONCE (per load or navigation)
  function muteStream() {
    if (!enabled || didAutoMute) return;

    const muteBtn = document.querySelector('[data-a-target="player-mute-unmute-button"]');
    const video = document.querySelector('video');
    if (!muteBtn && !video) return;

    let acted = false;

    const label = muteBtn?.getAttribute('aria-label')?.toLowerCase() || '';
    const showsUnmute = /\bunmute\b/.test(label); // "Unmute (m)" => already muted
    const showsMute = /\bmute\b/.test(label) && !showsUnmute; // "Mute (m)" => currently unmuted

    if (video && !video.muted) {
      video.muted = true;
      video.volume = 0;
      acted = true;
    }

    if (muteBtn && showsMute) {
      muteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      acted = true;
    }

    didAutoMute = true;
    if (acted) log('🔇 Auto-muted stream (once)');
    else log('🔇 Stream already muted; will not auto-mute again until navigation/new video');
  }

  // Robustly close the settings/quality menus:
  // - If in Quality submenu: click "Back to Video Player Settings", then "Close"
  // - Else: click "Close"
  // - Fallbacks: ESC, toggle gear button, click player area
  async function closeSettingsMenuRobust() {
    const visibleMenus = () => [...document.querySelectorAll('[role="menu"]')].filter(isVisible);

    const clickItemByTextInMenus = (rx) => {
      const menus = visibleMenus();
      for (let i = menus.length - 1; i >= 0; i--) {
        const menu = menus[i];
        const all = menu.querySelectorAll('*');
        for (const el of all) {
          const text = el.textContent?.trim() || '';
          if (rx.test(text)) {
            const row = el.closest('[role="menuitem"]') ||
                        el.closest('.Layout-sc-1xcs6mc-0.dCYttJ') ||
                        el.closest('button,[role="button"]') ||
                        el;
            row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
          }
        }
      }
      return false;
    };

    // Try direct close (if at root)
    if (clickItemByTextInMenus(/^\s*close\s*$/i)) {
      await sleep(120);
      if (visibleMenus().length === 0) return;
    }

    // If in a submenu: go back first, then close
    if (clickItemByTextInMenus(/back to video player settings/i)) {
      await sleep(140);
      clickItemByTextInMenus(/^\s*close\s*$/i);
      await sleep(120);
      if (visibleMenus().length === 0) return;
    }

    // ESC fallback
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    await sleep(100);
    if (visibleMenus().length === 0) return;

    // Toggle the gear (settings) as a fallback — use robust resolver
    const gear = getSettingsButton();
    gear?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);
    if (visibleMenus().length === 0) return;

    // Click the player area to defocus/close
    const player = document.querySelector('[data-a-target="video-player"]') ||
                   document.querySelector('[data-a-player="true"]') ||
                   document.querySelector('video')?.parentElement;
    player?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  // Set Lowest Stream Quality — excludes "Auto"/"Audio Only", then closes menu
  function setLowestQuality() {
    if (!enabled) return;
    const gear = getSettingsButton();
    if (!gear) return;

    gear.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    setTimeout(() => {
      const qualityMenuBtn = [...document.querySelectorAll('[role="menuitem"]')]
        .find(el => ((el.textContent || '').toLowerCase().includes('quality')));

      if (!qualityMenuBtn) {
        setTimeout(setLowestQuality, 2000); // retry later if UI not ready
        return;
      }

      qualityMenuBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      setTimeout(() => {
        const options = [...document.querySelectorAll('[role="menuitemradio"]')];
        if (options.length === 0) return;

        const candidates = options
          .map(el => ({ el, text: (el.textContent || '').trim().toLowerCase() }))
          .filter(({ text }) => !text.includes('auto') && !text.includes('audio'))
          .map(({ el, text }) => {
            const m = text.match(/(\d{3,4})\s*p/); // 160p, 360p, 720p60 -> 720
            return { el, res: m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY };
          })
          .sort((a, b) => a.res - b.res);

        let clicked = false;
        if (candidates.length && Number.isFinite(candidates[0].res)) {
          candidates[0].el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          clicked = true;
          log('📉 Set to lowest non-auto quality');
        } else {
          const numeric = options.filter(
            el => /(\d{3,4})\s*p/i.test(el.textContent || '') && !/auto|audio/i.test((el.textContent || '').toLowerCase())
          );
          const target = numeric.at(-1) || options.find(el => !/auto/i.test((el.textContent || '').toLowerCase()));
          if (target) {
            target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            clicked = true;
          }
          log('📉 Set to lowest quality (fallback)');
        }

        if (clicked) {
          setTimeout(() => { closeSettingsMenuRobust(); }, 180);
        }
      }, 350);
    }, 350);
  }

  // Detect "Reload Player" button and click it every 10s
  function detectFrozenStream() {
    if (!enabled) return;
    const labelCandidates = document.querySelectorAll('[data-a-target="tw-core-button-label-text"]');
    for (const lbl of labelCandidates) {
      const text = (lbl.textContent || '').trim();
      if (/^click here to reload player$/i.test(text)) {
        const btn = lbl.closest('button, [role="button"]');
        if (btn) {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          log('🔁 Clicked "Reload Player" button');
          break;
        }
      }
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
      if (location.href !== lastUrl) fire();
    }, 1000);

    window.addEventListener('locationchange', async () => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      log('🔄 SPA navigation detected:', lastUrl);

      didAutoMute = false;

      const v = await waitForSelector('video', { timeout: 15000 });
      if (v) {
        lastVideo = v;
        setTimeout(() => muteStream(), 0);
        setTimeout(() => setLowestQuality(), 3000);
      }
    });
  }

  // Watch for new <video> elements (player rebuilds)
  function installVideoObserver() {
    lastVideo = document.querySelector('video') || null;

    const mo = new MutationObserver(muts => {
      claimPoints();
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const v = n.matches?.('video') ? n : n.querySelector?.('video');
          if (v && v !== lastVideo) {
            lastVideo = v;
            didAutoMute = false;
            log('🎬 New video element detected; running init actions');
            setTimeout(() => muteStream(), 0);
            setTimeout(() => setLowestQuality(), 3000);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Bonus button observer
  const bonusObserver = new MutationObserver(() => {
    claimPoints();
  });
  bonusObserver.observe(document.body, { childList: true, subtree: true });

  // Main loop
  function mainLoop() {
    claimPoints();
    muteStream(); // only acts once due to didAutoMute
  }

  // Timers
  setInterval(mainLoop, 15000);
  setInterval(detectFrozenStream, 10000);

  // Initialize
  installSpaNavigationHooks();
  installVideoObserver();

  setTimeout(() => {
    muteStream();
    setLowestQuality();
  }, 5000);
})();
