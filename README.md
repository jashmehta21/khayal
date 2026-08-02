# Khayal ✦ — catch every khayal

Your thoughts, kept safe. Private, offline, yours — nothing ever leaves your device.

## Use it on this PC (one click)

Double-click **`Start Khayal.bat`** in this folder. Your browser opens the app.

Optional, recommended: in Edge or Chrome, click the **install icon** in the address bar
(or menu → *Install Khayal*). Khayal becomes a real desktop app with its own window
and icon — after that, launch it from the Start menu like any app.

## Get it on your iPhone

The app is live at **https://jashmehta21.github.io/khayal/**

On your iPhone: open that link in Safari → tap **Share** → **Add to Home Screen**.
Khayal becomes a real app icon that works fully offline.

## How it works

- **Capture** — tap the mic and speak. English ya Hindi — Hindi speech is
  automatically written in English letters ("zindagi", not "ज़िंदगी").
  You can edit before saving. Typing works too.
- **Auto-polish** — raw dictation is cleaned up as you speak: sentences get
  capital letters and full stops (your natural pauses become the sentence
  breaks, a long pause starts a new paragraph), and fillers like "um", "uh",
  "you know", "matlab", "yaani" are dropped. Say "full stop", "comma",
  "question mark", or "new line" and you get the punctuation.
  Tap **✨ Polish** to clean text up manually — tap the toast to undo.
  Turn the whole thing off in Settings → Dictation.
- **Khayals — List** — everything you've caught, grouped by day (Today,
  Yesterday, weekday, then date). Each card shows its opening line as a
  headline with a dimmed preview underneath.
- **Search** — type any words and it finds khayals containing *all* of them,
  in any order. Matches are highlighted in gold, with a live result count.
- **Khayals — Calendar** — your thinking at a glance: streak and total tiles,
  a GitHub-style heatmap of the last six months (brighter = more khayals that
  day), and a month grid you can page through. Tap any day in either one to
  read everything you thought that day.
- **Tiers** — promote what matters: ★ High → ✦ Core (your core memories).
- **Review** — old khayals come back as cards: Keep / Promote / Later / Purge.
  Anything untouched for 30+ days is flagged as *fading* so you know what to let go.
- **Trash** — purged khayals wait 30 days before disappearing forever.
- **Backup** — Settings → Export backup gives you a file with everything.
  Import it on another device to move your khayals there.

## Where is my data?

Only inside the browser's private storage on each device (IndexedDB).
No cloud, no account, no tracking. Export a backup now and then to be safe.

## For future updates (note to developers)

Plain HTML/CSS/JS, no build step. When shipping a change, bump **both**:

1. the `?v=` tags on `app.css` / `app.js` in `index.html`, and
2. `VERSION` plus the matching `?v=` entries in `sw.js`'s `ASSETS`.

They must agree — the service worker caches by full URL, so the `?v=` tag is
what tells a browser a file is genuinely new. Navigations are network-first,
so a new version appears on the next launch (and still works offline).
