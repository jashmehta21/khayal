/* Khayal — private thought keeper + to-dos. All data stays on-device (IndexedDB). */
"use strict";

const DAY = 86400000;
const REVIEW_INTERVALS = [3, 7, 14, 30, 60, 90];
const FADE_DAYS = 30;
const TRASH_DAYS = 30;
const NEW_THOUGHT_GRACE = 2;

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

/* ================= Hindi → English letters (transliteration) ================= */
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
  for (let j = units.length - 1; j >= 0; j--) {
    if (units[j].lit !== undefined) continue;
    if (units[j].implicit) units[j].v = "";
    break;
  }
  for (let j = 1; j < units.length - 1; j++) {
    const prev = units[j - 1], u = units[j], next = units[j + 1];
    if (u.implicit && u.v === "a" && !u.coda &&
        prev.lit === undefined && prev.v && !prev.coda &&
        next.lit === undefined && next.c && next.v && !next.implicit &&
        j + 1 === units.length - 1) {
      u.v = "";
    }
  }
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
  return text.split(/(\s+)/).map((tok) => (/[ऀ-ॿ]/.test(tok) ? translitWord(tok) : tok)).join("");
}

/* ================= polish: raw dictation → readable text ================= */
const SPOKEN_MARKS = [
  [/\b(?:full stop|fullstop|period)\b/gi, "."],
  [/\b(?:question mark)\b/gi, "?"],
  [/\b(?:exclamation (?:mark|point))\b/gi, "!"],
  [/\b(?:comma)\b/gi, ","],
  [/\b(?:new paragraph|next paragraph)\b/gi, "\n\n"],
  [/\b(?:new line|next line|nayi line)\b/gi, "\n"],
];
const FILLERS = [
  "um", "umm", "ummm", "uh", "uhh", "uhhh", "uhm", "er", "err", "erm",
  "ah", "ahh", "hmm", "hmmm", "mmm", "mm",
  "you know", "i mean", "matlab", "yaani", "yani", "arre", "arey",
];
const FILLER_RE = new RegExp("(^|[\\s,.!?\\n])(?:" + FILLERS.join("|") + ")(?=[\\s,.!?\\n]|$)", "gi");
const STUTTER_WORDS = new Set([
  "i", "the", "a", "an", "and", "but", "so", "to", "of", "in", "is", "it",
  "that", "this", "we", "you", "he", "she", "they", "my", "me", "was", "for",
  "main", "mein", "ki", "ka", "ke", "hai", "toh", "aur", "ye", "wo", "woh",
]);

