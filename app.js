/* Khayal — private thought keeper. All data stays on-device (IndexedDB). */
"use strict";

const DAY = 86400000;
const REVIEW_INTERVALS = [3, 7, 14, 30, 60, 90]; // days, by reviewCount
const FADE_DAYS = 30;   // regular khayals untouched this long are "fading"
const TRASH_DAYS = 30;  // purged khayals kept this long before final delete
const NEW_THOUGHT_GRACE = 2; // days before a new khayal enters the review queue

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

/* ================= Hindi → English letters (transliteration) =================
   The speech engine returns Hindi in Devanagari script; this converts it to
   the roman Hinglish the user actually writes: ज़िंदगी → zindagi. Fully local. */
const DEV_CONS = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
  "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
  "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y",
};
const DEV_NUKTA = { "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "d", "ढ": "dh", "फ": "f", "य": "y" };
const DEV_VOW = { "अ": "a", "आ": "aa", "इ": "i", "ई": "i", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e" };
const DEV_MATRA = { "ा": "aa", "ि": "i", "ी": "i", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e" };
const DEV_SIGNS = { "ं": "n", "ँ": "n", "ः": "h" };
const DEV_DIGITS = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };
const VIRAMA = "्", NUKTA_MARK = "़";

function translitWord(w) {
  const units = [];
  let i = 0;
  while (i < w.length) {
    let ch = w[i];
    let cons = DEV_CONS[ch];
    if (w[i + 1] === NUKTA_MARK) { cons = DEV_NUKTA[ch] || cons; i++; }
    if (cons !== undefined) {
      i++;
      const u = { c: cons, v: "a", implicit: true, coda: "" };
      if (DEV_MATRA[w[i]] !== undefined) { u.v = DEV_MATRA[w[i]]; u.implicit = false; i++; }
      else if (w[i] === VIRAMA) { u.v = ""; u.implicit = false; i++; }
      while (DEV_SIGNS[w[i]] !== undefined) { u.coda += DEV_SIGNS[w[i]]; i++; }
      units.push(u);
    } else if (DEV_VOW[ch] !== undefined) {
      i++;
      const u = { c: "", v: DEV_VOW[ch], implicit: false, coda: "" };
      while (DEV_SIGNS[w[i]] !== undefined) { u.coda += DEV_SIGNS[w[i]]; i++; }
      units.push(u);
    } else {
      i++;
      if (ch === "।" || ch === "॥") ch = ".";
      else if (DEV_DIGITS[ch] !== undefined) ch = DEV_DIGITS[ch];
      else if (ch === NUKTA_MARK || ch === VIRAMA || ch === "ऽ") continue;
      units.push({ lit: ch });
    }
  }
  // word-final inherent 'a' is silent: बात → baat, not baata
  for (let j = units.length - 1; j >= 0; j--) {
    if (units[j].lit !== undefined) continue;
    if (units[j].implicit) units[j].v = "";
    break;
  }
  // schwa deletion: करना → karna (not karana); blocked after clusters/anusvara: zindagi
  for (let j = 1; j < units.length - 1; j++) {
    const prev = units[j - 1], u = units[j], next = units[j + 1];
    if (u.implicit && u.v === "a" && !u.coda &&
        prev.lit === undefined && prev.v && !prev.coda &&
        next.lit === undefined && next.c && next.v && !next.implicit &&
        j + 1 === units.length - 1) {
      u.v = "";
    }
  }
  // natural spellings: final aa → a (accha, kya); e+n → ein (mein, nahin stays via i+n)
  return units
    .map((u, j) => {
      if (u.lit !== undefined) return u.lit;
      let v = u.v;
      if (v === "aa" && j === units.length - 1) v = "a";
      if (v === "e" && u.coda === "n") return u.c + "ein";
      return u.c + v + u.coda;
    })
    .join("");
}

function transliterate(text) {
  if (!/[ऀ-ॿ]/.test(text)) return text;
  return text
    .split(/(\s+)/)
    .map((tok) => (/[ऀ-ॿ]/.test(tok) ? translitWord(tok) : tok))
    .join("");
}

/* ================= IndexedDB ================= */
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("khayal-db", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("thoughts")) d.createObjectStore("thoughts", { keyPath: "id" });
      if (!d.objectStoreNames.contains("trash")) d.createObjectStore("trash", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const dbGetAll = (store) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
const dbPut = (store, obj) => tx(store, "readwrite", (s) => s.put(obj));
const dbDelete = (store, id) => tx(store, "readwrite", (s) => s.delete(id));
const dbClear = (store) => tx(store, "readwrite", (s) => s.clear());

/* ================= state ================= */
let thoughts = [];
let trash = [];
let settings = loadSettings();
let currentFilter = "all";
let searchQuery = "";
let detailId = null;
let detailTier = 0;
let reviewQueue = [];
let reviewIndex = 0;
let deferredInstallPrompt = null;

function loadSettings() {
  try { return JSON.parse(localStorage.getItem("khayal-settings")) || {}; }
  catch { return {}; }
}
function saveSettings() { localStorage.setItem("khayal-settings", JSON.stringify(settings)); }

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/* ================= helpers ================= */
function touchTime(t) { return Math.max(t.updatedAt || 0, t.lastReviewedAt || 0, t.createdAt); }
function isFading(t) { return t.tier === 0 && now() - touchTime(t) > FADE_DAYS * DAY; }
function isDue(t) {
  if (t.snoozedUntil && t.snoozedUntil > now()) return false;
  const mult = t.tier === 2 ? 2 : 1; // core khayals resurface half as often
  if (!t.lastReviewedAt) return now() - t.createdAt > NEW_THOUGHT_GRACE * DAY;
  const interval = REVIEW_INTERVALS[Math.min(t.reviewCount || 0, REVIEW_INTERVALS.length - 1)];
  return now() - t.lastReviewedAt > interval * mult * DAY;
}
function relTime(ts) {
  const d = now() - ts;
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < DAY) return Math.floor(d / 3600000) + "h ago";
  if (d < 30 * DAY) return Math.floor(d / DAY) + "d ago";
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function tierBadge(t) {
  if (t.tier === 2) return '<span class="tier-badge t2">✦ Core</span>';
  if (t.tier === 1) return '<span class="tier-badge t1">★ High</span>';
  return "";
}
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1800);
}

/* ================= navigation ================= */
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  $("screen-" + name).classList.add("active");
  document.querySelector(`.tab[data-screen="${name}"]`).classList.add("active");
  if (name === "thoughts") renderList();
  if (name === "review") startReview();
  if (name === "settings") renderSettings();
  if (name === "capture") updateTodayStat();
}
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => showScreen(t.dataset.screen))
);

