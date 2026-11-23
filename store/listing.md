# Ad Swap for Twitch: Chrome Web Store listing

Everything below is ready to paste into the Chrome Web Store Developer Dashboard.
Upload file: `store/ad-swap-for-twitch-0.44.zip`

---

## Store listing tab

**Name** (comes from the manifest)

    Ad Swap for Twitch

**Summary** (comes from the manifest, 132 characters max)

    During Twitch ad breaks that keep the stream in a mini player, shows the live stream in the main player. Switches back by itself.

**Detailed description**

    Ad Swap for Twitch keeps you watching the stream during ad breaks.

    It does not take ad revenue from the streamer. Ad Swap never blocks or skips an ad: every ad still plays all the way through in Twitch's own player, just as it would without Ad Swap. You simply don't have to watch it. (The one exception is an optional setting, off unless you turn it on, that reloads the page when an ad break comes with no small player. That cuts the ad short, and the setting says so.)

    When a streamer runs an ad break, Twitch often keeps the live stream playing, muted, in a small player above chat while the ad takes over the main player. Ad Swap switches the two: the live stream goes back in the main player with its sound, and the ad plays silently in the small spot. When the break ends, everything goes back to normal by itself.

    WHAT IT DOES
    • Puts the live stream in the main player, with sound, for the length of the ad break
    • Moves the ad to the small player and mutes it
    • Switches back automatically when the break ends
    • Works in fullscreen and theatre mode
    • Works with chat closed: it opens chat for the break (Twitch only runs the small stream while chat is open) and closes it again afterwards
    • Twitch's own volume slider and mute button control the stream during the swap
    • The advert's subtitles, when it has them, stay with the advert in the small player. Ad Swap turns Twitch's captions on for the break if you had them off, and puts them back the way you had them afterwards
    • Your choice of stream size during an ad: fill the player, or keep it at its real size for the sharpest picture
    • Your choice of what the small player shows: the advert, nothing at all (a plain card with the time left), your own videos, or the streamer's own most-watched clips
    • Your choice of sound: the live stream (the default), or the small player instead
    • A keyboard shortcut, the - (minus) key, to cover the player at any moment, for anything you would rather not see, and to uncover it again. It does nothing while you are typing in chat
    • An optional notification when an ad break ends, if you have gone to another tab
    • Optional, off by default: for a break that comes with no small player, reload the page once, which sometimes brings the small player so the ad can be swapped. It cuts that ad short, so the streamer may not be paid for it. At most once every 10 minutes per tab, never for the ad that plays as a channel opens
    • A safety net: if Twitch leaves its ad notice stuck on screen, Ad Swap lets go so you are never left looking at a cover
    • A running count of the ad breaks it has swapped and the time you didn't spend watching ads
    All of these are set by clicking the Ad Swap icon in Chrome's toolbar.

    YOUR OWN VIDEOS
    Choose "My videos" and add video files from your computer. During an ad break they play in the small player in place of the advert.
    • They play one after another and go round again if the ad break outlasts them, so even one short clip is enough
    • Shuffle gives a new random order every break
    • "Finish with the ad break" times them so the last video ends as the break does
    • They are silent by default, so you hear the stream. Set the sound to the small player if you would rather hear them
    • They also cover ads that cannot be swapped, with their sound, since there is no stream to hear then
    They are kept in your browser on your own computer and are never uploaded anywhere.

    SOME ADS CAN'T BE SWAPPED. THAT IS NORMAL, NOT A FAULT.
    Ad Swap can only show you the stream when Twitch has put the stream on the page. Two kinds of ad come without it:
    • Ads when you open a channel. When you open, refresh or switch to a channel, Twitch often plays an ad before the stream starts. There is no stream on the page yet, so there is nothing to swap in.
    • Full-screen ad breaks. Some breaks replace the stream completely and no small player appears above chat.
    When one of these plays, the banner says "can't swap this ad" and gives the reason, and the cover itself says "This ad can't be swapped". Ad Swap is working; it is waiting for an ad break that comes with the small player. Those are usually the ad breaks a streamer runs in the middle of a stream.
    You still do not have to watch them. Ad Swap can cover these ads and mute them until they end:
    • with your own videos, if you have added any (this is the default)
    • otherwise with the streamer's own most-watched clips from the channel you are watching, clearly labelled as a clip with the time until the live stream is back. Each break brings clips you have not seen yet, until you have seen them all
    • with a plain card showing the time left, and a button to switch to the streamer's clips instead
    • or not at all, leaving the ad as it is (what happens if there are no videos and no clips)
    The stream itself is not available during these ads, so it cannot be shown; the cover comes off the moment the ad ends.
    Tip: if you are testing it, stay on one channel. Every refresh or channel change can bring another opening ad.

    WHAT ELSE TO KNOW
    • It does not block or skip ads. The ad still plays; you just are not forced to watch it. The only exception is the optional reload described above, which you have to turn on yourself.
    • During a swap the stream is shown at the quality Twitch sends to the small player, which is 640x360p. It returns to full quality when the break ends.

    HOW TO USE IT
    Install it and open any Twitch channel. A small status banner in Twitch's top bar reads "AdSwap: watching". That is all. During an ad break it reads "players swapped", or tells you the ad can't be swapped. Click the banner to switch Ad Swap off or on. (In theatre mode, where Twitch hides its top bar, the banner sits in the top-left corner instead.)

    SUPPORT THE DEVELOPER
    Ad Swap is free and always will be. If it saves you from a few ad breaks and you feel like saying thanks, click the Ad Swap icon in Chrome's toolbar: there is an optional "Buy me a coffee" box with Cash App and Venmo links.

    PRIVACY
    Ad Swap runs only on www.twitch.tv. It collects nothing and has no account or sign-in. The only requests it makes are to Twitch itself, for the clips of the channel you are watching. It keeps your settings, a count of swapped ad breaks, any videos you add, which of the streamer's clips you have already been shown (so they are not repeated), when it last reloaded a tab (if you turned that on), and a short troubleshooting log in your own browser. None of it leaves your computer unless you copy the log yourself (right-click the banner).

    OPEN SOURCE
    The full source code is public on GitHub, so you can check exactly what Ad Swap does: https://github.com/Chandler090/ad-swap-for-twitch
    Found a problem or have an idea? Open an issue there: https://github.com/Chandler090/ad-swap-for-twitch/issues

    Ad Swap is an independent project. It is not affiliated with, endorsed by, or sponsored by Twitch.

