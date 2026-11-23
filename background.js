// The extension's background script. Three small jobs:
//
//   1. An extra keyboard shortcut, if the viewer sets one at chrome://extensions/shortcuts
//      (the main one, "-", is handled on the Twitch page itself): tell the Twitch tab in front
//      to cover or uncover the player. bridge.js passes it on to the page.
//   2. "Tell me when an ad break ends" (off unless the viewer turns it on in the popup, which
//      also asks Chrome for permission to show notifications): when a Twitch tab the viewer is
//      not looking at says its ad break is over, show a notification. Clicking it brings that
//      tab back to the front.
'use strict';

chrome.commands.onCommand.addListener(function (command, tab) {
  if (command !== 'cover-now') return;
  function send(t) {
    if (!t || t.id === undefined) return;
    chrome.tabs.sendMessage(t.id, { type: 'coverNow' }).catch(function () {});   // not a Twitch tab: nothing to do
  }
  if (tab) send(tab);
  else chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { send(tabs && tabs[0]); });
});

chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== 'breakOver' || !sender.tab || !chrome.notifications) return;
  chrome.storage.local.get({ notify: 'off' }, function (saved) {
    if (saved.notify !== 'on') return;
    var who = String(msg.channel || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30);
    chrome.notifications.create('tab-' + sender.tab.id + '-' + sender.tab.windowId + '-' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Ad break over',
      message: (who ? who + '’s stream is back.' : 'The stream is back.') + ' Click to return to it.'
    });
  });
});

// Clicking the notification brings that Twitch tab and its window to the front. Notifications
// only exist once the viewer has allowed them, so this is set up when (and if) they have.
function listenForClicks() {
  if (!chrome.notifications || listenForClicks.done) return;
  listenForClicks.done = true;
  chrome.notifications.onClicked.addListener(function (id) {
    var m = /^tab-(\d+)-(\d+)-/.exec(id);
    chrome.notifications.clear(id);
    if (!m) return;
    chrome.tabs.update(+m[1], { active: true }).catch(function () {});
    chrome.windows.update(+m[2], { focused: true }).catch(function () {});
  });
}
listenForClicks();
chrome.permissions.onAdded.addListener(listenForClicks);

// 3. When AdSwap is installed or updated (including an automatic update from the Chrome Web
//    Store, or a reload in chrome://extensions), Twitch tabs that are already open would keep
//    the old copy, or have none, until refreshed. Put the current copy into them straight away.
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  chrome.tabs.query({ url: 'https://www.twitch.tv/*' }, function (tabs) {
    (tabs || []).forEach(function (t) {
      if (t.id === undefined || t.discarded) return;      // a discarded tab reloads, and gets it then
      chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['bridge.js'] })
        .then(function () {
          return chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['adswap.user.js'], world: 'MAIN' });
        })
        .catch(function () {});                           // a tab still loading gets it the normal way
    });
  });
});