/* ================= capture / speech ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
let recording = false;
let restartTimer = null;

function setLang(lang) {
  settings.lang = lang;
  saveSettings();
  document.querySelectorAll(".lang-chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.lang === lang)
  );
  $("langNote").hidden = lang !== "hi-IN";
  if (recording) { stopRecording(); startRecording(); }
}
document.querySelectorAll(".lang-chip").forEach((c) =>
  c.addEventListener("click", () => setLang(c.dataset.lang))
);

function buildRecognizer() {
  const r = new SR();
  r.lang = settings.lang || "en-IN";
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) appendFinal(transliterate(res[0].transcript));
      else interim += res[0].transcript;
    }
    $("interim").textContent = transliterate(interim);
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      recording = false;
      updateMicUI();
      $("micHint").textContent = "Mic blocked — allow microphone access in Settings › Safari";
    }
    // "no-speech" and "aborted" are normal; onend handles restart
  };
  r.onend = () => {
    // iOS stops recognition after pauses — restart while user still wants to record
    if (recording) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (recording) { try { recog.start(); } catch (_) {} }
      }, 150);
    } else {
      $("interim").textContent = "";
    }
  };
  return r;
}

function appendFinal(text) {
  const ta = $("transcript");
  const cur = ta.value;
  const sep = cur && !/\s$/.test(cur) ? " " : "";
  ta.value = cur + sep + text.trim();
  onTranscriptInput();
}

function startRecording() {
  if (!SR) {
    $("micHint").textContent = "Voice input isn't supported in this browser — typing works!";
    return;
  }
  try {
    recog = buildRecognizer();
    recog.start();
    recording = true;
    updateMicUI();
  } catch (_) {
    $("micHint").textContent = "Couldn't start the mic — try again";
  }
}
function stopRecording() {
  recording = false;
  clearTimeout(restartTimer);
  if (recog) { try { recog.stop(); } catch (_) {} }
  $("interim").textContent = "";
  updateMicUI();
}
function updateMicUI() {
  const btn = $("micBtn");
  btn.classList.toggle("recording", recording);
  btn.setAttribute("aria-label", recording ? "Stop recording" : "Start recording");
  $("wave").hidden = !recording;
  $("micHint").textContent = recording
    ? (settings.lang === "hi-IN" ? "Sun raha hoon… bolte jao" : "Listening… speak freely")
    : "Tap to speak";
}
$("micBtn").addEventListener("click", () => (recording ? stopRecording() : startRecording()));

function onTranscriptInput() {
  const has = $("transcript").value.trim().length > 0;
  $("captureActions").hidden = !has;
  localStorage.setItem("khayal-draft", $("transcript").value);
}
$("transcript").addEventListener("input", onTranscriptInput);
$("transcript").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") saveThought();
});

async function saveThought() {
  const text = $("transcript").value.trim();
  if (!text) return;
  stopRecording();
  const t = {
    id: uid(), text,
    tier: 0,
    createdAt: now(), updatedAt: now(),
    lastReviewedAt: null, reviewCount: 0, snoozedUntil: null,
    lang: settings.lang || "en-IN",
  };
  thoughts.push(t);
  await dbPut("thoughts", t);
  $("transcript").value = "";
  localStorage.removeItem("khayal-draft");
  onTranscriptInput();
  updateTodayStat();
  updateReviewBadge();
  toast("✦ Khayal saved");
}
$("saveBtn").addEventListener("click", saveThought);
$("discardBtn").addEventListener("click", () => {
  stopRecording();
  $("transcript").value = "";
  localStorage.removeItem("khayal-draft");
  onTranscriptInput();
});

function updateTodayStat() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const n = thoughts.filter((t) => t.createdAt >= start.getTime()).length;
  $("todayStat").textContent = n === 0 ? "Catch every khayal ✦" : `${n} khayal${n > 1 ? "s" : ""} caught today`;
}

/* ================= khayals list ================= */
$("searchBox").addEventListener("input", (e) => { searchQuery = e.target.value.toLowerCase(); renderList(); });
document.querySelectorAll(".filter-chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    currentFilter = c.dataset.filter;
    renderList();
  })
);

