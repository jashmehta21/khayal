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

/* ================= smart cleanup (optional, opt-in) =================
   Sends the dictated words to Gemini to be rewritten as clean prose. The key
   lives only in this browser's storage. Everything degrades to the offline
   polish() above if it's off, keyless, slow or failing. */
const SMART_TIMEOUT = 15000;
const DEFAULT_MODEL = "gemini-2.5-flash"; // only a starting guess; discovery replaces it
const BUILD = "v23";                      // shown in Settings so we can confirm what's running

const CLEANUP_PROMPT = `You are a dictation editor. Turn the raw speech below into what the speaker MEANT to write — the way a great human transcriptionist would.

What to do:
- Keep their meaning, facts, opinions and first-person voice exactly. Never add ideas, never answer, never comment, never summarise away detail.
- Delete fillers, stutters and false starts: "um", "uh", "you know", "I mean", "like", "matlab", "yaani", "basically" when it's noise.
- Honour self-correction. Speech doubles back — keep only the final intent. "I need to call Raj, no wait, I need to call Aman" becomes "I need to call Aman." "Let's meet Tuesday, actually Wednesday" becomes "Let's meet Wednesday."
- Collapse restarts and accidental repetition: "I think I think that we should, we should go" becomes "I think that we should go."
- Fix speech-recognition mishearings using context — wrong homophones, mangled names, broken numbers. If something is clearly a proper noun or a brand, spell it sensibly.
- Punctuate properly: full stops, commas, question marks, apostrophes, capitals. Break into paragraphs where the subject changes. Use a bulleted list only if they were plainly listing things.
- Numbers, money, dates and times in their normal written form: "thirty two thousand rupees" becomes "₹32,000", "half past nine" becomes "9:30".
- If Hindi and English are mixed, write the Hindi in English letters (Roman script) as it sounds. Never Devanagari, never translated into English.
- Keep the length close to what they said. Tighten, don't rewrite their style or make it formal.
- If it's already clean, return it essentially unchanged.

Reply with the edited text only: no preamble, no explanation, no quotes, no markdown fences.

Raw speech:
`;

function smartKey() { return localStorage.getItem("khayal-key") || ""; }
function smartModel() { return localStorage.getItem("khayal-model") || ""; }
function smartEnabled() { return settings.smart === true && !!smartKey(); }

/* Which service the key belongs to. OpenAI's request format is spoken by xAI,
   Groq, OpenRouter and most others, so "custom" covers them with a base URL. */
function smartProvider() { return localStorage.getItem("khayal-provider") || "openai"; }
function smartBase() {
  const p = smartProvider();
  if (p === "openai") return "https://api.openai.com/v1";
  if (p === "custom") return (localStorage.getItem("khayal-base") || "").replace(/\/+$/, "");
  return apiBase(); // gemini, version-detected in mind.js
}
const isGemini = () => smartProvider() === "gemini";

