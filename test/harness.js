// Offline test of the adswap state machine against a fake page.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

let now = 1000000;
const realNow = Date.now;
Date.now = () => now;

const pageVideos = [];        // what querySelectorAll('video') returns
let tickFn = null;
let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) failures++;
}

function mkEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), id: '', style: { cssText: '' }, muted: false, volume: 1, currentTime: 0,
    videoWidth: 0, videoHeight: 0, isConnected: false, parentNode: null, _rect: { left: 0, top: 0, width: 0, height: 0 },
    getBoundingClientRect() { return this._rect; },
    captureStream() { return { from: this }; },
    play() { return Promise.resolve(); },
    remove() {
      this.isConnected = false; this.parentNode = null;
      const i = pageVideos.indexOf(this); if (i >= 0) pageVideos.splice(i, 1);
    },
    set srcObject(s) { this._src = s; if (s && s.from && !this._blank) { this.videoWidth = s.from.videoWidth; this.videoHeight = s.from.videoHeight; } },
    get srcObject() { return this._src; },
  };
  return el;
}
const body = {
  textContent: '',
  appendChild(el) { el.isConnected = true; el.parentNode = body; if (el.tagName === 'VIDEO' && !pageVideos.includes(el)) pageVideos.push(el); },
};
global.window = {};
global.document = {
  body, fullscreenElement: null,
  createElement: mkEl,
  querySelectorAll(sel) { return sel === 'video' ? pageVideos.slice() : []; },
};
global.setInterval = (fn) => { tickFn = fn; return 1; };
global.clearInterval = () => {};
const quiet = console.log;
console.log = (...a) => { if (!String(a[0]).includes('[adswap]')) quiet(...a); };

function pageVideo(w, h, vw, vh, muted, volume) {
  const v = mkEl('video');
  v._rect = { left: 10, top: 20, width: w, height: h };
  v.videoWidth = vw; v.videoHeight = vh; v.muted = muted; v.volume = volume;
  body.appendChild(v);
  return v;
}
const mirrors = () => pageVideos.filter(v => v.id.startsWith('__adswap_'));
const AD = 'MeatyMarley is taking an ad break; stick around to support the stream! Ad (0:30)';

// One 250ms step: real videos keep playing unless frozen, then the script looks at the page.
function step(n) {
  for (let i = 0; i < (n || 1); i++) {
    for (const v of pageVideos) if (!v.id.startsWith('__adswap_') && !v._frozen) v.currentTime += 0.25;
    now += 250;
    tickFn();
  }
}

// Fake Twitch chat: a toggle button and a "collapsed" marker class.
const chat = { collapsed: false, clicks: 0 };
const chatBtn = { click() { chat.clicks++; chat.collapsed = !chat.collapsed; } };
document.querySelector = (sel) =>
  sel.includes('toggle-collapse-btn') ? chatBtn :
  sel.includes('right-column--collapsed') ? (chat.collapsed ? {} : null) : null;

eval(src);
const S = window.__adswap;
const last = () => S.log[S.log.length - 1];

// 1. Normal viewing: one video.
const main = pageVideo(1280, 720, 1920, 1080, false, 0.5);
step(2);
check('one video -> nothing happens', mirrors().length === 0 && main.muted === false);

// 2. Ad break starts: Twitch adds a small muted stream element; main now plays the ad.
body.textContent = AD;
const mini = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('break detected -> two mirrors created', mirrors().length === 2);
check('ad (main) muted', main.muted === true);
check('stream (mini) unmuted', mini.muted === false);
const sm = mirrors().find(m => m.id === '__adswap_stream'), am = mirrors().find(m => m.id === '__adswap_ad');
check('stream mirror sits on the main player', sm && sm.style.width === '1280px' && sm.srcObject.from === mini);
check('ad mirror sits on the mini player', am && am.style.width === '320px' && am.srcObject.from === main);
check('mirrors are silent', sm.muted && am.muted);
check('the real mini player is left exactly where and how it was', mini.style.cssText === '');

// 3. Our own mirrors must not be mistaken for more ads; Twitch re-muting is overridden.
mini.muted = true; main.muted = false;
step(5);
check('still exactly two mirrors after more ticks', mirrors().length === 2);
check('mute state held against Twitch', main.muted === true && mini.muted === false);

// 4. Frame check passes when mirrors draw; a long break does not end early.
step(40);
mini.videoWidth = 1280; mini.videoHeight = 720;      // the player steps quality up mid-break
step(60);
check('still swapped 25s into the break', mirrors().length === 2);
check('ad mirror still sits on the mini slot after enlarging', am.style.width === '320px');

// 5. Ad ends the simple way: Twitch removes the mini element.
mini.remove(); body.textContent = ''; step();
check('mini removed -> switched back', mirrors().length === 0 && main.muted === false);
check('logged as player removed', last().ended === 'player removed' && last().adInMini === true);
check('quality rise recorded in the log', last().res === '1280x720' && last().resLog.length === 2 && (console.error('  resLog:', JSON.stringify(last().resLog)), last().resLog[1].s === 12) && !('upscale' in last()));

// 6. THE REPORTED BUG: ad ends but Twitch leaves the mini player in place, still playing.
body.textContent = AD;
const mini2 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('second break picked up', mirrors().length === 2);
body.textContent = '';
step(4);
check('countdown gone for 1s -> not yet switched (debounce)', mirrors().length === 2);
step(4);
check('countdown gone for 2s -> switched back', mirrors().length === 0);
check('logged as ad countdown gone', last().ended === 'ad countdown gone');
check('main sound restored, leftover mini silenced again', main.muted === false && mini2.muted === true);
check('leftover mini player put back to its own size', mini2.style.cssText === '');
step(40);
check('leftover mini player does not re-trigger a swap', mirrors().length === 0 && main.muted === false);
mini2.remove();

// 7. Ad ends with the mini player hidden by CSS (zero size) but still in the page.
body.textContent = AD;
const mini3 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
mini3._rect = { left: 0, top: 0, width: 0, height: 0 };
body.textContent = '';
step();
check('mini hidden -> switched back', mirrors().length === 0 && main.muted === false && last().ended === 'mini player hidden');
step(8);
check('hidden mini does not re-trigger', mirrors().length === 0);
mini3.remove(); body.textContent = '';

// 8. Mini stream freezes (Twitch stopped feeding it) while everything else lingers.
body.textContent = AD;
const mini4 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
mini4._frozen = true;
step(11);
check('frozen for under 3s -> still swapped', mirrors().length === 2);
step(3);
check('frozen for over 3s -> switched back', mirrors().length === 0 && last().ended === 'mini stream stopped' && mini4.style.cssText === '');
step(20);
check('frozen mini does not re-trigger even with countdown showing', mirrors().length === 0);
mini4.remove(); body.textContent = '';

// 9. Mirroring draws no frames -> in-place fallback, undone at break end.
body.textContent = AD;
const mini5 = pageVideo(320, 180, 640, 360, true, 0.5);
const origCreate = document.createElement;
document.createElement = (t) => { const e = origCreate(t); e._blank = true; return e; };
step(2); step(8);
check('blank mirror -> falls back to restyling mini in place', mirrors().length === 0 && mini5.style.cssText.includes('1280px'));
body.textContent = ''; step(8);
check('fallback style undone at break end', mini5.style.cssText === '' && main.muted === false);
document.createElement = origCreate;
mini5.remove();

// 10. Two same-sized videos (not an ad layout) -> ignored.
body.textContent = AD;
const twin = pageVideo(1280, 720, 1920, 1080, false, 0.5);
step(4);
check('two equal-sized videos are not treated as an ad', mirrors().length === 0 && main.muted === false);
twin.remove();

// 11. Switching off mid-break puts everything back.
const mini6 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('another break picked up', mirrors().length === 2);
S.badge.onclick();
check('badge click mid-break -> restored', mirrors().length === 0 && main.muted === false);
step(4);
check('stays off while disabled', mirrors().length === 0);