function collapseStutters(text) {
  return text.replace(/\b(\w+)((?:\s+\1\b)+)/gi, (m, word) =>
    STUTTER_WORDS.has(word.toLowerCase()) ? word : m);
}
function fixFirstPerson(text) {
  return text.replace(/\bi\b(['’](?:m|ll|ve|d))?/g, (m, s) => "I" + (s || ""));
}
function capitalizeSentences(text) {
  return text.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (m, lead, ch) => lead + ch.toUpperCase());
}
function tidySpacing(text) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,;:])(?=\S)/g, "$1 ")
    .replace(/([.!?])(?=[A-Za-z])/g, "$1 ")
    .replace(/([.!?]){2,}/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function polish(text) {
  if (!text || !text.trim()) return text;
  let out = text;
  for (const [re, rep] of SPOKEN_MARKS) out = out.replace(re, rep);
  out = out.replace(FILLER_RE, "$1");
  out = collapseStutters(out);
  out = tidySpacing(out);
  out = fixFirstPerson(out);
  out = capitalizeSentences(out);
  if (out && !/[.!?…]$/.test(out)) out += ".";
  return out;
}

/* ================= auto titles =================
   Compresses a khayal into a short headline, locally and instantly: drop the
   hedging run-up people speak with, keep the first real clause, trim it to a
   natural length. No AI, no network. */
const MAX_TITLE = 52;

const TITLE_OPENERS = [
  /^(?:so|and|but|okay|ok|well|now|see|look|actually|basically|honestly|anyway)\b[\s,]*/i,
  /^(?:i(?:'ve| have)? (?:was |been )?(?:just )?(?:thinking|wondering|realising|realizing|feeling)\b(?: that| like| if)?)\s*/i,
  /^(?:i (?:think|feel|believe|guess|reckon)\b(?: that| like)?)\s*/i,
  /^(?:what if|imagine(?: if)?|maybe|perhaps|suppose)\b\s*/i,
  /^(?:mujhe lagta hai(?: ki)?|mera manna hai(?: ki)?|aisa lagta hai(?: ki)?|mujhe lagta(?: ki)?)\s*/i,
  /^(?:note to self|reminder|idea|thought)\b[\s:,-]*/i,
  /^(?:that|the fact that)\s+(?=\w)/i,
];

// words a title shouldn't end on
const TRAIL_TRIM = new Set([
  "a", "an", "the", "and", "or", "but", "so", "to", "of", "in", "on", "at", "for",
  "with", "from", "by", "as", "is", "was", "are", "were", "be", "that", "this",
  "it", "its", "my", "our", "your", "i", "we", "you", "he", "she", "they",
  "ki", "ka", "ke", "kya", "hai", "hain", "mein", "se", "ko", "aur", "par", "bhi", "toh",
]);

function generateTitle(text) {
  let s = String(text || "").trim().replace(/\s+/g, " ");
  if (!s) return "";

  // peel off hedges repeatedly: "So I was thinking that maybe …" → "…"
  let prev;
  do {
    prev = s;
    for (const re of TITLE_OPENERS) s = s.replace(re, "");
    s = s.replace(/^[\s,;:.\-—–]+/, "").trim();
  } while (s !== prev && s);
  if (!s) s = String(text).trim().replace(/\s+/g, " ");

  // first sentence
  const end = s.search(/[.!?…\n]/);
  let t = end > 0 ? s.slice(0, end) : s;

  // a first sentence that already reads as a title is kept whole
  const fits = (str) => str.length <= MAX_TITLE && str.split(/\s+/).filter(Boolean).length <= 10;
  let truncated = false;

  if (!fits(t)) {
    // cut at the first natural break rather than mid-thought
    const br = t.search(/\s[—–-]\s|[,;:]\s/);
    if (br > 14 && br <= MAX_TITLE + 12) { t = t.slice(0, br); truncated = true; }
  }
  if (!fits(t)) {
    const cut = t.slice(0, MAX_TITLE + 1);
    const sp = cut.lastIndexOf(" ");
    t = sp > 14 ? cut.slice(0, sp) : cut;
    truncated = true;
  }
  let words = t.split(/\s+/).filter(Boolean);
  if (words.length > 10) { words = words.slice(0, 10); truncated = true; }
  // only tidy a dangling connector when something was actually cut off
  if (truncated) {
    while (words.length > 2 && TRAIL_TRIM.has(words[words.length - 1].toLowerCase().replace(/[^a-z']/g, ""))) {
      words.pop();
    }
  }
  t = words.join(" ").replace(/[\s,;:.\-—–]+$/, "").trim();

  if (t.length < 3) t = s.slice(0, MAX_TITLE).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* body shown under the title — skips the words the title already used */
function previewFor(th) {
  const text = String(th.text || "").trim().replace(/\s+/g, " ");
  const title = String(th.title || "").trim();
  if (!title) return text;
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (norm(text).startsWith(norm(title))) {
    const rest = text.split(" ").slice(title.split(" ").length).join(" ");
    return rest.replace(/^[\s,;:.\-—–]+/, "").trim();
  }
  return text;
}

/* ================= IndexedDB ================= */
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("khayal-db", 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("thoughts")) d.createObjectStore("thoughts", { keyPath: "id" });
      if (!d.objectStoreNames.contains("trash")) d.createObjectStore("trash", { keyPath: "id" });
      if (!d.objectStoreNames.contains("todos")) d.createObjectStore("todos", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const dbGetAll = (store) =>
  new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
const dbPut = (store, obj) => tx(store, "readwrite", (s) => s.put(obj));
const dbDelete = (store, id) => tx(store, "readwrite", (s) => s.delete(id));
const dbClear = (store) => tx(store, "readwrite", (s) => s.clear());

/* ================= state ================= */
let thoughts = [], trash = [], todos = [];
let settings = loadSettings();
let currentFilter = "all", searchQuery = "";
let detailId = null, detailTier = 0;
let reviewQueue = [], reviewIndex = 0;
let deferredInstallPrompt = null;
let captureMode = "khayal";

function loadSettings() {
  try { return JSON.parse(localStorage.getItem("khayal-settings")) || {}; }
  catch { return {}; }
}
function saveSettings() { localStorage.setItem("khayal-settings", JSON.stringify(settings)); }
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/* ================= shared helpers ================= */
function touchTime(t) { return Math.max(t.updatedAt || 0, t.lastReviewedAt || 0, t.createdAt); }
function isFading(t) { return t.tier === 0 && now() - touchTime(t) > FADE_DAYS * DAY; }
function isDue(t) {
  if (t.snoozedUntil && t.snoozedUntil > now()) return false;
  const mult = t.tier === 2 ? 2 : 1;
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
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function tierBadge(t) {
  if (t.tier === 2) return '<span class="tier-badge t2">CORE</span>';
  if (t.tier === 1) return '<span class="tier-badge t1">HIGH</span>';
  return "";
}
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function keyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dayKey(ts) { return keyOf(new Date(ts)); }
function sameDay(a, b) { return keyOf(new Date(a)) === keyOf(new Date(b)); }
function clockTime(ts) { return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function buzz(ms) { if (navigator.vibrate && settings.motion !== false) { try { navigator.vibrate(ms); } catch (_) {} } }

let toastTimer;
function toast(msg, onTap) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle("tappable", !!onTap);
  el.onclick = onTap ? () => { el.hidden = true; clearTimeout(toastTimer); onTap(); } : null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), onTap ? 6500 : 1900);
}

/* animated number counter — always lands on the exact value, even if the
   tab is backgrounded and animation frames never fire */
function countUp(el, to, dur = 750, suffix = "") {
  const from = parseInt(el.textContent, 10) || 0;
  const settle = () => { el.textContent = to + suffix; };
  if (settings.motion === false || from === to) { settle(); return; }
  clearTimeout(el._countTimer);
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el._countTimer = setTimeout(settle, dur + 60);
}

/* ripple origin for buttons */
document.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".btn");
  if (!btn || settings.motion === false) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty("--rx", ((e.clientX - r.left) / r.width) * 100 + "%");
  btn.style.setProperty("--ry", ((e.clientY - r.top) / r.height) * 100 + "%");
  btn.classList.add("rippling");
  setTimeout(() => btn.classList.remove("rippling"), 60);
});

/* sliding thumb on segmented controls */
function moveThumb(seg) {
  const active = seg.querySelector(".seg-btn.active");
  const thumb = seg.querySelector(".seg-thumb");
  if (!active || !thumb || !active.offsetWidth) return;
  thumb.style.width = active.offsetWidth + "px";
  thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
}
/* run now (layout is usually ready) and again next frame, so the thumb is
   never left unpositioned if frames are throttled */
function moveAllThumbs() {
  document.querySelectorAll(".seg").forEach(moveThumb);
  requestAnimationFrame(() => document.querySelectorAll(".seg").forEach(moveThumb));
}
window.addEventListener("resize", moveAllThumbs);
document.fonts && document.fonts.ready.then(moveAllThumbs);

/* ================= navigation ================= */
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  $("screen-" + name).classList.add("active");
  document.querySelector(`.tab[data-screen="${name}"]`).classList.add("active");
  if (name === "thoughts") refreshThoughts();
  if (name === "todos") renderTodos();
  if (name === "review") startReview();
  if (name === "settings") renderSettings();
  if (name === "capture") updateTodayStat();
  moveAllThumbs();
}
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => { buzz(8); showScreen(t.dataset.screen); })
);

/* ================= capture mode ================= */
document.querySelectorAll(".seg-btn[data-mode]").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode))
);
function setMode(mode) {
  captureMode = mode;
  settings.mode = mode;
  saveSettings();
  document.querySelectorAll(".seg-btn[data-mode]").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
  moveThumb($("segThumb").parentElement);
  const todo = mode === "todo";
  $("todoOptions").hidden = !todo;
  $("composeLabel").textContent = todo ? "TO-DO" : "THOUGHT";
  $("transcript").placeholder = todo ? "What needs doing?" : "Bolo ya likho — jo bhi mann mein hai…";
  $("saveBtn").textContent = todo ? "Add to-do" : "Save khayal";
  buzz(8);
}

