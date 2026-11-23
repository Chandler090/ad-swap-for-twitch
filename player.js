// Plays the viewer's own videos, or the streamer's clips (player.html?src=clips), over an ad
// on Twitch. The clips' addresses are handed over by the Twitch page itself.
//
// - They play one after another, round and round: one short video simply repeats.
// - In order, or shuffled into a fresh random order each break (set on the "My videos" page).
// - "Finish with the ad break" (also set there): the first video is joined part-way through,
//   so that the last one ends as the break does, and the speed is nudged by a few per cent
//   to stay on time.
// - Silent unless the viewer chose to hear the small player; then at the level Twitch's own
//   volume slider shows.
//
// The Twitch page tells this page, once a second, how long the break has left and whether to
// play aloud (see syncMini in adswap.user.js).
(function () {
  'use strict';

  var video = document.getElementById('v'), msg = document.getElementById('msg');
  var plan = AdSwapSchedule;

  var items = [];           // the stored videos
  var order = [];           // play order: indexes into items
  var lengths = [];         // seconds, in play order
  var at = 0;               // which one is playing (index into order)
  var joinAt = 0;           // seconds to skip into the next one loaded
  var fit = true;           // finish with the ad break
  var left = null, leftAt = 0;      // the break's time left, and when we were told
  var ready = false, started = false, told = false;
  var parentOrigin = '';     // the Twitch page this is shown on, once it has spoken
  var movedAt = 0;          // when we last jumped, so we do not judge the timing mid-jump
  var url = null, failed = 0;
  var CLIPS = /[?&]src=clips(&|$)/.test(location.search);
  // Covering an ad that can't be swapped (player.html?why=noswap): say so, and when the stream is back.
  var NOSWAP = /[?&]why=noswap(&|$)/.test(location.search);
  var clipsWaiting = null;   // resolves with the clip list when the Twitch page sends it
  var label = document.getElementById('label'), clipTitle = document.getElementById('clip-title');
  var back = document.getElementById('back'), backTime = document.getElementById('back-t');
  var why = document.getElementById('why'), what = document.getElementById('what');
  if (why) why.hidden = !NOSWAP;
  if (what) what.hidden = !CLIPS;         // own videos have no "CLIP" line, only the two below

  // "The live stream is back in 0:42", while clips play during an ad break. Hidden when there
  // is no ad on (the viewer covered the player with the shortcut) or the time is not known.
  function showBack() {
    if (!(CLIPS || NOSWAP) || !back || !backTime) return;
    var s = leftNow();
    if (s === null || !started) { back.hidden = true; return; }
    s = Math.max(0, Math.ceil(s - 0.3));
    var words = s < 1 ? 'any moment' : Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    if (backTime.textContent !== words) backTime.textContent = words;
    back.hidden = false;
  }
  setInterval(showBack, 250);

  function say(words) {
    msg.textContent = words;
    msg.hidden = false;
    video.hidden = true;
  }

  // The break's time left right now (the countdown only reaches us once a second).
  function leftNow() {
    return left === null ? null : Math.max(0, left - (Date.now() - leftAt) / 1000);
  }

  function load(index, offset) {
    at = index;
    joinAt = offset || 0;
    if (url && url.indexOf('blob:') === 0) URL.revokeObjectURL(url);
    var item = items[order[at]];
    url = item.blob ? URL.createObjectURL(item.blob) : item.url;
    if (CLIPS && parentOrigin) {                // so the same clip is not shown again next time
      try { window.parent.postMessage({ source: 'adswap-player', type: 'playing', url: item.url }, parentOrigin); } catch (e) {}
    }
    if (CLIPS && label && clipTitle) {          // never let the label stop a clip from playing
      clipTitle.textContent = item.name || 'Clip';
      clipTitle.title = item.name || '';
    }
    if ((CLIPS || NOSWAP) && label) label.hidden = false;
    video.src = url;
    video.playbackRate = 1;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  video.addEventListener('loadedmetadata', function () {
    // Only a jump into the middle of a video needs time to settle before the timing is judged
    // again. An ordinary change from one video to the next does not: with short videos that
    // happens every few seconds, and pausing the timekeeping each time let it drift.
    if (joinAt > 0 && isFinite(video.duration)) {
      video.currentTime = Math.min(joinAt, Math.max(0, video.duration - 0.05));
      movedAt = Date.now();
    }
    joinAt = 0;
  });
  // Round and round. Changing from one video to the next takes the browser a moment, and with
  // short videos those moments add up; so each new video is joined exactly where the plan says
  // we should be by now, which skips at most its first instant.
  video.addEventListener('ended', function () {
    var next = (at + 1) % order.length, skip = 0;
    if (fit && left !== null && plan.known(lengths)) {
      var should = plan.start(lengths, leftNow());
      if (should.index === next && should.offset < 3) skip = should.offset;
    }
    load(next, skip);
  });
  video.addEventListener('playing', function () { failed = 0; });
  video.addEventListener('error', function () {
    failed++;
    if (failed >= order.length && label) label.hidden = true;
    if (failed >= order.length) say(CLIPS ? 'Couldn\u2019t play this channel\u2019s clips.'
      : 'This browser can\u2019t play these videos. MP4 and WebM work best.');
    else load((at + 1) % order.length, 0);
  });

  function begin() {
    if (started || !ready) return;
    started = true;
    var from = fit ? plan.start(lengths, leftNow()) : { index: 0, offset: 0 };
    load(from.index, from.offset);
  }

  // Keep to the plan: a small gap is closed by playing a few per cent faster or slower, a big
  // one (the break was lengthened or cut short) by jumping to where we should be.
  function keepTime() {
    if (!started || !fit || left === null || !plan.known(lengths)) return;
    if (video.readyState < 1 || Date.now() - movedAt < 1500) return;
    var gap = plan.drift(lengths, at, video.currentTime, leftNow());
    if (Math.abs(gap) > 6) {
      var to = plan.start(lengths, leftNow());
      if (to.index === at) { video.currentTime = to.offset; movedAt = Date.now(); }
      else load(to.index, to.offset);
      video.playbackRate = 1;
    } else {
      video.playbackRate = plan.rate(gap);
    }
  }

  function setSound(muted, volume) {
    if (volume >= 0 && volume <= 1) video.volume = volume;
    if (video.muted === !!muted) return;
    video.muted = !!muted;
    if (!muted) {
      var p = video.play();       // a browser that will not start sound here keeps it silent instead
      if (p && p.catch) p.catch(function () { video.muted = true; var q = video.play(); if (q && q.catch) q.catch(function () {}); });
    }
  }

  // Only the Twitch page this is shown on may steer it.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || d.source !== 'adswap' || d.type !== 'state') return;
    if (e.origin !== 'https://www.twitch.tv' && e.origin !== location.origin) return;
    told = true;
    parentOrigin = e.origin;
    if (clipsWaiting && Array.isArray(d.clips) && d.clips.length) {
      var hand = clipsWaiting;
      clipsWaiting = null;
      hand(d.clips.filter(function (c) {
        return c && typeof c.url === 'string' &&
          /^https:\/\/[a-z0-9.-]+\.(cloudfront\.net|twitch\.tv|ttvnw\.net|jtvnw\.net)\//.test(c.url);
      }).slice(0, 40).map(function (c) {
        return { name: String(c.title || ''), duration: Number(c.seconds), url: c.url };
      }));
    }
    if (typeof d.left === 'number' && d.left >= 0) { left = d.left; leftAt = Date.now(); }
    setSound(d.muted !== false, Number(d.volume));
    if (!started) begin(); else keepTime();
  });

  function settings() {
    return new Promise(function (resolve) {
      var plain = { shuffle: false, fit: true };
      try { chrome.storage.local.get(plain, function (saved) { resolve(saved || plain); }); }
      catch (e) { resolve(plain); }       // opened outside the extension
    });
  }

  // Where the videos come from: the viewer's library, or the clips the Twitch page sends.
  function source() {
    if (!CLIPS) return AdSwapLibrary.list();
    return new Promise(function (resolve) {
      clipsWaiting = resolve;
      setTimeout(function () { if (clipsWaiting) { clipsWaiting = null; resolve([]); } }, 6000);
    });
  }

  Promise.all([source(), settings()]).then(function (got) {
    items = got[0];
    fit = got[1].fit !== false;
    if (!items.length) {
      if (CLIPS) { if (label) label.hidden = true; say('This channel has no clips to show.'); }
      else { msg.hidden = false; video.hidden = true; }
      return;
    }
    // Clips arrive already chosen and shuffled by the Twitch page; play them as given.
    order = plan.order(items.length, !CLIPS && got[1].shuffle === true);

    // Each video's length: remembered from when it was added, measured now if it was not.
    return Promise.all(order.map(function (i) {
      var known = items[i].duration;
      return isFinite(known) && known > 0 ? known : items[i].blob ? AdSwapLibrary.probe(items[i].blob) : null;
    })).then(function (found) {
      lengths = found.map(function (d) { return d === null ? NaN : d; });
      ready = true;
      // Start at once if the Twitch page has already said how things stand (including "no ad
      // on", when the viewer covered the player with the shortcut); otherwise give it a moment.
      if (left !== null || told) begin();
      else setTimeout(begin, 1500);
    });
  }, function () {
    say('Could not open your videos.');
  });

  window.AdSwapPlayer = {       // for looking at it while testing
    state: function () {
      return { started: started, at: at, order: order, lengths: lengths, left: leftNow(), fit: fit,
        time: video.currentTime, rate: video.playbackRate, muted: video.muted, volume: video.volume };
    }
  };
})();