// 12. Switched back on with a mini player present but no ad countdown -> no swap.
body.textContent = '';
S.badge.onclick();
step(8);
check('mini player without an ad countdown is left alone', mirrors().length === 0 && main.muted === false);

// 13. The mini player's own size is never touched, during the swap or after it.
body.textContent = AD;
step(2);
check('swapped without resizing the mini player', mirrors().length === 2 && mini6.style.cssText === '');
mini6.remove(); body.textContent = ''; step();
check('mini player untouched after the break too', mini6.style.cssText === '' && mirrors().length === 0);
const ZERO = { left: 0, top: 0, width: 0, height: 0 };
const BOX = { left: 10, top: 20, width: 320, height: 180 };
const adMirror = () => mirrors().find(m => m.id === '__adswap_ad');
step(2);

// 14. REPORTED: chat closed when the ad starts. Mini stream is on the page, playing, but not drawn.
body.textContent = AD;
const mini7 = pageVideo(0, 0, 640, 360, true, 0.5);
step(2);
const before14 = S.log.length;
step(20);
check('chat closed at ad start -> ad left alone, nothing touched', mirrors().length === 0 && main.muted === false && mini7.muted === true && mini7.style.cssText === '');
check('reason recorded once as chat closed', S.log.length === before14 + 1 && last().type === 'no swap' && /not drawn/.test(last().why));
mini7._rect = { left: 10, top: 20, width: 320, height: 180 }; step(2);
check('chat opened during that ad -> swaps', mirrors().length === 2 && main.muted === true && mini7.muted === false);
body.textContent = ''; mini7.remove(); step();

// 15. REPORTED: chat closed in the middle of a break, then reopened.
body.textContent = AD;
const mini8 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('break with chat open -> ad copy shown in the mini slot', adMirror().style.display !== 'none' && adMirror().style.width === '320px');
mini8._rect = ZERO; step();
check('chat closed mid-break -> switched back at once, nothing left covering the player', mirrors().length === 0 && main.muted === false && mini8.muted === true && mini8.style.cssText === '');
check('logged as chat closed', /chat closed/.test(last().ended));
step(20);
check('stays switched back while chat is closed', mirrors().length === 0 && main.muted === false);
mini8._rect = BOX; step(2);
check('chat reopened mid-ad -> swaps again', mirrors().length === 2 && main.muted === true && mini8.muted === false);
body.textContent = ''; mini8.remove(); step();
check('ad over -> switched back', mirrors().length === 0 && main.muted === false);
step(4);   // quiet gap between breaks, as in real viewing

// 16. Ad showing, mini stream on the page but not playing -> no swap, reason recorded once.
body.textContent = AD;
const mini9 = pageVideo(320, 180, 640, 360, true, 0.5); mini9._frozen = true;
const before16 = S.log.length;
step(30);
check('paused mini stream -> no swap', mirrors().length === 0 && main.muted === false);
check('reason recorded once', S.log.length === before16 + 1 && last().type === 'no swap' && /not playing/.test(last().why) && last().players.length === 2);
mini9.remove(); body.textContent = ''; step(4);

// 17. Full-screen ad: one player and a countdown -> no swap, reason recorded.
body.textContent = AD;
step(20);
check('full-screen ad -> no swap, logged as only one player', mirrors().length === 0 && last().type === 'no swap' && /only one player/.test(last().why));
body.textContent = ''; step(4);

// 18. After all of the above, an ordinary break still works start to finish.
body.textContent = AD;
const mini10 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('ordinary break is picked up normally', mirrors().length === 2);
mini10.remove(); body.textContent = ''; step();
check('and ends normally', mirrors().length === 0 && main.muted === false);


// 19. REPORTED: Twitch takes the mini player off the page mid-break (chat closed), then
//     re-uses the very same element for the next break. Its size must have been put back.
step(4);
body.textContent = AD;
const mini11 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('break 19 picked up, mini player not restyled', mirrors().length === 2 && mini11.style.cssText === '');
mini11.remove(); step();
check('mini taken off the page -> its size and mute are still put back', mini11.style.cssText === '' && mini11.muted === true && main.muted === false);
body.textContent = ''; step(4);
body.textContent = AD; body.appendChild(mini11); step(2);
check('same element re-used for the next break -> swaps again', mirrors().length === 2 && main.muted === true);
mini11.remove(); body.textContent = ''; step(4);

// 20. (Removed with the enlarging trick in v0.19: nothing parks the mini player off-screen any more.)


// 21. REQUESTED: chat closed when a mini-player ad starts -> script opens chat, swaps, closes chat after.
step(4);
chat.collapsed = true; chat.clicks = 0;
body.textContent = AD;
step(8);
check('chat closed + ad -> script opens chat once', chat.clicks === 1 && chat.collapsed === false);
const mini12 = pageVideo(320, 180, 640, 360, true, 0.5);     // Twitch starts the mini stream now that chat is open
step(2);
check('mini stream appears -> swapped', mirrors().length === 2 && main.muted === true && mini12.muted === false);
step(40);
check('chat left open for the whole break', chat.clicks === 1 && mirrors().length === 2);
body.textContent = ''; mini12.remove(); step();
check('break over -> chat closed again, as the viewer had it', chat.clicks === 2 && chat.collapsed === true && main.muted === false);
check('logged that the script opened chat', last().chatOpenedByScript === true);
step(20);
check('chat not touched again between breaks', chat.clicks === 2);

// 22. Chat closed + full-screen ad (no mini stream ever comes) -> chat put back after 5s, no retry.
body.textContent = AD;
step(8);
check('full-screen ad with chat closed -> chat opened to look for the mini stream', chat.clicks === 3 && chat.collapsed === false);
step(22);
check('no mini stream after 5s -> chat closed again', chat.clicks === 4 && chat.collapsed === true);
step(60);
check('does not keep reopening chat during the same ad', chat.clicks === 4 && mirrors().length === 0 && main.muted === false);
check('reason recorded with the chat attempt noted', last().type === 'no swap' && last().openedChat === true);
body.textContent = ''; step(4);

// 23. Viewer closes chat themselves during a break the script opened it for -> left closed.
body.textContent = AD;
step(8);
const mini13 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('break 23 swapped after opening chat', chat.clicks === 5 && mirrors().length === 2);
chat.collapsed = true; mini13._rect = { left: 0, top: 0, width: 0, height: 0 };   // viewer collapses chat by hand
step();
check('viewer closed chat -> switched back, chat not clicked again', mirrors().length === 0 && chat.clicks === 5 && chat.collapsed === true);
step(40);
check('and it stays closed for the rest of that ad', chat.clicks === 5 && mirrors().length === 0);
mini13.remove(); body.textContent = ''; step(4);

// 24. Auto-open switched off -> chat is never touched.
S.autoChat = false;
body.textContent = AD;
step(20);
check('auto-open off -> chat untouched', chat.clicks === 5 && chat.collapsed === true);
body.textContent = ''; step(4);
S.autoChat = true; chat.collapsed = false;

// 25. Stream copy goes inside Twitch's player (so its controls stay usable) when it lands exactly on the ad.
const playerBox = {
  inserts: 0,
  insertBefore(el) {
    this.inserts++; el.isConnected = true; el.parentNode = this; el._rect = main._rect;
    if (!pageVideos.includes(el)) pageVideos.push(el);
  },
};
main.parentElement = playerBox;
document.elementsFromPoint = () => pageVideos.slice().reverse();   // later in the page = drawn on top
body.textContent = AD;
const mini14 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
const sm25 = mirrors().find(m => m.id === '__adswap_stream');
check('stream copy mounted inside the player', sm25 && sm25.parentNode === playerBox && sm25.style.cssText.includes('position:absolute') && sm25.style.cssText.includes('pointer-events:none'));
check('ad copy still on the page itself', adMirror() && adMirror().parentNode === body);
sm25.isConnected = false; sm25.parentNode = null;          // Twitch rebuilds that part of the player
step();
check('put back inside after Twitch rebuilt the player', sm25.parentNode === playerBox && playerBox.inserts === 2);
body.textContent = ''; mini14.remove(); step();
check('logged as inside placement, cleaned up', last().streamPlacement === 'inside' && mirrors().length === 0 && main.muted === false);