/* one chat call, whichever provider is configured */
async function chatComplete(prompt, { temperature = 0.2, timeout = SMART_TIMEOUT } = {}) {
  const key = smartKey();
  if (!key) throw new Error("No API key");
  const model = smartModel();
  if (!model) throw new Error("No model chosen — tap Test");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    let url, headers, body;
    if (isGemini()) {
      url = `${smartBase()}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      headers = { "Content-Type": "application/json" };
      body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, topP: 0.9 } };
    } else {
      url = `${smartBase()}/chat/completions`;
      headers = { "Content-Type": "application/json", Authorization: "Bearer " + key };
      body = { model, messages: [{ role: "user", content: prompt }], temperature };
    }
    const res = await fetch(url, { method: "POST", headers, signal: ctrl.signal, body: JSON.stringify(body) });
    if (!res.ok) {
      let d = ""; try { d = (await res.json()).error?.message || ""; } catch (_) {}
      throw new Error(friendlyApiError(res.status, d));
    }
    const data = await res.json();
    const out = isGemini()
      ? (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim()
      : (data.choices?.[0]?.message?.content || "").trim();
    if (!out) throw new Error("The model returned nothing");
    return out;
  } finally { clearTimeout(timer); }
}

async function smartCleanup(text) {
  return chatComplete(CLEANUP_PROMPT + text);
}

/* A real title, not the first clause: the model reads the whole khayal and
   names what it is actually about. Falls back to the local generator. */
const TITLE_PROMPT = `Give this personal note a short title: what it is actually about, not its first words.

Rules:
- 3 to 7 words. No trailing full stop. No quotes around it.
- Written the way the person would say it, in their own words where possible.
- If the note mixes Hindi and English, keep Hindi words in English letters.
- Capture the point, not the preamble. "Today I wanna basically note down that I need to fix my sleep" is titled "Fixing my sleep", not "Today I wanna basically note down".
- Reply with the title alone.

Note:
`;

async function aiTitle(text) {
  const out = await chatComplete(TITLE_PROMPT + text, { temperature: 0.3, timeout: 12000 });
  return out.replace(/^["'\s]+|["'.\s]+$/g, "").split("\n")[0].slice(0, 70);
}

/* ================= cloud transcription =================
   The phone's own speech engine is quick but mishears and punctuates poorly.
   Recording the audio and sending it to a real speech model is what closes the
   gap to a tool like Wispr Flow. OpenAI-format providers only. */
function sttModel() { return localStorage.getItem("khayal-stt-model") || "whisper-1"; }
function cloudSttReady() {
  return settings.cloudStt === true && !!smartKey() && smartProvider() !== "gemini"
    && !!(navigator.mediaDevices && window.MediaRecorder);
}

const STT_HINT =
  "Casual spoken notes that mix English and Hindi. Write Hindi words in English letters " +
  "(Roman script) the way they sound, never in Devanagari. Keep names and technical words intact.";

async function transcribeAudio(blob) {
  const key = smartKey();
  if (!key) throw new Error("No API key");
  const type = blob.type || "";
  const ext = /mp4|m4a|aac/.test(type) ? "mp4" : /webm/.test(type) ? "webm"
    : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : "mp4";
  const fd = new FormData();
  fd.append("file", blob, "speech." + ext);
  fd.append("model", sttModel());
  fd.append("prompt", STT_HINT);
  fd.append("response_format", "json");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`${smartBase()}/audio/transcriptions`, {
      method: "POST", headers: { Authorization: "Bearer " + key }, signal: ctrl.signal, body: fd,
    });
    if (!res.ok) {
      let d = ""; try { d = (await res.json()).error?.message || ""; } catch (_) {}
      throw new Error(friendlyApiError(res.status, d));
    }
    const data = await res.json();
    const text = (data.text || "").trim();
    if (!text) throw new Error("Nothing was heard");
    return text;
  } finally { clearTimeout(timer); }
}

/* raw audio capture, running alongside the live on-device preview */
let mediaRec = null, audioChunks = [], micStream = null;
async function startAudioCapture() {
  if (!cloudSttReady()) return false;
  try {
    if (micStream && micStream.getTracks().some((t) => t.readyState === "live")) {
      micStream.getTracks().forEach((t) => { t.enabled = true; });   // reuse, no new prompt
    } else {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]
      .find((m) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    mediaRec = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
    audioChunks = [];
    mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) audioChunks.push(e.data); };
    mediaRec.start();
    return true;
  } catch (_) { releaseMic(); return false; }
}
/* Keep the granted stream for the life of the session instead of asking for
   the microphone on every single recording, which is what made the permission
   prompt reappear constantly. Tracks are disabled between takes so the OS
   recording indicator goes out, and fully released when the app is hidden. */
function releaseMic({ keep = true } = {}) {
  mediaRec = null;
  if (!micStream) return;
  if (keep) { micStream.getTracks().forEach((t) => { t.enabled = false; }); return; }
  micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
}
function dropMic() { releaseMic({ keep: false }); }
function stopAudioCapture() {
  return new Promise((resolve) => {
    if (!mediaRec || mediaRec.state === "inactive") { releaseMic(); return resolve(null); }
    const type = mediaRec.mimeType;
    mediaRec.onstop = () => {
      const blob = audioChunks.length ? new Blob(audioChunks, { type }) : null;
      releaseMic();
      resolve(blob);
    };
    try { mediaRec.stop(); } catch (_) { releaseMic(); resolve(null); }
  });
}

function friendlyApiError(status, detail) {
  const d = String(detail || "");
  const google = smartProvider() === "gemini";

  if (/API key not valid|Incorrect API key/i.test(d)) return "That key isn't valid";
  if (/quota|billing|insufficient|credit/i.test(d))
    return google ? "Free-tier limit reached — try again later"
                  : "Out of credit on that account — top it up or check billing";

  if (google) {
    // Workspace/Cloud specifics — these look like a key problem but aren't
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(d))
      return "The Generative Language API is switched off for this key's Google Cloud project. Enable it, or use a key from a personal Gmail account.";
    if (status === 403 && /consumer|blocked|organization|policy|restricted/i.test(d))
      return "Your Google Workspace admin policy is blocking AI Studio. Turn on Google AI Studio in the Admin console, or use a personal Gmail key.";
    if (status === 401 || status === 403)
      return "Key rejected. On a Workspace account this usually means AI Studio is off for your org — a personal Gmail key is the quick fix.";
  } else {
    if (status === 401) return "That key was rejected — check you copied all of it";
    if (status === 403) return "That key isn't allowed to use this. Check the project or region.";
  }

  if (status === 404) return "That model name doesn't exist for your key";
  if (status === 429) return google ? "Free-tier limit reached — try again later" : "Rate limited — wait a moment and retry";
  if (status >= 500) return "The provider's service is having trouble";
  return d ? d.slice(0, 140) : "Request failed (" + status + ")";
}

/* Smart when available, offline polish otherwise. Never throws. */
async function bestCleanup(text) {
  if (!smartEnabled()) return { text: polish(text), smart: false };
  try {
    const cleaned = await smartCleanup(text);
    return { text: cleaned, smart: true };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Smart cleanup timed out" : err.message;
    return { text: polish(text), smart: false, error: msg };
  }
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
/* Review is tunable: how long a new khayal rests, how long before it fades,
   how fast kept ones come back, and whether Core memories return at all. */
const rv = (k, d) => { const v = settings.review && settings.review[k]; return v === undefined ? d : v; };
const graceDays = () => rv("grace", NEW_THOUGHT_GRACE);
const fadeDays = () => rv("fade", FADE_DAYS);
const reviewBatch = () => rv("batch", 20);
const pace = () => rv("pace", 3);          // 1 slow … 5 brisk
const coreResurfaces = () => rv("core", true);

function touchTime(t) { return Math.max(t.updatedAt || 0, t.lastReviewedAt || 0, t.createdAt); }
function isFading(t) { return t.tier === 0 && now() - touchTime(t) > fadeDays() * DAY; }
function isDue(t) {
  if (t.snoozedUntil && t.snoozedUntil > now()) return false;
  if (t.tier === 2 && !coreResurfaces()) return false;
  const speed = 6 / (pace() + 1);                 // pace 5 → 1.0×, pace 1 → 3×
  const mult = (t.tier === 2 ? 2 : 1) * speed;
  if (!t.lastReviewedAt) return now() - t.createdAt > graceDays() * DAY;
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
  if (t.tier === 1) return '<span class="tier-badge t1">BRIGHT</span>';
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
  showLayer(el);
  el.classList.toggle("tappable", !!onTap);
  el.onclick = onTap ? () => { hideLayer(el); clearTimeout(toastTimer); onTap(); } : null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideLayer(el), onTap ? 6500 : 1900);
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

/* Show/hide an overlay. The .open class is added on the next frame so the
   transition has a start state to animate from — and again on a timer, so if
   animation frames never arrive the layer still opens. */
/* Sheets lock the page behind them, so scrolling inside a sheet can never
   scroll the screen underneath. The scroll position is restored on close. */
let lockedScrollY = 0;
let openLayers = 0;
function lockScroll() {
  if (openLayers++ > 0) return;
  lockedScrollY = window.scrollY;
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.classList.add("locked");
}
function unlockScroll() {
  if (openLayers > 0) openLayers--;
  if (openLayers > 0) return;
  document.body.classList.remove("locked");
  document.body.style.top = "";
  window.scrollTo(0, lockedScrollY);
}

function showLayer(el, { lock = false } = {}) {
  if (!el) return;
  if (lock && el.hidden) lockScroll();
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("open"));
  clearTimeout(el._openTimer);
  el._openTimer = setTimeout(() => el.classList.add("open"), 60);
}
function hideLayer(el, { lock = false } = {}) {
  if (!el) return;
  if (lock && !el.hidden) unlockScroll();
  clearTimeout(el._openTimer);
  el.classList.remove("open");
  el.hidden = true;
}

/* Stagger a freshly rendered list, with a guarantee that it becomes visible
   whether or not the animation ever runs. setTimeout keeps working when
   animation frames don't, so this can't leave content hidden. */
function staggerIn(container, selector, step = 35, cap = 400) {
  if (!container) return;
  const els = [...container.querySelectorAll(selector)];
  if (!els.length) return;
  if (settings.motion === false) { els.forEach((el) => el.classList.add("entered")); return; }
  els.forEach((el, i) => { el.style.animationDelay = Math.min(i * step, cap) + "ms"; });
  clearTimeout(container._settleTimer);
  container._settleTimer = setTimeout(
    () => els.forEach((el) => el.classList.add("entered")),
    cap + 700
  );
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
  if (name !== "thoughts") MapView.stop(); // never animate off-screen
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

/* No language picker any more. The device engine uses en-IN, which copes with
   English and Hinglish, and cloud transcription detects the language itself. */
function setLang(lang) {
  settings.lang = lang || "en-IN";
  saveSettings();
}

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
    dictationBase = $("transcript").value;   // so cloud text replaces only what was dictated
    buzz(12);
    acquireWakeLock();
    startAudioCapture();                     // records in parallel with the live preview
    updateMicUI();
  } catch (_) { $("micHint").textContent = "Couldn't start the mic — try again"; }
}
let dictationBase = "";

function stopRecording({ cleanup = false } = {}) {
  const wasCloud = cloudSttReady() && !!mediaRec;
  recording = false;
  clearTimeout(restartTimer);
  if (recog) { try { recog.stop(); } catch (_) {} }
  $("interim").textContent = "";
  releaseWakeLock();
  updateMicUI();

  if (wasCloud) { finishCloudDictation(cleanup); return; }
  releaseMic();
  // finishing a dictation is exactly when the rewrite should happen
  if (cleanup && smartEnabled() && $("transcript").value.trim()) {
    setTimeout(() => runCleanup({ silent: true }), 250); // let the last result land
  }
}

/* Swap the rough on-device preview for the accurate transcription, then clean
   it up. Any failure quietly keeps whatever the phone already heard. */
async function finishCloudDictation(cleanup) {
  const ta = $("transcript");
  setWorking(true, "Transcribing what you said…");
  try {
    const blob = await stopAudioCapture();
    if (!blob || blob.size < 1200) throw new Error("Nothing recorded");
    let text = transliterate(await transcribeAudio(blob));
    if (cleanup && smartEnabled()) {
      $("workingNote").textContent = "Tidying up your words…";
      try { text = await smartCleanup(text); } catch (_) { text = polish(text); }
    } else {
      text = polish(text);
    }
    const base = dictationBase.trim();
    ta.value = (base ? base + "\n\n" : "") + text;
    onTranscriptInput();
    buzz(12);
  } catch (err) {
    releaseMic();
    const msg = err.name === "AbortError" ? "Transcription timed out" : err.message;
    // the device transcript is already in the box, so nothing is lost
    if (cleanup && smartEnabled() && ta.value.trim()) { await runCleanup({ silent: true }); }
    toast(msg + " — kept what your phone heard");
  } finally {
    setWorking(false);
  }
}
function updateMicUI() {
  const btn = $("micBtn");
  btn.classList.toggle("recording", recording);
  btn.setAttribute("aria-label", recording ? "Stop recording" : "Start recording");
  $("wave").hidden = !recording;
  $("micHint").textContent = recording ? "Listening… speak freely" : "Tap to speak";
}
$("micBtn").addEventListener("click", () =>
  recording ? stopRecording({ cleanup: true }) : startRecording());

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
let cleaning = false;

/* an unmistakable busy state, so a khayal isn't saved mid-rewrite */
function setWorking(on, label) {
  cleaning = on;
  const card = document.querySelector(".compose-card");
  if (card) card.classList.toggle("working", on);
  $("workingBox").hidden = !on;
  if (label) $("workingNote").textContent = label;
  $("polishBtn").disabled = on;
  $("saveBtn").disabled = on;
  $("saveBtn").style.opacity = on ? "0.5" : "";
  $("transcript").readOnly = on;
  if (!on && !recording) $("micHint").textContent = "Tap to speak";
}

async function runCleanup({ silent = false } = {}) {
  const ta = $("transcript");
  const before = ta.value.trim();
  if (!before || cleaning) return;

  const smart = smartEnabled();
  if (smart) setWorking(true, "Polishing your words…");

  const { text: after, smart: usedSmart, error } = await bestCleanup(before);

  if (smart) setWorking(false);

  if (after === before) {
    if (!silent) toast(error ? error : "Already clean");
    return;
  }
  prePolish = before;
  ta.value = after;
  onTranscriptInput();
  buzz(10);
  toast(
    error ? error + " — used offline polish" : usedSmart ? "✨ Cleaned up — tap to undo" : "✨ Polished — tap to undo",
    () => { ta.value = prePolish; prePolish = null; onTranscriptInput(); toast("Undone"); }
  );
}
$("polishBtn").addEventListener("click", () => runCleanup());

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
    // in the background: a proper title, then a meaning vector for the map
    if (smartEnabled()) {
      aiTitle(t.text).then(async (title) => {
        if (!title || t.titleEdited) return;
        t.title = title;
        await dbPut("thoughts", t);
        if ($("screen-thoughts").classList.contains("active")) refreshThoughts();
      }).catch(() => {});
    }
    if (smartKey()) {
      embedOne((t.title ? t.title + ". " : "") + t.text)
        .then(async (vec) => { t.vec = vec; t.vecModel = embedModel(); await dbPut("thoughts", t); })
        .catch(() => {});
    }
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

/* adding lives in Capture, so there is one place to create things */
$("goCapture").addEventListener("click", () => {
  buzz(8);
  showScreen("capture");
  setMode("todo");
  setTimeout(() => $("transcript").focus(), 250);
});

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
  return `<div class="todo-row" data-id="${t.id}">
  <div class="swipe-back"><span>${t.done ? "Undo" : "Done"}</span><span>Delete</span></div>
  <div class="todo-item${t.done ? " done" : ""}${due && due.cls === "past" ? " overdue" : ""}" data-id="${t.id}">
    <button class="tcheck" aria-label="${t.done ? "Mark as not done" : "Mark as done"}" role="checkbox" aria-checked="${t.done}">
      <svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5"/></svg>
    </button>
    <div class="tbody">
      <span class="ttext">${esc(t.text)}</span>
      ${due || t.dueAt ? `<div class="tmeta">${due ? `<span class="tdue ${due.cls}">${esc(due.text)}</span>` : ""}${t.dueAt && !t.done ? '<span class="tbell">🔔</span>' : ""}</div>` : ""}
    </div>
  </div></div>`;
}

/* Trailing swipe deletes, leading swipe completes — the iOS convention.
   The row tracks your finger with resistance past the action point, the label
   behind it names what will happen, and a tick of haptic fires the moment you
   cross the threshold, so you always know where you are. Tapping still opens
   the sheet, so nothing here is gesture-only. */
const SWIPE_ACTION = 78;   // travel at which the action arms
function bindSwipe(row) {
  const card = row.querySelector(".todo-item");
  const back = row.querySelector(".swipe-back");
  const leftLabel = back.children[0], rightLabel = back.children[1];
  let x0 = 0, y0 = 0, dx = 0, id = null, axis = null, armed = 0;

  const paint = () => {
    // resistance: the row keeps moving but gives less the further you pull
    const eased = Math.sign(dx) * Math.min(Math.abs(dx), SWIPE_ACTION + Math.pow(Math.max(0, Math.abs(dx) - SWIPE_ACTION), 0.62) * 3);
    card.style.transform = `translateX(${eased}px)`;
    const live = Math.abs(dx) >= SWIPE_ACTION;
    const dir = dx > 0 ? 1 : -1;
    row.classList.toggle("armed", live);
    back.style.opacity = String(Math.min(1, Math.abs(dx) / 46));
    leftLabel.style.opacity = dir > 0 ? "1" : "0.25";
    rightLabel.style.opacity = dir < 0 ? "1" : "0.25";
    if (live && armed !== dir) { buzz(9); armed = dir; }
    else if (!live && armed) armed = 0;
  };
  const settle = () => {
    row.classList.remove("swiping", "armed");
    card.style.transform = "";
    back.style.opacity = "";
    armed = 0;
  };

  row.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { id = null; return; }
    const t = e.touches[0];
    id = t.identifier; x0 = t.clientX; y0 = t.clientY; dx = 0; axis = null;
  }, { passive: true });

  row.addEventListener("touchmove", (e) => {
    if (id === null) return;
    const t = [...e.touches].find((x) => x.identifier === id);
    if (!t) return;
    const mx = t.clientX - x0, my = t.clientY - y0;
    if (!axis && Math.abs(mx) + Math.abs(my) > 8) {
      axis = Math.abs(mx) > Math.abs(my) * 1.15 ? "x" : "y";
      if (axis === "x") row.classList.add("swiping");
    }
    if (axis !== "x") return;
    dx = mx;
    paint();
  }, { passive: true });

  row.addEventListener("touchend", async () => {
    if (id === null) return;
    const travelled = axis === "x" ? dx : 0;
    id = null; axis = null;
    const t = todos.find((x) => x.id === row.dataset.id);

    if (!t || Math.abs(travelled) < SWIPE_ACTION) { settle(); return; }

    if (travelled <= -SWIPE_ACTION) {
      // let it fly out before the list reflows
      card.style.transform = "translateX(-115%)";
      row.style.opacity = "0.2";
      buzz(18);
      const backup = { ...t };
      await deleteTodo(t);
      setTimeout(() => {
        renderTodos();
        toast("Deleted — tap to undo", async () => {
          todos.push(backup); await dbPut("todos", backup);
          renderTodos(); updateBadges(); scheduleReminders(); toast("Restored");
        });
      }, 190);
    } else {
      settle();
      const nowDone = await toggleTodo(t);
      card.closest(".todo-row").querySelector(".todo-item").classList.toggle("done", nowDone);
      setTimeout(renderTodos, 420);   // let the tick draw before regrouping
    }
  }, { passive: true });

  row.addEventListener("touchcancel", () => { id = null; axis = null; settle(); }, { passive: true });
}

function renderTodos() {
  const open = todos.filter((t) => !t.done).length;
  $("todoStat").textContent = todos.length
    ? open ? `${open} to do · ${todos.length - open} done` : "All clear — nothing pending"
    : "Nothing yet";
  updateBadges();
  renderTodoProgress();

  const sections = todoSections();
  const list = $("todoList");
  if (!sections.length) {
    list.innerHTML = `<div class="empty-state"><span class="big">✓</span>No to-dos yet.<br>Add one above, or dictate it from Capture.</div>`;
    return;
  }
  const doneTotal = todos.filter((t) => t.done).length;
  list.innerHTML = sections.map((s) =>
    `<div class="todo-section">
      <div class="section-head">
        <span class="micro-label">${s.label}</span><span class="rule"></span>
        ${s.key === "done" && doneTotal
          ? `<button class="chip tiny-chip" id="clearDoneInline">Clear ${doneTotal}</button>`
          : `<span class="count">${s.items.length}</span>`}
      </div>
      ${s.items.map(todoItemHTML).join("")}
    </div>`).join("");
  const inlineClear = document.getElementById("clearDoneInline");
  if (inlineClear) inlineClear.addEventListener("click", clearCompleted);

  staggerIn(list, ".todo-item");
  list.querySelectorAll(".todo-row").forEach(bindSwipe);

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

/* sits inside the Done section now, where the number it quotes is visible */
async function clearCompleted() {
  const doneOnes = todos.filter((t) => t.done);
  if (!doneOnes.length) return;
  if (!confirm(`Remove ${doneOnes.length} completed to-do${doneOnes.length > 1 ? "s" : ""} for good?`)) return;
  for (const t of doneOnes) await dbDelete("todos", t.id);
  todos = todos.filter((t) => !t.done);
  buzz(14);
  renderTodos();
  updateBadges();
  toast("Cleared");
}

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
  showLayer($("todoSheetBackdrop"), { lock: true });
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
function closeTodoSheet() { hideLayer($("todoSheetBackdrop"), { lock: true }); todoId = null; }
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
/* Meaning-based search: literal matches show instantly, then khayals that mean
   the same thing are folded in once the query has been embedded. */
let semanticHits = new Map();   // id -> score, for the current query
let semanticFor = "";
let searchTimer = null;

async function runSemanticSearch(q) {
  if (!smartKey() || !thoughts.some((t) => t.vec) || q.trim().length < 3) return;
  try {
    const qv = await embedOne(q);
    const hits = new Map();
    for (const t of thoughts) {
      if (!t.vec) continue;
      const s = cosine(qv, t.vec);
      if (s >= 0.45) hits.set(t.id, s);
    }
    if (searchQuery.trim() !== q.trim()) return; // the query moved on
    semanticHits = hits;
    semanticFor = q.trim();
    renderList();
  } catch (_) {}
}

$("searchBox").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  $("searchClear").hidden = !searchQuery;
  if (!searchQuery.trim()) { semanticHits = new Map(); semanticFor = ""; }
  renderList();
  clearTimeout(searchTimer);
  const q = searchQuery;
  searchTimer = setTimeout(() => runSemanticSearch(q), 450);
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
  if (selectedDay) items = items.filter((t) => dayKey(t.createdAt) === selectedDay);
  if (tokens.length) {
    const usable = semanticFor === searchQuery.trim() ? semanticHits : new Map();
    items = items.filter((t) => matchesSearch(t, tokens) || usable.has(t.id));
    // literal matches first, then by how closely the meaning matches
    items.sort((a, b) => {
      const la = matchesSearch(a, tokens) ? 1 : 0, lb = matchesSearch(b, tokens) ? 1 : 0;
      if (la !== lb) return lb - la;
      return (usable.get(b.id) || 0) - (usable.get(a.id) || 0) || b.createdAt - a.createdAt;
    });
  }

  const core = thoughts.filter((t) => t.tier === 2).length;
  const high = thoughts.filter((t) => t.tier === 1).length;
  $("thoughtsStat").textContent = tokens.length
    ? `${items.length} result${items.length === 1 ? "" : "s"} for "${searchQuery.trim()}"`
    : selectedDay
    ? `${items.length} on this day`
    : thoughts.length ? `${thoughts.length} khayals · ${core} core · ${high} bright` : "";

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><span class="big">${tokens.length ? "🔍" : "✦"}</span>${
      tokens.length ? "Nothing matches those words.<br>Try fewer or different ones."
      : selectedDay ? "Nothing on this day.<br>Tap the date again to see everything."
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
  staggerIn(list, ".thought-card", 30, 350);
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

let calMonth = null;     // month shown in the expandable grid
let selectedDay = null;  // 'YYYY-MM-DD', or null for "everything"
let weekStart = null;    // Sunday of the visible week

const startOfWeek = (d) => addDays(startOfDay(d), -startOfDay(d).getDay());

function ensureDateState() {
  if (!weekStart) weekStart = startOfWeek(new Date());
  if (!calMonth) calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

/* the compact week strip that sits above the memories */
function renderDateBar() {
  ensureDateState();
  const counts = dayCounts();
  const today = startOfDay(new Date());
  const end = addDays(weekStart, 6);
  const monthOpen = !$("monthWrap").hidden;

  $("weekLabel").textContent = monthOpen
    ? calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : weekStart.getMonth() === end.getMonth()
    ? weekStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : weekStart.toLocaleDateString(undefined, { month: "short" }) + " – " +
      end.toLocaleDateString(undefined, { month: "short", year: "numeric" });

  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const k = keyOf(d);
    const n = counts.get(k) || 0;
    const cls = ["wday", n ? "has" : "", k === selectedDay ? "sel" : "",
      k === keyOf(today) ? "today" : "", d > today ? "future" : ""].filter(Boolean).join(" ");
    html += `<button class="${cls}" data-day="${k}" aria-label="${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${n} khayals">
      <span class="dow">${d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
      <span class="num">${d.getDate()}</span><span class="pip"></span></button>`;
  }
  $("weekStrip").innerHTML = html;
  $("weekStrip").querySelectorAll(".wday").forEach((el) =>
    el.addEventListener("click", () => toggleDay(el.dataset.day)));

  // the arrows page whichever calendar is on screen
  $("weekNext").disabled = monthOpen
    ? new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1) > new Date()
    : addDays(weekStart, 7) > today;

  if (monthOpen) renderMonth(counts);
  renderDayChip();
}

function renderDayChip() {
  const chip = $("dayChip");
  if (!selectedDay) { chip.hidden = true; return; }
  const [y, m, d] = selectedDay.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  chip.hidden = false;
  chip.textContent = dayGroup(date.getTime()) + "  ✕";
  chip.onclick = () => toggleDay(selectedDay); // tapping clears it
}

function toggleDay(k) {
  selectedDay = selectedDay === k ? null : k;
  if (selectedDay) {
    const [y, m, d] = selectedDay.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    weekStart = startOfWeek(date);
    calMonth = new Date(y, m - 1, 1);
  }
  buzz(8);
  renderDateBar();
  renderList();
}

$("weekPrev").addEventListener("click", () => {
  ensureDateState();
  if (!$("monthWrap").hidden) calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  else weekStart = addDays(weekStart, -7);
  buzz(8);
  renderDateBar();
});
$("weekNext").addEventListener("click", () => {
  ensureDateState();
  const today = startOfDay(new Date());
  if (!$("monthWrap").hidden) {
    const next = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    if (next > new Date()) return;
    calMonth = next;
  } else {
    if (addDays(weekStart, 7) > today) return;
    weekStart = addDays(weekStart, 7);
  }
  buzz(8);
  renderDateBar();
});
$("monthToggle").addEventListener("click", () => {
  const wrap = $("monthWrap");
  const opening = wrap.hidden;
  wrap.hidden = !opening;
  $("monthToggle").setAttribute("aria-expanded", String(opening));
  buzz(8);
  renderDateBar();
});
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
  staggerIn($("heatScroll"), ".heat-cell", 0, 0);
  // tapping a day in the heatmap jumps straight to that day's memories
  $("heatScroll").querySelectorAll(".heat-cell[data-day]").forEach((el) =>
    el.addEventListener("click", () => {
      selectedDay = el.dataset.day;
      const [y, m, d] = selectedDay.split("-").map(Number);
      weekStart = startOfWeek(new Date(y, m - 1, d));
      calMonth = new Date(y, m - 1, 1);
      settings.view = "list";
      saveSettings();
      buzz(10);
      refreshThoughts();
    }));
  $("heatScroll").scrollLeft = $("heatScroll").scrollWidth;
}
function renderMonth(counts) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
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
    el.addEventListener("click", () => toggleDay(el.dataset.day)));
}

/* ================= insights ================= */
function renderInsights() {
  const counts = dayCounts();
  renderStats(counts);
  renderHeatmap(counts);
  renderTierBreakdown();
  renderRhythm(counts);
}

function renderTierBreakdown() {
  const total = thoughts.length || 1;
  const rows = [
    { name: "Core", n: thoughts.filter((t) => t.tier === 2).length, color: "var(--accent)" },
    { name: "Bright", n: thoughts.filter((t) => t.tier === 1).length, color: "var(--high)" },
    { name: "Regular", n: thoughts.filter((t) => t.tier === 0).length, color: "var(--faint)" },
  ];
  $("tierBreakdown").innerHTML = rows.map((r) =>
    `<div class="tier-row">
      <span class="tier-dot" style="background:${r.color}"></span>
      <span class="name">${r.name}</span>
      <span class="track"><span class="fill" data-w="${Math.round((r.n / total) * 100)}" style="background:${r.color}"></span></span>
      <span class="n">${r.n}</span>
    </div>`).join("");
  // let the bars grow in
  requestAnimationFrame(() => {
    $("tierBreakdown").querySelectorAll(".fill").forEach((el) => { el.style.width = el.dataset.w + "%"; });
  });
  setTimeout(() => {
    $("tierBreakdown").querySelectorAll(".fill").forEach((el) => { el.style.width = el.dataset.w + "%"; });
  }, 60);
}

function renderRhythm(counts) {
  const el = $("rhythm");
  if (!thoughts.length) {
    el.innerHTML = `<p class="note" style="margin:0">Catch a few khayals and your patterns will show up here.</p>`;
    return;
  }
  const sorted = [...thoughts].sort((a, b) => a.createdAt - b.createdAt);
  const first = sorted[0].createdAt;
  const weeks = Math.max(1, Math.ceil((now() - first) / (7 * DAY)));
  const perWeek = (thoughts.length / weeks).toFixed(1);

  let busyKey = null, busyN = 0;
  for (const [k, n] of counts) if (n > busyN) { busyN = n; busyKey = k; }
  const busyDate = busyKey ? new Date(busyKey.split("-").map(Number)[0], busyKey.split("-").map(Number)[1] - 1, busyKey.split("-").map(Number)[2]) : null;

  // which weekday and which part of the day you think most
  const dowCount = Array(7).fill(0);
  const slots = { Morning: 0, Afternoon: 0, Evening: 0, "Late night": 0 };
  for (const t of thoughts) {
    const d = new Date(t.createdAt);
    dowCount[d.getDay()]++;
    const h = d.getHours();
    if (h < 5) slots["Late night"]++;
    else if (h < 12) slots.Morning++;
    else if (h < 17) slots.Afternoon++;
    else if (h < 22) slots.Evening++;
    else slots["Late night"]++;
  }
  const topDow = dowCount.indexOf(Math.max(...dowCount));
  const dowName = addDays(new Date(2024, 0, 7), topDow).toLocaleDateString(undefined, { weekday: "long" });
  const topSlot = Object.entries(slots).sort((a, b) => b[1] - a[1])[0][0];

  const rows = [
    ["Thinking since", new Date(first).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })],
    ["Khayals a week", perWeek],
    ["Busiest day", busyDate ? `${busyDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${busyN}` : "—"],
    ["Most active on", dowName + "s"],
    ["Peak time", topSlot],
    ["Days captured", counts.size],
  ];
  el.innerHTML = rows.map(([k, v]) =>
    `<div class="rhythm-row"><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}</span></div>`).join("");
}

function refreshThoughts() {
  const view = ["list", "map", "insights"].includes(settings.view) ? settings.view : "list";
  document.querySelectorAll(".view-chip").forEach((x) =>
    x.classList.toggle("active", x.dataset.view === view));
  $("listView").hidden = view !== "list";
  $("mapView").hidden = view !== "map";
  $("insightsView").hidden = view !== "insights";
  if (view !== "map") MapView.stop();
  if (view === "insights") renderInsights();
  else if (view === "map") {
    $("mapCta").hidden = !!smartKey();
    // the map keeps itself current: anything new is understood on arrival,
    // behind a loading veil, then the constellation rebuilds itself
    const pending = smartKey() ? thoughts.filter((t) => !t.vec).length : 0;
    if (pending) {
      $("mapLoading").hidden = false;
      $("mapLoadingText").textContent = `Understanding ${pending} khayal${pending > 1 ? "s" : ""}…`;
      MapView.start();
      embedMissing((d, tt) => { $("mapLoadingText").textContent = `Understanding your khayals… ${d}/${tt}`; })
        .then(({ done }) => { $("mapLoading").hidden = true; if (done) MapView.rebuild(); else MapView.updateStatus(); })
        .catch((e) => { $("mapLoading").hidden = true; $("mapStatus").textContent = e.message; });
    } else {
      $("mapLoading").hidden = true;
      MapView.start();
    }
  }
  else { renderDateBar(); renderList(); }
  moveAllThumbs();
}
const VIEW_ORDER = ["list", "map", "insights"];
function gotoView(name) {
  if (!VIEW_ORDER.includes(name)) return;
  settings.view = name;
  saveSettings();
  buzz(8);
  refreshThoughts();
}
document.querySelectorAll(".view-chip").forEach((c) =>
  c.addEventListener("click", () => gotoView(c.dataset.view)));

/* One swipe engine for the whole app. It decides direction once, from the
   first few pixels of travel, then commits — which is what stops the
   half-recognised, glitchy feel. It works right to the screen edges, because
   nothing here fights an iOS system gesture. */
function onHorizontalSwipe(el, handler) {
  let sx = 0, sy = 0, id = null, axis = null;
  const IGNORE = "#mapCanvas, .heat-scroll, .scroll-row, textarea, input, select, .todo-row";

  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || e.target.closest(IGNORE)) { id = null; return; }
    const t = e.touches[0];
    id = t.identifier; sx = t.clientX; sy = t.clientY; axis = null;
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (id === null) return;
    const t = [...e.touches].find((x) => x.identifier === id);
    if (!t) return;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (!axis && Math.abs(dx) + Math.abs(dy) > 10) {
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";   // lock the axis once
    }
  }, { passive: true });

  el.addEventListener("touchend", (e) => {
    if (id === null) return;
    const t = [...e.changedTouches].find((x) => x.identifier === id);
    id = null;
    if (!t || axis !== "x") return;
    const dx = t.clientX - sx;
    if (Math.abs(dx) < 55) return;
    handler(dx < 0 ? 1 : -1);
  }, { passive: true });

  el.addEventListener("touchcancel", () => { id = null; }, { passive: true });
}

/* Khayals: swipe between Memories, Map and Insights */
onHorizontalSwipe($("screen-thoughts"), (dir) => {
  const i = VIEW_ORDER.indexOf(settings.view);
  const next = VIEW_ORDER[(i < 0 ? 0 : i) + dir];
  if (next) gotoView(next);
});

/* Capture: swipe between Khayal and To-do, so the segmented control at the
   top is a shortcut rather than the only way there */
onHorizontalSwipe($("screen-capture"), (dir) => {
  const next = dir > 0 ? "todo" : "khayal";
  if (next !== captureMode) setMode(next);
});

/* ================= khayal detail sheet ================= */
/* Following a connected khayal replaces the sheet's contents rather than
   stacking another one on top, with a Back trail so you can retrace. */
let detailTrail = [];
function openDetail(id, { push = false } = {}) {
  const t = thoughts.find((x) => x.id === id);
  if (!t) return;
  if (push && detailId && detailId !== id) detailTrail.push(detailId);
  else if (!push) detailTrail = [];
  $("detailBack").hidden = detailTrail.length === 0;
  detailId = id;
  detailTier = t.tier;
  $("detailTitle").value = t.title || generateTitle(t.text);
  $("detailText").value = t.text;
  $("detailMeta").textContent = `Created ${relTime(t.createdAt)} · reviewed ${t.reviewCount || 0}×`;
  updateTierChips();
  renderRelated(t);
  showLayer($("sheetBackdrop"), { lock: true });
}

/* the connections, shown where they're actually useful: on the khayal itself */
function renderRelated(t) {
  const wrap = $("relatedWrap"), list = $("relatedList");
  const hits = relatedTo(t, 4);
  if (!hits.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  list.innerHTML = hits.map(({ t: o, s }) =>
    `<button class="related-item" data-id="${o.id}">
      <span class="rel-bar"><i style="width:${Math.round(Math.min(1, s) * 100)}%"></i></span>
      <span class="rel-text">
        <b>${esc(o.title || generateTitle(o.text))}</b>
        <em>${["Regular", "Bright", "Core"][o.tier]} · ${relTime(o.createdAt)}</em>
      </span>
    </button>`).join("");
  list.querySelectorAll(".related-item").forEach((el) =>
    el.addEventListener("click", () => { buzz(8); openDetail(el.dataset.id, { push: true }); }));
}
function updateTierChips() {
  document.querySelectorAll(".tier-chip").forEach((c) =>
    c.classList.toggle("active", Number(c.dataset.tier) === detailTier));
}
document.querySelectorAll(".tier-chip").forEach((c) =>
  c.addEventListener("click", () => { detailTier = Number(c.dataset.tier); buzz(8); updateTierChips(); }));
$("detailClose").addEventListener("click", closeDetail);
$("sheetBackdrop").addEventListener("click", (e) => { if (e.target === $("sheetBackdrop")) closeDetail(); });
function closeDetail() { hideLayer($("sheetBackdrop"), { lock: true }); detailId = null; detailTrail = []; }
$("detailBack").addEventListener("click", () => {
  const prev = detailTrail.pop();
  buzz(8);
  if (prev) { const keep = detailTrail.slice(); openDetail(prev); detailTrail = keep; $("detailBack").hidden = !detailTrail.length; }
  else closeDetail();
});

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
/* regenerate on demand — the model when available, local rules otherwise */
$("retitleBtn").addEventListener("click", async () => {
  const body = $("detailText").value;
  if (!body.trim()) { toast("Nothing to title"); return; }
  buzz(10);
  const btn = $("retitleBtn");
  if (smartEnabled()) {
    btn.textContent = "…"; btn.disabled = true;
    try { $("detailTitle").value = await aiTitle(body); toast("Title regenerated"); }
    catch (e) { $("detailTitle").value = generateTitle(body); toast(e.message + " — used offline title"); }
    finally { btn.textContent = "↻ Regenerate"; btn.disabled = false; }
  } else {
    $("detailTitle").value = generateTitle(body);
    toast("Title regenerated");
  }
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
  reviewQueue = reviewQueue.slice(0, reviewBatch());
  reviewIndex = 0;
  renderReviewSettings();
  const fadingCount = thoughts.filter(isFading).length;
  const banner = $("fadingBanner");
  if (fadingCount > 0) {
    banner.hidden = false;
    banner.innerHTML = `<b>${fadingCount}</b> khayal${fadingCount > 1 ? "s are" : " is"} fading — untouched for ${fadeDays()}+ days. They come first: keep them or let them go.`;
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
      <button class="btn promote" id="rvPromote">${t.tier >= 2 ? "Core ✓" : t.tier === 1 ? "Make Core" : "Make Bright"}</button>
    </div>`;
  staggerIn(area, ".review-card", 0, 0);
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
    toast(t.tier === 2 ? "Core memory" : "Bright memory");
    nextReview();
  });
}
function nextReview() { reviewIndex++; renderReviewCard(); }

