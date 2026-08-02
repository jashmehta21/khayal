# Khayal ✦ — catch every khayal

Your thoughts, kept safe. Private, offline, yours — nothing ever leaves your device.

## Use it on this PC (one click)

Double-click **`Start Khayal.bat`** in this folder. Your browser opens the app.

Optional, recommended: in Edge or Chrome, click the **install icon** in the address bar
(or menu → *Install Khayal*). Khayal becomes a real desktop app with its own window
and icon — after that, launch it from the Start menu like any app.

## Get it on your iPhone (needs hosting)

The app must live at a normal `https://` link for the iPhone to install it.
When you're ready, ask Claude to host it — then on your iPhone you just:
open the link in Safari → tap **Share** → **Add to Home Screen**. Done.

## How it works

- **Capture** — tap the mic and speak. English ya Hindi — Hindi speech is
  automatically written in English letters ("zindagi", not "ज़िंदगी").
  You can edit before saving. Typing works too.
- **Khayals** — everything you've caught, searchable, newest first.
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

Plain HTML/CSS/JS, no build step. After changing any file, bump `VERSION`
in `sw.js` so installed copies pick up the update on their next launch.
