// TEST ONLY. Paste into the console on a Twitch channel page WHILE AN AD IS PLAYING.
// It adds a second, muted copy of the channel's player in the bottom-right corner
// for two minutes. The question it answers: does that second player show the live
// stream, or does it show an ad too?
(function () {
  var old = document.getElementById('__embedtest');
  if (old) old.remove();
  var channel = location.pathname.split('/')[1];
  var f = document.createElement('iframe');
  f.id = '__embedtest';
  f.src = 'https://player.twitch.tv/?channel=' + channel + '&parent=www.twitch.tv&muted=true';
  f.allow = 'autoplay; fullscreen';
  f.style.cssText = 'position:fixed;right:16px;bottom:16px;width:640px;height:360px;' +
    'z-index:2147483647;border:2px solid #a970ff;background:#000';
  document.body.appendChild(f);
  setTimeout(function () { f.remove(); }, 120000);
  return 'second player added bottom-right for ' + channel + '; it removes itself after 2 minutes';
})();