**Additional fields** (lower down the Store listing tab; add these with the next update)

    Official URL:  leave empty (it needs a website you have proven you own)
    Homepage URL:  https://github.com/Chandler090/ad-swap-for-twitch
    Support URL:   https://github.com/Chandler090/ad-swap-for-twitch/issues
                   (swap this for the feedback form once it exists)

**Category**

    Entertainment  (if that is not offered, pick the closest: "Functionality & UI")

**Language**

    English

**Graphic assets**

| What | File | Status |
|---|---|---|
| Store icon, 128x128 | `icons/icon128.png` | Ready |
| Small promo tile, 440x280 (optional) | `store/promo-small-440x280.png` | Ready |
| Screenshot 1, 1280x800 (at least one is required) | `store/screenshot-1-1280x800.png` | Ready |
| Screenshot 2, 1280x800 | `store/screenshot-2-1280x800.png` | Ready |
| Marquee tile, 1400x560 (optional) | none | Skipped |

Both screenshots are real swaps (hivise, PewDiePie) taken on 2026-11-17 with v0.38: the stream in
the main player, the advert muted in the small player above chat, the banner in Twitch's top bar.
Each has a caption above it and three labels. The left sidebar (the viewer's own followed channels)
is cut off, and the chat, the chat usernames and the viewer's avatar are blurred, because the people
in chat did not agree to appear in a store listing. Upload screenshot 1 first. To rebuild them from
new pictures: `python store/make_screenshots.py <first> <second>`. The old v0.22 picture is kept as
`store/screenshot-old-v022.png` and is not for upload.

---

## Privacy practices tab

**Single purpose**

    Change what the viewer sees and hears during Twitch ad breaks: show the live stream in the main player when Twitch keeps it playing in a small player, and otherwise cover and mute the ad with the viewer's own videos, the streamer's clips or a countdown, putting everything back when the break ends.

**Permission justification** (the dashboard asks about the site access in the manifest)

    Host access to https://www.twitch.tv/* : the extension is a single content script that runs only on Twitch pages. It needs to run there to detect an ad break (it looks for Twitch's ad countdown and a second video player on the page), display the live stream over the main player, and restore the page when the break ends.

    storage: saves the viewer's settings (stream size, what the small player shows, what covers ads that cannot be swapped, which sound is heard, shuffle, and whether their videos are timed to the ad break), how many videos they have added, and a running count of swapped or covered ad breaks. Nothing is sent to the developer or anyone else.

    unlimitedStorage: the viewer can add their own video files to be shown in the small player during ad breaks. Video files are large, so they are kept in the extension's local storage on the viewer's computer, and this permission stops the browser from clearing them. They are never uploaded.

    Web-accessible page (player.html): a small page of the extension's own that plays the viewer's videos. It is shown inside the Twitch page, over the small player, only during an ad break and only when the viewer has chosen it.

    notifications (optional, asked for only when the viewer turns on "Notify me"): shows one notification when an ad break ends on a Twitch tab the viewer is not looking at. Clicking it brings that tab back.

    scripting (with host access to https://www.twitch.tv/* only): when AdSwap is installed or updated, Twitch tabs that are already open would otherwise keep running the old copy until refreshed. The background script puts the current copy of AdSwap's own two files into those Twitch tabs once, at install or update. It runs nothing else and touches no other site.

    Keyboard shortcut and background script: the - key on a Twitch page lets the viewer cover or uncover the Twitch player at will (the content script handles it). The viewer can also give the same action a Chrome shortcut at chrome://extensions/shortcuts; the background script only passes that key press to the Twitch tab in front, and shows the optional notification.

**Remote code**

    No, I am not using remote code.

**Data usage**

    Tick NONE of the data-type boxes. The extension does not collect or transmit any user data.

    Tick all three certifications:
    • I do not sell or transfer user data to third parties, outside of the approved use cases
    • I do not use or transfer user data for purposes that are unrelated to my item's single purpose
    • I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

    Leave empty. If the dashboard insists on one, the text is:

    "Ad Swap for Twitch does not collect, store on any server, sell or share any personal data. Its only network requests go to Twitch, to fetch the public clips of the channel being watched; nothing about the viewer is included. It keeps a short troubleshooting log in the browser's local storage on your own computer; that log is never transmitted."

---

## Test instructions tab

    No account or login is needed. Open any live Twitch channel.
    Ad breaks cannot be started on demand, so to see the cover at any time press the - (minus) key on the Twitch page, with the cursor not in chat: the player is covered and muted (with the streamer's clips, or a plain card), and pressing it again uncovers it.
    During a real ad break that keeps the live stream in the small player above chat, the stream moves to the main player with sound and the ad to the small player, muted. Ads that open a channel are usually the quickest to see: refresh a channel page.
    The extension's settings are in its toolbar popup.

---

## Distribution tab

    Visibility: Public   (or "Unlisted" first, if you want to try the install link yourself before anyone can find it by searching)
    Regions: All regions
    Pricing: Free

---

## Things to know before you submit

- Google reviews every submission. It usually takes a few days and it can be rejected; nobody can promise approval.
- The name says "for Twitch" rather than "Twitch Ad Swap" on purpose: the store does not allow a name that reads as if Twitch made it.
- Publishing puts the extension under your developer account's public name and contact email.
- Whether Twitch's own terms allow a tool like this has not been checked.

## Rebuilding the upload file after a change

    cd /c/Users/chand/twitch-ad-swap && python store/build_zip.py
