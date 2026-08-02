# Khayal — thoughts & to-dos

Catch every khayal. Private, offline, yours — nothing ever leaves your device.

**Live:** https://jashmehta21.github.io/khayal/

## Install

**iPhone:** open the link in Safari → **Share** → **Add to Home Screen**.
**Desktop:** open the link in Edge/Chrome → **install icon** in the address bar.
(Or run `Start Khayal.bat` in this folder to serve it locally.)

Installing matters on iPhone: notifications only work once Khayal is on the
Home Screen.

## What it does

- **Capture** — one screen, two modes: **Khayal** (a thought) or **To-do**.
  Tap the mic and speak, English ya Hindi — Hindi is written in English letters
  ("zindagi", not "ज़िंदगी").
- **Auto-polish** — dictation is cleaned as you speak: capitals and full stops
  (your pauses become the sentence breaks, a long pause a new paragraph), and
  fillers like "um", "matlab", "yaani" are dropped. Say "full stop", "comma" or
  "new line" for real punctuation. Tap **✨ Polish** to clean up manually — the
  toast undoes it. Switch it off in Settings → Dictation.
- **To-dos** — quick-add, or dictate from Capture. Grouped into Overdue, Today,
  Tomorrow, Upcoming, Someday and Done, with a live progress ring for the day.
  Tap the circle to complete, tap the row to edit, delete with undo.
- **Reminders** — Khayal notifies you when a to-do is due while it's open or in
  the background. For an alarm that fires even when Khayal is fully closed, use
  **Add to phone calendar** on a to-do: it drops a real event with an alert into
  your phone's own calendar.
- **Khayals — List** — grouped by day, headline plus dimmed preview.
- **Search** — matches every word you type, in any order, and highlights hits.
- **Khayals — Calendar** — streak and total tiles, a six-month activity heatmap,
  and a month grid. Tap any day to read what you thought that day.
- **Review** — old khayals resurface as cards: Keep / Make High / Make Core /
  Later / Purge. Untouched for 30+ days and they're flagged *fading*.
- **Trash** — purged khayals wait 30 days before going for good.
- **Backup** — Settings → Export writes a file with khayals, to-dos and trash.
  Import merges it on another device (newer edits win, no duplicates).

## Where is my data?

Only in this browser's private storage on each device (IndexedDB). No cloud,
no account, no tracking. Export a backup now and then.

## Notes for developers

Plain HTML/CSS/JS, no build step. When shipping a change, bump **both**:

1. the `?v=` tags on `app.css` / `app.js` in `index.html`, and
2. `VERSION` plus the matching `?v=` entries in `sw.js`'s `ASSETS`.

They must agree — the service worker caches by full URL, so the `?v=` tag is what
tells a browser a file is genuinely new. Navigations are network-first, so a new
version appears on the next launch and still works offline.

**Never** rewrite these files with PowerShell `Get-Content`/`Set-Content` — 5.1
reads as ANSI and double-encodes the glyphs into mojibake.
