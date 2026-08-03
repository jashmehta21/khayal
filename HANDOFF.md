# Khayal — complete handoff

**Read this first, in full, before writing any code.** It is the whole project:
what it is, what exists, why every decision was made, what is broken, and how to
build the native iOS app next.

Written 4 August 2026, at web build **v24**.

---

## 1. What Khayal is

A private thought-keeper for someone who thinks fast and forgets faster. You
speak a thought; it is transcribed, cleaned into readable writing, titled, and
kept. Over time you promote the ones that matter, review the rest, and let the
forgettable ones fade. It also holds to-dos, shows your thinking as a
constellation, and lets you ask questions of your own past thoughts.

**The owner:** Jash Mehta (GitHub `jashmehta21`, greyver.store@gmail.com).
Non-coder. Speaks Hindi/Hinglish and English. Owns an iPhone 17 Pro, an
iPhone 14, a Windows PC and a MacBook. He wants a real iOS app next.

**Non-negotiables, stated repeatedly:**
- **Data stays on the device.** No accounts, no cloud sync, no server.
- **Speed of capture.** A thought must be catchable before it is lost.
- **It must feel good.** Animation, polish and gesture quality matter to him a
  lot. He notices and objects when they are off.

**The word:** *khayal* (खयाल) = a thought. Plural used as "khayals".

---

## 2. Current state

| | |
|---|---|
| Live | https://jashmehta21.github.io/khayal/ |
| Repo | https://github.com/jashmehta21/khayal (public) |
| Local | `C:\Users\admin\Documents\Claude\Projects\Khayal` |
| Hosting | GitHub Pages, `main` branch root, auto-deploys ~30s after push |
| Build | app `v24`, service worker `khayal-v29` |
| Install | PWA — Safari → Share → Add to Home Screen |

**Files** (plain HTML/CSS/JS, no build step, no dependencies):

```
index.html   all markup, every screen and sheet
app.css      design system + every component
app.js       app logic: capture, todos, khayals, review, settings
mind.js      embeddings, similarity graph, constellation canvas, Ask
sw.js        service worker: offline cache + notification click
manifest.webmanifest
fonts/jakarta.woff2      Plus Jakarta Sans, latin subset, self-hosted
icons/                   192, 512, apple-touch (gold spark on ink)
Start Khayal.bat         local python server on :8321 (Windows)
```

### Cache versioning — THE most important operational rule

Every asset is referenced with a `?v=` tag. **When you change any file you must
bump, together:**

1. the `?v=` on `app.css` / `mind.js` / `app.js` in `index.html`
2. the matching `?v=` entries in `sw.js` → `ASSETS`
3. `VERSION` in `sw.js`
4. `BUILD` in `app.js` (shown in Settings → Version)

The service worker matches by **full URL**, so the `?v=` is what makes a file
new. I broke this rule once, spent an hour "fixing" a bug that was already
fixed, and concluded a correct change hadn't worked. Do not repeat it.

To test locally: unregister the SW, clear caches, reload. Bumping alone is not
enough during development because the browser also caches.

---

## 3. Data model — preserve this exactly

**IndexedDB** database `khayal-db`, version **2**. Three stores, all keyed on `id`.

```js
// store: "thoughts"
{
  id: string,              // crypto.randomUUID()
  text: string,            // the khayal itself
  title: string,           // short generated headline
  titleEdited: boolean,    // true = user wrote it; never auto-overwrite
  tier: 0 | 1 | 2,         // 0 Regular, 1 Bright, 2 Core
  createdAt: number,       // ms epoch
  updatedAt: number,
  lastReviewedAt: number | null,
  reviewCount: number,
  snoozedUntil: number | null,
  lang: string,            // BCP-47 at capture time
  vec: Float32Array,       // meaning vector, optional
  vecModel: string         // which embedding model produced it
}

// store: "trash"  — a thought plus:
{ purgedAt: number }       // hard-deleted after 30 days

// store: "todos"
{
  id, text,
  done: boolean,
  dueAt: number | null,
  notified: boolean,       // stops repeat reminders
  createdAt, updatedAt,
  completedAt: number | null
}
```

**localStorage**