function renderList() {
  const list = $("thoughtList");
  let items = [...thoughts].sort((a, b) => b.createdAt - a.createdAt);
  if (currentFilter === "core") items = items.filter((t) => t.tier === 2);
  if (currentFilter === "high") items = items.filter((t) => t.tier === 1);
  if (currentFilter === "fading") items = items.filter(isFading);
  if (searchQuery) items = items.filter((t) => t.text.toLowerCase().includes(searchQuery));

  const core = thoughts.filter((t) => t.tier === 2).length;
  const high = thoughts.filter((t) => t.tier === 1).length;
  $("thoughtsStat").textContent = thoughts.length
    ? `${thoughts.length} khayals · ${core} core · ${high} high`
    : "";

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><span class="big">✦</span>${
      thoughts.length ? "Nothing matches here." : "No khayals yet.<br>Go catch your first one."
    }</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (t) => `<div class="thought-card tier-${t.tier}${isFading(t) ? " fading" : ""}" data-id="${t.id}">
        <div class="thought-text">${esc(t.text)}</div>
        <div class="thought-meta">${tierBadge(t)}<span>${relTime(t.createdAt)}</span>${isFading(t) ? '<span class="fade-tag">fading</span>' : ""}</div>
      </div>`
    )
    .join("");
  list.querySelectorAll(".thought-card").forEach((el) =>
    el.addEventListener("click", () => openDetail(el.dataset.id))
  );
}

/* ================= detail sheet ================= */
function openDetail(id) {
  const t = thoughts.find((x) => x.id === id);
  if (!t) return;
  detailId = id;
  detailTier = t.tier;
  $("detailText").value = t.text;
  $("detailMeta").textContent = `Created ${relTime(t.createdAt)} · reviewed ${t.reviewCount || 0}×`;
  updateTierChips();
  $("sheetBackdrop").hidden = false;
}
function updateTierChips() {
  document.querySelectorAll(".tier-chip").forEach((c) =>
    c.classList.toggle("active", Number(c.dataset.tier) === detailTier)
  );
}
document.querySelectorAll(".tier-chip").forEach((c) =>
  c.addEventListener("click", () => { detailTier = Number(c.dataset.tier); updateTierChips(); })
);
$("detailClose").addEventListener("click", closeDetail);
$("sheetBackdrop").addEventListener("click", (e) => { if (e.target === $("sheetBackdrop")) closeDetail(); });
function closeDetail() { $("sheetBackdrop").hidden = true; detailId = null; }