/* ---- review controls ---- */
const PACE_WORDS = ["", "Very relaxed", "Relaxed", "Balanced", "Frequent", "Very frequent"];
function renderReviewSettings() {
  const due = thoughts.filter(isDue).length;
  $("reviewExplain").innerHTML =
    `Khayals come back on a widening schedule — a few days, then a week, then longer each time you keep one. ` +
    `Anything you don't touch for <b>${fadeDays()} days</b> is flagged as fading. ` +
    `Right now <b>${due}</b> ${due === 1 ? "is" : "are"} due, shown <b>${reviewBatch()}</b> at a time.`;
  $("valGrace").textContent = graceDays() + (graceDays() === 1 ? " day" : " days");
  $("valFade").textContent = fadeDays() + " days";
  $("valBatch").textContent = reviewBatch();
  $("valPace").textContent = PACE_WORDS[pace()];
  $("coreResurfaceToggle").checked = coreResurfaces();
}
function setReview(k, v) {
  settings.review = { ...(settings.review || {}), [k]: v };
  saveSettings();
  startReview();
  updateBadges();
}
$("reviewSettingsToggle").addEventListener("click", () => {
  const box = $("reviewSettings");
  box.hidden = !box.hidden;
  $("reviewSettingsToggle").textContent = box.hidden ? "Adjust" : "Done";
  buzz(8);
});
document.querySelectorAll(".stepper button").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.k, d = Number(b.dataset.d);
    buzz(6);
    const limits = { grace: [0, 14], fade: [7, 180], batch: [5, 100], pace: [1, 5] };
    const cur = { grace: graceDays(), fade: fadeDays(), batch: reviewBatch(), pace: pace() }[k];
    const [lo, hi] = limits[k];
    setReview(k, Math.max(lo, Math.min(hi, cur + d)));
  })
);
$("coreResurfaceToggle").addEventListener("change", (e) => setReview("core", e.target.checked));

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
  renderSmartState();
  renderSttState();
  renderVersion();
  $("buildLine").textContent = `Khayal · build ${BUILD}`;
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