| key | meaning |
|---|---|
| `khayal-settings` | JSON blob, see below |
| `khayal-draft` | unsaved capture text, survives reload |
| `khayal-key` | API key — **never exported, never committed** |
| `khayal-provider` | `openai` \| `gemini` \| `custom` |
| `khayal-base` | base URL when provider is custom |
| `khayal-model` | chat model id |
| `khayal-embed-model` | embedding model id |
| `khayal-stt-model` | transcription model id |
| `khayal-apiver` | `v1beta` or `v1`, Gemini only |
| `khayal-sw` | last seen cache name, for the Version panel |

```js
settings = {
  onboarded: bool,
  lang: "en-IN" | "hi-IN" | ... | "auto",
  roman: bool,          // write non-Latin scripts in English letters
  mode: "khayal" | "todo",      // capture mode
  view: "list" | "map" | "insights",
  autoPolish: bool,     // clean dictation as you speak
  wakeLock: bool,       // keep screen awake while recording
  motion: bool,         // animations on
  smart: bool,          // AI cleanup enabled
  remind: bool,         // to-do notifications
  cloudStt: bool,       // cloud transcription instead of device engine
  review: { grace, fade, batch, pace, core }
}
```

**Export format** (Settings → Backup → Export), version 3 — this is the
migration path into the native app:

```js
{
  app: "khayal", version: 3, build: "v24", exportedAt: ISO,
  counts: {...},
  settings: {...},
  preferences: { provider, model, embedModel, sttModel, apiBase },
  thoughts: [...],   // vec serialised as a plain number array
  trash: [...],
  todos: [...]
}
```
The API key is **deliberately excluded** so a backup can never leak a
credential. Import restores everything else and re-hydrates `vec` to
`Float32Array`. **Tell Jash to take an export before any migration.**

---

## 4. Design system

Warm, minimal, light. Derived from a fitness-app reference he liked.

```css
--bg: #efede9        /* warm off-white canvas */
--card: #ffffff
--card-2: #f7f6f3
--ink: #14120f       /* near-black text */
--ink-soft: #3d3a34
--muted: #8c8880
--faint: #b5b1a8
--line: #e8e5df
--accent: #f05337    /* coral — the app accent */
--core: #c8961c      /* gold — Core memories */
--core-soft: #f9f0d9
--high: #1aa5c4      /* cyan — Bright memories */
--high-soft: #e3f5fa
--green: #2f9e6b     /* completion */
--dark: #16140f      /* buttons, active tab */

radius: cards 24px, inner 16px, pills 999px
font: "Plus Jakarta Sans" (self-hosted woff2)
ease: cubic-bezier(.32,.72,0,1)   spring: cubic-bezier(.34,1.56,.64,1)
```

**Type rules:** big tight headings (2.05rem/800/-0.035em); tiny uppercase
micro-labels (0.63rem/800/0.13em tracking) above every section; body 500–700.

**Tiers.** Core = gold, gradient card with gilt shadow. Bright = cyan.
Regular = plain white. He rejected: violet-on-dark (too dark), ochre (looked
brown), silver/chrome (looked dull). Gold + cyan is where it landed.
"High" was renamed **Bright** because "high" meant nothing to him.

**Layout.** Five-tab floating bar, blurred, flush to the bottom edge with the
safe-area inset absorbed as its own padding. Content max-width 520px.

---

## 5. Feature inventory

### Capture (tab 1)
- Segmented **Khayal / To-do**; also swipeable left/right.
- Big mic. Device speech engine streams a live preview.
- **Auto-polish**: pauses become sentence boundaries, a 2.5s silence becomes a
  paragraph break, fillers removed, capitals and full stops added.
- **✨ Polish** button, undo via the toast.
- Screen-fills layout: card takes the slack and scrolls internally so the mic
  and Save can never be pushed under the tab bar.
- To-do mode adds Someday/Today/Tomorrow/Weekend chips + date/time.

### To-dos (tab 2)
- Grouped Overdue / Today / Tomorrow / Upcoming / Someday / Done.
- Daily progress ring + bar.
- Swipe right completes, swipe left deletes with undo. Tap opens a sheet.
- "Clear N" lives inside the Done section.
- Reminders while the app is open/backgrounded, plus **.ics export** per to-do
  so the phone's own calendar fires a real alarm when the app is closed.

### Khayals (tab 3) — three views, swipeable
- **Memories**: search, compact week strip (expandable to a month grid), tier
  filters, day-grouped cards with title + preview.