/* ================= speech ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, recording = false, restartTimer = null;

function setLang(lang) {
  settings.lang = lang;
  saveSettings();
  document.querySelectorAll(".lang-btn").forEach((c) => c.classList.toggle("active", c.dataset.lang === lang));
  if (recording) { stopRecording(); startRecording(); }
}
document.querySelectorAll(".lang-btn").forEach((c) =>
  c.addEventListener("click", () => { buzz(8); setLang(c.dataset.lang); })
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
  };
  r.onend = () => {
    if (recording) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { if (recording) { try { recog.start(); } catch (_) {} } }, 150);
    } else $("interim").textContent = "";
  };
  return r;
}

let lastFinalAt = 0;
const PARA_GAP = 2500;

function appendFinal(text) {
  const ta = $("transcript");
  let chunk = text.trim();
  if (!chunk) return;
  const cur = ta.value;
  if (settings.autoPolish !== false) {
    const gap = lastFinalAt ? now() - lastFinalAt : 0;
    const newPara = cur && gap > PARA_GAP && captureMode === "khayal";
    chunk = polish(chunk);
    if (!chunk.trim()) { lastFinalAt = now(); return; }
    if (!cur) ta.value = chunk;
    else ta.value = cur.replace(/\s+$/, "") + (newPara ? "\n\n" : " ") + chunk;
  } else {
    ta.value = cur + (cur && !/\s$/.test(cur) ? " " : "") + chunk;
  }
  lastFinalAt = now();
  onTranscriptInput();
}

let wakeLock = null;
async function acquireWakeLock() {
  if (settings.wakeLock === false || !("wakeLock" in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
}
function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch (_) {} wakeLock = null; }
}

function startRecording() {
  if (!SR) { $("micHint").textContent = "Voice input isn't supported here — typing works!"; return; }
  try {
    recog = buildRecognizer();
    recog.start();
    recording = true;
    lastFinalAt = 0;
    buzz(12);
    acquireWakeLock();
    updateMicUI();
  } catch (_) { $("micHint").textContent = "Couldn't start the mic — try again"; }
}
function stopRecording() {
  recording = false;
  clearTimeout(restartTimer);
  if (recog) { try { recog.stop(); } catch (_) {} }
  $("interim").textContent = "";
  releaseWakeLock();
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
  $("polishBtn").hidden = !has;
  localStorage.setItem("khayal-draft", $("transcript").value);
}
$("transcript").addEventListener("input", onTranscriptInput);
$("transcript").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") saveCapture();
});

let prePolish = null;
$("polishBtn").addEventListener("click", () => {
  const ta = $("transcript");
  const before = ta.value;
  const after = polish(before);
  if (after === before) { toast("Already clean"); return; }
  prePolish = before;
  ta.value = after;
  onTranscriptInput();
  buzz(10);
  toast("✨ Polished — tap to undo", () => {
    ta.value = prePolish; prePolish = null; onTranscriptInput(); toast("Undone");
  });
});

/* due-date chips on the capture screen */
let captureDue = "none";
document.querySelectorAll(".due-chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll(".due-chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    captureDue = c.dataset.due;
    buzz(8);
    const d = dueFromPreset(captureDue);
    $("dueDetail").hidden = captureDue === "none";
    if (d) {
      $("dueDate").value = keyOf(new Date(d));
      $("dueTime").value = new Date(d).toTimeString().slice(0, 5);
    }
  })
);

/* preset → timestamp (09:00, or an hour from now if today's 09:00 has passed) */
function dueFromPreset(preset) {
  const t = new Date();
  let d;
  if (preset === "none") return null;
  if (preset === "today") d = startOfDay(t);
  else if (preset === "tomorrow") d = addDays(startOfDay(t), 1);
  else if (preset === "weekend") {
    d = startOfDay(t);
    const delta = (6 - d.getDay() + 7) % 7 || 7; // next Saturday
    d = addDays(d, delta);
  } else return null;
  d.setHours(9, 0, 0, 0);
  if (d.getTime() < now()) {
    d = new Date(Math.ceil((now() + 3600000) / 900000) * 900000); // next quarter hour, +1h
  }
  return d.getTime();
}
function readDueFields(dateEl, timeEl) {
  const dv = dateEl.value, tv = timeEl.value || "09:00";
  if (!dv) return null;
  const [y, m, d] = dv.split("-").map(Number);
  const [hh, mm] = tv.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
}

async function saveCapture() {
  const text = $("transcript").value.trim();
  if (!text) return;
  stopRecording();
  if (captureMode === "todo") {
    const dueAt = captureDue === "none" ? null : readDueFields($("dueDate"), $("dueTime"));
    await addTodo(text, dueAt);
    toast("✓ To-do added");
  } else {
    const t = {
      id: uid(), text, title: generateTitle(text), titleEdited: false,
      tier: 0, createdAt: now(), updatedAt: now(),
      lastReviewedAt: null, reviewCount: 0, snoozedUntil: null, lang: settings.lang || "en-IN",
    };
    thoughts.push(t);
    await dbPut("thoughts", t);
    updateTodayStat();
    updateBadges();
    toast("✦ Khayal saved");
  }
  $("transcript").value = "";
  localStorage.removeItem("khayal-draft");
  onTranscriptInput();
  buzz(14);
}
$("saveBtn").addEventListener("click", saveCapture);
$("discardBtn").addEventListener("click", () => {
  stopRecording();
  $("transcript").value = "";
  localStorage.removeItem("khayal-draft");
  onTranscriptInput();
});