/* ---- smart cleanup settings ---- */
function setModelOptions(ids, selected) {
  const sel = $("apiModel");
  const list = (ids || []).filter(Boolean);
  if (!list.length) {
    // an empty value, so a placeholder can never be saved as a real model name
    sel.innerHTML = `<option value="">— tap Test to find models —</option>`;
    sel.value = "";
    return;
  }
  sel.innerHTML = [...new Set(list)].map((id) =>
    `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(id)}</option>`).join("");
  sel.value = selected && list.includes(selected) ? selected : list[0];
}

/* Ask the key what it can run, remember the best chat + embedding models. */
async function discoverModels({ quiet = false } = {}) {
  const { chat, embed } = await listModels();
  const best = pickChatModel(chat);
  const bestEmbed = pickEmbedModel(embed);
  if (bestEmbed) localStorage.setItem("khayal-embed-model", bestEmbed);
  const current = smartModel();
  const chosen = chat.includes(current) ? current : best;
  if (chosen) localStorage.setItem("khayal-model", chosen);
  setModelOptions(chat, chosen);
  if (!quiet) {
    $("smartStatus").textContent = `Found ${chat.length} models. Using ${chosen || "none"}${bestEmbed ? " · embeddings: " + bestEmbed : ""}.`;
  }
  return { chat, embed, chosen, bestEmbed };
}