$("detailSave").addEventListener("click", async () => {
  const t = thoughts.find((x) => x.id === detailId);
  if (!t) return;
  const newText = $("detailText").value.trim();
  if (!newText) { toast("Khayal can't be empty"); return; }
  t.text = newText;
  t.tier = detailTier;
  t.updatedAt = now();
  await dbPut("thoughts", t);
  closeDetail();
  renderList();
  toast("Updated");
});
$("detailPurge").addEventListener("click", async () => {
  const t = thoughts.find((x) => x.id === detailId);
  if (!t) return;
  if (t.tier === 2 && !confirm("This is a ✦ Core khayal. Purge it anyway?")) return;
  await purgeThought(t);
  closeDetail();
  renderList();
});

async function purgeThought(t) {
  thoughts = thoughts.filter((x) => x.id !== t.id);
  await dbDelete("thoughts", t.id);
  const item = { ...t, purgedAt: now() };
  trash.push(item);
  await dbPut("trash", item);
  updateReviewBadge();
  toast("Purged — in trash for 30 days");
}

/* ================= review ================= */
function startReview() {
  reviewQueue = thoughts
    .filter(isDue)
    .sort((a, b) => {
      const fa = isFading(a) ? 0 : 1, fb = isFading(b) ? 0 : 1;
      if (fa !== fb) return fa - fb; // fading first
      return touchTime(a) - touchTime(b); // then oldest
    });
  reviewIndex = 0;
  const fadingCount = thoughts.filter(isFading).length;
  const banner = $("fadingBanner");
  if (fadingCount > 0) {
    banner.hidden = false;
    banner.innerHTML = `<b>${fadingCount}</b> khayal${fadingCount > 1 ? "s are" : " is"} fading — untouched for ${FADE_DAYS}+ days. They come first below: keep them or let them go.`;
  } else banner.hidden = true;
  renderReviewCard();
}

function renderReviewCard() {
  const area = $("reviewArea");
  updateReviewBadge();
  if (reviewIndex >= reviewQueue.length) {
    area.innerHTML = `<div class="empty-state"><span class="big">🌙</span>All clear. Your mind is tidy.<br>Come back when khayals pile up.</div>`;
    return;
  }
  const t = reviewQueue[reviewIndex];
  area.innerHTML = `
    <div class="review-progress">${reviewIndex + 1} of ${reviewQueue.length}</div>
    <div class="review-stack">
      <div class="review-card">
        <div class="thought-text">${esc(t.text)}</div>
        <div class="thought-meta">${tierBadge(t)}<span>${relTime(t.createdAt)}</span>${isFading(t) ? '<span class="fade-tag">fading</span>' : ""}</div>
      </div>
    </div>
    <div class="review-actions">
      <button class="btn danger" id="rvPurge">Purge</button>
      <button class="btn later" id="rvLater">Later</button>
      <button class="btn keep" id="rvKeep">Keep ✓</button>
      <button class="btn promote" id="rvPromote">${t.tier >= 2 ? "✦ Core ✓" : t.tier === 1 ? "Make ✦ Core" : "Make ★ High"}</button>
    </div>`;
  $("rvPurge").addEventListener("click", async () => {
    if (t.tier === 2 && !confirm("This is a ✦ Core khayal. Purge it anyway?")) return;
    await purgeThought(t);
    nextReview();
  });
  $("rvLater").addEventListener("click", async () => {
    t.snoozedUntil = now() + 7 * DAY;
    await dbPut("thoughts", t);
    nextReview();
  });
  $("rvKeep").addEventListener("click", async () => {
    t.lastReviewedAt = now();
    t.reviewCount = (t.reviewCount || 0) + 1;
    t.snoozedUntil = null;
    await dbPut("thoughts", t);
    nextReview();
  });
  $("rvPromote").addEventListener("click", async () => {
    t.tier = Math.min(t.tier + 1, 2);
    t.lastReviewedAt = now();
    t.reviewCount = (t.reviewCount || 0) + 1;
    t.snoozedUntil = null;
    await dbPut("thoughts", t);
    toast(t.tier === 2 ? "✦ Core memory" : "★ High memory");
    nextReview();
  });
}
function nextReview() { reviewIndex++; renderReviewCard(); }

function updateReviewBadge() {
  const n = thoughts.filter(isDue).length;
  const b = $("reviewBadge");
  b.hidden = n === 0;
  b.textContent = n > 99 ? "99+" : n;
}