function updateTodayStat() {
  const start = startOfDay(new Date()).getTime();
  const n = thoughts.filter((t) => t.createdAt >= start).length;
  $("todayStat").textContent = n === 0 ? "Catch every khayal" : `${n} khayal${n > 1 ? "s" : ""} caught today`;
  $("headDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
}

/* ================= TO-DOS ================= */
async function addTodo(text, dueAt = null) {
  const t = {
    id: uid(), text, done: false, dueAt, notified: false,
    createdAt: now(), updatedAt: now(), completedAt: null,
  };
  todos.push(t);
  await dbPut("todos", t);
  scheduleReminders();
  updateBadges();
  if ($("screen-todos").classList.contains("active")) renderTodos();
  return t;
}

$("quickAddBtn").addEventListener("click", quickAdd);
$("quickAdd").addEventListener("keydown", (e) => { if (e.key === "Enter") quickAdd(); });
async function quickAdd() {
  const input = $("quickAdd");
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  input.value = "";
  buzz(12);
  await addTodo(text, null);
  renderTodos();
}

async function toggleTodo(t) {
  t.done = !t.done;
  t.completedAt = t.done ? now() : null;
  t.updatedAt = now();
  if (t.done) t.notified = true; // don't nag about something already finished
  await dbPut("todos", t);
  buzz(t.done ? 16 : 8);
  updateBadges();
  scheduleReminders();
  return t.done;
}

async function deleteTodo(t) {
  todos = todos.filter((x) => x.id !== t.id);
  await dbDelete("todos", t.id);
  updateBadges();
  scheduleReminders();
}

function dueLabel(t) {
  if (!t.dueAt) return null;
  const d = new Date(t.dueAt);
  const today = startOfDay(new Date());
  const days = Math.round((startOfDay(d) - today) / DAY);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (t.dueAt < now() && !t.done) return { text: "Overdue · " + time, cls: "past" };
  if (days === 0) return { text: "Today " + time, cls: "soon" };
  if (days === 1) return { text: "Tomorrow " + time, cls: "" };
  if (days > 1 && days < 7) return { text: d.toLocaleDateString(undefined, { weekday: "long" }) + " " + time, cls: "" };
  return { text: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + time, cls: "" };
}

function todoSections() {
  const today = startOfDay(new Date()).getTime();
  const tomorrow = today + DAY;
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const byDue = (a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity) || b.createdAt - a.createdAt;

  return [
    { key: "overdue", label: "Overdue", items: open.filter((t) => t.dueAt && t.dueAt < now() && t.dueAt < tomorrow).sort(byDue) },
    { key: "today", label: "Today", items: open.filter((t) => t.dueAt && t.dueAt >= now() && t.dueAt < tomorrow).sort(byDue) },
    { key: "tomorrow", label: "Tomorrow", items: open.filter((t) => t.dueAt >= tomorrow && t.dueAt < tomorrow + DAY).sort(byDue) },
    { key: "upcoming", label: "Upcoming", items: open.filter((t) => t.dueAt && t.dueAt >= tomorrow + DAY).sort(byDue) },
    { key: "someday", label: "Someday", items: open.filter((t) => !t.dueAt).sort((a, b) => b.createdAt - a.createdAt) },
    { key: "done", label: "Done", items: done.slice(0, 25) },
  ].filter((s) => s.items.length);
}

function todoItemHTML(t) {
  const due = dueLabel(t);
  return `<div class="todo-item${t.done ? " done" : ""}${due && due.cls === "past" ? " overdue" : ""}" data-id="${t.id}">
    <button class="tcheck" aria-label="${t.done ? "Mark as not done" : "Mark as done"}" role="checkbox" aria-checked="${t.done}">
      <svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5"/></svg>
    </button>
    <div class="tbody">
      <span class="ttext">${esc(t.text)}</span>
      ${due || t.dueAt ? `<div class="tmeta">${due ? `<span class="tdue ${due.cls}">${esc(due.text)}</span>` : ""}${t.dueAt && !t.done ? '<span class="tbell">🔔</span>' : ""}</div>` : ""}
    </div>
  </div>`;
}

function renderTodos() {
  const open = todos.filter((t) => !t.done).length;
  $("todoStat").textContent = todos.length
    ? open ? `${open} to do · ${todos.length - open} done` : "All clear — nothing pending"
    : "Nothing yet";
  $("clearDoneBtn").hidden = !todos.some((t) => t.done);

  updateBadges();
  renderTodoProgress();

  const sections = todoSections();
  const list = $("todoList");
  if (!sections.length) {
    list.innerHTML = `<div class="empty-state"><span class="big">✓</span>No to-dos yet.<br>Add one above, or dictate it from Capture.</div>`;
    return;
  }
  list.innerHTML = sections.map((s) =>
    `<div class="todo-section">
      <div class="section-head">
        <span class="micro-label">${s.label}</span><span class="rule"></span><span class="count">${s.items.length}</span>
      </div>
      ${s.items.map(todoItemHTML).join("")}
    </div>`).join("");

  // stagger the entrance so the list assembles rather than snaps in
  if (settings.motion !== false) {
    list.querySelectorAll(".todo-item").forEach((el, i) => {
      el.style.animationDelay = Math.min(i * 0.035, 0.4) + "s";
    });
  }

  list.querySelectorAll(".tcheck").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = btn.closest(".todo-item");
      const t = todos.find((x) => x.id === row.dataset.id);
      if (!t) return;
      const nowDone = await toggleTodo(t);
      row.classList.toggle("done", nowDone);
      btn.setAttribute("aria-checked", String(nowDone));
      // let the strike-through play before the list regroups
      setTimeout(() => { if ($("screen-todos").classList.contains("active")) renderTodos(); }, 480);
      if (nowDone && todos.filter((x) => !x.done).length === 0) {
        setTimeout(() => toast("🎉 Everything done"), 500);
      }
    })
  );
  list.querySelectorAll(".todo-item").forEach((el) =>
    el.addEventListener("click", () => openTodo(el.dataset.id))
  );
}

function renderTodoProgress() {
  const t0 = startOfDay(new Date()).getTime();
  const t1 = t0 + DAY;
  const relevant = todos.filter((t) =>
    (t.dueAt && t.dueAt < t1) || (t.done && t.completedAt && t.completedAt >= t0));
  const card = $("progressCard");
  if (!relevant.length) { card.hidden = true; return; }
  card.hidden = false;
  const done = relevant.filter((t) => t.done).length;
  const pct = Math.round((done / relevant.length) * 100);
  countUp($("doneCount"), done);
  $("totalCount").textContent = "/" + relevant.length;
  countUp($("ringPct"), pct, 750, "%");
  const C = 2 * Math.PI * 19;
  $("ringFg").style.strokeDashoffset = C * (1 - pct / 100);
  $("barFill").style.width = pct + "%";
}

$("clearDoneBtn").addEventListener("click", async () => {
  const doneOnes = todos.filter((t) => t.done);
  if (!doneOnes.length) return;
  if (!confirm(`Remove ${doneOnes.length} completed to-do${doneOnes.length > 1 ? "s" : ""}?`)) return;
  for (const t of doneOnes) await dbDelete("todos", t.id);
  todos = todos.filter((t) => !t.done);
  renderTodos();
  updateBadges();
  toast("Cleared");
});

/* ---- todo detail sheet ---- */
let todoId = null, todoDue = "none";
function openTodo(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  todoId = id;
  $("todoText").value = t.text;
  const has = !!t.dueAt;
  todoDue = has ? "custom" : "none";
  document.querySelectorAll(".tdue-chip").forEach((c) =>
    c.classList.toggle("active", has ? false : c.dataset.due === "none"));
  $("tDueDetail").hidden = !has;
  if (has) {
    $("tDueDate").value = keyOf(new Date(t.dueAt));
    $("tDueTime").value = new Date(t.dueAt).toTimeString().slice(0, 5);
  } else { $("tDueDate").value = ""; $("tDueTime").value = "09:00"; }
  $("todoIcs").hidden = !has;
  $("todoSheetBackdrop").hidden = false;
}
document.querySelectorAll(".tdue-chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll(".tdue-chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    todoDue = c.dataset.due;
    buzz(8);
    const d = dueFromPreset(todoDue);
    $("tDueDetail").hidden = todoDue === "none";
    $("todoIcs").hidden = todoDue === "none";
    if (d) {
      $("tDueDate").value = keyOf(new Date(d));
      $("tDueTime").value = new Date(d).toTimeString().slice(0, 5);
    }
  })
);
function closeTodoSheet() { $("todoSheetBackdrop").hidden = true; todoId = null; }
$("todoClose").addEventListener("click", closeTodoSheet);
$("todoSheetBackdrop").addEventListener("click", (e) => {
  if (e.target === $("todoSheetBackdrop")) closeTodoSheet();
});
$("todoSave").addEventListener("click", async () => {
  const t = todos.find((x) => x.id === todoId);
  if (!t) return;
  const text = $("todoText").value.trim();
  if (!text) { toast("To-do can't be empty"); return; }
  const newDue = $("tDueDetail").hidden ? null : readDueFields($("tDueDate"), $("tDueTime"));
  if (newDue !== t.dueAt) t.notified = false; // a new time deserves a new alert
  t.text = text;
  t.dueAt = newDue;
  t.updatedAt = now();
  await dbPut("todos", t);
  closeTodoSheet();
  renderTodos();
  scheduleReminders();
  updateBadges();
  toast("Updated");
});
$("todoDelete").addEventListener("click", async () => {
  const t = todos.find((x) => x.id === todoId);
  if (!t) return;
  const backup = { ...t };
  await deleteTodo(t);
  closeTodoSheet();
  renderTodos();
  toast("Deleted — tap to undo", async () => {
    todos.push(backup);
    await dbPut("todos", backup);
    renderTodos(); updateBadges(); scheduleReminders();
    toast("Restored");
  });
});

