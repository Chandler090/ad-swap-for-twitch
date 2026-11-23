// The go-between for the Twitch page and the extension.
//
// The main script (adswap.user.js) runs inside the page itself so it can work with Twitch's
// players, and from there it cannot reach the extension's storage. This helper can. It does
// four small jobs:
//
//   1. Copies the viewer's settings onto the page as attributes on <html>, which the main
//      script reads:
//        data-adswap-fit   "fill" | "actual"       how big the stream is drawn during a swap
//        data-adswap-mini  "ad" | "hide" | "video" | "clips"  what the small player shows during a swap
//        data-adswap-sound "stream" | "small"      which of the two is heard during a swap
//        data-adswap-full  "video" | "clips" | "hide" | "ad"  what covers an ad that cannot be swapped
//        data-adswap-videos  how many videos the viewer has added (so "video" can fall back)
//        data-adswap-reload "off" | "on"         reload the page for a break with no small player
//   2. Tells the page where the extension's own pages live (data-adswap-base), so the main
//      script can show the viewer's own videos.
//   3. Keeps the running totals for the popup ("12 ad breaks swapped"), from the message the
//      main script sends when a swap ends.
//   4. Notices when the extension has been updated while this page stayed open. The page is
//      then running an old copy that no longer hears the popup; it marks the page
//      (data-adswap-stale) so the banner can ask for a refresh.
//   5. Passes the keyboard shortcut from the background script to the page, and an "ad break
//      over" from the page to the background script (for the notification), but only when
//      the viewer is not looking at this tab.
//   6. Saves the choice made on the card over an ad ("Show the streamer's clips instead").
//
// When AdSwap is installed or updated, background.js also puts this file into Twitch tabs that
// are already open, so they need no refresh. It must then run only once per tab, and it takes
// over from the old copy, whose "out of date" mark it clears.
(function () {
  'use strict';

  if (window.__adswapBridge) return;        // this copy is already running in this tab
  window.__adswapBridge = true;

  function mark(name, value) {
    if (document.documentElement) document.documentElement.setAttribute(name, value);
  }
  function apply(saved) {
    saved = saved || {};
    mark('data-adswap-fit', saved.fit === 'actual' ? 'actual' : 'fill');
    mark('data-adswap-mini', saved.mini === 'hide' || saved.mini === 'video' || saved.mini === 'clips' ? saved.mini : 'ad');
    mark('data-adswap-sound', saved.sound === 'small' ? 'small' : 'stream');
    mark('data-adswap-full', saved.full === 'hide' || saved.full === 'ad' || saved.full === 'clips' ? saved.full : 'video');
    mark('data-adswap-videos', String(Math.max(0, parseInt(saved.videos, 10) || 0)));
    mark('data-adswap-reload', saved.reload === 'on' ? 'on' : 'off');
  }
  function connected() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  var SETTINGS = { fit: 'fill', mini: 'ad', sound: 'stream', full: 'video', videos: 0, reload: 'off' };

  try {
    mark('data-adswap-base', chrome.runtime.getURL(''));
    chrome.storage.local.get(SETTINGS, apply);
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.fit || changes.mini || changes.sound || changes.full || changes.videos || changes.reload) chrome.storage.local.get(SETTINGS, apply);
    });

    // A swap ended. Only this page's own messages count, and only sensible lengths.
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (e.source !== window || !d || d.source !== 'adswap' || d.type !== 'swapped') return;
      var seconds = Math.round(Number(d.seconds));
      if (!(seconds >= 3 && seconds <= 3600) || !connected()) return;
      try {
        chrome.storage.local.get({ swaps: 0, seconds: 0 }, function (t) {
          chrome.storage.local.set({ swaps: (t.swaps || 0) + 1, seconds: (t.seconds || 0) + seconds });
        });
      } catch (err) {}
    });

    // An ad break ended. A notification is only any use if the viewer is looking elsewhere.
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (e.source !== window || !d || d.source !== 'adswap' || d.type !== 'breakOver') return;
      if (document.visibilityState === 'visible' || !connected()) return;
      try {
        chrome.runtime.sendMessage({ type: 'breakOver', channel: String(d.channel || '').slice(0, 40) })
          .catch(function () {});
      } catch (err) {}
    });

    // The viewer pressed "Show the streamer's clips instead" on the card over an ad: save it as
    // their choice for ads that can't be swapped, the same as picking it in the popup.
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (e.source !== window || !d || d.source !== 'adswap' || d.type !== 'setFull' || !connected()) return;
      if (d.value !== 'clips' && d.value !== 'video' && d.value !== 'hide' && d.value !== 'ad') return;
      try { chrome.storage.local.set({ full: d.value }); } catch (err) {}
    });

    // The keyboard shortcut was pressed while this tab was in front.
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'coverNow') window.postMessage({ source: 'adswap-ext', type: 'coverToggle' }, location.origin);
    });

    // An older copy left in this tab marks the page out of date a few seconds after the update.
    // This copy is current, so that mark does not apply: take it off, now and whenever it comes.
    var root = document.documentElement;
    if (root && connected()) root.removeAttribute('data-adswap-stale');
    if (root && typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        if (connected() && root.getAttribute('data-adswap-stale') === '1') root.removeAttribute('data-adswap-stale');
      }).observe(root, { attributes: true, attributeFilter: ['data-adswap-stale'] });
    }

    var watch = setInterval(function () {
      if (connected()) return;
      mark('data-adswap-stale', '1');
      clearInterval(watch);
    }, 3000);
  } catch (e) {
    apply({});      // storage unavailable: fall back to the defaults
  }
})();
