// The arithmetic behind playing the viewer's own videos during an ad break:
// what order to play them in, and where to start so the last one finishes as the break does.
// Kept apart from the player page so it can be checked on its own (test/schedule.test.js).
var AdSwapSchedule = (function () {
  'use strict';

  function total(durations) {
    var sum = 0;
    for (var i = 0; i < durations.length; i++) sum += durations[i];
    return sum;
  }

  // True when every length is a real, positive number of seconds. Without that there is
  // nothing to plan against, and the videos just play round and round.
  function known(durations) {
    if (!durations.length) return false;
    for (var i = 0; i < durations.length; i++) {
      if (!(isFinite(durations[i]) && durations[i] > 0)) return false;
    }
    return true;
  }

  return {
    known: known,
    total: total,

    // The order to play n videos in: 0, 1, 2 ... or, shuffled, a fresh random order.
    // random: a function returning 0 <= x < 1 (Math.random unless a test supplies its own).
    order: function (n, shuffle, random) {
      var out = [], i;
      for (i = 0; i < n; i++) out.push(i);
      if (!shuffle) return out;
      random = random || Math.random;
      for (i = n - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1)), keep = out[i];
        out[i] = out[j];
        out[j] = keep;
      }
      return out;
    },

    // Where to start, so that playing the list round and round from there reaches the end of
    // its last video exactly `left` seconds from now. Usually that means joining the first
    // video part-way through. If the list is shorter than the break it goes round as many
    // times as it takes. Returns { index, offset }: which video (in play order), how far in.
    start: function (durations, left) {
      var whole = total(durations);
      if (!known(durations) || !(left >= 0)) return { index: 0, offset: 0 };
      var at = ((-left % whole) + whole) % whole;       // seconds into one pass of the list
      for (var i = 0; i < durations.length; i++) {
        if (at < durations[i] - 0.001) return { index: i, offset: at };
        at -= durations[i];
      }
      return { index: 0, offset: 0 };
    },

    // How far off the plan we are, in seconds, given the video now playing, how far into it,
    // and how long the break has left. Positive: we will finish BEFORE the break does (slow
    // down). Negative: we will finish after it (speed up). Zero when nothing can be planned.
    drift: function (durations, index, time, left) {
      var whole = total(durations);
      if (!known(durations) || !(left >= 0)) return 0;
      var done = time;
      for (var i = 0; i < index; i++) done += durations[i];
      var ours = whole - (done % whole);                // seconds until our list next ends
      var d = (((left - ours) % whole) + whole) % whole;
      return d > whole / 2 ? d - whole : d;
    },

    // The playing speed that closes that gap gently. A gap under about half a second is
    // within what the countdown can tell us and is left alone; beyond that the speed changes
    // in proportion to the gap, by at most 8%, which the eye does not notice.
    rate: function (drift) {
      if (Math.abs(drift) < 0.6) return 1;
      var change = Math.max(-0.08, Math.min(0.08, drift / 20));
      return Math.round((1 - change) * 1000) / 1000;
    }
  };
})();

if (typeof module !== 'undefined') module.exports = AdSwapSchedule;