/* ---- calendar file: a real phone alarm, even when Khayal is closed ---- */
function icsStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
$("todoIcs").addEventListener("click", () => {
  const t = todos.find((x) => x.id === todoId);
  const due = $("tDueDetail").hidden ? null : readDueFields($("tDueDate"), $("tDueTime"));
  if (!t || !due) { toast("Pick a date first"); return; }
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Khayal//To-do//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:" + t.id + "@khayal",
    "DTSTAMP:" + icsStamp(now()),
    "DTSTART:" + icsStamp(due),
    "DTEND:" + icsStamp(due + 1800000),
    "SUMMARY:" + $("todoText").value.replace(/[\r\n]+/g, " ").slice(0, 200),
    "DESCRIPTION:From Khayal",
    "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "khayal-todo.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Opening your calendar…");
});

/* ================= notifications ================= */
let reminderTimers = [];
function canNotify() { return "Notification" in window && Notification.permission === "granted"; }

async function showNotification(title, body, tag) {
  if (!canNotify()) return;
  const opts = { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch (_) {}
  try { new Notification(title, opts); } catch (_) {}
}

function scheduleReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  if (settings.remind === false || !canNotify()) return;
  for (const t of todos) {
    if (t.done || !t.dueAt || t.notified) continue;
    const delay = t.dueAt - now();
    if (delay > 0 && delay < DAY) {
      reminderTimers.push(setTimeout(async () => {
        if (t.done) return;
        t.notified = true;
        await dbPut("todos", t);
        showNotification("To-do", t.text, t.id);
        buzz(20);
        updateBadges();
      }, delay));
    }
  }
}

/* anything that came due while the app was closed */
async function catchUpReminders() {
  if (settings.remind === false || !canNotify()) return;
  const missed = todos.filter((t) => !t.done && t.dueAt && !t.notified && t.dueAt <= now());
  for (const t of missed.slice(0, 3)) {
    t.notified = true;
    await dbPut("todos", t);
    showNotification("Overdue to-do", t.text, t.id);
  }
  if (missed.length > 3) showNotification("Khayal", `${missed.length} to-dos are overdue`, "overdue-bulk");
}

$("notifBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) { toast("Notifications aren't supported here"); return; }
  const res = await Notification.requestPermission();
  renderNotifState();
  if (res === "granted") {
    settings.remind = true;
    saveSettings();
    $("remindToggle").checked = true;
    scheduleReminders();
    showNotification("Notifications on", "You'll be reminded about your to-dos.", "welcome");
    toast("Notifications on");
  } else {
    toast("Permission denied");
  }
});
$("remindToggle").addEventListener("change", (e) => {
  settings.remind = e.target.checked;
  saveSettings();
  scheduleReminders();
});

function renderNotifState() {
  const note = $("notifNote"), btn = $("notifBtn");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!("Notification" in window)) {
    note.innerHTML = isIOS && !standalone
      ? "On iPhone, notifications only work once Khayal is installed to your Home Screen. Add it via Safari's <b>Share → Add to Home Screen</b>, then come back here."
      : "This browser doesn't support notifications.";
    btn.hidden = true;
    return;
  }
  if (Notification.permission === "granted") {
    note.innerHTML = "Notifications are <b>on</b>. Khayal alerts you when a to-do is due while it's open or in the background. For an alarm that fires even when Khayal is fully closed, use <b>Add to phone calendar</b> on any to-do.";
    btn.hidden = true;
  } else if (Notification.permission === "denied") {
    note.innerHTML = "Notifications are blocked. Turn them back on in your phone's <b>Settings → Notifications → Khayal</b>.";
    btn.hidden = true;
  } else {
    note.textContent = "Get a nudge when a to-do is due.";
    btn.hidden = false;
  }
}

/* ================= search ================= */
function searchTokens() { return searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean); }
function matchesSearch(t, tokens) {
  const hay = (t.text + " " + (t.title || "")).toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function highlightHTML(raw, tokens) {
  if (!tokens.length) return esc(raw);
  const re = new RegExp("(" + tokens.map(escapeRegex).join("|") + ")", "gi");
  let out = "", last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out += esc(raw.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
    last = m.index + m[0].length;
  }
  return out + esc(raw.slice(last));
}
$("searchBox").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  $("searchClear").hidden = !searchQuery;
  renderList();
});
$("searchClear").addEventListener("click", () => {
  searchQuery = ""; $("searchBox").value = ""; $("searchClear").hidden = true;
  renderList(); $("searchBox").focus();
});

/* ================= khayals list ================= */
document.querySelectorAll(".filter-chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    currentFilter = c.dataset.filter;
    buzz(8);
    renderList();
  })
);