// 26. If the copy would not land on the ad (different box), it floats over the player instead.
const offBox = { insertBefore(el) { el.isConnected = true; el.parentNode = this; el._rect = { left: 0, top: 0, width: 100, height: 50 }; if (!pageVideos.includes(el)) pageVideos.push(el); } };
main.parentElement = offBox;
body.textContent = AD;
const mini15 = pageVideo(320, 180, 640, 360, true, 0.5);
step(2);
const sm26 = mirrors().find(m => m.id === '__adswap_stream');
check('wrong landing spot -> floats over the player instead', sm26 && sm26.parentNode === body && sm26.style.cssText.includes('position:fixed') && sm26.style.width === '1280px');
body.textContent = ''; mini15.remove(); step();
check('logged as over placement', last().streamPlacement === 'over');

// 27. Twitch's own corner player (after leaving a channel) next to another video is not an ad break,
//     even for a viewer whose countdown text has never been recognised.
step(8);
const logLen27 = S.log.length;
S.textWorks = false;
const corner = pageVideo(280, 158, 1920, 1080, false, 0.5);
corner.closest = (sel) => sel.includes('persistent-player__border--mini') ? {} : null;
step(8);
check('corner player beside another video -> no swap', mirrors().length === 0 && main.muted === false && corner.style.cssText === '' && S.log.length === logLen27);
// The regression in v0.12/0.13: during a real ad break the same kind of player must still swap.
S.textWorks = true; body.textContent = AD;
step(2);
check('corner-style player during a real ad countdown -> swaps', mirrors().length === 2);
body.textContent = ''; step(8);
check('and switches back when the countdown goes', mirrors().length === 0 && main.muted === false);
S.textWorks = false;
step(8);
check('corner player still ignored afterwards with no ad', mirrors().length === 0);
corner.closest = () => null;                                // control: the same video outside the corner player
step(2);
check('control: same video outside the corner player does swap', mirrors().length === 2);
corner.remove(); step();
check('control cleaned up', mirrors().length === 0 && main.muted === false);
S.textWorks = true;

