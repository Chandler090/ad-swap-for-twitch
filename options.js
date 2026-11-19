// The "My videos" page: add, see and remove the viewer's own videos.
(function () {
  'use strict';

  var list = document.getElementById('list'), empty = document.getElementById('empty');
  var total = document.getElementById('total'), pick = document.getElementById('pick');
  var drop = document.getElementById('drop'), use = document.getElementById('use');
  var useNote = document.getElementById('use-note');
  var urls = [];      // preview addresses made for the list, released when it is redrawn

  // The extension's own storage. Outside the extension (a plain page) the switch is not saved.
  var store = null;
  try { store = chrome.storage.local; } catch (e) {}

  function size(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function row(item) {
    var li = document.createElement('li');
    li.className = 'row';

    var v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    var url = URL.createObjectURL(item.blob);
    urls.push(url);
    v.src = url;

    var words = document.createElement('div');
    words.style.minWidth = '0';
    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name;
    name.title = item.name;
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = size(item.size);
    v.addEventListener('loadedmetadata', function () {
      var s = Math.round(v.duration);
      if (isFinite(s)) meta.textContent = size(item.size) + '  ·  ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    });
    v.addEventListener('error', function () {
      meta.textContent = size(item.size) + '  ·  this browser can’t play it';
      meta.className = 'meta bad';
    });
    words.appendChild(name);
    words.appendChild(meta);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + item.name);
    remove.addEventListener('click', function () {
      remove.disabled = true;
      AdSwapLibrary.remove(item.id).then(draw, draw);
    });

    li.appendChild(v);
    li.appendChild(words);
    li.appendChild(remove);
    return li;
  }

  function draw() {
    return AdSwapLibrary.list().then(function (items) {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      urls = [];
      list.textContent = '';
      var bytes = 0;
      items.forEach(function (item) { bytes += item.size; list.appendChild(row(item)); });
      empty.hidden = items.length > 0;
      if (store) store.set({ videos: items.length });     // lets Ad Swap know whether there is anything to show
      total.textContent = items.length ? items.length + (items.length === 1 ? ' video' : ' videos') + '  ·  ' + size(bytes) : '';
      return items.length;
    });
  }

  // Add the files one at a time, so a very large one cannot fail the rest.
  function addFiles(files) {
    var todo = Array.prototype.filter.call(files, function (f) { return /^video\//.test(f.type) || /\.(mp4|webm|m4v|mov|mkv|ogv)$/i.test(f.name); });
    var first = todo.length > 0;
    var chain = Promise.resolve();
    todo.forEach(function (f) {
      chain = chain.then(function () { return AdSwapLibrary.probe(f); })
        .then(function (seconds) { return AdSwapLibrary.add(f, seconds); }).catch(function (err) {
        empty.hidden = false;
        empty.textContent = 'Could not add ' + f.name + ': ' + (err && err.message ? err.message : 'not enough room in the browser’s storage') + '.';
      });
    });
    return chain.then(draw).then(function (count) {
      if (first && count && use.getAttribute('aria-checked') !== 'true') setUse(true);   // adding videos means wanting them shown
    });
  }

  document.getElementById('add').addEventListener('click', function () { pick.click(); });
  pick.addEventListener('change', function () { addFiles(pick.files).then(function () { pick.value = ''; }); });
  ['dragenter', 'dragover'].forEach(function (name) {
    drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  /* ---------------- the switch: the same setting as "Small player" in the popup ---------------- */

  function showUse(on) {
    use.setAttribute('aria-checked', String(on));
    useNote.textContent = on ? 'On: the small player shows your videos.' : 'Off: the small player shows the advert, or a plain card if you chose Hidden.';
  }
  function setUse(on) {
    showUse(on);
    if (store) store.set({ mini: on ? 'video' : 'ad' });
  }
  use.addEventListener('click', function () { setUse(use.getAttribute('aria-checked') !== 'true'); });
  if (store) {
    store.get({ mini: 'ad' }, function (saved) { showUse(saved.mini === 'video'); });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.mini) showUse(changes.mini.newValue === 'video');
    });
  }

  /* ---------------- shuffle, and finishing with the ad break ---------------- */

  function simpleSwitch(id, key, fallback, onText, offText) {
    var button = document.getElementById(id), words = document.getElementById(id + '-note');
    function show(on) {
      button.setAttribute('aria-checked', String(on));
      words.textContent = on ? onText : offText;
    }
    button.addEventListener('click', function () {
      var on = button.getAttribute('aria-checked') !== 'true';
      show(on);
      if (store) { var change = {}; change[key] = on; store.set(change); }
    });
    show(fallback);
    if (store) {
      var ask = {}; ask[key] = fallback;
      store.get(ask, function (saved) { show(saved[key] === true || (fallback && saved[key] !== false)); });
    }
  }
  simpleSwitch('shuffle', 'shuffle', false,
    'On: a new random order every ad break.', 'Off: they play in the order listed below.');
  simpleSwitch('fit', 'fit', true,
    'On: timed so the last video ends as the break does.', 'Off: they start from the beginning and stop when the break ends.');

  // Ask the browser not to clear these to make room. It may say no; nothing depends on it.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  draw();
  window.AdSwapOptions = { addFiles: addFiles, draw: draw };      // for testing the page by hand
})();