function splitPreview(text) {
  const clean = text.trim();
  const m = clean.match(/^[\s\S]{0,110}?[.!?…](\s|$)|^[^\n]{0,110}(\n|$)/);
  let title = m ? m[0].trim() : clean.slice(0, 110);
  if (!title) title = clean.slice(0, 110);
  const rest = clean.slice(title.length).trim().replace(/\s+/g, " ");
  return { title, rest };
}
function dayGroup(ts) {
  const d = new Date(ts), t = new Date();
  const days = Math.round((startOfDay(t) - startOfDay(d)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  if (d.getFullYear() === t.getFullYear()) return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
function thoughtCardHTML(t, tokens = []) {
  const title = t.title || generateTitle(t.text);
  const rest = previewFor({ ...t, title });
  return `<div class="thought-card tier-${t.tier}${isFading(t) ? " fading" : ""}" data-id="${t.id}">
    <div class="thought-title">${highlightHTML(title, tokens)}</div>
    ${rest ? `<div class="thought-preview">${highlightHTML(rest, tokens)}</div>` : ""}
    <div class="thought-meta">${tierBadge(t)}<span>${clockTime(t.createdAt)}</span>${isFading(t) ? '<span class="fade-tag">fading</span>' : ""}</div>
  </div>`;
}

function renderList() {
  const list = $("thoughtList");
  const tokens = searchTokens();
  let items = [...thoughts].sort((a, b) => b.createdAt - a.createdAt);
  if (currentFilter === "core") items = items.filter((t) => t.tier === 2);
  if (currentFilter === "high") items = items.filter((t) => t.tier === 1);
  if (currentFilter === "fading") items = items.filter(isFading);
  if (tokens.length) items = items.filter((t) => matchesSearch(t, tokens));

  const core = thoughts.filter((t) => t.tier === 2).length;
  const high = thoughts.filter((t) => t.tier === 1).length;
  $("thoughtsStat").textContent = tokens.length
    ? `${items.length} result${items.length === 1 ? "" : "s"} for "${searchQuery.trim()}"`
    : thoughts.length ? `${thoughts.length} khayals · ${core} core · ${high} high` : "";

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><span class="big">${tokens.length ? "🔍" : "✦"}</span>${
      tokens.length ? "Nothing matches those words.<br>Try fewer or different ones."
      : thoughts.length ? "Nothing here yet." : "No khayals yet.<br>Go catch your first one."}</div>`;
    return;
  }
  let html = "", lastGroup = null;
  for (const t of items) {
    const g = dayGroup(t.createdAt);
    if (g !== lastGroup) { html += `<div class="day-head"><span>${g}</span></div>`; lastGroup = g; }
    html += thoughtCardHTML(t, tokens);
  }
  list.innerHTML = html;
  if (settings.motion !== false) {
    list.querySelectorAll(".thought-card").forEach((el, i) => {
      el.style.animationDelay = Math.min(i * 0.03, 0.35) + "s";
    });
  }
  list.querySelectorAll(".thought-card").forEach((el) =>
    el.addEventListener("click", () => openDetail(el.dataset.id)));
}

/* ================= calendar & heatmap ================= */
const HEAT_WEEKS = 27;
function dayCounts() {
  const map = new Map();
  for (const t of thoughts) {
    const k = dayKey(t.createdAt);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}
function heatLevel(n) {
  if (!n) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}
function streaks(counts) {
  if (!counts.size) return { current: 0, longest: 0 };
  const today = startOfDay(new Date());
  let cursor = counts.has(keyOf(today)) ? today : addDays(today, -1);
  let current = 0;
  while (counts.has(keyOf(cursor))) { current++; cursor = addDays(cursor, -1); }
  const keys = [...counts.keys()].sort();
  let longest = 0, run = 0, prev = null;
  for (const k of keys) {
    const [y, m, d] = k.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    run = prev && keyOf(addDays(prev, 1)) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  return { current, longest };
}

let calMonth = null, selectedDay = null;
function renderCalendar() {
  const counts = dayCounts();
  if (!calMonth) calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  if (!selectedDay) selectedDay = keyOf(startOfDay(new Date()));
  renderStats(counts);
  renderHeatmap(counts);
  renderMonth(counts);
  renderDayPanel();
}
function renderStats(counts) {
  const { current, longest } = streaks(counts);
  const nowD = new Date();
  const thisMonth = thoughts.filter((t) => {
    const d = new Date(t.createdAt);
    return d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth();
  }).length;
  const tiles = [
    { n: thoughts.length, label: "khayals" },
    { n: current, label: "day streak", accent: current > 0 },
    { n: longest, label: "best streak" },
    { n: thisMonth, label: "this month" },
  ];
  $("statGrid").innerHTML = tiles.map((t) =>
    `<div class="stat-tile${t.accent ? " hot" : ""}"><b data-to="${t.n}">0</b><span>${t.label}</span></div>`).join("");
  $("statGrid").querySelectorAll("b").forEach((el) => countUp(el, Number(el.dataset.to)));
}
function renderHeatmap(counts) {
  const today = startOfDay(new Date());
  const end = addDays(today, 6 - today.getDay());
  const start = addDays(end, -(HEAT_WEEKS * 7 - 1));
  let cells = "", months = "", lastMonth = -1;
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const colStart = addDays(start, w * 7);
    const m = colStart.getMonth();
    const showLabel = m !== lastMonth && colStart.getDate() <= 7;
    months += `<span class="heat-month">${showLabel ? colStart.toLocaleDateString(undefined, { month: "short" }) : ""}</span>`;
    if (showLabel) lastMonth = m;
    let col = "";
    for (let d = 0; d < 7; d++) {
      const date = addDays(colStart, d);
      if (date > today) { col += `<i class="heat-cell empty"></i>`; continue; }
      const k = keyOf(date);
      const n = counts.get(k) || 0;
      const label = `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} — ${n} khayal${n === 1 ? "" : "s"}`;
      col += `<i class="heat-cell lv${heatLevel(n)}${k === selectedDay ? " sel" : ""}" data-day="${k}" title="${label}" style="animation-delay:${Math.min(w * 0.012, 0.32)}s"></i>`;
    }
    cells += `<div class="heat-col">${col}</div>`;
  }
  $("heatScroll").innerHTML = `<div class="heat-inner"><div class="heat-months">${months}</div><div class="heat-grid">${cells}</div></div>`;
  $("heatScroll").querySelectorAll(".heat-cell[data-day]").forEach((el) =>
    el.addEventListener("click", () => selectDay(el.dataset.day)));
  $("heatScroll").scrollLeft = $("heatScroll").scrollWidth;
}
function renderMonth(counts) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $("monthLabel").textContent = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const sample = new Date(2024, 0, 7);
  $("weekdayRow").innerHTML = Array.from({ length: 7 }, (_, i) =>
    `<span>${addDays(sample, i).toLocaleDateString(undefined, { weekday: "narrow" })}</span>`).join("");
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = keyOf(startOfDay(new Date()));
  let html = "";
  for (let i = 0; i < first.getDay(); i++) html += `<span class="mday blank"></span>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    const k = keyOf(date);
    const n = counts.get(k) || 0;
    const cls = ["mday", "lv" + heatLevel(n), k === selectedDay ? "sel" : "",
      k === todayKey ? "today" : "", date > new Date() ? "future" : ""].filter(Boolean).join(" ");
    html += `<button class="${cls}" data-day="${k}"><span>${d}</span>${n ? `<i class="mdot"></i>` : ""}</button>`;
  }
  $("monthGrid").innerHTML = html;
  $("monthGrid").querySelectorAll(".mday[data-day]").forEach((el) =>
    el.addEventListener("click", () => selectDay(el.dataset.day)));
  $("nextMonth").disabled = new Date(y, m + 1, 1) > new Date();
}
function selectDay(k) {
  selectedDay = k;
  const [y, m] = k.split("-").map(Number);
  calMonth = new Date(y, m - 1, 1);
  buzz(8);
  renderCalendar();
}
function renderDayPanel() {
  const [y, m, d] = selectedDay.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const items = thoughts.filter((t) => dayKey(t.createdAt) === selectedDay)
    .sort((a, b) => a.createdAt - b.createdAt);
  const today = startOfDay(new Date());
  const days = Math.round((today - startOfDay(date)) / DAY);
  const full = date.toLocaleDateString(undefined, {
    day: "numeric", month: "long",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
  const heading = days >= 0 && days < 7 ? `${dayGroup(date.getTime())} · ${full}` : full;
  const body = items.length ? items.map((t) => thoughtCardHTML(t)).join("")
    : `<div class="empty-state small"><span class="big">·</span>Nothing on this day.</div>`;
  $("dayPanel").innerHTML = `<div class="day-head"><span>${esc(heading)}</span></div><div class="thought-list">${body}</div>`;
  $("dayPanel").querySelectorAll(".thought-card").forEach((el) =>
    el.addEventListener("click", () => openDetail(el.dataset.id)));
}
$("prevMonth").addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  buzz(8); renderCalendar();
});
$("nextMonth").addEventListener("click", () => {
  const next = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  if (next > new Date()) return;
  calMonth = next; buzz(8); renderCalendar();
});

function refreshThoughts() {
  const cal = settings.view === "calendar";
  document.querySelectorAll(".view-chip").forEach((x) =>
    x.classList.toggle("active", (x.dataset.view === "calendar") === cal));
  $("listView").hidden = cal;
  $("calendarView").hidden = !cal;
  if (cal) renderCalendar(); else renderList();
  moveAllThumbs();
}
document.querySelectorAll(".view-chip").forEach((c) =>
  c.addEventListener("click", () => {
    settings.view = c.dataset.view;
    saveSettings();
    buzz(8);
    refreshThoughts();
  })
);

/* ================= khayal detail sheet ================= */
function openDetail(id) {
  const t = thoughts.find((x) => x.id === id);
  if (!t) return;
  detailId = id;
  detailTier = t.tier;
  $("detailTitle").value = t.title || generateTitle(t.text);
  $("detailText").value = t.text;
  $("detailMeta").textContent = `Created ${relTime(t.createdAt)} · reviewed ${t.reviewCount || 0}×`;
  updateTierChips();
  $("sheetBackdrop").hidden = false;
}
function updateTierChips() {
  document.querySelectorAll(".tier-chip").forEach((c) =>
    c.classList.toggle("active", Number(c.dataset.tier) === detailTier));
}
document.querySelectorAll(".tier-chip").forEach((c) =>
  c.addEventListener("click", () => { detailTier = Number(c.dataset.tier); buzz(8); updateTierChips(); }));
$("detailClose").addEventListener("click", closeDetail);
$("sheetBackdrop").addEventListener("click", (e) => { if (e.target === $("sheetBackdrop")) closeDetail(); });
function closeDetail() { $("sheetBackdrop").hidden = true; detailId = null; }

$("detailPolish").addEventListener("click", () => {
  const ta = $("detailText");
  const before = ta.value, after = polish(before);
  if (after === before) { toast("Already clean"); return; }
  ta.value = after; buzz(10);
  toast("✨ Polished — tap to undo", () => { ta.value = before; toast("Undone"); });
});
$("detailCopy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("detailText").value); toast("Copied"); }
  catch { toast("Couldn't copy"); }
});
/* regenerate on demand, and hand the title back to the generator if it's cleared */
$("retitleBtn").addEventListener("click", () => {
  const fresh = generateTitle($("detailText").value);
  $("detailTitle").value = fresh;
  buzz(10);
  toast(fresh ? "Title regenerated" : "Nothing to title");
});