- **Map**: 3D constellation on canvas, perspective projection, slow auto-spin,
  one-finger rotate, two-finger pinch/pan, two-finger sweep to change view,
  zoom/reset/fullscreen controls, deep-sky starfield.
- **Insights**: stat tiles (total, streak, best streak, this month), 27-week
  heatmap, tier breakdown bars, rhythm panel (first khayal, per week, busiest
  day, most active weekday, peak time, days captured).
- **✦ Ask**: retrieval over your own khayals, answers cite only the ones used.

### Review (tab 4)
- Spaced resurfacing: Keep / Make Bright / Make Core / Later / Purge.
- Fading flag after N untouched days.
- Adjustable: first-review delay, fade threshold, cards per session, pace,
  whether Core resurfaces.

### Settings (tab 5)
Language (28 Indian languages + auto, plus a Roman-script switch) · Smart
cleanup (provider, key, model discovery, Test) · Transcription (cloud on/off) ·
Dictation (auto-polish, wake lock, animations) · Reminders · Backup ·
Trash · Install · Version (build, cache, install state, counts, update check).

---

## 6. Algorithms worth keeping

**Transliteration** (`app.js`): Devanagari → Roman with schwa deletion, so
करना → "karna" not "karana", ज़िंदगी → "zindagi". Unit-tested against 16 words.
Only runs when `settings.roman` is true.

**polish()**: rule-based cleanup — filler removal, stutter collapse on a
function-word whitelist, spoken punctuation ("full stop", "comma", "new line"),
sentence capitalisation, "i" → "I". Idempotent. Preserves meaningful repetition
("very very"), and words containing filler substrings (humming, summer).