function renderSmartState() {
  const on = settings.smart === true;
  $("smartToggle").checked = on;
  $("smartConfig").hidden = !on;
  $("apiKey").value = smartKey();
  $("apiProvider").value = smartProvider();
  $("baseWrap").hidden = smartProvider() !== "custom";
  $("apiBaseUrl").value = localStorage.getItem("khayal-base") || "";
  $("apiKey").placeholder = smartProvider() === "gemini" ? "Paste your Gemini key" : "sk-…";
  setModelOptions(smartModel() ? [smartModel()] : [], smartModel());
  const s = $("smartStatus");
  if (!on) { s.textContent = ""; return; }
  s.textContent = smartKey()
    ? "Key saved on this device. Tap Test to check it works."
    : "Add a key below to switch this on.";
}

$("apiProvider").addEventListener("change", (e) => {
  localStorage.setItem("khayal-provider", e.target.value);
  // a model from one provider is meaningless to another
  localStorage.removeItem("khayal-model");
  localStorage.removeItem("khayal-embed-model");
  renderSmartState();
  $("smartStatus").textContent = "Paste that provider's key, then tap Test.";
});
$("apiBaseUrl").addEventListener("change", (e) => {
  localStorage.setItem("khayal-base", e.target.value.trim().replace(/\/+$/, ""));
});

