// The viewer's own videos: where they are kept and how to get at them.
//
// Shared by the "My videos" page (options.html), which adds and removes them, and the player
// page (player.html), which shows them in the small player during an ad break.
//
// They are kept in the browser's storage for this extension (IndexedDB), on this computer.
// Nothing is uploaded anywhere.
var AdSwapLibrary = (function () {
  'use strict';

  var DB = 'adswap', STORE = 'videos';

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // Run one request against the store and hand back its result once it is safely written.
  function run(mode, makeRequest) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = makeRequest(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || req.error); };
      });
    });
  }

  return {
    // file: a File from a file chooser or a drop. duration: its length in seconds, if known.
    // Returns the new entry's id.
    add: function (file, duration) {
      return run('readwrite', function (store) {
        return store.add({ name: file.name, size: file.size, type: file.type, added: Date.now(),
          duration: isFinite(duration) && duration > 0 ? duration : null, blob: file });
      });
    },
    // How long a video is, in seconds; null if this browser cannot play it or cannot tell.
    probe: function (blob) {
      return new Promise(function (resolve) {
        var v = document.createElement('video'), url = URL.createObjectURL(blob), done = false;
        function finish(d) {
          if (done) return;
          done = true;
          URL.revokeObjectURL(url);
          resolve(isFinite(d) && d > 0 ? d : null);
        }
        v.preload = 'metadata';
        v.muted = true;
        v.onloadedmetadata = function () {
          if (isFinite(v.duration)) { finish(v.duration); return; }
          // Some recordings do not say how long they are until the end has been looked at.
          v.ondurationchange = function () { if (isFinite(v.duration)) finish(v.duration); };
          try { v.currentTime = 1e9; } catch (e) { finish(null); }
        };
        v.onerror = function () { finish(null); };
        setTimeout(function () { finish(null); }, 4000);
        v.src = url;
      });
    },
    // Every stored video: { id, name, size, type, added, duration, blob }.
    list: function () {
      return run('readonly', function (store) { return store.getAll(); });
    },
    remove: function (id) {
      return run('readwrite', function (store) { return store.delete(id); });
    }
  };
})();
