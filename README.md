# AdSwap for Twitch

A Chrome extension that keeps you watching the stream during Twitch ad breaks.

**Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/njppnbahckpbmipbfajnfmcjhfdpbpmn)

## What it does

When a streamer runs an ad break, Twitch often keeps the live stream playing, muted, in a small player above
chat while the ad takes over the main player. AdSwap switches the two: the live stream goes back in the main
player with its sound, the ad plays muted in the small spot, and everything goes back to normal when the
break ends.

Some ads come with no stream to swap in (an ad as a channel opens, or a break with no small player). AdSwap
covers and mutes those instead, with your own videos, the streamer's own clips, or a countdown card.

It does not block or skip ads. The ad still plays, so the streamer still gets paid for it. One optional
setting, off by default, reloads the page when a break comes with no small player; Twitch then plays a new
set of ads, this time with the small player, so they can be swapped.

Everything else (stream size, what the small player shows, sound, your own videos, a notification when a
break ends) is set from the extension's toolbar popup. Press `-` on Twitch to cover or uncover the player at
any time.

## Files

| File | What it is |
|---|---|
| `manifest.json` | The extension's description for Chrome |
| `adswap.user.js` | The main script, run inside Twitch's page: finds ad breaks, swaps or covers, puts things back |
| `bridge.js` | Passes settings between the extension and the Twitch page |
| `background.js` | The keyboard shortcut, the "break is over" notification, and updating open tabs |
| `popup.html`, `popup.js` | The toolbar popup |
| `options.html`, `options.js`, `library.js` | The "My videos" page and the store for your own videos |
| `player.html`, `player.js`, `schedule.js` | Plays your videos or the streamer's clips over an ad, timed to end with the break |
| `icons/` | The extension's icons |
| `store/` | The Chrome Web Store listing text, artwork, and the scripts that make the icons, screenshots and upload file |
| `test/` | Offline tests |

## Working on it

Load it in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick this folder.
After a change, click the reload arrow on its card. Open Twitch tabs pick up the new copy by themselves.

Run the tests (Node.js):

```bash
node test/harness.js adswap.user.js
node test/schedule.test.js
```

Build the file to upload to the store (Python; bump the version in `manifest.json` and in `adswap.user.js`
first):

```bash
python store/build_zip.py
```

## Privacy

AdSwap runs only on www.twitch.tv. It collects nothing and has no account or sign-in. Its only network
requests go to Twitch, for the public clips of the channel you are watching. Your settings, your videos and a
short troubleshooting log stay in your own browser.

AdSwap is an independent project. It is not affiliated with, endorsed by, or sponsored by Twitch.

## License

Copyright © 2026 Chandler090. All rights reserved.

You're welcome to read the code and to suggest changes or report problems in
[Issues](https://github.com/Chandler090/ad-swap-for-twitch/issues). No license is granted to copy or
republish it.