$("apiModel").addEventListener("change", (e) => {
  localStorage.setItem("khayal-model", e.target.value);
  $("smartStatus").textContent = "Using " + e.target.value + ".";
});
$("findModelsBtn").addEventListener("click", async () => {
  const k = $("apiKey").value.trim();
  if (!k) { $("smartStatus").textContent = "Paste a key first."; return; }
  localStorage.setItem("khayal-key", k);
  $("smartStatus").textContent = "Asking Google what your key can use…";
  $("findModelsBtn").disabled = true;
  try { await discoverModels(); toast("Models found"); }
  catch (err) { $("smartStatus").textContent = "✕ " + (err.name === "AbortError" ? "Timed out" : err.message); }
  finally { $("findModelsBtn").disabled = false; }
});
$("smartToggle").addEventListener("change", (e) => {
  settings.smart = e.target.checked;
  saveSettings();
  renderSmartState();
  toast(e.target.checked ? "Smart cleanup on" : "Smart cleanup off");
});
$("saveKeyBtn").addEventListener("click", async () => {
  const k = $("apiKey").value.trim();
  if (k) localStorage.setItem("khayal-key", k); else localStorage.removeItem("khayal-key");
  if ($("apiModel").value) localStorage.setItem("khayal-model", $("apiModel").value);
  renderSmartState();
  toast(k ? "Saved on this device" : "Key removed");
  // fill the model list straight away so the picker is never guesswork
  if (k) { try { await discoverModels(); } catch (_) {} }
});

