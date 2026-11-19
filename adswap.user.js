// ==UserScript==
// @name         Ad Swap for Twitch
// @namespace    local
// @version      0.43
// @description  During a Twitch picture-by-picture ad break, swap the two players: live stream in the main spot with sound, ad in the mini spot, then put everything back when the break ends.
// @match        https://www.twitch.tv/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Install: chrome://extensions -> Developer mode -> Load unpacked -> pick this folder (manifest.json loads this file).
// It can also be pasted into the DevTools console on a Twitch channel page, or installed in Tampermonkey.
// Click the badge (top-left) to switch it off and on.

(function () {
  'use strict';

  var S = window.__adswap || (window.__adswap = {});
  if (S.stop) S.stop();                       // replace any earlier copy cleanly
  if (S.timer) clearInterval(S.timer);
  if (S.badge) S.badge.remove();
  if (S.overlay) S.overlay.remove();
  if (S.capCss && S.capCss.remove) S.capCss.remove();
  S.log = S.log || [];
  S.err = null;
  S.note = null;

  var VERSION = '0.43';
  var STORE = 'adswap.log';
  // The history survives a page refresh, so a break can be reported after the fact.
  if (!S.log.length) {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE) || '[]');
      if (Array.isArray(saved)) S.log = saved;
    } catch (e0) {}
  }
  function record(entry) {
    entry.v = VERSION;
    S.log.push(entry);
    if (S.log.length > 200) S.log.splice(0, S.log.length - 200);
    try { localStorage.setItem(STORE, JSON.stringify(S.log.slice(-40))); } catch (e1) {}
  }
  // Open chat by itself during ad breaks when it is closed. Turn off with: window.__adswap.autoChat = false
  if (S.autoChat === undefined) S.autoChat = true;

  var ID_PREFIX = '__adswap_';
  var TICK_MS = 250;
  var FRAME_CHECK_MS = 1500;
  var TEXT_GONE_MS = 1500;   // countdown must be gone this long before we call the break over
  var STALL_MS = 3000;       // mini stream frozen this long = break over
  var AD_TEXT = /\bAd\b[^()]{0,20}\((\d+:\d{2})\)/;   // Twitch's "Ad (0:48)" countdown
  var adLeft = '';        // the time left in the ad break, as Twitch last showed it ("0:48")
  var adLeftAt = 0;       // when that figure last changed
  var adLeftSeenAt = 0;   // when the countdown was last seen at all
  var adLeftTicked = false;   // true once we watched it change, so adLeftAt is the tick itself
  var adLeftChanges = 0;      // how many times the countdown has changed during this break
  // Leave this ad break alone until it ends: set when the viewer uncovers it with the shortcut,
  // or when Twitch's countdown gets stuck. Cleared as soon as no ad countdown is showing.
  var holdOff = false;
  var STUCK_MS = 8000;        // a countdown that has not moved for this long is stuck
  var active = null;      // the ad break being handled, or null
  var cand = null;        // a mini player we are still deciding about
  var idleTicks = 0, idleText = false, adSeenAt = 0, missNoted = false;
  // Has the stream itself played on this page yet? An ad that starts before it has is the kind
  // Twitch plays when a channel is opened or refreshed (a pre-roll). It fills the player and
  // there is no stream on the page to swap in, so it must not be mistaken for a fault.
  var navPath = pathNow(), navAt = Date.now(), streamSeen = false, quietTicks = 0;
  var AT_LOAD_MS = 20000;
  // Twitch sometimes puts the small stream player on the page but leaves it paused (seen on a
  // real break, 2026-11-15). The swap needs that stream running, so start it ourselves.
  var nudges = 0, lastNudge = 0;
  // When the small player is on screen during an ad but its stream will not play (seen
  // 2026-11-18: drawn, not paused, but no picture at all), there is nothing to swap in. After
  // STUCK_MINI_MS of that, the ad is covered like one that cannot be swapped.
  var miniStuckAt = 0, STUCK_MINI_MS = 4000;
  function tabState() { try { return String(document.visibilityState || 'unknown'); } catch (e) { return 'unknown'; } }
  function pathNow() { try { return location.pathname; } catch (e) { return ''; } }
  var CHAT_WAIT_MS = 5000;   // how long to wait for the mini stream after opening chat
  var chatTried = false;     // already opened chat once during this break
  var chatOpenedAt = 0;      // when we opened chat ourselves (0 = we did not)
  var enabled = true;

  function log() {
    var args = ['%c[adswap]', 'color:#a970ff;font-weight:bold'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function snap(v) {
    return { muted: v.muted, volume: v.volume, res: v.videoWidth + 'x' + v.videoHeight };
  }

  /* ---------------- badge ---------------- */

  // The badge has two homes. Normally it sits in Twitch's top bar, in the empty stretch to
  // the right of the logo, the links and the "more" button, where it covers nothing. When that
  // bar is not there (theatre mode), it floats in the top-left corner of the page instead.
  var BADGE_LOOK = 'background:#18181b;color:#efeff1;font:12px/1.4 system-ui,sans-serif;padding:6px 10px;' +
    'border-radius:6px;cursor:pointer;user-select:none;';
  var BADGE_FLOAT = 'position:fixed;top:8px;left:8px;z-index:2147483647;opacity:.92;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.5);transition:transform .2s ease;';
  var BADGE_NAV = 'position:static;align-self:center;flex:0 1 auto;min-width:0;max-width:620px;margin:0 8px;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);';
  var HINT = 'Click: switch adswap off or on. Right-click: copy the log.';
  var badgeMode = '', badgeShift = 0;

  var badge = S.badge = document.createElement('div');
  badge.title = HINT;
  badge.oncontextmenu = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    var report = { version: VERSION, log: S.log.slice(-6) };
    if (active) {
      report.swapRunningNow = {
        seconds: Math.round((Date.now() - active.t0) / 1000), res: active.res,
        placement: active.mode === 'mirror' ? active.where : active.mode,
        subtitles: [active.cap1, active.cap2].filter(Boolean), adSubtitles: active.capLog, sound: active.sound
      };
    }
    var text = JSON.stringify(report, null, 1);
    var done = function (ok) {
      badge.textContent = 'AdSwap' + (ok ? ': log copied to the clipboard' : ': could not copy the log');
      setTimeout(paint, 2500);
    };
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } catch (err) { done(false); }
    return false;
  };
  badge.onclick = function () {
    enabled = !enabled;
    if (!enabled) {
      if (active) leave('switched off');
      if (cov) endCover('switched off');
      restoreChat('switched off');
    }
    paint();
  };
  // Twitch's top bar: the row that holds the logo, the links (Following, Browse) and "more".
  function navRow() {
    var logo = document.querySelector('a[data-a-target="home-link"]');
    var browse = document.querySelector('a[data-a-target="browse-link"]');
    if (!logo || !browse || !logo.parentElement) return null;
    var row = logo.parentElement;
    if (!row.contains(browse) || !shown(logo)) return null;     // bar hidden (theatre mode) or built differently
    return row;
  }

  // Put the badge where it belongs for the page as it is now. Run again and again: Twitch
  // rebuilds its top bar, and the viewer goes in and out of theatre mode.
  function placeBadge() {
    var row = null;
    try { row = navRow(); } catch (e) {}
    if (row) {
      if (badge.parentNode !== row || row.lastElementChild !== badge) row.appendChild(badge);
      if (badgeMode !== 'nav') { badgeMode = 'nav'; badgeShift = 0; badge.style.cssText = BADGE_LOOK + BADGE_NAV; }
    } else {
      if (badge.parentNode !== document.body) document.body.appendChild(badge);
      if (badgeMode !== 'float') { badgeMode = 'float'; badgeShift = 0; badge.style.cssText = BADGE_LOOK + BADGE_FLOAT; }
    }
  }

  // During an ad Twitch prints a notice along the top of the player ("... is taking an ad
  // break ... Ad (0:28)"). In theatre mode that is exactly where the badge sits, so while an
  // ad is on, the badge slides down to just under that line, and back up afterwards.
  var dodgeTicks = 0;

  // The line of Twitch's ad notice: its top and bottom, and the player's left and right edges.
  function adNoticeRow() {
    var vs = videos(), big = null, i;
    for (i = 0; i < vs.length; i++) if (!big || area(vs[i]) > area(big)) big = vs[i];
    var root = big && big.closest && (big.closest('.video-player') || big.closest('.persistent-player'));
    if (!root || !AD_TEXT.test(root.textContent || '')) return null;
    // Walk down to the smallest box that still holds the whole countdown.
    var el = root, deeper = true;
    while (deeper) {
      deeper = false;
      var kids = el.children || [];
      for (i = 0; i < kids.length; i++) {
        if (AD_TEXT.test(kids[i].textContent || '')) { el = kids[i]; deeper = true; break; }
      }
    }
    var r = el.getBoundingClientRect(), p = root.getBoundingClientRect();
    if (r.height < 1 || r.height > 80) return null;      // not a single line of text: leave the badge alone
    return { top: r.top, bottom: r.bottom, left: p.left, right: p.right };
  }

  function dodge(adOn) {
    var shift = 0;
    var row = adOn && badgeMode === 'float' ? adNoticeRow() : null;
    if (row) {
      var b = badge.getBoundingClientRect();
      var top = b.top - badgeShift, bottom = b.bottom - badgeShift;   // where the badge sits when not moved
      if (bottom > row.top && top < row.bottom && b.right > row.left && b.left < row.right) {
        shift = Math.round(row.bottom + 6 - top);
      }
    }
    if (shift !== badgeShift) {
      badgeShift = shift;
      badge.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    }
  }

  // True once the extension has been updated or reloaded while this page stayed open. The page
  // is then still running the old copy and no longer hears the popup's settings.
  var staleShown = false;
  function stale() {
    try { return document.documentElement.getAttribute('data-adswap-stale') === '1'; } catch (e) { return false; }
  }

  function paint() {
    var t;
    if (!enabled) t = 'off (click to turn on)';
    else if (active) t = 'ad break, players swapped (' + active.res + (/^\d+x\d+$/.test(active.res) ? 'p' : '') +
      (fitMode() === 'actual' ? ', actual size' : '') + ')';
    // The first two are normal: Twitch gave nothing to swap in. Say so plainly, so nobody
    // thinks the extension is broken. Only an unexpected miss points at the log.
    else if (cov && cov.manual) t = 'covered, press the shortcut again to uncover';
    else if (cov) t = 'can\'t swap this ad: ' +
      (cov.kind === 'video' ? 'showing your videos' : cov.kind === 'clips' ? 'showing their clips' : 'hidden');
    else if (holdOff && idleText) t = 'leaving this ad break as it is';
    else if (S.note) t = /ad at page load/.test(S.note)
      ? 'can\'t swap this ad: it plays as the channel opens'
      : /only one player/.test(S.note)
      ? 'can\'t swap this ad: Twitch sent no small player'
      : 'not swapped: ' + S.note + ' (right-click for the log)';
    else t = stale() ? 'updated, refresh this page to finish' : 'watching';
    if (S.err) t += ' | ERROR: ' + S.err + ' (right-click for the log)';
    badge.textContent = 'AdSwap: ' + t;
    var more = /as the channel opens/.test(t)
      ? '\nTwitch plays this ad before the stream is on the page, so there is nothing to swap in. This is normal.'
      : /no small player/.test(t)
      ? '\nThis ad break came without the small stream player, so there is nothing to swap in. This is normal.'
      : '';
    badge.title = 'AdSwap ' + VERSION + ': ' + t + more + '\n' + HINT;      // the version shows on hover only
  }

  /* ---------------- detection ---------------- */

  // Every <video> on the page except our own mirrors.
  function videos() {
    var all = document.querySelectorAll('video');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].id || '').indexOf(ID_PREFIX) !== 0) out.push(all[i]);
    }
    return out;
  }

  function area(v) {
    var r = v.getBoundingClientRect();
    return r.width * r.height;
  }

  // A picture-by-picture break = two videos on screen, one clearly smaller than the other.
  // The mini player must actually be drawn: with chat closed Twitch stops playing it,
  // so there is no live picture to show and the ad is left alone.
  function findPair(adText) {
    var vs = videos();
    if (vs.length < 2) return null;
    vs.sort(function (a, b) { return area(a) - area(b); });
    var small = vs[0], big = vs[vs.length - 1];
    if (!shown(small) || !shown(big)) return null;
    // Twitch's own corner player (the stream that follows you after you leave a channel) is not an
    // ad break. Only while no ad countdown is showing: during a real break nothing is ruled out.
    if (!adText && small.closest && small.closest('.persistent-player__border--mini')) return null;
    if (!(small.getBoundingClientRect().width < big.getBoundingClientRect().width * 0.6)) return null;
    return { small: small, big: big };
  }

  // For the log: what one player looks like right now.
  function describe(v) {
    var r = v.getBoundingClientRect();
    return {
      res: v.videoWidth + 'x' + v.videoHeight, box: Math.round(r.width) + 'x' + Math.round(r.height),
      drawn: shown(v), paused: v.paused === true, muted: v.muted,
      length: isFinite(v.duration) ? Math.round(v.duration) + 's' : 'live (no end)',
      corner: !!(v.closest && v.closest('.persistent-player__border--mini'))
    };
  }

  // True while the element is really on screen (not collapsed or hidden by CSS).
  function shown(v) {
    var r = v.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (typeof v.checkVisibility === 'function') {
      return v.checkVisibility({
        checkOpacity: true, checkVisibilityCSS: true,
        opacityProperty: true, visibilityProperty: true
      });
    }
    return true;
  }

  // Twitch shows a countdown like "Ad (0:48)" for the whole break.
  function adTextShown() {
    var m = AD_TEXT.exec(document.body.textContent || ''), now = Date.now();
    if (m) {
      if (m[1] !== adLeft) {
        // Caught changing while we were watching closely: this is the tick, to a quarter second.
        adLeftTicked = adLeft !== '' && now - adLeftSeenAt < 600;
        if (adLeft !== '') adLeftChanges++;
        adLeft = m[1];
        adLeftAt = now;
      }
      adLeftSeenAt = now;
    }
    return !!m;
  }

  /* ---------------- mirrors ---------------- */

  function host() {
    return document.fullscreenElement || document.body;
  }

  // How the stream is drawn in the main player during a swap. Twitch only sends the small
  // player a 640x360 picture, so there are two honest choices:
  //   'fill'   - stretch it to fill the player (bigger, but soft)
  //   'actual' - draw it at its real size, centred on black (small, but as sharp as it gets)
  // The choice is made in the extension's popup; a small helper script copies it onto the page
  // as an attribute, because this script cannot read the extension's own storage.
  function fitMode() {
    var v = '';
    try { v = document.documentElement.getAttribute('data-adswap-fit') || ''; } catch (e) {}
    if (v !== 'actual' && v !== 'fill') v = S.fit === 'actual' ? 'actual' : 'fill';
    return v;
  }
  // Gaps (top, right, bottom, left, in page dots) that leave a box of exactly the picture's real
  // size in the middle of the player: one dot of picture per dot of screen, so nothing is
  // stretched. Windows display scaling and browser zoom both make a page dot bigger than a screen
  // dot, hence the division. All zero = fill the player (also when the player is smaller than
  // the picture).
  function fitPads(vw, vh, box) {
    if (fitMode() !== 'actual') return [0, 0, 0, 0];
    var dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    var w = vw / dpr, h = vh / dpr;
    if (!(w > 0 && h > 0) || w >= box.width || h >= box.height) return [0, 0, 0, 0];
    var left = Math.floor((box.width - w) / 2), top = Math.floor((box.height - h) / 2);
    var r2 = function (x) { return Math.round(x * 100) / 100; };
    return [top, r2(box.width - w - left), r2(box.height - h - top), left];
  }
  function padString(p) { return p[0] + 'px ' + p[1] + 'px ' + p[2] + 'px ' + p[3] + 'px'; }

  // Put those gaps on the stream copy. Checked against what is really on the element on every
  // look: when Twitch rebuilds its player our styles are reset, and a remembered "already
  // applied" would then be wrong and the picture would stay big (that was the v0.32 fault).
  var SIDES = ['top', 'right', 'bottom', 'left'];
  function applyFit(el, vw, vh, box) {
    var p = fitPads(vw, vh, box), st = el.style;
    if (typeof st.setProperty !== 'function') {
      var all = padString(p);
      if (st.padding !== all || st.boxSizing !== 'border-box') { st.boxSizing = 'border-box'; st.padding = all; }
      return;
    }
    for (var i = 0; i < 4; i++) {
      var v = p[i] + 'px';
      if (st.getPropertyValue('padding-' + SIDES[i]) !== v) st.setProperty('padding-' + SIDES[i], v, 'important');
    }
    if (st.getPropertyValue('box-sizing') !== 'border-box') st.setProperty('box-sizing', 'border-box', 'important');
  }

  var OVER_STYLE = 'position:fixed;z-index:2147483646;background:#000;object-fit:contain;pointer-events:none';
  var INSIDE_STYLE = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:#000;object-fit:contain;';

  // A muted <video> that shows a live copy of another video's picture. Not on the page yet.
  function mkMirror(name, source) {
    var o = document.createElement('video');
    o.id = ID_PREFIX + name;
    o.autoplay = true;
    o.playsInline = true;
    o.muted = true;                         // sound always comes from the real elements
    o.style.cssText = OVER_STYLE;
    o.srcObject = source.captureStream();   // may throw; caller handles it
    return o;
  }

  function playQuietly(m) {
    var p = m.play && m.play();
    if (p && p.catch) p.catch(function () {});
  }

  // Preferred placement: inside Twitch's own player, directly on top of the ad video.
  // Twitch's controls (fullscreen, theatre mode, chat button) then stay visible and usable
  // above it, and the copy follows the player into fullscreen and theatre mode by itself.
  // Returns false if it did not land exactly on the ad, so the caller can float it instead.
  function mountInside(m, big) {
    var p = big.parentElement;
    if (!p || typeof p.insertBefore !== 'function') return false;
    m.style.cssText = INSIDE_STYLE + 'pointer-events:auto;';
    p.insertBefore(m, big.nextSibling);
    var a = m.getBoundingClientRect(), b = big.getBoundingClientRect();
    var same = a.width > 0 && Math.abs(a.left - b.left) < 4 && Math.abs(a.top - b.top) < 4 &&
      Math.abs(a.width - b.width) < 4 && Math.abs(a.height - b.height) < 4;
    var onTop = false;
    if (same && typeof document.elementsFromPoint === 'function') {
      var stack = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      var im = stack.indexOf(m), iv = stack.indexOf(big);
      onTop = im > -1 && (iv === -1 || im < iv);
    }
    m.style.cssText = INSIDE_STYLE + 'pointer-events:none;';
    if (same && onTop) return true;
    m.remove();
    return false;
  }

  // Keep the stream copy on the ad: inside the player if possible, floating over it if not.
  function placeStream() {
    var m = active.streamMirror, big = active.big;
    if (active.where === 'inside') {
      if (m.isConnected && m.parentNode === big.parentElement) return;   // in place; it sizes itself
      // Twitch rebuilt that part of the player: go back in, or float over it instead.
      if (mountInside(m, big)) { playQuietly(m); return; }
      active.where = 'over';
      m.style.cssText = OVER_STYLE;
    }
    fit(m, big.getBoundingClientRect(), host());
  }

  // Where the mini player sits right now (a zero box when it is not drawn).
  function miniSlot() {
    return active.small.getBoundingClientRect();
  }

  function fit(mirror, r, where) {
    // Nowhere to put it (for example the mini slot is gone because chat is closed): hide it.
    if (r.width < 1 || r.height < 1) { mirror.style.display = 'none'; return; }
    mirror.style.display = '';
    if (mirror.parentNode !== where) {
      where.appendChild(mirror);
      playQuietly(mirror);
    }
    mirror.style.left = r.left + 'px';
    mirror.style.top = r.top + 'px';
    mirror.style.width = r.width + 'px';
    mirror.style.height = r.height + 'px';
  }

  // What is drawn over the small player during a swap. The viewer chooses in the popup:
  //   'ad'    - the advert itself (the default: the two players really are swapped)
  //   'hide'  - a plain card with the time left, so the advert is not seen at all
  //   'video' - the viewer's own videos, played from the extension's storage
  function miniMode() {
    var v = '';
    try { v = document.documentElement.getAttribute('data-adswap-mini') || ''; } catch (e) {}
    if (v !== 'hide' && v !== 'video' && v !== 'ad' && v !== 'clips') {
      v = (S.mini === 'hide' || S.mini === 'video' || S.mini === 'clips') ? S.mini : 'ad';
    }
    return v;
  }
  // Where the extension's own pages live (set by the helper script). Empty when this script was
  // pasted in or runs from a userscript manager: then there are no such pages.
  function baseUrl() {
    var v = '';
    try { v = document.documentElement.getAttribute('data-adswap-base') || ''; } catch (e) {}
    return /^(chrome-extension|moz-extension):\/\/[^\/]+\/$|^http:\/\/localhost:\d+\/$/.test(v) ? v : '';
  }
  // The time left in the ad break in seconds, from Twitch's countdown; null if not known.
  // The countdown only shows whole seconds. Once it has been seen ticking over, the time since
  // that tick is taken off; until then the best guess is half a second into the current one.
  function secondsLeft() {
    var m = /^(\d+):(\d{2})$/.exec(adLeft);
    if (!m) return null;
    var shown = (+m[1]) * 60 + (+m[2]);
    var into = adLeftTicked ? Math.min(1, (Date.now() - adLeftAt) / 1000) : 0.5;
    return Math.max(0, shown - into);
  }
  var COVER_STYLE = 'position:fixed;z-index:2147483646;pointer-events:none;border:0;background:#111315;';
  var CARD_STYLE = COVER_STYLE + 'color:#d7dde0;font:600 14px system-ui,sans-serif;text-align:center;' +
    'white-space:nowrap;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);';

  // Make the small player show what the viewer chose. Looked at on every tick, so changing the
  // choice in the middle of an ad takes effect straight away.
  function syncMini(a) {
    var want = miniMode();
    if (want === 'video' && !baseUrl()) want = 'hide';
    if (want === 'clips' && !(baseUrl() && clipsReady())) want = 'hide';     // no clips to show: the card
    if (want !== a.miniShown) {
      a.miniShown = want;
      if (a.cover) { a.cover.remove(); a.cover = S.cover = null; }
      if (want === 'ad') {
        if (!a.adMirror) {
          try { a.adMirror = mkMirror('ad', a.big); }
          catch (e2) { log('could not copy the ad into the small player (' + e2.message + '); small player left as is'); }
        }
      } else {
        if (a.adMirror) { a.adMirror.remove(); a.adMirror = null; }
        var el;
        if (want === 'video' || want === 'clips') {
          el = document.createElement('iframe');
          el.id = ID_PREFIX + 'myvideo';
          if (el.setAttribute) el.setAttribute('allow', 'autoplay');
          el.src = baseUrl() + 'player.html' + (want === 'clips' ? '?src=clips' : '');
          el.style.cssText = COVER_STYLE;
        } else {
          el = document.createElement('div');
          el.id = ID_PREFIX + 'card';
          el.style.cssText = CARD_STYLE;
        }
        a.cover = S.cover = el;
      }
    }
    var slot = miniSlot();
    if (a.adMirror) fit(a.adMirror, slot, document.body);
    if (a.cover) {
      fit(a.cover, slot, document.body);
      // The viewer's own videos: say how long the break has left (so they can finish with it)
      // and whether they should be heard. Sent once a second, and at once when the sound changes.
      if ((a.miniShown === 'video' || a.miniShown === 'clips') && a.cover.contentWindow) {
        var vsnd = a.videoSound || { muted: true, volume: 0 };
        // The swap ends a moment after the countdown goes (TEXT_GONE_MS), and the videos are on
        // screen until it does, so that moment is the one to finish on.
        // Once the countdown has gone, that moment is known exactly: count down to it.
        var secs = secondsLeft();
        var untilEnd = a.textGone ? Math.max(0, (a.textGone + TEXT_GONE_MS - Date.now()) / 1000)
          : (secs === null ? null : secs + TEXT_GONE_MS / 1000);
        var state = { source: 'adswap', type: 'state', left: untilEnd, muted: vsnd.muted, volume: vsnd.volume };
        if (a.miniShown === 'clips') state.clips = clipList();
        var sKey = state.muted + '|' + state.volume;
        if (Date.now() >= (a.stateAt || 0) || sKey !== a.stateKey) {
          a.stateAt = Date.now() + 1000;
          a.stateKey = sKey;
          try { a.cover.contentWindow.postMessage(state, baseUrl().replace(/\/$/, '')); } catch (e13) {}
        }
      }
      if (a.miniShown === 'hide') {
        var words = 'Ad break' + (adLeft ? '  \u00b7  ' + adLeft + ' left' : '');
        if (a.cover.textContent !== words) a.cover.textContent = words;
        a.cover.style.lineHeight = slot.height + 'px';
      }
    }
  }

  // Stream mirror sits on the ad; ad mirror sits on the mini player. That is the swap.
  function place() {
    if (!active) return;
    if (active.mode === 'mirror') {
      if (active.streamMirror) {
        placeStream();
        var sm = active.streamMirror;
        applyFit(sm, sm.videoWidth || active.small.videoWidth, sm.videoHeight || active.small.videoHeight,
          active.big.getBoundingClientRect());
        active.copyRes = sm.videoWidth + 'x' + sm.videoHeight;
      }
      // What sits on the small player stays on the page itself, so in fullscreen it is out of sight.
      syncMini(active);
    } else {
      var r = active.big.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      active.small.style.cssText = 'position:fixed;z-index:2147483646;background:#000;object-fit:contain;' +
        'box-sizing:border-box;padding:' + padString(fitPads(active.small.videoWidth, active.small.videoHeight, r)) + ';' +
        'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
    }
  }

  function dropMirrors() {
    if (!active) return;
    if (active.streamMirror) { active.streamMirror.remove(); active.streamMirror = null; }
    if (active.adMirror) { active.adMirror.remove(); active.adMirror = null; }
    if (active.cover) { active.cover.remove(); active.cover = S.cover = null; }
    active.miniShown = null;
  }

  // If mirroring the stream gives no picture, restyle the mini player itself instead.
  function fallbackInPlace(why) {
    dropMirrors();
    active.mode = 'inplace';
    log('mirror gave no picture (' + why + '), restyling the mini player in place');
    place();
    paint();
  }

  /* ---------------- volume slider ---------------- */

  // Twitch's volume slider and mute button talk to the main player, which is the ad during a
  // break. So for the length of the swap the ad's player is made to answer "not muted, volume X"
  // (whatever Twitch last asked for) while really staying silent, and every request Twitch
  // sends it is passed on to the live stream instead. The slider then works on the stream.
  // For the log: what Twitch's own sound controls show right now.
  function attrs(sel, attr) {
    var out = [], els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length && i < 4; i++) {
      out.push(attr === 'value' ? els[i].value : els[i].getAttribute(attr));
    }
    return out;
  }
  // Any "100%"-style label Twitch is showing (the volume tooltip), with the box it sits in.
  function percentLeaves() {
    var out = [], els = document.querySelectorAll('[role="tooltip"], [class*="tooltip"], [class*="volume"] *');
    for (var i = 0; i < els.length && out.length < 4; i++) {
      var e = els[i], t = (e.textContent || '').trim();
      if (e.children.length === 0 && /^\d{1,3}\s*%$/.test(t)) out.push(e);
    }
    return out;
  }
  function percentTexts() {
    return percentLeaves().map(function (e) {
      return (e.textContent || '').trim() + ' @ ' +
        String(e.className || (e.parentElement && e.parentElement.className) || '').slice(0, 60);
    });
  }

  // During an ad Twitch has two sets of sound controls: the main player's (the one on screen,
  // the one the viewer drags) and a second set belonging to the mini stream. This is the first.
  var SLIDER = 'input[data-a-target="player-volume-slider"]';
  function adSlider(a) {
    var root = a.big.closest && a.big.closest('.video-player');
    return (root && root.querySelector && root.querySelector(SLIDER)) || document.querySelector(SLIDER);
  }
  // The volume the viewer has chosen = what that slider shows. (The volume Twitch gives the ad
  // itself is adjusted per advert, so it is not the viewer's setting.) null if it cannot be read.
  function sliderVolume(a) {
    var s = adSlider(a), n = s ? parseFloat(s.value) : NaN;
    return n >= 0 && n <= 1 ? n : null;
  }
  // The "44%" label beside the slider comes from the other set of controls and goes stale
  // while the viewer drags. Make it say what the slider says.
  function syncPercent(a) {
    var s = adSlider(a);
    var says = s && s.getAttribute && s.getAttribute('aria-valuetext');
    if (!says || !/^\d{1,3}%$/.test(says)) return;
    var mini = a.small.closest && a.small.closest('.picture-by-picture-player');
    var leaves = percentLeaves();
    for (var i = 0; i < leaves.length; i++) {
      var tn = leaves[i].firstChild;
      if (mini && mini.contains && mini.contains(leaves[i])) continue;
      if (tn && tn.nodeType === 3 && String(tn.nodeValue).trim() !== says) {
        if (!a.percentFixed) { a.percentFixed = true; note(a, { fixed: 'percent label', was: tn.nodeValue, now: says }); }
        tn.nodeValue = says;
      }
    }
  }
  function uiState() {
    return {
      btn: attrs('button[data-a-target="player-mute-unmute-button"]', 'aria-label'),
      slider: attrs('input[data-a-target="player-volume-slider"]', 'value'),
      sliderSays: attrs('input[data-a-target="player-volume-slider"]', 'aria-valuetext'),
      percentShown: percentTexts()
    };
  }

  /* ---------------- ad subtitles ---------------- */

  // Twitch draws an advert's subtitles as text over the main player. During a swap the stream
  // is in that spot, so the advert's words land on the stream. They are hidden there and shown
  // over the advert in the small player instead. A line that nothing replaces is cleared after
  // a few seconds, so the last thing said does not stay stuck on screen.
  var CAP_SEL = '[class*="caption" i], [data-a-target*="caption" i], [class*="subtitle" i]';
  var CAP_NOT = ':not(button):not(button *):not([role="menu"] *):not([role="dialog"] *):not([role="tooltip"] *)';
  var CAP_STALE_MS = 7000;
  var CAP_BOX_STYLE = 'position:fixed;z-index:2147483646;pointer-events:none;transform:translate(-50%,-100%);' +
    'font:600 12px/1.3 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.8);padding:3px 7px;' +
    'border-radius:4px;text-align:center;white-space:pre-line;overflow:hidden;max-height:4.2em;' +
    'width:max-content;display:none';     // max-content: as wide as the words need, up to max-width

  // One style rule does the hiding, so a new subtitle line never flashes on the stream first.
  // It only applies while the player carries our mark, which is set for the length of a swap.
  try {
    var capCss = document.createElement('style');
    capCss.id = ID_PREFIX + 'style';
    capCss.textContent = CAP_SEL.split(', ').map(function (sel) {
      return '[data-adswap-caps] ' + sel + CAP_NOT;
    }).join(', ') + ' { opacity: 0 !important; }';
    (document.head || document.documentElement).appendChild(capCss);
    S.capCss = capCss;
  } catch (eCss) { S.capCss = null; }

  function capRoot(a) {
    return (a.big.closest && (a.big.closest('.video-player') || a.big.closest('.persistent-player'))) || null;
  }

  // For the log: what an element is called, and the two boxes around it.
  function sigOf(e) {
    var parts = [], k = 0;
    while (e && k < 3) {
      parts.push((e.tagName || '') + '|' + ((e.getAttribute && e.getAttribute('data-a-target')) || '') + '|' +
        (typeof e.className === 'string' ? e.className.slice(0, 70) : ''));
      e = e.parentElement;
      k++;
    }
    return parts.join(' < ');
  }

  // Twitch's subtitle boxes inside the advert's player: the outermost ones, never a control.
  function capBoxes(a) {
    var root = a.capRoot, out = [];
    if (!root || !root.querySelectorAll) return out;
    var all = root.querySelectorAll(CAP_SEL);
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.tagName === 'BUTTON') continue;
      if (e.closest && e.closest('button, [role="menu"], [role="dialog"], [role="tooltip"]')) continue;
      if (e.parentElement && e.parentElement.closest && e.parentElement.closest(CAP_SEL)) continue;
      out.push(e);
    }
    return out;
  }

  function capStart(a) {
    a.capRoot = capRoot(a);
    a.capText = '';
    a.capChanged = 0;
    a.capLog = { boxes: [], lines: [], otherTextOverPlayer: {} };
    a.capProbeAt = 0;
    if (a.capRoot && a.capRoot.setAttribute) a.capRoot.setAttribute('data-adswap-caps', '');
    var box = document.createElement('div');
    box.id = ID_PREFIX + 'caps';
    box.style.cssText = CAP_BOX_STYLE;
    a.capBox = S.capBox = box;
  }

  function capStop(a) {
    if (a.capRoot && a.capRoot.removeAttribute) a.capRoot.removeAttribute('data-adswap-caps');
    if (a.capBox) a.capBox.remove();
    a.capBox = S.capBox = null;
  }

  function capSync(a) {
    if (!a.capBox) return;
    var boxes = capBoxes(a), text = '', i, now = Date.now();
    for (i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var t = String(b.innerText !== undefined ? b.innerText : (b.textContent || ''))
        .replace(/[ \t]*\n\s*/g, '\n').trim();
      if (t) text += (text ? '\n' : '') + t;
      var sig = sigOf(b);
      if (a.capLog.boxes.indexOf(sig) < 0 && a.capLog.boxes.length < 4) a.capLog.boxes.push(sig);
    }
    if (text !== a.capText) {
      a.capText = text;
      a.capChanged = now;
      if (text && a.capLog.lines.length < 4) {
        a.capLog.lines.push({ s: Math.round((now - a.t0) / 1000), text: text.slice(0, 80) });
      }
    }
    var slot = a.adMirror ? miniSlot() : null;
    var show = text && now - a.capChanged < CAP_STALE_MS && slot && slot.width >= 1 && slot.height >= 1;
    var st = a.capBox.style;
    if (!show) { st.display = 'none'; return; }
    if (a.capBox.parentNode !== document.body) document.body.appendChild(a.capBox);
    if (a.capBox.textContent !== text) a.capBox.textContent = text;
    st.display = 'block';
    st.left = (slot.left + slot.width / 2) + 'px';
    st.top = (slot.top + slot.height - 6) + 'px';
    st.maxWidth = Math.max(60, slot.width - 16) + 'px';
  }

  // If no subtitle box has been recognised, note any other text sitting over the lower part
  // of the main player, so a pasted log shows what Twitch's subtitle box is really called.
  function capProbe(a) {
    if (a.capLog.boxes.length || !a.big.closest) return;
    var root = a.big.closest('.persistent-player') || a.capRoot;
    if (!root || !root.querySelectorAll) return;
    var r = a.big.getBoundingClientRect(), els = root.querySelectorAll('*'), seen = a.capLog.otherTextOverPlayer;
    for (var i = 0; i < els.length && i < 2000; i++) {
      var e = els[i], own = '';
      for (var n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.nodeValue;
      own = own.trim();
      if (!own) continue;
      var b = e.getBoundingClientRect();
      if (b.width < 1 || b.top < r.top + r.height * 0.35 || b.bottom > r.bottom + 2 ||
          b.left < r.left - 2 || b.right > r.right + 2) continue;
      var sig = sigOf(e);
      if (seen[sig]) seen[sig].lastText = own.slice(0, 60);
      else if (Object.keys(seen).length < 8) {
        seen[sig] = { firstSeen: Math.round((Date.now() - a.t0) / 1000), text: own.slice(0, 60) };
      }
    }
  }

  // For the log: does this player carry subtitles, and does Twitch offer a subtitles control?
  // (Asked on 2026-11-14: could the ad's subtitles be shown in the small player? This records
  // what a real ad provides, so the answer comes from the page and not from a guess.)
  function captionInfo(v) {
    var out = { tracks: [], trackTags: 0, controls: [], onScreen: [] }, i;
    var tt = v.textTracks || [];
    for (i = 0; i < tt.length && i < 8; i++) {
      out.tracks.push({
        kind: tt[i].kind, label: tt[i].label, lang: tt[i].language, mode: tt[i].mode,
        cues: tt[i].cues ? tt[i].cues.length : null,
        showingNow: tt[i].activeCues && tt[i].activeCues.length
          ? String(tt[i].activeCues[0].text || '').slice(0, 80) : ''
      });
    }
    if (v.querySelectorAll) out.trackTags = v.querySelectorAll('track').length;
    var root = v.closest && (v.closest('.video-player') || v.closest('.persistent-player') ||
      v.closest('.picture-by-picture-player'));
    if (!root || !root.querySelectorAll) return out;
    var els = root.querySelectorAll('button, [data-a-target], [class]');
    for (i = 0; i < els.length && out.controls.length + out.onScreen.length < 12; i++) {
      var e = els[i];
      var name = [e.getAttribute('aria-label') || '', e.getAttribute('data-a-target') || '',
        typeof e.className === 'string' ? e.className : ''].join(' | ');
      if (!/caption|subtitle|closed.?caption|\bcc\b/i.test(name)) continue;
      if (e.tagName === 'BUTTON') out.controls.push(name.slice(0, 90));
      else out.onScreen.push(name.slice(0, 60) + ' => "' + (e.textContent || '').trim().slice(0, 80) + '"');
    }
    return out;
  }

  // For the log: where a player sits in Twitch's page (names of the boxes around it).
  function whereIs(v) {
    var chain = [], e = v.parentElement;
    while (e && e !== document.body && chain.length < 8) {
      var name = (e.getAttribute && e.getAttribute('data-a-target')) || '';
      var cls = typeof e.className === 'string' ? e.className.split(' ').filter(function (c) {
        return /^[a-z][a-z-]*(__[a-z-]+)?(--[a-z-]+)?$/.test(c);
      }).join('.') : '';
      if (name || cls) chain.push(name + '|' + cls);
      e = e.parentElement;
    }
    return chain;
  }

  // For the log: one thing that happened to the sound during this break.
  function note(a, o) {
    if (!a.sound || a.sound.events.length >= 12) return;
    o.s = Math.round((Date.now() - a.t0) / 100) / 10;
    a.sound.events.push(o);
  }

  // Which sound the viewer hears during a swap. Chosen in the popup:
  //   'stream' - the live stream (the default)
  //   'small'  - whatever the small player is showing: the advert, or the viewer's own video
  function soundMode() {
    var v = '';
    try { v = document.documentElement.getAttribute('data-adswap-sound') || ''; } catch (e) {}
    if (v !== 'small' && v !== 'stream') v = S.sound === 'small' ? 'small' : 'stream';
    return v;
  }
  // What that works out to right now. The Hidden card has no sound of its own, so the stream is
  // heard; the same if the small player's content could not be made.
  function heard(a) {
    if (soundMode() !== 'small') return 'stream';
    if (a.miniShown === 'ad' && a.adMirror) return 'ad';
    if ((a.miniShown === 'video' || a.miniShown === 'clips') && a.cover) return 'video';
    return 'stream';
  }
  // Make the three possible sounds match the choice. Exactly one is ever audible, at the level
  // Twitch's own volume slider shows; Twitch's mute button silences whichever it is.
  function applySound(a, logIt) {
    var w = a.want, who = heard(a), level = a.streamVolume();
    // 1. the advert's own sound (the real main player, which Twitch believes is playing aloud)
    var adMuted = who !== 'ad' || w.muted;
    if (a.realMuted.get.call(a.big) !== adMuted) {
      if (logIt && adMuted) note(a, { fixed: 'ad had really been unmuted' });
      a.realMuted.set.call(a.big, adMuted);
    }
    if (who === 'ad' && Math.abs(a.realVolume.get.call(a.big) - w.volume) > 0.001) {
      a.realVolume.set.call(a.big, w.volume);       // the level Twitch itself chose for this advert
    }
    // 2. the live stream
    var streamMuted = who !== 'stream' || w.muted;
    if (a.small.muted !== streamMuted) {
      if (logIt && who === 'stream') note(a, { fixed: 'stream muted', was: a.small.muted, now: streamMuted });
      a.small.muted = streamMuted;
    }
    if (Math.abs(a.small.volume - level) > 0.001) {
      if (logIt) note(a, { fixed: 'stream volume', was: a.small.volume, now: level });
      a.small.volume = level;
    }
    // 3. the viewer's own video (told to its page by syncMini)
    a.videoSound = { muted: who !== 'video' || w.muted, volume: level };
    a.heardNow = who;
  }

  function takeVolume(a) {
    var P = typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype;
    var dM = P && Object.getOwnPropertyDescriptor(P, 'muted');
    var dV = P && Object.getOwnPropertyDescriptor(P, 'volume');
    if (!dM || !dV || !dM.get || !dM.set || !dV.get || !dV.set) return false;
    var want = { muted: !!a.big.muted, volume: a.big.volume };
    // The stream plays at what the slider shows; if the slider cannot be read, at what Twitch asked of the ad.
    a.streamVolume = function () {
      var sv = sliderVolume(a);
      return sv === null ? want.volume : sv;
    };
    function passOn() {
      if (active !== a || !a.want) return;
      applySound(a, false);
    }
    try {
      Object.defineProperty(a.big, 'muted', {
        configurable: true, enumerable: true,
        get: function () { return want.muted; },
        set: function (x) { note(a, { twitchSetAd: 'muted', to: !!x }); want.muted = !!x; passOn(); }
      });
      Object.defineProperty(a.big, 'volume', {
        configurable: true, enumerable: true,
        get: function () { return want.volume; },
        set: function (x) {
          x = +x;
          note(a, { twitchSetAd: 'volume', to: x });
          if (x >= 0 && x <= 1) { want.volume = x; passOn(); }
        }
      });
    } catch (e) {
      try { delete a.big.muted; delete a.big.volume; } catch (e2) {}
      return false;
    }
    a.want = want;
    a.realMuted = dM;
    a.realVolume = dV;
    dM.set.call(a.big, true);                 // the ad itself: really silent, until the viewer's choice says otherwise
    passOn();
    return true;
  }

  // Hand the main player its own sound back, at whatever the viewer set during the break.
  function releaseVolume(a) {
    var want = a.want;
    a.want = null;
    delete a.big.muted;
    delete a.big.volume;
    a.big.volume = want.volume;
    a.big.muted = want.muted;
  }

  /* ---------------- enter / leave ---------------- */

  function enter(pair) {
    var small = pair.small, big = pair.big;
    active = {
      small: small, big: big, mode: 'mirror', where: 'over', t0: Date.now(), checked: false,
      streamMirror: null, adMirror: null, openedChat: chatOpenedAt > 0,
      sawText: adTextShown(), textGone: 0, lastCT: small.currentTime, lastMove: Date.now(),
      res: small.videoWidth + 'x' + small.videoHeight,
      resLog: [{ s: 0, res: small.videoWidth + 'x' + small.videoHeight }],
      origStyle: small.style.cssText,
      bigMuted: big.muted, before: { small: snap(small), big: snap(big) }
    };

    if (active.sawText) S.textWorks = true;
    S.note = null;
    try {
      active.sound = { ui: uiState(), stream: whereIs(small), ad: whereIs(big), events: [] };
    } catch (e0) { active.sound = { events: [], failed: String(e0 && e0.message) }; }
    active.sampleAt = 0;
    active.tabAtStart = tabState();
    active.nudged = nudges;
    try { capStart(active); } catch (e8) {}
    active.lastSample = '';

    active.slider = takeVolume(active);
    if (!active.slider) {
      // Could not take over the slider: plain version, ad muted and stream unmuted.
      big.muted = true;
      small.muted = false;
      if (small.volume === 0) small.volume = big.volume > 0 ? big.volume : 0.5;
    }

    try {
      active.streamMirror = mkMirror('stream', small);
      active.where = mountInside(active.streamMirror, big) ? 'inside' : 'over';
      if (active.where === 'over') active.streamMirror.style.cssText = OVER_STYLE;
    } catch (e) {
      fallbackInPlace(e.message);
    }
    place();
    paint();
    log('ad break: live stream moved to the main spot at', active.res);
  }

  function leave(reason) {
    if (!active) return;
    var a = active;
    a.miniWas = a.miniShown;
    dropMirrors();
    active = null;
    adSeenAt = 0;                             // restart the "ad showing but no swap" clock

    // If the mini player itself was restyled (the no-picture fallback), put its style back even
    // if Twitch has taken it off the page for now: Twitch re-uses the same element later.
    if (a.mode === 'inplace') a.small.style.cssText = a.origStyle;
    try { capStop(a); } catch (e9) {}
    if (a.want) releaseVolume(a);
    else a.big.muted = a.bigMuted;
    // Silence the mini stream again so it is not heard twice, unless it is now the only
    // player on the page (then it has become the main stream and its sound is left alone).
    var rest = videos();
    if (!(a.small.isConnected && rest.length < 2)) {
      a.small.muted = a.before.small.muted;
      a.small.volume = a.before.small.volume;
    }

    var after = rest.map(snap);
    var entry = {
      t: new Date(a.t0).toISOString(), seconds: Math.round((Date.now() - a.t0) / 1000),
      res: a.res, resLog: a.resLog,
      mode: a.mode, streamPlacement: a.mode === 'mirror' ? a.where : 'inplace',
      adInMini: a.adShown === true, chatOpenedByScript: a.openedChat, ended: reason,
      slider: a.slider ? 'controls the stream' : 'not taken over', sound: a.sound,
      subtitles: [a.cap1, a.cap2].filter(Boolean), adSubtitles: a.capLog,
      tabAtStart: a.tabAtStart, hadToStartSmallPlayer: a.nudged, streamSize: fitMode(), copyRes: a.copyRes, smallPlayerShowed: a.miniWas, heard: a.heardNow || 'stream',
      before: a.before, after: after
    };
    record(entry);
    if ((reason === 'ad countdown gone' || reason === 'player removed') && entry.seconds >= 5) tellBreakOver(entry.seconds);
    // For the "ads you didn't watch" count in the popup. Only real swaps of some length.
    if (entry.seconds >= 3 && a.mode === 'mirror') {
      try { window.postMessage({ source: 'adswap', type: 'swapped', seconds: entry.seconds }, location.origin); }
      catch (e12) {}
    }
    log('break over (' + reason + ') after', entry.seconds + 's. Videos now:', JSON.stringify(after));
    restoreChat(reason);
    paint();
  }

  /* ---------------- chat ---------------- */

  // Twitch only runs the mini stream while chat is open. If the viewer has chat closed
  // (including closed and then gone fullscreen), open it for the length of the break
  // and put it back afterwards.
  var CHAT_BTN = 'button[data-a-target="right-column__toggle-collapse-btn"]';

  function chatButton() {
    return typeof document.querySelector === 'function' ? document.querySelector(CHAT_BTN) : null;
  }

  function chatCollapsed() {
    return typeof document.querySelector === 'function' && !!document.querySelector('.right-column--collapsed');
  }

  function openChatForBreak() {
    var btn = chatButton();
    if (!btn) return;
    chatTried = true;
    chatOpenedAt = Date.now();
    btn.click();
    log('chat is closed; opening it for this ad break so the mini stream starts');
  }

  // Put chat back the way the viewer had it, if we were the ones who opened it.
  function restoreChat(why) {
    if (!chatOpenedAt) return;
    chatOpenedAt = 0;
    var btn = chatButton();
    if (btn && !chatCollapsed()) {
      btn.click();
      log('chat closed again (' + why + ')');
    }
  }

  /* ---------------- ads that cannot be swapped ---------------- */

  // Some ads come with no stream to swap in: the one Twitch plays as a channel opens, and
  // breaks that fill the player with no small player beside them. The stream cannot be shown,
  // but the ad need not be watched either. The viewer chooses in the popup:
  //   'video' - cover it with their own videos, with their sound (the default; falls back to
  //             'ad' when they have not added any)
  //   'hide'  - cover it with a plain card and the time left, in silence
  //   'ad'    - leave the ad alone
  var cov = null;           // the ad being covered right now, or null
  var FULL_CARD = 'color:#d7dde0;font:600 22px system-ui,sans-serif;text-align:center;white-space:nowrap;' +
    'overflow:hidden;background:#111315;';

  function videoCount() {
    var n = 0;
    try { n = parseInt(document.documentElement.getAttribute('data-adswap-videos'), 10) || 0; } catch (e) {}
    return n;
  }
  // What actually covers it. The default is the viewer's own videos; if they have added none,
  // the streamer's clips; if there are none of those either, the ad is left alone.
  function fullMode() {
    var v = '';
    try { v = document.documentElement.getAttribute('data-adswap-full') || ''; } catch (e) {}
    if (v !== 'ad' && v !== 'hide' && v !== 'video' && v !== 'clips') {
      v = (S.full === 'ad' || S.full === 'hide' || S.full === 'clips') ? S.full : 'video';
    }
    if (v === 'video' && (!baseUrl() || videoCount() < 1)) v = 'clips';    // none added: their clips
    if (v === 'clips' && !(baseUrl() && clipsReady())) v = 'ad';           // no clips either: leave the ad
    return v;
  }

  /* ---------------- the streamer's own clips ---------------- */

  // The most-watched clips of the channel being watched, to play instead of an ad. They come
  // from the same place Twitch's own website gets them (its GraphQL service, with the website's
  // public client id), because the official API needs a private developer key that a free
  // extension cannot keep. Twitch may change this at any time; if it stops working there are
  // simply no clips, and Ad Swap falls back as if the channel had none.
  var GQL_URL = 'https://gql.twitch.tv/gql';
  var GQL_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  var CLIP_TTL = 30 * 60 * 1000;        // a clip's play pass is refreshed after this long
  var CLIP_RETRY = 5 * 60 * 1000;       // after a failure, wait this long before asking again
  var NOT_A_CHANNEL = /^(directory|videos|settings|search|downloads|subscriptions|inventory|wallet|drops|turbo|jobs|p|friends|messages|following|moderator|popout|embed|clip|clips|u|prime|store|team|collections|login|signup|logout)$/;
  var clipStore = S.clipStore = { channel: '', list: null, at: 0, busy: false, failedAt: 0, error: '' };

  function clipChannel() {
    var c = channelName().toLowerCase();
    return /^[a-z0-9_]{2,25}$/.test(c) && !NOT_A_CHANNEL.test(c) ? c : '';
  }
  function clipsReady() {
    var c = clipChannel();
    return !!c && clipStore.channel === c && !!clipStore.list && clipStore.list.length > 0 &&
      Date.now() - clipStore.at < CLIP_TTL;
  }
  function clipList() { return clipsReady() ? clipStore.list : []; }

  function gql(query) {
    return fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Client-Id': GQL_CLIENT, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ query: query })
    }).then(function (r) {
      if (!r.ok) throw new Error('Twitch answered ' + r.status);
      return r.json();
    });
  }

  // The best size for playing: 720p, else the nearest below it, else whatever there is.
  function pickSource(qualities) {
    var best = null;
    for (var i = 0; i < (qualities || []).length; i++) {
      var q = qualities[i], h = parseInt(q.quality, 10);
      if (!q.sourceURL || !/^https:\/\//.test(q.sourceURL)) continue;
      if (h <= 720 && (!best || h > best.h)) best = { h: h, url: q.sourceURL };
    }
    if (!best && qualities && qualities[0] && /^https:\/\//.test(qualities[0].sourceURL)) best = { url: qualities[0].sourceURL };
    return best ? best.url : '';
  }

  // Not the same clips every break. A pool of up to ~150 of the channel's clips (the most watched
  // of the past week, month and all time) is kept for a few hours; each break gets 12 the viewer
  // has not seen yet, in a random order. A clip counts as seen once it has actually played, and
  // that is remembered on this computer, so it holds across visits. When every clip in the pool
  // has been seen, it starts over.
  var POOL_TTL = 6 * 60 * 60 * 1000;
  var SEEN_KEY = 'adswap.seenClips';
  var seenAll = {};
  try { seenAll = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (eSeen) { seenAll = {}; }
  S.seenClips = seenAll;

  function seenFor(c) { return seenAll[c] || (seenAll[c] = {}); }
  function saveSeen() {
    var now = Date.now(), cutoff = now - 60 * 24 * 60 * 60 * 1000, chans = [];
    Object.keys(seenAll).forEach(function (c) {
      var m = seenAll[c], keys = Object.keys(m).filter(function (k) { return m[k] > cutoff; });
      keys.sort(function (a, b) { return m[b] - m[a]; });
      var kept = {};
      keys.slice(0, 300).forEach(function (k) { kept[k] = m[k]; });
      seenAll[c] = kept;
      chans.push({ c: c, last: keys.length ? m[keys[0]] : 0 });
    });
    chans.sort(function (a, b) { return b.last - a.last; });
    chans.slice(25).forEach(function (x) { delete seenAll[x.c]; });
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenAll)); } catch (e) {}
  }

  // Up to n clips for the next break: ones not seen yet, in a random order. If the pool is used up
  // the viewer's history for this channel starts over; if only a few unseen are left, the longest-
  // ago seen ones fill the front (with "finish with the ad break" the end of the list is what plays).
  function pickClips(pool, seen, n, random) {
    random = random || Math.random;
    var fresh = pool.filter(function (x) { return !seen[x.slug]; });
    if (!fresh.length && pool.length) {
      Object.keys(seen).forEach(function (k) { delete seen[k]; });
      fresh = pool.slice();
    }
    for (var i = fresh.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1)), keep = fresh[i];
      fresh[i] = fresh[j];
      fresh[j] = keep;
    }
    var pick = fresh.slice(0, n);
    if (pick.length < n) {
      var old = pool.filter(function (x) { return seen[x.slug]; })
        .sort(function (a, b) { return seen[a.slug] - seen[b.slug]; });
      pick = old.slice(0, n - pick.length).concat(pick);
    }
    return pick;
  }
  S.pickClips = pickClips;

  function fetchPool(c) {
    function period(alias, which) {
      return ' ' + alias + ': clips(first: 50, criteria: { period: ' + which + ', sort: VIEWS_DESC }) ' +
        '{ edges { node { slug title durationSeconds } } }';
    }
    return gql('query { user(login: "' + c + '") {' + period('week', 'LAST_WEEK') + period('month', 'LAST_MONTH') +
        period('ever', 'ALL_TIME') + ' } }')
      .then(function (j) {
        var u = j && j.data && j.data.user;
        if (!u) throw new Error('no such channel');
        var seen = {}, pool = [];
        [u.week, u.month, u.ever].forEach(function (set) {
          ((set && set.edges) || []).forEach(function (e) {
            var n = e && e.node;
            if (!n || seen[n.slug]) return;
            if (!/^[A-Za-z0-9_-]{4,120}$/.test(n.slug) || !(n.durationSeconds >= 3)) return;
            seen[n.slug] = true;
            pool.push({ slug: n.slug, title: String(n.title || '').slice(0, 100), seconds: n.durationSeconds });
          });
        });
        return pool;
      });
  }

  // Play passes and addresses for the chosen clips, in one request (12: Twitch refuses more than
  // 15 clips in one request, measured 2026-11-15).
  function fetchPlayable(picked) {
    if (!picked.length) return Promise.resolve([]);
    var q = 'query {' + picked.map(function (p, i) {
      return ' c' + i + ': clip(slug: "' + p.slug + '") { playbackAccessToken(params: { platform: "web", ' +
        'playerBackend: "mediaplayer", playerType: "site" }) { signature value } videoQualities { quality sourceURL } }';
    }).join('') + ' }';
    return gql(q).then(function (k) {
      var d = (k && k.data) || {}, out = [];
      picked.forEach(function (p, i) {
        var clip = d['c' + i], tok = clip && clip.playbackAccessToken, src = clip && pickSource(clip.videoQualities);
        if (!src || !tok || !tok.signature || !tok.value) return;
        out.push({ slug: p.slug, title: p.title, seconds: p.seconds,
          url: src + (src.indexOf('?') < 0 ? '?' : '&') + 'sig=' + encodeURIComponent(tok.signature) +
            '&token=' + encodeURIComponent(tok.value) });
      });
      return out;
    });
  }

  // Is a clip list on screen right now? Then the next one waits until it is gone.
  function clipsInUse() {
    return !!((cov && cov.kind === 'clips') || (active && active.miniShown === 'clips'));
  }

  function fetchClips() {
    var c = clipChannel(), now = Date.now();
    if (!c || clipStore.busy || typeof fetch !== 'function') return;
    var poolFresh = clipStore.poolFor === c && !!clipStore.pool && now - clipStore.poolAt < POOL_TTL;
    var ready = clipsReady();
    if (ready && poolFresh && !clipStore.wantFresh) return;               // all set
    if (ready && clipsInUse()) return;                                   // wait for this break to end
    if (clipStore.channel === c && now - clipStore.failedAt < CLIP_RETRY) return;   // failed a moment ago
    clipStore.busy = true;
    (poolFresh ? Promise.resolve(clipStore.pool) : fetchPool(c))
      .then(function (pool) {
        clipStore.pool = pool;
        clipStore.poolFor = c;
        if (!poolFresh) clipStore.poolAt = Date.now();
        return fetchPlayable(pickClips(pool, seenFor(c), 12));
      })
      .then(function (list) {
        saveSeen();                                  // pickClips may have started a used-up channel over
        clipStore.channel = c;
        clipStore.list = list;
        clipStore.at = Date.now();
        clipStore.busy = false;
        clipStore.wantFresh = false;
        clipStore.error = list.length ? '' : 'this channel has no clips';
        if (!list.length) clipStore.failedAt = Date.now();
        log('clips for', c + ':', list.length, 'of', (clipStore.pool || []).length);
      })
      .catch(function (e) {
        if (clipStore.channel !== c) clipStore.list = null;     // keep a working list for this channel
        clipStore.channel = c;
        clipStore.busy = false;
        clipStore.failedAt = Date.now();
        clipStore.error = String((e && e.message) || e);
        log('could not get clips for', c, '(' + clipStore.error + ')');
      });
  }

  // The video page says which clip has started playing: remember it as seen, and get a fresh
  // set ready for the next break.
  try {
    if (window.addEventListener) {
      window.addEventListener('message', function (e) {
        var d = e.data, base = baseUrl();
        if (!d || d.source !== 'adswap-player' || d.type !== 'playing' || !base) return;
        if (e.origin !== base.replace(/\/$/, '')) return;
        var c = clipStore.channel, hit = (clipStore.list || []).filter(function (x) { return x.url === d.url; })[0];
        if (!c || !hit) return;
        seenFor(c)[hit.slug] = Date.now();
        saveSeen();
        clipStore.wantFresh = true;
      });
    }
  } catch (e16) {}

  // Only ask Twitch for clips when a setting could use them.
  function needsClips() {
    var mini = '', full = '';
    try {
      mini = document.documentElement.getAttribute('data-adswap-mini') || '';
      full = document.documentElement.getAttribute('data-adswap-full') || 'video';
    } catch (e) {}
    return mini === 'clips' || full === 'clips' || (full === 'video' && videoCount() < 1);
  }


  // Make a player tell Twitch "not muted, at volume X" (whatever Twitch last asked for) while
  // we decide what it really does. Twitch's volume slider then keeps working and never shows
  // "muted" because of us. Returns null where that cannot be done.
  function shadow(el, onWrite) {
    var P = typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype;
    var dM = P && Object.getOwnPropertyDescriptor(P, 'muted');
    var dV = P && Object.getOwnPropertyDescriptor(P, 'volume');
    if (!dM || !dV || !dM.get || !dM.set || !dV.get || !dV.set) return null;
    var want = { muted: !!el.muted, volume: el.volume };
    try {
      Object.defineProperty(el, 'muted', {
        configurable: true, enumerable: true,
        get: function () { return want.muted; },
        set: function (x) { want.muted = !!x; onWrite(); }
      });
      Object.defineProperty(el, 'volume', {
        configurable: true, enumerable: true,
        get: function () { return want.volume; },
        set: function (x) { x = +x; if (x >= 0 && x <= 1) { want.volume = x; onWrite(); } }
      });
    } catch (e) {
      try { delete el.muted; delete el.volume; } catch (e2) {}
      return null;
    }
    return { want: want, realMuted: dM, realVolume: dV };
  }
  function unshadow(el, sh) {
    delete el.muted;
    delete el.volume;
    el.volume = sh.want.volume;
    el.muted = sh.want.muted;
  }

  function coverInside(c) {
    if (!mountInside(c.el, c.big)) return false;
    if (c.kind === 'hide') c.el.style.cssText += FULL_CARD;
    return true;
  }

  function startCover(video, kind, manual) {
    var el;
    if (kind === 'video' || kind === 'clips') {
      el = document.createElement('iframe');
      el.id = ID_PREFIX + 'fullvideo';
      if (el.setAttribute) el.setAttribute('allow', 'autoplay');
      el.src = baseUrl() + 'player.html' + (kind === 'clips' ? '?src=clips' : '');
    } else {
      el = document.createElement('div');
      el.id = ID_PREFIX + 'fullcard';
    }
    cov = { big: video, kind: kind, el: el, t0: Date.now(), gone: 0, where: 'inside', bigMuted: video.muted, manual: !!manual,
      sh: null, stateAt: 0, stateKey: '' };
    cov.sh = shadow(video, function () { if (cov && cov.big === video) cov.stateAt = 0; });
    if (!coverInside(cov)) {
      cov.where = 'over';
      el.style.cssText = COVER_STYLE + (kind === 'hide' ? FULL_CARD : '');
    }
    S.fullCover = el;
    coverTick(true);
    paint();
    log(manual ? 'covered by you, with' : 'ad that cannot be swapped: covering it with',
      kind === 'video' ? 'your videos' : kind === 'clips' ? 'the streamer\'s clips' : 'a plain card');
  }

  // Keep the cover in place, the ad silent, and (for videos) the player page told the time
  // left and how loud to be. adOn: is the ad countdown still showing?
  function coverTick(adOn) {
    var c = cov, now = Date.now();
    if (!c) return;
    if (!c.big.isConnected) { endCover('player removed'); return; }
    if (!c.manual) {                                     // a cover the viewer put on stays until they take it off
      if (adOn) c.gone = 0;
      else if (!c.gone) c.gone = now;
      else if (now - c.gone > 400) { endCover('ad countdown gone'); return; }   // the stream is back: uncover at once
      if (adOn && countdownStuck()) { holdOff = true; endCover('ad countdown stuck'); return; }
      if (fullMode() !== c.kind) { endCover('setting changed'); return; }
    }

    if (c.where === 'inside' && !(c.el.isConnected && c.el.parentNode === c.big.parentElement)) {
      if (!coverInside(c)) {                               // Twitch rebuilt its player: float over it instead
        c.where = 'over';
        c.el.style.cssText = COVER_STYLE + (c.kind === 'hide' ? FULL_CARD : '');
      }
    }
    var box = c.big.getBoundingClientRect();
    if (c.where === 'over') fit(c.el, box, host());

    // The ad itself is silent for as long as it is covered.
    if (c.sh) { if (!c.sh.realMuted.get.call(c.big)) c.sh.realMuted.set.call(c.big, true); }
    else if (!c.big.muted) c.big.muted = true;

    if (c.kind === 'hide') {
      var words = adOn && adLeft ? 'Ad break  \u00b7  ' + adLeft + ' left' : (c.manual ? 'Covered' : 'Ad break');
      if (c.el.textContent !== words) c.el.textContent = words;
      c.el.style.lineHeight = box.height + 'px';
    } else if (c.el.contentWindow) {
      // Their videos are heard here (there is no stream to hear), at the level Twitch's slider
      // shows, and silenced by Twitch's mute button.
      var level = sliderVolume(c);
      if (level === null) level = c.sh ? c.sh.want.volume : 1;
      var secs = secondsLeft();
      var state = { source: 'adswap', type: 'state', left: c.gone ? 0 : (!adOn || secs === null ? null : secs + 0.4),
        muted: c.sh ? c.sh.want.muted : c.bigMuted, volume: level };
      if (c.kind === 'clips') state.clips = clipList();
      var key = state.muted + '|' + state.volume;
      if (now >= c.stateAt || key !== c.stateKey) {
        c.stateAt = now + 1000;
        c.stateKey = key;
        try { c.el.contentWindow.postMessage(state, baseUrl().replace(/\/$/, '')); } catch (e) {}
      }
    }
  }

  function endCover(reason) {
    var c = cov;
    if (!c) return;
    cov = null;
    c.el.remove();
    S.fullCover = null;
    if (c.sh) unshadow(c.big, c.sh);
    else c.big.muted = c.bigMuted;
    var seconds = Math.round((Date.now() - c.t0) / 1000);
    record({ t: new Date(c.t0).toISOString(), type: 'covered', showed: c.kind, placement: c.where,
      seconds: seconds, ended: reason, byYou: c.manual });
    if (seconds >= 3 && !c.manual) {
      try { window.postMessage({ source: 'adswap', type: 'swapped', seconds: seconds }, location.origin); }
      catch (e) {}
    }
    log('ad cover removed (' + reason + ') after', seconds + 's');
    paint();
  }

  /* ---------------- safety and the viewer's own controls ---------------- */

  // Twitch's ad countdown normally moves every second. If it has been seen moving during this
  // break and then stops for STUCK_MS (or sits at 0:00), Twitch has left its ad notice up after
  // the ad, and Ad Swap lets go rather than keep the stream covered. Only judged while the tab is
  // on screen: a page in a background tab may not redraw the countdown.
  function countdownStuck() {
    if (adLeftChanges < 1) return false;
    if (tabState() === 'hidden') { adLeftAt = Date.now(); return false; }
    var still = Date.now() - adLeftAt;
    return still > STUCK_MS || (adLeft === '0:00' && still > 4000);
  }

  function channelName() { return (pathNow().split('/')[1] || '').slice(0, 40); }

  // An ad break has ended. The helper script turns this into a notification, if the viewer
  // asked for one and is not looking at this tab.
  function tellBreakOver(seconds) {
    try {
      window.postMessage({ source: 'adswap', type: 'breakOver', seconds: Math.round(seconds), channel: channelName() },
        location.origin);
    } catch (e) {}
  }

  // The keyboard shortcut (set in Chrome; Alt+Shift+A unless the viewer changed it):
  //  - during a swap or a cover: show what is really there, and leave the rest of this break alone
  //  - otherwise: cover the player now, with the viewer's videos (or a plain card if they have
  //    none), until the shortcut is pressed again. Useful for anything Ad Swap did not catch.
  function coverNow() {
    if (!enabled) return;
    if (active) { holdOff = true; leave('uncovered by you'); return; }
    if (cov) { holdOff = true; endCover('uncovered by you'); return; }
    var vs = videos(), big = null;
    for (var i = 0; i < vs.length; i++) if (shown(vs[i]) && (!big || area(vs[i]) > area(big))) big = vs[i];
    if (!big) return;
    startCover(big, !baseUrl() ? 'hide' : videoCount() > 0 ? 'video' : clipsReady() ? 'clips' : 'hide', true);
  }
  S.coverNow = coverNow;
  try {
    if (window.addEventListener) {
      window.addEventListener('message', function (e) {
        var d = e.data;
        // 'coverToggle', not the 'coverNow' that copies up to v0.40 listen for: when a newer copy
        // is put into an open tab, the older one is stopped but its listener stays, and it must
        // not react. Only the copy in charge (the one S.coverNow points at) acts.
        if (e.source !== window || !d || d.source !== 'adswap-ext' || d.type !== 'coverToggle') return;
        if (S.coverNow !== coverNow) return;
        coverNow();
      });
    }
  } catch (e14) {}

  /* ---------------- loop ---------------- */

  // Any one of these means the break is over. Twitch does not always remove the
  // mini player when the ad ends, so removal alone is not enough.
  function endReason() {
    var a = active, now = Date.now();
    if (videos().length < 2 || !a.small.isConnected || !a.big.isConnected) return 'player removed';

    var text = adTextShown();
    if (text) {
      a.sawText = true; S.textWorks = true; a.textGone = 0;
    } else if (a.sawText) {
      if (!a.textGone) a.textGone = now;
      else if (now - a.textGone > TEXT_GONE_MS) return 'ad countdown gone';
    }
    if (text && countdownStuck()) { holdOff = true; return 'ad countdown stuck'; }

    // Mini player no longer drawn: either the ad is over or chat was closed. Twitch stops
    // playing the mini stream when chat is closed, so either way switch back now. If chat
    // is reopened while the ad is still running, the swap starts again by itself.
    if (!shown(a.small)) return text ? 'mini player hidden (chat closed?)' : 'mini player hidden';

    var ct = a.small.currentTime;
    if (ct !== a.lastCT) { a.lastCT = ct; a.lastMove = now; }
    else if (now - a.lastMove > STALL_MS) return 'mini stream stopped';

    return null;
  }

  function tick() {
    if (!enabled) return;

    if (!active) {
      idleTicks++;
      var vs = videos();
      // Reading the countdown costs a little, so with one player on the page look once a second.
      if (vs.length >= 2 || idleTicks % 4 === 0 || cov) idleText = adTextShown();
      var text = idleText;

      // A different channel (Twitch changes page without reloading) starts the question again.
      var pathIs = pathNow();
      if (pathIs !== navPath) { navPath = pathIs; navAt = Date.now(); streamSeen = false; quietTicks = 0; }
      if (text) quietTicks = 0;
      else if (!streamSeen) {
        var playing = false;
        for (var k = 0; k < vs.length; k++) if (vs[k].paused !== true && shown(vs[k])) playing = true;
        quietTicks = playing ? quietTicks + 1 : 0;
        if (quietTicks >= 12) streamSeen = true;          // 3 seconds of picture with no ad countdown
      }
      if (!text) {
        // An ad break that was not being swapped (covered, or left alone) has just ended.
        if (adSeenAt && Date.now() - adSeenAt > 5000) tellBreakOver((Date.now() - adSeenAt) / 1000);
        adSeenAt = 0; missNoted = false; chatTried = false; restoreChat('ad over');
        adLeft = ''; adLeftChanges = 0; miniStuckAt = 0;
        if (holdOff) { holdOff = false; paint(); }
        nudges = 0;
        if (S.note) { S.note = null; paint(); }
      }
      else if (!adSeenAt) adSeenAt = Date.now();

      var pair = findPair(text);
      var why = null;
      var mayAct = !holdOff && !(cov && cov.manual);       // the viewer's own choice comes first
      if (!pair) {
        cand = null;
        miniStuckAt = 0;
        var undrawn = false;
        for (var i = 0; i < vs.length; i++) if (!shown(vs[i])) undrawn = true;
        var atLoad = !streamSeen || (adSeenAt && adSeenAt - navAt < AT_LOAD_MS);
        why = vs.length < 2 ? (atLoad ? 'ad at page load: ' : '') +
            'only one player on the page (no mini stream exists)'
          : undrawn ? 'mini stream is on the page but not drawn (chat closed?)'
          : 'second player does not look like a mini stream';
      } else if (S.textWorks && !text) {
        // Once the countdown has been seen working, insist on it: a leftover mini player is not an ad.
        cand = null;
      } else if (!mayAct) {
        cand = null;
      } else {
        // The mini stream must really be playing: its clock has to move between two looks.
        var ct = pair.small.currentTime;
        if (!cand || cand.el !== pair.small) cand = { el: pair.small, ct: ct };
        else if (ct !== cand.ct) {
          cand = null;
          miniStuckAt = 0;
          if (cov && !cov.manual) endCover('small player started');   // it came to life: swap after all
          enter(pair);
          return;
        }
        else {
          why = 'mini stream is on the page but not playing';
          if (text && !miniStuckAt) miniStuckAt = Date.now();
          // Only during an ad countdown, only if it is really paused, and at most once a second.
          if (text && pair.small.paused === true && Date.now() - lastNudge >= 1000) {
            lastNudge = Date.now();
            nudges++;
            try {
              var started = pair.small.play();
              if (started && started.catch) started.catch(function () {});
            } catch (e7) {}
            if (nudges === 1) log('small stream player was paused; starting it');
          }
        }
      }

      if (text && !pair) {
        if (chatOpenedAt && Date.now() - chatOpenedAt > CHAT_WAIT_MS) {
          // We opened chat and no mini stream showed up: this is a full-screen ad. Put chat back.
          restoreChat('no mini stream appeared');
        } else if (S.autoChat && !chatTried && Date.now() - adSeenAt > 500 && chatCollapsed()) {
          openChatForBreak();   // once per break; if the viewer closes it again we leave it closed
        }
      }

      // An ad with nothing to swap in: cover it, if the viewer wants that. Not while we are still
      // waiting to see whether opening chat brings the small player, and only once it has had a
      // moment to appear by itself.
      if (cov) {
        if (pair && !cov.manual && !cov.stuckPair) endCover('small player appeared');
        else coverTick(text);
      } else if (mayAct && text && !pair && !chatOpenedAt &&
          !(S.autoChat && !chatTried && chatCollapsed()) && Date.now() - adSeenAt > 1500) {
        // Only the players actually on screen count. With chat closed Twitch can leave the small
        // player on the page but not drawn (seen 2026-11-17); that still leaves one player showing
        // the ad, and it is covered like any other.
        var onScreen = [];
        for (var v2 = 0; v2 < vs.length; v2++) if (shown(vs[v2])) onScreen.push(vs[v2]);
        var how = onScreen.length === 1 ? fullMode() : 'ad';
        if (how !== 'ad') startCover(onScreen[0], how);
      } else if (mayAct && text && pair && miniStuckAt && Date.now() - miniStuckAt > STUCK_MINI_MS && !chatOpenedAt) {
        var how2 = fullMode();
        if (how2 !== 'ad') {
          startCover(pair.big, how2);
          if (cov) cov.stuckPair = true;       // the small player is still there; keep covering while it is stuck
        }
      }

      // An ad has been showing for 3s and we have not swapped: record why, once per break.
      if (text && why && mayAct && !missNoted && !chatOpenedAt && Date.now() - adSeenAt > 3000) {
        missNoted = true;
        record({ t: new Date().toISOString(), type: 'no swap', why: why, openedChat: chatTried,
          chatCollapsed: chatCollapsed(), players: vs.map(describe),
          secondsSincePageOpened: Math.round((adSeenAt - navAt) / 1000), streamPlayedFirst: streamSeen,
          tab: tabState(), triedToStartSmallPlayer: nudges });
        log('ad showing but no swap:', why);
        S.note = why;                         // shown on the badge so the reason can be read off the screen
        paint();
      }
      return;
    }

    var ended = endReason();
    if (ended) {
      leave(ended);
      return;
    }

    // Twitch may re-assert its own mute state mid-break; hold ours.
    if (active.want) {
      // One sound only, the one the viewer chose, at whatever the slider and mute button say.
      applySound(active, true);
      try { syncPercent(active); } catch (e4) {}
    } else {
      if (!active.big.muted) { note(active, { fixed: 'ad had been unmuted' }); active.big.muted = true; }
      if (active.small.muted) { note(active, { fixed: 'stream had been muted' }); active.small.muted = false; }
    }

    // Twice per break (5s and 25s in), note what subtitles the ad and the stream carry.
    var capAge = Date.now() - active.t0;
    if ((!active.cap1 && capAge > 5000) || (!active.cap2 && capAge > 25000)) {
      var capKey = active.cap1 ? 'cap2' : 'cap1';
      try {
        active[capKey] = { s: Math.round(capAge / 1000), ad: captionInfo(active.big), stream: captionInfo(active.small) };
      } catch (e6) { active[capKey] = { failed: String(e6 && e6.message) }; }
    }

    // The advert's subtitles: off the stream, onto the advert in the small player.
    try {
      capSync(active);
      if (Date.now() >= active.capProbeAt) { active.capProbeAt = Date.now() + 2000; capProbe(active); }
    } catch (e10) {}

    // Once a second, note what Twitch's sound controls show (only when something changed).
    if (active.sound && Date.now() >= active.sampleAt) {
      active.sampleAt = Date.now() + 1000;
      try {
        var smp = {
          ui: uiState(), stream: [active.small.muted, active.small.volume],
          ad: active.want ? ['really muted: ' + active.realMuted.get.call(active.big), active.want.muted, active.want.volume]
            : [active.big.muted, active.big.volume]
        };
        var key = JSON.stringify(smp);
        if (key !== active.lastSample) { active.lastSample = key; note(active, smp); }
      } catch (e3) {}
    }

    // Record every change in the live stream's resolution during the break.
    var res = active.small.videoWidth + 'x' + active.small.videoHeight;
    if (res !== active.res) {
      active.res = res;
      active.resLog.push({ s: Math.round((Date.now() - active.t0) / 1000), res: res });
      log('stream quality changed to', res);
      paint();
    }

    place();
    if (active.fitShown !== fitMode()) { active.fitShown = fitMode(); paint(); }

    // One-time check that the mirrors are really drawing frames.
    if (!active.checked && Date.now() - active.t0 > FRAME_CHECK_MS) {
      active.checked = true;
      if (active.mode === 'mirror') {
        if (!(active.streamMirror && active.streamMirror.videoWidth > 0)) {
          fallbackInPlace('no frames after ' + FRAME_CHECK_MS + 'ms');
        } else if (active.adMirror && !(active.adMirror.videoWidth > 0)) {
          active.adMirror.remove();
          active.adMirror = null;
          log('ad mirror drew no frames; mini player left as is');
        } else if (active.adMirror) {
          active.adShown = true;
        }
      }
    }
  }

  // Nothing may fail silently: an error is written to the log and shown on the badge.
  function safeTick() {
    // Once a second: keep the badge clear of Twitch's ad notice.
    if (++dodgeTicks % 4 === 0) {
      try { placeBadge(); } catch (e11) {}
      try { if (enabled && baseUrl() && needsClips()) fetchClips(); } catch (e15) {}
      if (stale() !== staleShown) { staleShown = stale(); paint(); }
      try { dodge(enabled && (!!active || idleText)); } catch (e5) {}
    }
    try { tick(); }
    catch (e) {
      var msg = String((e && e.message) || e);
      if (S.err !== msg) {
        S.err = msg;
        record({ t: new Date().toISOString(), type: 'error', msg: msg,
          stack: String((e && e.stack) || '').slice(0, 600), swapped: !!active });
        log('error:', e);
        paint();
      }
    }
  }

  S.timer = setInterval(safeTick, TICK_MS);
  S.stop = function () {
    clearInterval(S.timer);
    leave('stopped');
    endCover('stopped');
    restoreChat('stopped');
    if (S.badge) S.badge.remove();
    if (S.capCss && S.capCss.remove) S.capCss.remove();
  };

  placeBadge();
  paint();
  log('armed (v' + VERSION + '). Click the badge to switch off. History: window.__adswap.log');
})();
