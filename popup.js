// The window that opens when the Ad Swap icon in Chrome's toolbar is clicked.

// The developer's tip names. Leave one empty ('') to hide that button;
// leave all three empty and the whole "Buy me a coffee" section stays hidden.
var TIPS = {
  cashapp: 'AdSwap',        // Cash App $cashtag, with or without the $
  paypal: '',               // PayPal.Me name (the part after paypal.me/)
  venmo: 'Chandler090'      // Venmo username, with or without the @
};

(function () {
  'use strict';

  /* ---------------- coffee ---------------- */

  // name -> how the link is built and how the name is shown on the button
  var SERVICES = {
    cashapp: { url: function (n) { return 'https://cash.app/$' + n; }, show: function (n) { return '$' + n; } },
    paypal: { url: function (n) { return 'https://paypal.me/' + n; }, show: function (n) { return n; } },
    venmo: { url: function (n) { return 'https://venmo.com/u/' + n; }, show: function (n) { return '@' + n; } }
  };

  // A tip name is letters, digits, dot, dash or underscore. Anything else is not turned into a link.
  function clean(name) {
    var n = String(name || '').trim().replace(/^[$@]/, '');
    return /^[A-Za-z0-9._-]{1,40}$/.test(n) ? n : '';
  }

  var shown = 0;
  Object.keys(SERVICES).forEach(function (key) {
    var a = document.getElementById('tip-' + key);
    var n = clean(TIPS[key]);
    if (!a || !n) return;
    a.href = SERVICES[key].url(encodeURIComponent(n));
    a.querySelector('.handle').textContent = SERVICES[key].show(n);
    a.hidden = false;
    shown++;
  });
  if (shown) document.getElementById('coffee').hidden = false;

  var ver = document.getElementById('ver');
  try {
    ver.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (e) {
    ver.textContent = '';   // opened outside the extension (for example as a plain page)
  }

  // The extension's own storage. Outside the extension (a plain page) nothing is saved.
  var store = null;
  try { store = chrome.storage.local; } catch (e) {}

  /* ---------------- the running count ---------------- */

  function howLong(seconds) {
    var m = Math.round(seconds / 60);
    if (seconds < 60) return seconds + (seconds === 1 ? ' second' : ' seconds');
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function showTally(swaps, seconds) {
    var box = document.querySelector('.tally');
    var none = !(swaps > 0);
    box.classList.toggle('none', none);
    document.getElementById('tally-n').textContent = none ? 'No ad breaks swapped yet'
      : swaps + (swaps === 1 ? ' ad break swapped or covered' : ' ad breaks swapped or covered');
    document.getElementById('tally-t').textContent = none ? 'The count starts with your first one.'
      : howLong(seconds) + ' of ads you didn’t have to watch';
  }
  showTally(0, 0);

  /* ---------------- the settings ---------------- */

  // Each group of buttons is one setting: data-key on the group, data-value on each button.
  var DEFAULTS = { fit: 'fill', mini: 'ad', sound: 'stream', full: 'video', notify: 'off' };
  var groups = document.querySelectorAll('.seg[data-key]');

  function showChoice(group, value) {
    var buttons = group.querySelectorAll('button'), found = false, i;
    for (i = 0; i < buttons.length; i++) if (buttons[i].getAttribute('data-value') === value) found = true;
    if (!found) value = DEFAULTS[group.getAttribute('data-key')];
    for (i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-checked', String(buttons[i].getAttribute('data-value') === value));
    }
  }
  function wire(group) {
    var key = group.getAttribute('data-key');
    group.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var value = b.getAttribute('data-value');
      function save(v) {
        showChoice(group, v);
        if (store) { var change = {}; change[key] = v; store.set(change); }   // bridge.js passes it to Twitch at once
      }
      if (key === 'notify' && value === 'on') {
        try {
          chrome.permissions.request({ permissions: ['notifications'] }, function (granted) { save(granted ? 'on' : 'off'); });
        } catch (err) { save('off'); }
        return;
      }
      save(value);
    });
  }
  for (var g = 0; g < groups.length; g++) wire(groups[g]);

  function showAll(saved) {
    for (var i = 0; i < groups.length; i++) showChoice(groups[i], saved[groups[i].getAttribute('data-key')]);
    showTally(saved.swaps, saved.seconds);
  }
  if (store) {
    var wanted = { fit: DEFAULTS.fit, mini: DEFAULTS.mini, sound: DEFAULTS.sound, full: DEFAULTS.full,
      notify: DEFAULTS.notify, swaps: 0, seconds: 0 };
    store.get(wanted, showAll);
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local') store.get(wanted, showAll);       // e.g. a swap finishing while the popup is open
    });
  }

  // "My videos…" opens the page where the viewer's own videos are added.
  var link = document.getElementById('videos-link');
  if (link) {
    link.addEventListener('click', function (e) {
      try { chrome.runtime.openOptionsPage(); e.preventDefault(); } catch (err) {}   // plain link otherwise
    });
  }

  /* ---------------- the keyboard shortcut ---------------- */

  // The key is "-" on the Twitch page. A viewer who also set a key for it in Chrome
  // (chrome://extensions/shortcuts) is shown that one too.
  try {
    chrome.commands.getAll(function (all) {
      var c = (all || []).filter(function (x) { return x.name === 'cover-now'; })[0];
      var also = document.getElementById('key-also');
      if (!also || !c || !c.shortcut) return;
      also.textContent = ' (or ';
      var k = document.createElement('kbd');
      k.textContent = c.shortcut;
      also.appendChild(k);
      also.appendChild(document.createTextNode(')'));
    });
  } catch (e) {}

  /* ---------------- the little picture ---------------- */

  // Clicking it plays the swap again.
  var stage = document.getElementById('stage');
  if (stage) {
    stage.addEventListener('click', function () {
      var parts = stage.querySelectorAll('.screen');
      for (var i = 0; i < parts.length; i++) {
        parts[i].style.animation = 'none';
        void parts[i].offsetWidth;            // let the browser notice, so the animation restarts
        parts[i].style.animation = '';
        parts[i].style.animationDelay = '0ms';
      }
    });
  }
})();