$("testKeyBtn").addEventListener("click", async () => {
  const k = $("apiKey").value.trim();
  if (!k) { $("smartStatus").textContent = "Paste a key first."; return; }
  localStorage.setItem("khayal-key", k);
  if ($("apiModel").value) localStorage.setItem("khayal-model", $("apiModel").value);
  $("smartStatus").textContent = "Testing…";
  $("testKeyBtn").disabled = true;
  const sample = "um so i was thinking that uh maybe this thing it works you know";

  /* Always discover first: the model name is the part that goes stale, and
     guessing it is what kept failing. Then try every candidate the key
     actually offers before giving up. */
  try {
    $("smartStatus").textContent = "Asking your key what it can run…";
    let info = null, discoveryErr = null;
    try { info = await discoverModels({ quiet: true }); }
    catch (e) { discoveryErr = e; $("smartStatus").textContent = "Couldn't list models: " + e.message; }

    const candidates = info && info.chat.length
      ? [smartModel(), ...info.chat.filter((m) => m !== smartModel())]
      : [smartModel()];

    let out = null, lastErr = null, used = null;
    for (const m of candidates.slice(0, 6)) {
      localStorage.setItem("khayal-model", m);
      $("smartStatus").textContent = `Trying ${m}…`;
      try { out = await smartCleanup(sample); used = m; break; }
      catch (e) { lastErr = e; }
    }

    if (out) {
      localStorage.setItem("khayal-model", used);
      if (info) setModelOptions(info.chat, used);
      $("smartStatus").textContent = `Working ✓ on ${used} (${localStorage.getItem("khayal-apiver") || "v1beta"})  →  ${out.slice(0, 70)}`;
      toast("Smart cleanup is live");
    } else {
      // nothing worked — lead with the root cause, not the symptom after it
      const found = info ? info.all.slice(0, 10).join(", ") : "none";
      const reason = discoveryErr ? discoveryErr.message : (lastErr ? lastErr.message : "No model worked");
      $("smartStatus").innerHTML =
        `✕ ${esc(reason)}<br><br>` +
        `<b>Diagnostics</b><br>Provider: ${esc(smartProvider())} · ${esc(smartBase() || "no address")}<br>` +
        `Models your key reports (${info ? info.all.length : 0}): ${esc(found) || "none"}<br>` +
        `Build: ${esc(BUILD)}<br><br>Send me this and I'll fix it.`;
      toast("Test failed");
    }
  } catch (err) {
    const msg = err.name === "AbortError" ? "Timed out — check your connection" : err.message;
    $("smartStatus").innerHTML = `✕ ${esc(msg)}<br><br>Build: ${esc(BUILD)}`;
    toast("Test failed");
  } finally {
    $("testKeyBtn").disabled = false;
  }
});

/* ---- transcription ---- */
function renderSttState() {
  $("cloudSttToggle").checked = settings.cloudStt === true;
  const s = $("sttStatus");
  if (!smartKey()) { s.textContent = "Add an API key above to switch this on."; return; }
  if (smartProvider() === "gemini") {
    s.textContent = "Cloud transcription needs an OpenAI-format provider. Your phone's engine is being used.";
    return;
  }
  if (!(navigator.mediaDevices && window.MediaRecorder)) {
    s.textContent = "This browser can't record audio, so the phone's engine is being used.";
    return;
  }
  s.textContent = settings.cloudStt === true
    ? `On, using ${sttModel()}. Your phone still shows a live preview while you speak; the accurate version replaces it when you stop.`
    : "Off — using your phone's built-in engine.";
}
$("cloudSttToggle").addEventListener("change", async (e) => {
  settings.cloudStt = e.target.checked;
  saveSettings();
  if (e.target.checked && smartKey() && smartProvider() !== "gemini") {
    try {
      const { all } = await listModels();
      const stt = all.filter((id) => /whisper|transcribe/i.test(id));
      const best = stt.sort((a, b) =>
        (/mini/i.test(b) ? 2 : 0) + (/4o|gpt/i.test(b) ? 3 : 0) -
        ((/mini/i.test(a) ? 2 : 0) + (/4o|gpt/i.test(a) ? 3 : 0)))[0];
      if (best) localStorage.setItem("khayal-stt-model", best);
    } catch (_) {}
  }
  renderSttState();
  toast(e.target.checked ? "Cloud transcription on" : "Using phone engine");
});