/* ================= settings ================= */
function renderSettings() {
  const core = thoughts.filter((t) => t.tier === 2).length;
  const high = thoughts.filter((t) => t.tier === 1).length;
  $("statsLine").textContent = `${thoughts.length} khayals · ${core} ✦ core · ${high} ★ high · ${trash.length} in trash`;
  renderTrash();
  renderInstallHelp();
}

function renderTrash() {
  const list = $("trashList");
  $("emptyTrashBtn").hidden = trash.length === 0;
  if (!trash.length) {
    list.innerHTML = '<p class="settings-note" style="margin:0">Trash is empty.</p>';
    return;
  }
  list.innerHTML = [...trash]
    .sort((a, b) => b.purgedAt - a.purgedAt)
    .map((t) => {
      const left = Math.max(0, TRASH_DAYS - Math.floor((now() - t.purgedAt) / DAY));
      return `<div class="trash-item"><span class="t-text">${esc(t.text)}</span><span style="color:var(--dim);font-size:0.75rem">${left}d</span><button data-id="${t.id}">Restore</button></div>`;
    })
    .join("");
  list.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", async () => {
      const item = trash.find((x) => x.id === b.dataset.id);
      if (!item) return;
      trash = trash.filter((x) => x.id !== item.id);
      await dbDelete("trash", item.id);
      const { purgedAt, ...restored } = item;
      thoughts.push(restored);
      await dbPut("thoughts", restored);
      renderSettings();
      updateReviewBadge();
      toast("Restored");
    })
  );
}
$("emptyTrashBtn").addEventListener("click", async () => {
  if (!confirm(`Permanently delete ${trash.length} purged khayal${trash.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
  trash = [];
  await dbClear("trash");
  renderSettings();
  toast("Trash emptied");
});

async function cleanOldTrash() {
  const cutoff = now() - TRASH_DAYS * DAY;
  const old = trash.filter((t) => t.purgedAt < cutoff);
  for (const t of old) await dbDelete("trash", t.id);
  trash = trash.filter((t) => t.purgedAt >= cutoff);
}

/* ---- backup ---- */
$("exportBtn").addEventListener("click", () => {
  const data = { app: "khayal", version: 1, exportedAt: new Date().toISOString(), thoughts, trash };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `khayal-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Backup downloaded");
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if ((data.app !== "khayal" && data.app !== "sparks") || !Array.isArray(data.thoughts)) throw new Error("bad format");
    let added = 0, updated = 0;
    for (const inc of data.thoughts) {
      const existing = thoughts.find((t) => t.id === inc.id);
      if (!existing) { thoughts.push(inc); await dbPut("thoughts", inc); added++; }
      else if ((inc.updatedAt || 0) > (existing.updatedAt || 0)) {
        Object.assign(existing, inc); await dbPut("thoughts", existing); updated++;
      }
    }
    for (const inc of data.trash || []) {
      if (!trash.find((t) => t.id === inc.id) && !thoughts.find((t) => t.id === inc.id)) {
        trash.push(inc); await dbPut("trash", inc);
      }
    }
    renderSettings();
    updateReviewBadge();
    toast(`Imported: ${added} new, ${updated} updated`);
  } catch {
    toast("Couldn't read that backup file");
  }
});

/* ---- install help ---- */
function renderInstallHelp() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const help = $("installHelp");
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (standalone) {
    help.textContent = "Installed ✓ — you're running Khayal as an app.";
    $("installBtn").hidden = true;
  } else if (isIOS) {
    help.innerHTML = "On iPhone: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. Khayal becomes a real app icon.";
  } else if (deferredInstallPrompt) {
    help.textContent = "Install Khayal as a desktop app:";
    $("installBtn").hidden = false;
  } else {
    help.innerHTML = "In Chrome or Edge: look for the <b>install icon</b> in the address bar, or use the browser menu → <b>Install Khayal</b>.";
  }
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if ($("screen-settings").classList.contains("active")) renderInstallHelp();
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  renderInstallHelp();
});

/* ================= onboarding ================= */
$("onboardDone").addEventListener("click", () => {
  settings.onboarded = true;
  saveSettings();
  $("onboard").hidden = true;
});

/* ================= boot ================= */
(async function boot() {
  db = await openDB();
  thoughts = await dbGetAll("thoughts");
  trash = await dbGetAll("trash");
  await cleanOldTrash();

  setLang(settings.lang || "en-IN");
  const draft = localStorage.getItem("khayal-draft");
  if (draft) { $("transcript").value = draft; }
  onTranscriptInput();
  updateTodayStat();
  updateReviewBadge();

  if (!settings.onboarded) $("onboard").hidden = false;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