// 28. Volume slider. In a real browser muted/volume live on the element's prototype, and
//     Twitch's slider writes them on the main player. Those writes must reach the stream.
main.remove(); step(8);
function Media() {}
Object.defineProperty(Media.prototype, 'muted', { configurable: true, get() { return !!this._m; }, set(x) { this._m = !!x; } });
Object.defineProperty(Media.prototype, 'volume', { configurable: true, get() { return this._v === undefined ? 1 : this._v; }, set(x) { this._v = +x; } });
global.HTMLMediaElement = Media;
function realVideo(w, h, vw, vh, muted, volume) {
  const v = mkEl('video'); delete v.muted; delete v.volume;
  Object.setPrototypeOf(v, Media.prototype);
  v._rect = { left: 10, top: 20, width: w, height: h };
  v.videoWidth = vw; v.videoHeight = vh; v.muted = muted; v.volume = volume;
  body.appendChild(v);
  return v;
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const main2 = realVideo(1280, 720, 1920, 1080, false, 0.6);
step(2);
body.textContent = AD;
const mini16 = realVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('slider: swap entered', mirrors().length === 2);
check('slider: ad is really silent', main2._m === true);
check('slider: ad player still reports unmuted at the viewer volume', main2.muted === false && main2.volume === 0.6);
check('slider: stream plays at the viewer volume', mini16._m === false && mini16._v === 0.6);
main2.volume = 0.3;                                         // viewer drags Twitch's slider
check('slider: drag changes the stream, not the ad', mini16._v === 0.3 && main2._m === true && main2._v === 0.6 && main2.volume === 0.3);
main2.muted = true;                                         // viewer clicks Twitch's mute button
check('slider: mute button mutes the stream', mini16._m === true && main2.muted === true);
main2.muted = false;
check('slider: unmute brings the stream back, ad stays silent', mini16._m === false && main2._m === true);
mini16._m = true; main2._m = false;                         // Twitch pushes its own state underneath
step();
check('slider: state held against Twitch', mini16._m === false && main2._m === true);
body.textContent = ''; mini16.remove(); step();
check('slider: after the break the main player has its sound back at the new volume', main2._m === false && main2._v === 0.3 && !own(main2, 'muted') && !own(main2, 'volume'));
check('slider: logged', last().slider === 'controls the stream');

// 29. A viewer watching muted is not surprised by sound when the swap starts.
main2.muted = true; step(8);
body.textContent = AD;
const mini17 = realVideo(320, 180, 640, 360, true, 0.5);
step(2);
check('muted viewer: stream stays muted in the swap', mirrors().length === 2 && mini17._m === true && main2.muted === true);
main2.muted = false;
check('muted viewer: unmuting during the break plays the stream', mini17._m === false && main2._m === true);
S.stop();
check('stopping mid-break gives the main player its own controls back', !own(main2, 'muted') && !own(main2, 'volume') && main2._m === false && mirrors().length === 0);

// 31. From a real log: Twitch gives each advert its own volume (0.63, then 0.58) while the viewer's
//     slider says 44%. The stream must play at the slider's value, and the percentage label
//     beside the slider must follow the slider when it is dragged.
mini17.remove();                                            // left over from the stopped break above
body.textContent = ''; main2.muted = false; step(8);
const slider ={ value: '0.44', says: '44%', getAttribute(k) { return k === 'aria-valuetext' ? this.says : null; } };
const tipText = { nodeType: 3, nodeValue: '44%' };
const tip = { children: { length: 0 }, className: 'tip', firstChild: tipText, get textContent() { return tipText.nodeValue; } };
const oldQS = document.querySelector, oldQSA = document.querySelectorAll;
document.querySelector = (sel) => sel.includes('player-volume-slider') ? slider : oldQS(sel);
document.querySelectorAll = (sel) => sel === 'video' ? pageVideos.slice()
  : sel.includes('tooltip') ? [tip] : sel.includes('player-volume-slider') ? [slider] : [];
main2.volume = 0.63;
body.textContent = AD;
const mini18 = realVideo(320, 180, 640, 360, true, 0);
step(2);
check('real log: stream plays at the slider volume, not the advert volume', mirrors().length === 2 && mini18._v === 0.44 && main2.volume === 0.63);
main2.volume = 0.58;                                        // next advert in the break
step();
check('real log: a new advert does not change the stream volume', mini18._v === 0.44 && main2.volume === 0.58);
slider.value = '0.8'; slider.says = '80%'; main2.volume = 0.8;    // viewer drags the slider
check('real log: dragging sets the stream volume at once', mini18._v === 0.8);
check('real log: label is stale until the next look', tipText.nodeValue === '44%');
step();
check('real log: percentage label now follows the slider', tipText.nodeValue === '80%');
body.textContent = ''; mini18.remove(); step();
check('real log: cleaned up', mirrors().length === 0 && main2._m === false);
document.querySelector = oldQS; document.querySelectorAll = oldQSA;

// 32. REPORTED from a real screenshot: in theatre mode the badge covered the start of Twitch's
//     ad notice. While an ad is on, the badge moves to just under that line, then back.
body.textContent = ''; step(8);
S.badge._rect = { left: 8, top: 8, right: 330, bottom: 36, width: 322, height: 28 };
S.badge.getBoundingClientRect = function () {      // like a real element: its box moves with its transform
  const m = /translateY\((-?\d+)px\)/.exec(this.style.transform || ''), dy = m ? +m[1] : 0, r = this._rect;
  return { left: r.left, right: r.right, top: r.top + dy, bottom: r.bottom + dy, width: r.width, height: r.height };
};
const noticeRow = { textContent: AD, children: [], _r: { top: 6, bottom: 34, left: 0, right: 500, width: 500, height: 28 }, getBoundingClientRect() { return this._r; } };
const playerRoot = { textContent: AD, children: [noticeRow], getBoundingClientRect() { return { left: 0, right: 930, top: 0, bottom: 920, width: 930, height: 920 }; } };
main2.closest = (sel) => sel === '.video-player' ? playerRoot : null;
step(8);
check('no ad -> badge stays put', !S.badge.style.transform);
body.textContent = AD;
step(8);
check('ad notice under the badge -> badge slides below it', S.badge.style.transform === 'translateY(32px)');
for (let i = 0; i < 12; i++) {                      // every look for the next 3 seconds
  step();
  if (S.badge.style.transform !== 'translateY(32px)') { check('badge moved or flickered at tick ' + i, false); break; }
}
check('and stays there, without creeping or flickering', S.badge.style.transform === 'translateY(32px)');
noticeRow._r = { top: 56, bottom: 84, left: 240, right: 740, width: 500, height: 28 };   // normal layout: notice is lower down
step(8);
check('notice not under the badge -> badge back in its corner', !S.badge.style.transform);
noticeRow._r = { top: 6, bottom: 34, left: 0, right: 500, width: 500, height: 28 };
step(8);
body.textContent = ''; playerRoot.textContent = ''; noticeRow.textContent = '';
step(8);
check('ad over -> badge back in its corner', !S.badge.style.transform);
delete main2.closest;

// 33. REPORTED: "refreshed and now it's not working at all". Both failed ads in the pasted log had
//     one player on the page and came right after the page was opened. That is an ad Twitch plays
//     before the stream starts; the badge and the log must say so instead of looking like a fault.
body.textContent = ''; step(16);
global.location = { pathname: '/somechannel' };            // viewer opens a channel
step(2);
body.textContent = AD;                                      // the ad starts before any stream has played
step(16);
check('ad right after opening a channel -> logged as an ad at page load', last().type === 'no swap' &&
  /ad at page load/.test(last().why) && /only one player/.test(last().why) &&
  last().streamPlayedFirst === false && last().secondsSincePageOpened <= 2);
check('badge says plainly that this ad cannot be swapped, and why', /can't swap this ad/.test(S.badge.textContent) &&
  /as the channel opens/.test(S.badge.textContent) && !/for the log/.test(S.badge.textContent));
check('that message is short enough for the top bar, with the full reason on hover', S.badge.textContent.length <= 60 &&
  /nothing to swap in\. This is normal/.test(S.badge.title));
body.textContent = ''; step(120);                           // ad ends, the stream plays for 30 seconds
check('badge back to watching', /watching$/.test(S.badge.textContent));
body.textContent = AD; step(16);                            // a later full-screen ad, mid-stream
check('a later full-screen ad is not called a pre-roll', last().type === 'no swap' &&
  !/ad at page load/.test(last().why) && /only one player/.test(last().why) && last().streamPlayedFirst === true &&
  /can't swap this ad/.test(S.badge.textContent) && /no small player/.test(S.badge.textContent) &&
  !/channel opens/.test(S.badge.textContent) && S.badge.textContent.length <= 60);
body.textContent = ''; step(8);
delete global.location;

// 34. The log records what subtitles the ad and the stream carry during a swap.
body.textContent = ''; step(16);
main2.textTracks = [{ kind: 'captions', label: 'English', language: 'en', mode: 'hidden',
  cues: { length: 14 }, activeCues: [{ text: 'Try the new burger today.' }] }];
body.textContent = AD;
const mini19 = realVideo(320, 180, 640, 360, true, 0);
step(2);
check('subtitles: swap entered', mirrors().length === 2);
step(110);                                                  // past both looks (5s and 25s)
body.textContent = ''; mini19.remove(); step();
const subs = last().subtitles;
check('subtitles: two looks recorded, at about 5s and 25s', Array.isArray(subs) && subs.length === 2 && subs[0].s >= 5 && subs[0].s <= 6 && subs[1].s >= 25);
check('subtitles: the ad\'s track and the line showing are in the log', subs[0].ad.tracks.length === 1 &&
  subs[0].ad.tracks[0].kind === 'captions' && subs[0].ad.tracks[0].cues === 14 &&
  subs[0].ad.tracks[0].showingNow === 'Try the new burger today.' && subs[0].stream.tracks.length === 0);
delete main2.textTracks;

// 35. REPORTED (real log, 2026-11-15, "it didn't switch the ad that time"): 15 minutes into a
//     stream, an ad break came with the small stream player on the page and drawn, but paused.
//     The swap waits for that stream to be running, so it never happened. The script must start it.
body.textContent = ''; step(16);
body.textContent = AD;
const mini20 = realVideo(320, 180, 640, 360, true, 0);
mini20.paused = true; mini20._frozen = true;
let plays = 0;
mini20.play = function () { plays++; if (plays >= 2) { this.paused = false; this._frozen = false; } return Promise.resolve(); };
step(3);
check('paused small player: first attempt made, not swapped yet', mirrors().length === 0 && plays === 1);
step(8);
check('paused small player: started by the script, then swapped', mirrors().length === 2 && plays >= 2 && mini20.paused === false);
body.textContent = ''; mini20.remove(); step();
check('paused small player: the log says the script had to start it', last().hadToStartSmallPlayer >= 2 && last().ended === 'player removed');
// ...and it is left alone when no ad is on.
step(8);
const mini21 = realVideo(320, 180, 640, 360, true, 0);
mini21.paused = true; mini21._frozen = true;
let plays21 = 0;
mini21.play = function () { plays21++; return Promise.resolve(); };
step(16);
check('paused small player with no ad on is not touched', plays21 === 0 && mirrors().length === 0);
mini21.remove(); step();

// 36. REPORTED (2026-11-15): "the ads subtitles are on the stream and not the ad in the mini
//     player", and "the last thing said gets stuck on screen". The advert's subtitle text must be
//     hidden on the main player, shown over the advert in the small player, and cleared when stale.
body.textContent = ''; step(16);
const capEl = { tagName: 'DIV', className: 'player-captions-container', textContent: 'Try the new burger today.',
  parentElement: null, closest() { return null; }, getAttribute() { return null; } };
const marks = {};
const root36 = {
  querySelectorAll(sel) { return sel.includes('caption') ? [capEl] : []; },
  setAttribute(k, v) { marks[k] = v; }, removeAttribute(k) { delete marks[k]; }
};
main2.closest = (sel) => sel === '.video-player' ? root36 : null;
body.textContent = AD;
const mini22 = realVideo(320, 180, 640, 360, true, 0);
step(3);
check('ad subtitles: swap entered and the main player is marked so its subtitles are hidden',
  mirrors().length === 2 && 'data-adswap-caps' in marks);
check('ad subtitles: the line is shown over the advert in the small player', !!S.capBox &&
  S.capBox.textContent === 'Try the new burger today.' && S.capBox.style.display === 'block' &&
  S.capBox.parentNode === body && S.capBox.style.left === '170px' && S.capBox.style.top === '194px');
step(20);
check('ad subtitles: still showing 5 seconds later', S.capBox.style.display === 'block');
step(12);
check('ad subtitles: a line nothing replaced is cleared after 7 seconds', S.capBox.style.display === 'none');
capEl.textContent = 'Order now.'; step();
check('ad subtitles: the next line appears', S.capBox.textContent === 'Order now.' && S.capBox.style.display === 'block');
capEl.textContent = ''; step();
check('ad subtitles: nothing said -> nothing shown', S.capBox.style.display === 'none');
body.textContent = ''; mini22.remove(); step();
check('ad subtitles: put back at the end of the break', S.capBox === null && !('data-adswap-caps' in marks));
check('ad subtitles: the log names the subtitle box and the lines seen', last().adSubtitles.boxes.length === 1 &&
  /player-captions-container/.test(last().adSubtitles.boxes[0]) && last().adSubtitles.lines.length === 2 &&
  last().adSubtitles.lines[0].text === 'Try the new burger today.');
delete main2.closest;

// 37. ASKED (2026-11-15): the badge covered Twitch's logo. It now lives in the empty stretch of
//     the top bar, after the logo, the links and the "more" button; with no top bar (theatre
//     mode) it floats in the corner as before.
body.textContent = ''; step(8);
check('no top bar on the page -> badge floats in the corner', S.badge.parentNode === body && /position:fixed/.test(S.badge.style.cssText));
const navRow37 = { lastElementChild: null, contains(e) { return e === browse37; },
  appendChild(el) { el.parentNode = navRow37; navRow37.lastElementChild = el; } };
const logo37 = { parentElement: navRow37, _r: { left: 0, top: 0, width: 48, height: 50 }, getBoundingClientRect() { return this._r; } };
const browse37 = {};
const qs37 = document.querySelector;
document.querySelector = (sel) => sel.includes('home-link') ? logo37 : sel.includes('browse-link') ? browse37 : qs37(sel);
step(4);
check('top bar present -> badge is the last thing in its row', S.badge.parentNode === navRow37 && navRow37.lastElementChild === S.badge);
check('and it sits in the bar\'s flow, not on top of anything', /position:static/.test(S.badge.style.cssText) && !/position:fixed/.test(S.badge.style.cssText));
navRow37.lastElementChild = {};                             // Twitch adds something after it
step(4);
check('Twitch rebuilt the bar -> badge moved back to the end', navRow37.lastElementChild === S.badge);
logo37._r = { left: 0, top: 0, width: 0, height: 0 };       // theatre mode: the bar is not drawn
step(4);
check('top bar hidden -> badge floats in the corner again', S.badge.parentNode === body && /position:fixed/.test(S.badge.style.cssText));
document.querySelector = qs37; step(4);

// 38. ASKED (2026-11-15): let the viewer choose between the stream filling the player (soft) and
//     staying at its real size, centred (sharp). The choice arrives as an attribute on <html>.
body.textContent = ''; step(16);
let fitAttr = null;
document.documentElement = { getAttribute(k) { return k === 'data-adswap-fit' ? fitAttr : null; } };
body.textContent = AD;
const mini23 = realVideo(320, 180, 640, 360, true, 0);
step(3);
const sm38 = mirrors().find(m => m.id === '__adswap_stream');
check('stream size: with nothing chosen the stream fills the player', !!sm38 && sm38.style.padding === '0px 0px 0px 0px' &&
  !/actual size/.test(S.badge.textContent));
fitAttr = 'actual'; step();
// player 1280x720, picture 640x360: 320 clear on each side, 180 above and below
check('stream size: "actual" leaves exactly the picture\'s real size in the middle, at once, mid-swap',
  sm38.style.padding === '180px 320px 180px 320px' && sm38.style.boxSizing === 'border-box');
global.devicePixelRatio = 1.5; step();                      // Windows display scaling at 150%
// 640/1.5 = 426.67 wide, 240 high: 426 clear on the left, 427.33 on the right, 240 above and below
check('stream size: with 150% display scaling the box shrinks so it is still one dot per screen dot',
  /^240px 427\.3\d*px 240px 426px$/.test(sm38.style.padding));
delete global.devicePixelRatio; step();
check('stream size: the copy still covers the whole player, so the ad stays hidden', sm38.style.width === '1280px');
check('stream size: the badge says so', /actual size/.test(S.badge.textContent));
fitAttr = 'fill'; step();
check('stream size: back to filling the player', sm38.style.padding === '0px 0px 0px 0px' && !/actual size/.test(S.badge.textContent));
// REPORTED (2026-11-15): "I was able to switch from small to big and back, but now it's not
// allowing me from big to small." Twitch rebuilding its player wipes the copy's styles; the
// script must notice and put the size back, in both directions, as often as it happens.
fitAttr = 'actual'; step();
sm38.style.padding = ''; sm38.style.boxSizing = '';          // Twitch rebuilt the player: styles gone
step();
check('stream size: wiped by a player rebuild -> small size put straight back', sm38.style.padding === '180px 320px 180px 320px');
fitAttr = 'fill'; step(); fitAttr = 'actual'; sm38.style.padding = '0px 0px 0px 0px'; step();
check('stream size: big -> small works again after a rebuild', sm38.style.padding === '180px 320px 180px 320px');
fitAttr = 'fill'; step();
fitAttr = 'actual'; step();
body.textContent = ''; mini23.remove(); step();
check('stream size: the log records which was used, and the size of the copy', last().streamSize === 'actual' && last().copyRes === '640x360');
delete document.documentElement;

// 39. ASKED (2026-11-15): choose what the small player shows during a swap: the ad (default),
//     nothing (a card with the time left), or the viewer's own videos. Changeable mid-ad.
body.textContent = ''; step(16);
const attrs39 = {};
document.documentElement = { getAttribute(k) { return k in attrs39 ? attrs39[k] : null; } };
const adCopy = () => mirrors().find(m => m.id === '__adswap_ad');
body.textContent = 'Streamer is taking an ad break; stick around to support the stream! Ad (1:26)';
const mini24 = realVideo(320, 180, 640, 360, true, 0);
step(3);
check('small player: by default it shows the ad', !!adCopy() && !S.cover);
attrs39['data-adswap-mini'] = 'hide'; step();
check('small player: "hide" removes the ad copy at once, mid-ad', !adCopy() && !!S.cover && S.cover.id === '__adswap_card');
check('small player: the card says how long is left', /^Ad break\s+.\s+1:26 left$/.test(S.cover.textContent) &&
  S.cover.parentNode === body && S.cover.style.width === '320px' && S.cover.style.lineHeight === '180px');
body.textContent = 'Streamer is taking an ad break; stick around to support the stream! Ad (1:25)'; step();
check('small player: the card counts down', /1:25 left$/.test(S.cover.textContent));
check('small player: the stream is still in the main player', !!mirrors().find(m => m.id === '__adswap_stream'));
attrs39['data-adswap-mini'] = 'video'; step();
check('small player: "my videos" without the extension\'s pages falls back to the card', S.cover.id === '__adswap_card');
attrs39['data-adswap-base'] = 'chrome-extension://abcdefghijklmnop/'; attrs39['data-adswap-mini'] = 'hide'; step();
attrs39['data-adswap-mini'] = 'video'; step();
check('small player: "my videos" shows the extension\'s player page over it', !adCopy() && S.cover.id === '__adswap_myvideo' &&
  S.cover.src === 'chrome-extension://abcdefghijklmnop/player.html' && S.cover.style.width === '320px');
attrs39['data-adswap-base'] = 'https://evil.example/'; attrs39['data-adswap-mini'] = 'hide'; step(); attrs39['data-adswap-mini'] = 'video'; step();
check('small player: an address that is not the extension\'s is never loaded', S.cover.id === '__adswap_card');
attrs39['data-adswap-mini'] = 'ad'; step();
check('small player: back to the ad, mid-ad', !!adCopy() && !S.cover);
attrs39['data-adswap-mini'] = 'hide'; step();
// 40. The count for the popup: a finished swap is reported to the helper script.
const posted = [];
window.postMessage = (msg, origin) => posted.push([msg, origin]);
global.location = { pathname: '/x', origin: 'https://www.twitch.tv' };
for (let i = 0; i < 10; i++) {                             // ten more seconds of a countdown that keeps moving
  body.textContent = 'Streamer is taking an ad break; stick around to support the stream! Ad (1:' + (24 - i) + ')';
  step(4);
}
body.textContent = ''; mini24.remove(); step();
check('small player: everything is cleared at the end of the break', !S.cover && mirrors().length === 0);
check('small player: the log says what it showed', last().smallPlayerShowed === 'hide');
const swappedMsgs = posted.filter(p => p[0].type === 'swapped');
check('counter: the finished swap is reported, with its length, to this page only', swappedMsgs.length === 1 &&
  swappedMsgs[0][0].source === 'adswap' && swappedMsgs[0][0].seconds >= 10 &&
  swappedMsgs[0][1] === 'https://www.twitch.tv');
check('break-over: the end of the break is announced once, with the channel', posted.filter(p => p[0].type === 'breakOver').length === 1 &&
  posted.find(p => p[0].type === 'breakOver')[0].channel === 'x');
delete window.postMessage; delete global.location;
// 41. After an extension update the open page still runs the old copy: the banner says so.
step(8);
check('update notice: normally the banner just says watching', /^AdSwap: watching$/.test(S.badge.textContent));
attrs39['data-adswap-stale'] = '1'; step(4);
check('update notice: after an update it asks for a refresh', /refresh this page/.test(S.badge.textContent));
delete attrs39['data-adswap-stale']; step(4);
delete document.documentElement;

// 42. ASKED (2026-11-15): let the viewer hear the small player (the advert, or their own video)
//     instead of the stream. Only ever one sound, at the level Twitch's slider shows.
body.textContent = ''; step(16);
const attrs42 = {};
document.documentElement = { getAttribute(k) { return k in attrs42 ? attrs42[k] : null; } };
main2.muted = false; main2.volume = 0.5; step(8);
body.textContent = 'Streamer is taking an ad break; stick around to support the stream! Ad (0:30)';
const mini25 = realVideo(320, 180, 640, 360, true, 0);
step(3);
check('sound: by default the stream is heard and the advert is silent', mirrors().length === 2 && main2._m === true && mini25._m === false && mini25._v === 0.5);
attrs42['data-adswap-sound'] = 'small'; step();
check('sound: "small player" with the advert showing -> the advert is heard, the stream is silent',
  main2._m === false && main2._v === 0.5 && mini25._m === true);
main2.muted = true;                                          // viewer clicks Twitch's mute button
check('sound: Twitch\'s mute button silences whichever is playing', main2._m === true && mini25._m === true);
main2.muted = false;
check('sound: and unmute brings the advert back, not the stream', main2._m === false && mini25._m === true);
attrs42['data-adswap-mini'] = 'hide'; step(2);
check('sound: the Hidden card has no sound, so the stream is heard', main2._m === true && mini25._m === false);
attrs42['data-adswap-base'] = 'chrome-extension://abcdefghijklmnop/'; attrs42['data-adswap-mini'] = 'video'; step();
const told = [];
S.cover.contentWindow = { postMessage(m, o) { told.push([m, o]); } };
step(5);
const lastTold = () => told[told.length - 1];
check('sound: with own videos chosen, the advert and the stream are both silent', main2._m === true && mini25._m === true);
check('sound: the video page is told to play aloud, at the slider level, and how long is left', told.length >= 1 &&
  lastTold()[0].source === 'adswap' && lastTold()[0].type === 'state' && lastTold()[0].muted === false &&
  lastTold()[0].volume === 0.5 && lastTold()[0].left >= 30 && lastTold()[0].left <= 31.5);   // 0:30 showing, plus the 1.5s the swap outlasts it
check('sound: that message goes to the extension\'s own page and nowhere else', lastTold()[1] === 'chrome-extension://abcdefghijklmnop');
const before42 = told.length;
attrs42['data-adswap-sound'] = 'stream'; step();
check('sound: back to the stream -> the video page is told at once to be silent', told.length === before42 + 1 &&
  lastTold()[0].muted === true && mini25._m === false);
attrs42['data-adswap-sound'] = 'small'; step();
body.textContent = ''; mini25.remove(); step();
check('sound: after the break the main player has its own sound back', main2._m === false && !own(main2, 'muted') && last().heard === 'video');
delete document.documentElement;

// 43. ASKED (2026-11-15): for ads that cannot be swapped, play one of the viewer's own videos
//     over the ad by default if they have any; if they have none, leave the ad; and offer a
//     setting to hide such ads behind a card with the time left.
body.textContent = ''; step(16);
const attrs43 = { 'data-adswap-base': 'chrome-extension://abcdefghijklmnop/' };
document.documentElement = { getAttribute(k) { return k in attrs43 ? attrs43[k] : null; } };
const AD43 = (left) => 'Streamer is taking an ad break; stick around to support the stream! Ad (' + left + ')';
main2.muted = false; main2.volume = 0.5;
chat.collapsed = false;                                     // chat open (an earlier check left it closed)
step(8);

// (a) no videos added: the ad is left alone, exactly as before
body.textContent = AD43('0:20'); step(24);                   // the countdown is only looked at once a second here
check('unswappable ad, no videos added: the ad is left alone', !S.fullCover && main2._m === false &&
  /can't swap this ad/.test(S.badge.textContent) && !/showing|hidden/.test(S.badge.textContent));
body.textContent = ''; step(8);

// (b) videos added: by default one of them covers the ad
attrs43['data-adswap-videos'] = '2';
body.textContent = AD43('0:20'); step(4);
check('videos added: not covered in the first second (the small player may still appear)', !S.fullCover);
step(8);
check('videos added: after that the ad is covered with their videos', !!S.fullCover && S.fullCover.id === '__adswap_fullvideo' &&
  S.fullCover.src === 'chrome-extension://abcdefghijklmnop/player.html' && S.fullCover.style.width === '1280px');
check('...the ad is silent, though Twitch still sees its player as unmuted', main2._m === true && main2.muted === false);
check('...and the banner says so', /can't swap this ad: showing your videos/.test(S.badge.textContent));
const told43 = [];
S.fullCover.contentWindow = { postMessage(m, o) { told43.push([m, o]); } };
step(5);
const last43 = () => told43[told43.length - 1];
check('...the video page is told to play aloud at the slider level, with the time left', told43.length >= 1 &&
  last43()[0].muted === false && last43()[0].volume === 0.5 && last43()[0].left > 19 && last43()[0].left <= 20.5 &&
  last43()[1] === 'chrome-extension://abcdefghijklmnop');
main2.muted = true; step();                                  // viewer clicks Twitch's mute button
check('...Twitch\'s mute button silences their video', last43()[0].muted === true);
main2.muted = false; step();
const posted43 = [];
window.postMessage = (m, o) => posted43.push(m);
global.location = { pathname: '/x', origin: 'https://www.twitch.tv' };
step(12);
body.textContent = ''; step(8);                              // the ad ends
check('the ad ends: the cover goes and the player has its sound back', !S.fullCover && main2._m === false && !own(main2, 'muted'));
check('...within a second, so the stream is not hidden', last().type === 'covered' && last().showed === 'video' && last().ended === 'ad countdown gone');
check('...and it is counted for the popup', posted43.filter(m => m.type === 'swapped').length === 1 &&
  posted43.find(m => m.type === 'swapped').seconds >= 3);
check('...and the end of the break is announced once', posted43.filter(m => m.type === 'breakOver').length === 1);
delete window.postMessage; delete global.location;

// (c) the setting: hide such ads behind a card with the countdown
attrs43['data-adswap-full'] = 'hide';
step(8);
body.textContent = AD43('1:05'); step(12);
check('"hidden": a card covers the ad', !!S.fullCover && S.fullCover.id === '__adswap_fullcard' && S.fullCover.style.width === '1280px');
check('...with the time left, and the ad silent', /^Ad break\s+.\s+1:05 left$/.test(S.fullCover.textContent) && main2._m === true);
body.textContent = AD43('1:04'); step(4);
check('...counting down', /1:04 left$/.test(S.fullCover.textContent));
check('...and the banner says hidden', /can't swap this ad: hidden/.test(S.badge.textContent));

// (d) changing the setting mid-ad takes effect
attrs43['data-adswap-full'] = 'ad'; step(2);
check('"the ad", chosen mid-ad: uncovered at once, with its sound', !S.fullCover && main2._m === false);
attrs43['data-adswap-full'] = 'video'; step(12);
check('"my videos", chosen mid-ad: covered again', !!S.fullCover && S.fullCover.id === '__adswap_fullvideo');

// (e) if the small player turns up after all, the cover gives way to a real swap
const mini26 = realVideo(320, 180, 640, 360, true, 0);
step(3);
check('small player appears: the cover goes and the players are swapped', !S.fullCover && mirrors().length === 2);
body.textContent = ''; mini26.remove(); step();

// (f) switching Ad Swap off uncovers
attrs43['data-adswap-full'] = 'hide'; step(8);
body.textContent = AD43('0:30'); step(12);
check('covered again for the next test', !!S.fullCover);
S.badge.onclick();
check('Ad Swap switched off: uncovered, sound back', !S.fullCover && main2._m === false);
S.badge.onclick();
body.textContent = ''; step(8);
delete document.documentElement;

// 44. Features taken from other extensions (2026-11-15).
// (a) From Harest's script and Live Commercial Blocker: a shortcut to cover or uncover at will.
body.textContent = ''; step(16);
const attrs44 = { 'data-adswap-base': 'chrome-extension://abcdefghijklmnop/' };
document.documentElement = { getAttribute(k) { return k in attrs44 ? attrs44[k] : null; } };
main2.muted = false; main2.volume = 0.5; chat.collapsed = false; step(8);
S.coverNow();                                                // no ad on: cover the player now
check('shortcut, no ad, no videos: a plain card covers the player, the sound is off', !!S.fullCover &&
  S.fullCover.id === '__adswap_fullcard' && main2._m === true && main2.muted === false);
step(4);
check('...it says "Covered" and the banner says how to undo it', S.fullCover.textContent === 'Covered' &&
  /press the shortcut again/.test(S.badge.textContent));
step(40);
check('...and stays, with no ad on, until the shortcut is pressed again', !!S.fullCover);
S.coverNow();
check('shortcut again: uncovered, sound back', !S.fullCover && main2._m === false && !own(main2, 'muted') && last().byYou === true);
attrs44['data-adswap-videos'] = '3'; step(8);
S.coverNow();
check('shortcut with videos added: their videos cover the player', !!S.fullCover && S.fullCover.id === '__adswap_fullvideo');
S.coverNow(); step(8);
// during a swap: show the real ad, and leave the rest of this break alone
body.textContent = 'Streamer is taking an ad break; stick around to support the stream! Ad (0:40)';
const mini27 = realVideo(320, 180, 640, 360, true, 0);
step(3);
check('a swap starts as usual', mirrors().length === 2);
S.coverNow();
check('shortcut during a swap: back to how Twitch has it', mirrors().length === 0 && last().ended === 'uncovered by you');
step(20);
check('...and it does not swap again during this break', mirrors().length === 0 && /leaving this ad break as it is/.test(S.badge.textContent));
body.textContent = ''; step(8);
body.textContent = 'Streamer is taking an ad break; stick around to support the stream! Ad (0:40)'; step(3);
check('the next break swaps again', mirrors().length === 2);
body.textContent = ''; mini27.remove(); step(8);
// a cover the viewer put on is not taken off by an ad break ending
S.coverNow(); body.textContent = 'Streamer is taking an ad break; stick around to support the stream! Ad (0:12)'; step(8);
body.textContent = ''; step(12);
check('a cover put on by the viewer stays when an ad break ends', !!S.fullCover);
S.coverNow(); step(8);

// (b) From Harest's auto-unlock: if Twitch's countdown gets stuck, let go instead of staying swapped.
const AD44 = (left) => 'Streamer is taking an ad break; stick around to support the stream! Ad (' + left + ')';
const mini28 = realVideo(320, 180, 640, 360, true, 0);
body.textContent = AD44('0:20'); step(3);
check('stuck countdown: a swap starts', mirrors().length === 2);
body.textContent = AD44('0:19'); step(4);
body.textContent = AD44('0:18'); step(4);
step(28);                                                    // 7 more seconds at 0:18: not yet stuck
check('stuck countdown: 8 seconds without moving is not yet stuck', mirrors().length === 2);
step(8);
check('stuck countdown: after that it lets go', mirrors().length === 0 && last().ended === 'ad countdown stuck');
step(16);
check('...and does not grab it again while the notice is still up', mirrors().length === 0);
body.textContent = ''; mini28.remove(); step(8);
// a countdown that never moves at all (some other notice) is not judged stuck
const mini29 = realVideo(320, 180, 640, 360, true, 0);
body.textContent = AD44('0:30'); step(80);
check('a countdown never seen moving is not judged stuck', mirrors().length === 2);
body.textContent = ''; mini29.remove(); step(8);
// a cover lets go of a stuck countdown too
attrs44['data-adswap-full'] = 'hide';
body.textContent = AD44('0:15'); step(12);
body.textContent = AD44('0:14'); step(4);
check('stuck countdown: a cover starts', !!S.fullCover);
step(40);
check('stuck countdown: the cover lets go', !S.fullCover && last().ended === 'ad countdown stuck');
body.textContent = ''; step(8);
delete document.documentElement;

// 45. ASKED (2026-11-15): play the streamer's own clips instead of the ad, and make them what
//     covers an unswappable ad when the viewer has added no videos of their own.
body.textContent = ''; step(16);
const attrs45 = { 'data-adswap-base': 'chrome-extension://abcdefghijklmnop/', 'data-adswap-videos': '0' };
document.documentElement = { getAttribute(k) { return k in attrs45 ? attrs45[k] : null; } };
global.location = { pathname: '/streamer_one', origin: 'https://www.twitch.tv' };
main2.muted = false; main2.volume = 0.5; chat.collapsed = false; step(8);
const CLIPS45 = [
  { title: 'big play', seconds: 17, url: 'https://d1ndex63qxojbr.cloudfront.net/a/720.mp4?sig=s&token=t' },
  { title: 'funny', seconds: 23, url: 'https://d1ndex63qxojbr.cloudfront.net/b/720.mp4?sig=s&token=t' }
];
const AD45 = (left) => 'Streamer is taking an ad break; stick around to support the stream! Ad (' + left + ')';
// (a) no videos of their own and no clips (not fetched, or none): the ad is left alone
body.textContent = AD45('0:20'); step(24);
check('clips: none to show, no videos added -> the ad is left alone', !S.fullCover && main2._m === false);
body.textContent = ''; step(8);
// (b) the channel's clips are ready: by default they cover the ad
Object.assign(S.clipStore, { channel: 'streamer_one', list: CLIPS45, at: now, busy: true });
body.textContent = AD45('0:20'); step(12);
check('clips: no videos added -> the streamer\'s clips cover the ad', !!S.fullCover && S.fullCover.id === '__adswap_fullvideo' &&
  S.fullCover.src === 'chrome-extension://abcdefghijklmnop/player.html?src=clips');
check('...the banner says so', /can't swap this ad: showing their clips/.test(S.badge.textContent));
const told45 = [];
S.fullCover.contentWindow = { postMessage(m, o) { told45.push(m); } };
step(5);
check('...the video page is handed the clips, with sound on', told45.length >= 1 && told45[told45.length - 1].clips.length === 2 &&
  told45[told45.length - 1].clips[0].url === CLIPS45[0].url && told45[told45.length - 1].muted === false);
body.textContent = ''; step(8);
// (c) their own videos still come first
attrs45['data-adswap-videos'] = '2';
body.textContent = AD45('0:20'); step(12);
check('clips: own videos added -> own videos cover the ad, not the clips', !!S.fullCover && !/src=clips/.test(S.fullCover.src));
body.textContent = ''; step(8);
attrs45['data-adswap-videos'] = '0';
// (d) clips of another channel are never used
global.location.pathname = '/someone_else'; step(4);
body.textContent = AD45('0:20'); step(12);
check('clips: another channel\'s clips are never shown', !S.fullCover);
body.textContent = ''; step(8);
global.location.pathname = '/streamer_one'; step(4);
// (e) clips go stale after half an hour (their play passes expire)
S.clipStore.at = now - 31 * 60 * 1000;
body.textContent = AD45('0:20'); step(12);
check('clips: older than 30 minutes -> not used until refreshed', !S.fullCover);
body.textContent = ''; step(8);
S.clipStore.at = now;
// (f) "Their clips" in the small player during a swap
attrs45['data-adswap-mini'] = 'clips';
body.textContent = AD45('0:40');
const mini30 = realVideo(320, 180, 640, 360, true, 0);
step(3);
check('clips: in the small player during a swap', mirrors().length === 1 && !!S.cover && S.cover.id === '__adswap_myvideo' &&
  S.cover.src === 'chrome-extension://abcdefghijklmnop/player.html?src=clips');
S.clipStore.list = []; step(2);
body.textContent = AD45('0:39'); step(2);
attrs45['data-adswap-mini'] = 'hide'; step(); attrs45['data-adswap-mini'] = 'clips'; step();
check('clips: none available -> the small player gets the plain card instead', !!S.cover && S.cover.id === '__adswap_card');
body.textContent = ''; mini30.remove(); step(8);
S.clipStore.list = CLIPS45;
delete attrs45['data-adswap-mini'];
// (g) the shortcut uses them too when there are no videos of their own
S.coverNow();
check('clips: the shortcut covers with their clips when no videos are added', !!S.fullCover && /src=clips/.test(S.fullCover.src));
S.coverNow(); step(8);
S.clipStore.busy = false; S.clipStore.list = null; S.clipStore.channel = '';
delete global.location;
delete document.documentElement;

// 46. ASKED (2026-11-17): the resolution on the banner ends in "p".
body.textContent = ''; step(16);
body.textContent = AD;
const mini31 = pageVideo(320, 180, 640, 360, true, 0.5);
step(3);
check('banner: the resolution reads 640x360p', /players swapped \(640x360p\)/.test(S.badge.textContent));
body.textContent = ''; mini31.remove(); step(8);

// 47. REPORTED (real log, 2026-11-17): an ad as a channel opened, with chat closed. Twitch left the
//     small player on the page but not drawn (0x0). The script opened chat, no small stream came,
//     it closed chat again, and then never covered the ad, because it counted two players.
body.textContent = ''; step(16);
const attrs47 = { 'data-adswap-base': 'chrome-extension://abcdefghijklmnop/', 'data-adswap-videos': '0' };
document.documentElement = { getAttribute(k) { return k in attrs47 ? attrs47[k] : null; } };
global.location = { pathname: '/itsspoit', origin: 'https://www.twitch.tv' };
Object.assign(S.clipStore, { channel: 'itsspoit', list: [{ title: 'ace', seconds: 20, url: 'https://d1ndex63qxojbr.cloudfront.net/x/720.mp4?sig=s&token=t' }], at: now, busy: true });
main2.muted = false; chat.collapsed = true; step(8);
const hidden47 = realVideo(320, 180, 0, 0, true, 0);
hidden47._rect = { left: 0, top: 0, width: 0, height: 0 };   // on the page, not drawn
body.textContent = 'Catch itsSpoit right after this ad break; stick around to support the stream! Ad (0:20)';
step(4);
check('hidden small player: chat is opened first, to look for the small stream', chat.collapsed === false && !S.fullCover);
step(24);                                                    // 6 seconds: no small stream came
check('hidden small player: chat is put back as it was', chat.collapsed === true);
step(8);
check('hidden small player: then the ad is covered with the clips', !!S.fullCover && /src=clips/.test(S.fullCover.src) &&
  /showing their clips/.test(S.badge.textContent));
check('...covering the player that is on screen, not the hidden one', S.fullCover.parentNode !== null && main2._m === true);
body.textContent = ''; step(8);
check('...and uncovered when the ad ends', !S.fullCover && main2._m === false);
hidden47.remove(); chat.collapsed = false; step(8);
S.clipStore.busy = false; S.clipStore.list = null; S.clipStore.channel = '';
delete global.location; delete document.documentElement;

// 48. ASKED (2026-11-18): not the same clips every break. Each break gets 12 not seen yet.
{
  const pool = Array.from({ length: 30 }, (_, i) => ({ slug: 'clip' + i, title: 't' + i, seconds: 20 }));
  const seen = {};
  for (let i = 0; i < 10; i++) seen['clip' + i] = 1000 + i;
  const pick1 = S.pickClips(pool, seen, 12);
  check('clip variety: 12 picked, none of them already seen', pick1.length === 12 && pick1.every(c => !seen[c.slug]));
  check('clip variety: no clip twice in one pick', new Set(pick1.map(c => c.slug)).size === 12);
  let differentOrders = 0;
  for (let k = 0; k < 20; k++) if (S.pickClips(pool, {}, 12).map(c => c.slug).join() !== S.pickClips(pool, {}, 12).map(c => c.slug).join()) differentOrders++;
  check('clip variety: a different set or order almost every time', differentOrders >= 18);
  // only 3 unseen left: they go last (what plays when timed to the break), the longest-ago seen fill the front
  const seen2 = {};
  pool.forEach((c, i) => { if (i >= 3) seen2[c.slug] = 2000 + i; });
  const pick2 = S.pickClips(pool, seen2, 12);
  check('clip variety: the few unseen ones are put last', pick2.length === 12 && pick2.slice(-3).every(c => !seen2[c.slug]) &&
    pick2.slice(0, 9).every(c => seen2[c.slug]));
  check('clip variety: the fill-ins are the ones seen longest ago', pick2[0].slug === 'clip3');
  // everything seen: the history for this channel starts over
  const seen3 = {};
  pool.forEach(c => { seen3[c.slug] = 5; });
  const pick3 = S.pickClips(pool, seen3, 12);
  check('clip variety: all seen -> starts over with a fresh random 12', pick3.length === 12 && Object.keys(seen3).length === 0);
  // a small channel: fewer clips than 12
  const small = pool.slice(0, 5);
  check('clip variety: a channel with only 5 clips gets all 5', S.pickClips(small, {}, 12).length === 5);
}

// 49. REPORTED (real log, 2026-11-18): during an ad the small player was on screen but its stream
//     would not play (no picture at all, not paused). Nothing could be swapped in, and the ad was
//     left showing. After a few seconds of that, the ad is covered like one that cannot be swapped.
body.textContent = ''; step(16);
const attrs49 = { 'data-adswap-base': 'chrome-extension://abcdefghijklmnop/', 'data-adswap-videos': '0', 'data-adswap-full': 'hide' };
document.documentElement = { getAttribute(k) { return k in attrs49 ? attrs49[k] : null; } };
main2.muted = false; chat.collapsed = false; step(8);
const stuck49 = realVideo(320, 180, 0, 0, true, 0);
stuck49._frozen = true;                                       // on screen, but its clock never moves
body.textContent = AD;
step(8);
check('stuck small player: not swapped, and not covered in the first seconds', mirrors().length === 0 && !S.fullCover);
step(12);
check('stuck small player: after about 4 seconds the ad is covered', !!S.fullCover && S.fullCover.id === '__adswap_fullcard' && main2._m === true);
step(8);
check('...and it stays covered while the small player stays stuck', !!S.fullCover);
stuck49._frozen = false; step(3);                             // the small stream comes to life
check('stuck small player starts playing: the cover goes and the players are swapped', !S.fullCover && mirrors().length === 2);
body.textContent = ''; stuck49.remove(); step(8);
check('...and all back to normal after the break', mirrors().length === 0 && !S.fullCover && main2._m === false);
delete document.documentElement;

// 30. Nothing failed silently anywhere above, and the badge names the version.
check('no error was swallowed during the whole run', S.err === null);
check('badge reads "AdSwap: ..." with no version; the version is in the hover text',
  /^AdSwap: /.test(S.badge.textContent) && !/\d+\.\d+/.test(S.badge.textContent) && /^AdSwap \d+\.\d+: /.test(S.badge.title));

Date.now = realNow;
console.log = quiet;
console.log(failures === 0 ? '\nALL PASSED' : '\n' + failures + ' FAILED');
process.exit(failures ? 1 : 0);