$("detailSave").addEventListener("click", async () => {
  const t = thoughts.find((x) => x.id === detailId);
  if (!t) return;
  const newText = $("detailText").value.trim();
  if (!newText) { toast("Khayal can't be empty"); return; }
  const typedTitle = $("detailTitle").value.trim();
  const autoForOld = generateTitle(t.text);

  if (!typedTitle) {
    // cleared the field — go back to an automatic title
    t.title = generateTitle(newText);
    t.titleEdited = false;
  } else if (typedTitle !== (t.title || autoForOld)) {
    t.title = typedTitle;           // they wrote their own
    t.titleEdited = true;
  } else if (!t.titleEdited && newText !== t.text) {
    t.title = generateTitle(newText); // auto title follows the edited text
  }

  t.text = newText; t.tier = detailTier; t.updatedAt = now();
  await dbPut("thoughts", t);
  closeDetail(); refreshThoughts(); toast("Updated");
});
$("detailPurge").addEventListener("click", async () => {
  const t = thoughts.find((x) => x.id === detailId);
  if (!t) return;
  if (t.tier === 2 && !confirm("This is a Core khayal. Purge it anyway?")) return;
  await purgeThought(t);
  closeDetail(); refreshThoughts();
});
async function purgeThought(t) {
  thoughts = thoughts.filter((x) => x.id !== t.id);
  await dbDelete("thoughts", t.id);
  const item = { ...t, purgedAt: now() };
  trash.push(item);
  await dbPut("trash", item);
  updateBadges();
  toast("Purged — in trash for 30 days");
}