/* ---- version ---- */
function renderVersion() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const rows = [
    ["App build", BUILD],
    ["Offline cache", localStorage.getItem("khayal-sw") || "—"],
    ["Installed", standalone ? "Yes, as an app" : "No, running in a browser"],
    ["Khayals stored", String(thoughts.length)],
    ["To-dos stored", String(todos.length)],
  ];
  $("versionRows").innerHTML = rows.map(([k, v]) =>
    `<div class="rhythm-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
}
$("checkUpdateBtn").addEventListener("click", async () => {
  $("updateStatus").textContent = "Checking…";
  try {
    const res = await fetch("index.html?cb=" + Date.now(), { cache: "no-store" });
    const html = await res.text();
    const m = /app\.js\?v=(\d+)/.exec(html);
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    const live = m ? m[1] : null;
    const mine = /app\.js\?v=(\d+)/.exec(document.documentElement.innerHTML);
    const here = mine ? mine[1] : null;
    if (live && here && live !== here) {
      $("updateStatus").textContent = `A newer version is ready. Close Khayal completely and reopen to get it.`;
      toast("Update available");
    } else {
      $("updateStatus").textContent = "You're on the latest version.";
      toast("Up to date");
    }
  } catch (_) {
    $("updateStatus").textContent = "Couldn't check — you may be offline.";
  }
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
  /* A complete portrait of the app: every khayal with its title, tier, review
     history and meaning vector, every to-do, the trash, and your preferences —
     enough to rebuild this exactly somewhere else. The API key is deliberately
     left out so a backup file is never a credential. */
  const plain = (t) => ({ ...t, vec: t.vec ? Array.from(t.vec) : undefined });
  const data = {
    app: "khayal",
    version: 3,
    build: BUILD,
    exportedAt: new Date().toISOString(),
    counts: { thoughts: thoughts.length, todos: todos.length, trash: trash.length },
    settings: { ...settings },
    preferences: {
      provider: smartProvider(),
      model: smartModel(),
      embedModel: embedModel(),
      sttModel: sttModel(),
      apiBase: smartProvider() === "custom" ? localStorage.getItem("khayal-base") : undefined,
      note: "API key intentionally not exported — re-enter it after importing.",
    },
    thoughts: thoughts.map(plain),
    trash: trash.map(plain),
    todos,
  };
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
    if (data.settings) { settings = { ...settings, ...data.settings }; saveSettings(); }
    if (data.preferences) {
      const p = data.preferences;
      if (p.provider) localStorage.setItem("khayal-provider", p.provider);
      if (p.model) localStorage.setItem("khayal-model", p.model);
      if (p.embedModel) localStorage.setItem("khayal-embed-model", p.embedModel);
      if (p.sttModel) localStorage.setItem("khayal-stt-model", p.sttModel);
      if (p.apiBase) localStorage.setItem("khayal-base", p.apiBase);
    }
    for (const inc of data.thoughts) {
      if (!inc.title) inc.title = generateTitle(inc.text); // older backups
      if (Array.isArray(inc.vec)) inc.vec = Float32Array.from(inc.vec);
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

/* ================= map controls ================= */
$("hudClose").addEventListener("click", () => { hideLayer($("mapHud")); });
$("mapZoomIn").addEventListener("click", () => { buzz(6); MapView.zoomBy(1.25); });
$("mapZoomOut").addEventListener("click", () => { buzz(6); MapView.zoomBy(0.8); });
$("mapReset").addEventListener("click", () => { buzz(8); MapView.resetView(); });
$("mapFull").addEventListener("click", () => {
  const wrap = document.querySelector(".map-wrap");
  const full = wrap.classList.toggle("full");
  document.body.classList.toggle("locked", full);
  $("mapFull").textContent = full ? "✕" : "⛶";
  buzz(10);
  setTimeout(() => MapView.rebuild(), 60);   // relayout for the new canvas size
});

/* The canvas owns single-finger drags, so on the map a two-finger sweep is
   what moves between views. Edge strips are avoided deliberately: iOS reserves
   the screen edges for its own back and Home gestures. */
MapView.onTwoFingerSweep((dir) => {
  const i = VIEW_ORDER.indexOf(settings.view);
  const next = VIEW_ORDER[i + dir];
  if (next) gotoView(next);
});
$("ctaSettings").addEventListener("click", () => {
  showScreen("settings");
  setTimeout(() => $("smartToggle").scrollIntoView({ block: "center", behavior: "smooth" }), 200);
});
$("mapRelink").addEventListener("click", async () => {
  buzz(10);
  if (smartKey()) {
    $("mapStatus").textContent = "Reading your khayals…";
    const { done, total } = await embedMissing((d, t) => {
      $("mapStatus").textContent = `Understanding your khayals… ${d}/${t}`;
    }).catch((e) => { toast(e.message); return { done: 0, total: 0 }; });
    if (done) toast(`Connected ${done} khayal${done > 1 ? "s" : ""}`);
  }
  MapView.rebuild();
});

/* ================= ask ================= */
function openChat() {
  showLayer($("chatBackdrop"), { lock: true });
  $("chatSub").textContent = smartKey()
    ? "Answers come only from what you've written."
    : "Add a free key in Settings to talk. Without one I'll still find the closest khayals.";
  if (!chatHistory.length) renderChat();
  setTimeout(() => $("chatInput").focus(), 250);
}
function closeChat() { hideLayer($("chatBackdrop"), { lock: true }); }
$("askBtn").addEventListener("click", () => { buzz(8); openChat(); });
$("chatClose").addEventListener("click", closeChat);
$("chatNew").addEventListener("click", () => {
  chatHistory = [];
  renderChat({ toTop: true });   // a fresh chat starts at the top, not mid-scroll
  buzz(8);
});
$("chatBackdrop").addEventListener("click", (e) => { if (e.target === $("chatBackdrop")) closeChat(); });

function renderChat({ toTop = false } = {}) {
  const log = $("chatLog");
  if (!chatHistory.length) {
    const seeds = ["What have I been thinking about lately?",
      "What are my recurring themes?", "Summarise my core memories"];
    log.innerHTML = `<div class="chat-empty">
      <p>Ask anything about your own thoughts.</p>
      ${seeds.map((s) => `<button class="chip seed-chip">${esc(s)}</button>`).join("")}
    </div>`;
    log.querySelectorAll(".seed-chip").forEach((b) =>
      b.addEventListener("click", () => { $("chatInput").value = b.textContent; sendChat(); }));
    return;
  }
  log.innerHTML = chatHistory.map((m) => {
    if (m.role === "you") return `<div class="msg you">${esc(m.text)}</div>`;
    if (m.role === "thinking") return `<div class="msg bot thinking"><i></i><i></i><i></i></div>`;
    const cites = (m.sources || []).length
      ? `<div class="cites">${m.sources.map((s, i) =>
          `<button class="cite" data-id="${s.id}">[${i + 1}] ${esc((s.title || generateTitle(s.text)).slice(0, 30))}</button>`).join("")}</div>`
      : "";
    return `<div class="msg bot">${esc(m.text).replace(/\n/g, "<br>")}${cites}</div>`;
  }).join("");
  staggerIn(log, ".msg", 0, 0);
  log.querySelectorAll(".cite").forEach((el) =>
    el.addEventListener("click", () => { closeChat(); openDetail(el.dataset.id); }));
  log.scrollTop = toTop ? 0 : log.scrollHeight;
}

let chatBusy = false;
async function sendChat() {
  const input = $("chatInput");
  const q = input.value.trim();
  if (!q || chatBusy) return;
  if (!thoughts.length) { toast("No khayals to ask about yet"); return; }
  input.value = "";
  chatBusy = true;
  chatHistory.push({ role: "you", text: q });
  chatHistory.push({ role: "thinking" });
  renderChat();
  try {
    // make sure meaning vectors exist before the first real question
    if (smartKey() && thoughts.some((t) => !t.vec)) {
      await embedMissing().catch(() => {});
    }
    const { answer, sources } = await askKhayals(q);
    chatHistory = chatHistory.filter((m) => m.role !== "thinking");
    chatHistory.push({ role: "bot", text: answer, sources });
  } catch (err) {
    chatHistory = chatHistory.filter((m) => m.role !== "thinking");
    const msg = err.name === "AbortError" ? "That took too long — try again" : err.message;
    chatHistory.push({ role: "bot", text: msg, sources: [] });
  } finally {
    chatBusy = false;
    renderChat();
  }
}
$("chatSend").addEventListener("click", sendChat);
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

/* ================= onboarding ================= */
$("onboardDone").addEventListener("click", () => {
  settings.onboarded = true; saveSettings(); hideLayer($("onboard"));
  moveAllThumbs();
});

/* ================= lifecycle ================= */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    MapView.stop();  // don't burn battery while backgrounded
    if (!recording) dropMic();   // fully hand the microphone back
    return;
  }
  if ($("screen-thoughts").classList.contains("active") && settings.view === "map") MapView.start();
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

  if (!settings.onboarded) showLayer($("onboard"));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    caches.keys().then((k) => { if (k[0]) localStorage.setItem("khayal-sw", k[0]); }).catch(() => {});
  }
  catchUpReminders();
  scheduleReminders();
})();