**Titles**: `generateTitle()` strips hedging openers ("So I was thinking that
maybe…") and keeps the first real clause; `aiTitle()` asks the model for a
3–7 word title naming what the note is *about*. A complete short sentence is
kept whole — trailing-word trimming only applies when text was actually cut.

**Similarity & graph** (`mind.js`): embeddings when a key exists, tf-idf
word overlap otherwise. **Two separate thresholds** — `EMBED_MIN 0.6` and
`LEX_MIN 0.15` — because the scales are not comparable. Graph is
**k-nearest-neighbour, k=4**, so density stays bounded and never hairballs:
300 khayals → 390 links, built in 11ms.

**Ask**: embed the question → top-k by cosine, filtered to those near the best
match → prompt with numbered context → parse `[n]` from the answer and cite
only those.

**Review schedule**: intervals `[3,7,14,30,60,90]` days by review count,
multiplied by tier (Core ×2) and a pace factor `6/(pace+1)`.

---

## 7. Hard-won lessons — read these, they cost real time

1. **Never let an entrance animation be what makes content visible.** Elements
   started at `opacity:0` with `animation-fill-mode`. When the animation
   timeline stalls (backgrounded tab, throttling, content inserted while no
   frames are produced) the animation is created but **never started**
   (`startTime: null`), so those elements stay invisible **forever**. This made
   the entire to-do list, all three sheets, the toast and onboarding render as
   blank space. Fix: reveal with **CSS transitions**, not keyframes — a
   transition that can't run lands on its *visible* end state; an animation
   that can't run holds its *hidden* start state.
2. **Bump `?v=` and the SW VERSION together, every time.** See §2.
3. **Never rewrite these files with PowerShell `Get-Content`/`Set-Content`.**
   5.1 reads as ANSI and double-encodes every emoji and dash into mojibake.
   Use the editing tools, or `[System.IO.File]::ReadAllText/WriteAllText` with
   `UTF8Encoding($false)`.
4. **Never hardcode model names.** They go stale. Ask the API what the key can
   run, score the candidates, try them in turn.
5. **Google Workspace accounts usually cannot use AI Studio** — it is an
   admin-controlled service, off by default, and keys made there resolve no
   models. This cost three rounds. A personal Gmail key, or OpenAI, works.
6. **OpenAI, xAI and Gemini all permit direct browser calls** (verified: a bad
   key returns 401, not a CORS block).
7. **"gemini" contains "mini"** — a naive cheap-tier regex scored every Gemini
   model as cheap and picked `pro` over `flash`. Use word boundaries.
8. **Word-overlap similarity cannot link thoughts.** "Sleep is underrated" and
   "gym consistency" score **0.000**; the strongest pair in a test corpus was a
   false positive on the word "tool". Embeddings are not optional for the map.
9. **iOS reserves the screen edges** for Back and Home. Do not put your own
   edge-swipe strips there.
10. **`100dvh` is not the visible viewport** in some browsers — it was 30px out.
    Derive heights from the layout, not from viewport units.
11. `setPointerCapture` can throw; wrap it or the canvas becomes untappable.
12. **Track every pointer** in a Map for multi-touch, or two fingers glitch.
13. Stop the canvas render loop when off-screen or backgrounded, or it burns
    battery at 60fps in a pocket.
14. Lock body scroll behind sheets, restoring scroll position on close.

---

## 8. Outstanding — what he asked for that is NOT done

Ordered by how strongly he has pushed.

1. **To-do date/time picker is bad.** Choosing "Today" opens Date and Time
   fields that overflow the card and force scrolling. He explicitly asked that
   you **research how alarm/reminder pickers are designed** and implement that
   properly — likely an inline wheel or a compact sheet, not two form fields.
2. **To-do swipe still doesn't feel right.** Rebuilt twice, still rejected. I
   believe this is a web-view limitation; he agrees it may need the native app.
3. **Ask should be its own top-level section**, not inside Khayals. He calls it
   "the main USP".
4. **To-do history + insights**, mirroring Khayals: a browsable history of past
   to-dos by day, so the main screen stays uncluttered after clearing.
5. **Insights: ship all the proposed metrics** — keep-vs-purge ratio,
   most-connected khayal, longest gap between thoughts, weekly bar chart. He
   said deploy them all and he'll trim.
6. **Review "Adjust"** should sit at the very top, outside the white card, and
   open the settings as a **popup**; the explainer itself should be dismissible.
7. **Fullscreen map exit corrupts the layout** — the map area comes back too
   wide. Attempted a CSS fix, never verified. Still broken.
8. **Constellation legibility**: focused node labels are unreadable, and
   selecting a star doesn't feel meaningful. Needs a rethink, not a tweak.
9. **Capture screen is too pale** — every other screen has some colour; this one
   is flat. He wants subtle colour, e.g. on the mic or "Tap to speak".

---

## 9. Building the native iOS app

This is where he wants to go, and it solves most of the above.

**Stack: SwiftUI + SwiftData, Xcode on his MacBook, iOS 18+.**

### Requirement: full feature parity, AI included

He wants the native app to be **exactly the web app** — every screen, every
feature, every AI capability listed in §5 — not a reduced offline version.

**What "local" means here.** His data — khayals, to-dos, tiers, review history,
embeddings — lives only on the device. There is **no account, no sync, no
server of ours, no analytics**. AI features call **his own API key directly**
from the device, exactly as the web app does. That is not a violation of local;
it is the same bargain he already accepted and uses daily.

**Port the provider architecture as-is:**

- Providers: **OpenAI (default)**, Google Gemini, and "custom" with a base URL
  (covers xAI, Groq, OpenRouter — all speak the OpenAI format).
- **Never hardcode model names.** `GET {base}/models`, score candidates, try
  them in turn, remember the winner. See §7 lesson 4 and 7.
- Store the key in the **Keychain**, not UserDefaults. Never in the export.
- Every AI call degrades gracefully to the offline path on failure — no key, no
  network, timeout, quota, bad model. **Nothing may ever be lost or blocked.**

**The five AI features to port, all of them:**

| Feature | Endpoint | Notes |
|---|---|---|
| Smart cleanup | `chat/completions` | The full dictation-editor prompt: honour self-correction, collapse restarts, repair mishearings, punctuate, format numbers and money, respect the language setting. Falls back to the rule-based `polish()`. |
| Cloud transcription | `audio/transcriptions` | Records audio while the device engine shows a live preview; the accurate text replaces it on stop. Falls back to whatever the device heard. |
| AI titles | `chat/completions` | 3–7 words naming what the note is about. Falls back to `generateTitle()`. |
| Embeddings | `embeddings` | `text-embedding-3-small`. Powers the constellation, connected khayals, and semantic search. Computed once, stored, reused offline forever. |
| Ask | `chat/completions` | Retrieval over his khayals, citing only the ones used. |

**Native upgrades worth taking on top** (additions, not replacements):

- **`SFSpeechRecognizer` with `requiresOnDeviceRecognition`** as the free,
  offline default engine — better than the web's Web Speech API, and it means
  the app is fully usable with no key at all.
- **Foundation Models (Apple Intelligence)** as a *third* cleanup option beside
  OpenAI and Gemini, for users without a key. Requires iPhone 15 Pro or newer —
  his 17 Pro qualifies, his 14 does not.
- **`UNUserNotificationCenter`** for real scheduled local reminders that fire
  when the app is closed. This is the biggest thing the web version cannot do,
  and it retires the `.ics` calendar workaround.
- Native gestures, which retire every unresolved swipe complaint in §8.

| Need | Web today | Native answer |
|---|---|---|
| Storage | IndexedDB | **SwiftData** (`@Model`) |
| Dictation | Web Speech / cloud Whisper | **`SFSpeechRecognizer`** with `requiresOnDeviceRecognition = true` — offline, private, supports many Indian languages |
| Cleanup ("Wispr" rewrite) | remote LLM | **Foundation Models** (Apple Intelligence, on-device) on supported devices; keep bring-your-own-key as fallback |
| Embeddings for map/Ask | remote API | **`NLEmbedding.sentenceEmbedding`** on-device, free — or a small CoreML MiniLM |
| Reminders | impossible when closed | **`UNUserNotificationCenter`** — real scheduled local notifications. This is the single biggest win. |
| Gestures | fragile touch handlers | `.swipeActions`, `DragGesture`, `MagnifyGesture`, `RotateGesture` — solves every swipe complaint |
| Constellation | canvas 2D fake-3D | SwiftUI `Canvas`, or **SceneKit/RealityKit** for true 3D |
| Animation | CSS, fragile | SwiftUI implicit animation, `matchedGeometryEffect`, `.phaseAnimator` |

**Migration:** the v3 JSON export maps 1:1 onto SwiftData models. Write the
importer first — it means he never loses a khayal.

**Suggested order** — every stage ends with something working on his phone.
1. Xcode project, SwiftData models, **JSON importer**. Verify his export loads.
2. Capture + on-device dictation + rule-based polish. The core loop, no key needed.
3. Khayals: list, day grouping, search, tiers, detail sheet.
4. To-dos + **local notifications** + native swipe actions.
5. Settings: provider, key in Keychain, model discovery, language picker.
6. **AI layer**: smart cleanup, cloud transcription, AI titles.
7. Review, with its adjustable schedule.
8. **Embeddings** → connected khayals → semantic search → **Ask** (its own tab,
   per §8 item 3).
9. Constellation last — most wow, most effort. Consider SceneKit for real 3D.
10. Insights, with the full metric set from §8 item 5.

**Keeping it local:** no CloudKit, no analytics, no network entitlement unless
he opts into a bring-your-own-key mode. Back up via Files/iCloud Drive export
of the same JSON, which he controls.

**How he ships it:** Xcode → free Apple ID installs to his own iPhone for 7
days; a $99/yr Apple Developer account removes the limit and allows TestFlight
and the App Store.

---

## 10. How to work with him

- He is not a coder. Explain in plain language; never assume he'll read code.
- He gives long, multi-item lists. Enumerate them, do them all, and **say
  plainly what you did not do** — he responds well to that and badly to silent
  omissions.
- He notices UI detail acutely: colour, spacing, animation smoothness, gesture
  feel. Treat those as real requirements.
- Verify before claiming. He has caught "fixed" things that weren't.
- He asks for research (he asked for iOS gesture norms) — actually do it.
- Ship in small verified increments; he tests on a real iPhone immediately.

---

## 11. One-line summary for the next session

> Khayal is a local-first PWA at github.com/jashmehta21/khayal (live at
> jashmehta21.github.io/khayal) that captures spoken thoughts, cleans them into
> readable writing, titles them, tiers them Core/Bright/Regular, resurfaces them
> for review, holds to-dos, maps them as a 3D constellation from embeddings, and
> answers questions about them. Read HANDOFF.md fully. Next: fix §8, then rebuild
> native in SwiftUI + SwiftData per §9, keeping everything on-device.