/* ================= review ================= */
function startReview() {
  reviewQueue = thoughts.filter(isDue).sort((a, b) => {
    const fa = isFading(a) ? 0 : 1, fb = isFading(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return touchTime(a) - touchTime(b);
  });
  reviewIndex = 0;
  const fadingCount = thoughts.filter(isFading).length;
  const banner = $("fadingBanner");
  if (fadingCount > 0) {
    banner.hidden = false;
    banner.innerHTML = `<b>${fadingCount}</b> khayal${fadingCount > 1 ? "s are" : " is"} fading — untouched for ${FADE_DAYS}+ days. They come first: keep them or let them go.`;
  } else banner.hidden = true;
  renderReviewCard();
}
function renderReviewCard() {
  const area = $("reviewArea");
  updateBadges();
  if (reviewIndex >= reviewQueue.length) {
    area.innerHTML = `<div class="empty-state"><span class="big">🌙</span>All clear. Your mind is tidy.<br>Come back when khayals pile up.</div>`;
    return;
  }
  const t = reviewQueue[reviewIndex];
  area.innerHTML = `
    <div class="review-progress">${reviewIndex + 1} of ${reviewQueue.length}</div>
    <div class="review-stack">
      <div class="review-card">
        <div class="review-title">${esc(t.title || generateTitle(t.text))}</div>
        <div class="thought-title">${esc(t.text)}</div>
        <div class="thought-meta">${tierBadge(t)}<span>${relTime(t.createdAt)}</span>${isFading(t) ? '<span class="fade-tag">fading</span>' : ""}</div>
      </div>
    </div>
    <div class="review-actions">
      <button class="btn danger" id="rvPurge">Purge</button>
      <button class="btn later" id="rvLater">Later</button>
      <button class="btn keep" id="rvKeep">Keep</button>
      <button class="btn promote" id="rvPromote">${t.tier >= 2 ? "Core ✓" : t.tier === 1 ? "Make Core" : "Make High"}</button>
    </div>`;
  $("rvPurge").addEventListener("click", async () => {
    if (t.tier === 2 && !confirm("This is a Core khayal. Purge it anyway?")) return;
    await purgeThought(t); nextReview();
  });
  $("rvLater").addEventListener("click", async () => {
    t.snoozedUntil = now() + 7 * DAY; await dbPut("thoughts", t); buzz(8); nextReview();
  });
  $("rvKeep").addEventListener("click", async () => {
    t.lastReviewedAt = now(); t.reviewCount = (t.reviewCount || 0) + 1; t.snoozedUntil = null;
    await dbPut("thoughts", t); buzz(10); nextReview();
  });
  $("rvPromote").addEventListener("click", async () => {
    t.tier = Math.min(t.tier + 1, 2);
    t.lastReviewedAt = now(); t.reviewCount = (t.reviewCount || 0) + 1; t.snoozedUntil = null;
    await dbPut("thoughts", t); buzz(14);
    toast(t.tier === 2 ? "Core memory" : "High memory");
    nextReview();
  });
}
function nextReview() { reviewIndex++; renderReviewCard(); }

/* ================= badges ================= */
function updateBadges() {
  const reviewN = thoughts.filter(isDue).length;
  $("reviewDot").hidden = reviewN === 0;
  const pending = todos.some((t) => !t.done && t.dueAt && t.dueAt < startOfDay(new Date()).getTime() + DAY);
  $("todoDot").hidden = !pending;
}

/* ================= settings ================= */
function renderSettings() {
  const core = thoughts.filter((t) => t.tier === 2).length;
  const open = todos.filter((t) => !t.done).length;
  $("statsLine").textContent = `${thoughts.length} khayals · ${core} core · ${open} to-dos open`;
  renderTrash();
  renderInstallHelp();
  renderNotifState();
}
function renderTrash() {
  const list = $("trashList");
  $("emptyTrashBtn").hidden = trash.length === 0;
  if (!trash.length) { list.innerHTML = '<p class="note" style="margin:0">Trash is empty.</p>'; return; }
  list.innerHTML = [...trash].sort((a, b) => b.purgedAt - a.purgedAt).map((t) => {
    const left = Math.max(0, TRASH_DAYS - Math.floor((now() - t.purgedAt) / DAY));
    return `<div class="trash-item"><span class="t-text">${esc(t.text)}</span><span style="color:var(--faint);font-size:0.72rem;font-weight:700">${left}d</span><button data-id="${t.id}">Restore</button></div>`;
  }).join("");
  list.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", async () => {
      const item = trash.find((x) => x.id === b.dataset.id);
      if (!item) return;
      trash = trash.filter((x) => x.id !== item.id);
      await dbDelete("trash", item.id);
      const { purgedAt, ...restored } = item;
      thoughts.push(restored);
      await dbPut("thoughts", restored);
      renderSettings(); updateBadges(); toast("Restored");
    }));
}
$("emptyTrashBtn").addEventListener("click", async () => {
  if (!confirm(`Permanently delete ${trash.length} purged khayal${trash.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
  trash = []; await dbClear("trash"); renderSettings(); toast("Trash emptied");
});

$("autoPolishToggle").addEventListener("change", (e) => {
  settings.autoPolish = e.target.checked; saveSettings();
  toast(e.target.checked ? "Auto-polish on" : "Auto-polish off");
});
$("autoSaveToggle").addEventListener("change", (e) => {
  settings.wakeLock = e.target.checked; saveSettings();
  if (!e.target.checked) releaseWakeLock(); else if (recording) acquireWakeLock();
});
$("motionToggle").addEventListener("change", (e) => {
  settings.motion = e.target.checked; saveSettings();
  document.body.classList.toggle("no-motion", !e.target.checked);
  toast(e.target.checked ? "Animations on" : "Animations off");
});

/* ---- backup ---- */
$("exportBtn").addEventListener("click", () => {
  const data = { app: "khayal", version: 2, exportedAt: new Date().toISOString(), thoughts, trash, todos };
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
    if ((data.app !== "khayal" && data.app !== "sparks") || !Array.isArray(data.thoughts)) throw new Error("bad");
    let added = 0, updated = 0;
    for (const inc of data.thoughts) {
      if (!inc.title) inc.title = generateTitle(inc.text); // older backups
      const ex = thoughts.find((t) => t.id === inc.id);
      if (!ex) { thoughts.push(inc); await dbPut("thoughts", inc); added++; }
      else if ((inc.updatedAt || 0) > (ex.updatedAt || 0)) { Object.assign(ex, inc); await dbPut("thoughts", ex); updated++; }
    }
    for (const inc of data.trash || []) {
      if (!trash.find((t) => t.id === inc.id) && !thoughts.find((t) => t.id === inc.id)) {
        trash.push(inc); await dbPut("trash", inc);
      }
    }
    for (const inc of data.todos || []) {
      const ex = todos.find((t) => t.id === inc.id);
      if (!ex) { todos.push(inc); await dbPut("todos", inc); added++; }
      else if ((inc.updatedAt || 0) > (ex.updatedAt || 0)) { Object.assign(ex, inc); await dbPut("todos", ex); updated++; }
    }
    renderSettings(); updateBadges(); scheduleReminders();
    toast(`Imported: ${added} new, ${updated} updated`);
  } catch { toast("Couldn't read that backup file"); }
});

/* ---- install ---- */
function renderInstallHelp() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const help = $("installHelp");
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (standalone) { help.textContent = "Installed ✓ — you're running Khayal as an app."; $("installBtn").hidden = true; }
  else if (isIOS) help.innerHTML = "On iPhone: tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>.";
  else if (deferredInstallPrompt) { help.textContent = "Install Khayal as a desktop app:"; $("installBtn").hidden = false; }
  else help.innerHTML = "In Chrome or Edge: use the <b>install icon</b> in the address bar, or the menu → <b>Install Khayal</b>.";
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
  settings.onboarded = true; saveSettings(); $("onboard").hidden = true;
  moveAllThumbs();
});

/* ================= lifecycle ================= */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (recording && !wakeLock) acquireWakeLock();
  catchUpReminders();
  scheduleReminders();
  if ($("screen-todos").classList.contains("active")) renderTodos();
  updateBadges();
});

/* every khayal saved before titles existed gets one, once */
async function backfillTitles() {
  const missing = thoughts.filter((t) => !t.title);
  for (const t of missing) {
    t.title = generateTitle(t.text);
    t.titleEdited = false;
    await dbPut("thoughts", t);
  }
}

async function cleanOldTrash() {
  const cutoff = now() - TRASH_DAYS * DAY;
  for (const t of trash.filter((x) => x.purgedAt < cutoff)) await dbDelete("trash", t.id);
  trash = trash.filter((t) => t.purgedAt >= cutoff);
}

/* ================= boot ================= */
(async function boot() {
  db = await openDB();
  thoughts = await dbGetAll("thoughts");
  trash = await dbGetAll("trash");
  todos = await dbGetAll("todos");
  await cleanOldTrash();
  await backfillTitles();

  document.body.classList.toggle("no-motion", settings.motion === false);
  setLang(settings.lang || "en-IN");
  setMode(settings.mode || "khayal");
  $("autoPolishToggle").checked = settings.autoPolish !== false;
  $("autoSaveToggle").checked = settings.wakeLock !== false;
  $("motionToggle").checked = settings.motion !== false;
  $("remindToggle").checked = settings.remind !== false;

  const draft = localStorage.getItem("khayal-draft");
  if (draft) $("transcript").value = draft;
  onTranscriptInput();
  updateTodayStat();
  updateBadges();
  moveAllThumbs();

  if (!settings.onboarded) $("onboard").hidden = false;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  catchUpReminders();
  scheduleReminders();
})();
