/* Khayal — the mind layer: meaning vectors, connections, constellation, ask.
   Works with no key at all (local word-overlap similarity); an API key upgrades
   it to real semantic embeddings, computed once per khayal then reused offline. */
"use strict";

/* Model names change over time, so nothing is hardcoded as truth: these are
   only the starting guesses, replaced by whatever the key actually offers. */
const DEFAULT_EMBED_MODEL = "text-embedding-004";
function embedModel() { return localStorage.getItem("khayal-embed-model") || DEFAULT_EMBED_MODEL; }

/* Google has shipped both v1beta and v1; which one a key answers on varies,
   so try each rather than assuming. The winner is remembered. */
const API_VERSIONS = ["v1beta", "v1"];
function apiBase() {
  const v = localStorage.getItem("khayal-apiver") || API_VERSIONS[0];
  return `https://generativelanguage.googleapis.com/${v}`;
}

/* ---- OpenAI-style discovery (also xAI, Groq, OpenRouter…) ---- */
async function listModelsOpenAI() {
  const key = smartKey();
  const base = smartBase();
  if (!base) throw new Error("Set the API address first");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: "Bearer " + key }, signal: ctrl.signal,
    });
    if (!res.ok) {
      let d = ""; try { d = (await res.json()).error?.message || ""; } catch (_) {}
      throw new Error(friendlyApiError(res.status, d));
    }
    const data = await res.json();
    const ids = (data.data || data.models || []).map((m) => String(m.id || m.name || ""));
    if (!ids.length) throw new Error("That key returned no models");
    // no capability flags in this API, so split on well-known naming
    const bad = /embedding|whisper|tts|dall|image|moderation|audio|realtime|transcribe|search|rerank/i;
    return {
      version: "openai",
      all: ids,
      chat: ids.filter((id) => !bad.test(id)),
      embed: ids.filter((id) => /embedding/i.test(id)),
    };
  } finally { clearTimeout(timer); }
}

/* Ask the API what this key can actually use, across every API version. */
async function listModelsGemini() {
  const key = smartKey();
  if (!key) throw new Error("No API key");
  let lastErr = null;
  for (const ver of API_VERSIONS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(key)}&pageSize=200`,
        { signal: ctrl.signal });
      if (!res.ok) {
        let d = ""; try { d = (await res.json()).error?.message || ""; } catch (_) {}
        lastErr = new Error(`[${ver}] ${res.status}: ${d || "request failed"}`);
        continue;
      }
      const data = await res.json();
      const all = (data.models || []).map((m) => ({
        id: String(m.name || "").replace(/^models\//, ""),
        methods: m.supportedGenerationMethods || [],
      }));
      if (!all.length) { lastErr = new Error(`[${ver}] returned no models`); continue; }
      localStorage.setItem("khayal-apiver", ver);
      // some responses omit the method list — treat those as usable rather than dropping them
      const known = all.some((m) => m.methods.length);
      return {
        version: ver,
        all: all.map((m) => m.id),
        chat: all.filter((m) => !known || m.methods.includes("generateContent")).map((m) => m.id),
        embed: all.filter((m) => !known || m.methods.includes("embedContent")).map((m) => m.id),
      };
    } catch (e) {
      lastErr = e.name === "AbortError" ? new Error(`[${ver}] timed out`) : e;
    } finally { clearTimeout(timer); }
  }
  throw lastErr || new Error("Could not reach the model list");
}

const listModels = () => (smartProvider() === "gemini" ? listModelsGemini() : listModelsOpenAI());

/* Prefer something fast, cheap and current; fall back to whatever exists. */
function pickChatModel(ids) {
  const score = (id) => {
    let s = 0;
    // "mini" must be its own word — otherwise "ge-mini" scores as the cheap tier
    if (/flash|(^|[-_. ])mini|haiku|turbo/i.test(id)) s += 40;
    if (/(^|[-_. ])(nano|lite)/i.test(id)) s += 20;
    if (/latest/i.test(id)) s += 12;
    if (/^gpt|gemini|grok|llama|claude/i.test(id)) s += 10;
    if (/pro|opus/i.test(id)) s += 4;
    const v = /(\d+)(?:[.-](\d+))?/.exec(id);
    if (v) s += Number(v[1]) * 5 + (Number(v[2]) || 0);
    if (/preview|exp|thinking|vision|image|audio|tts|live|instruct|tuning|realtime|search/i.test(id)) s -= 40;
    if (/\d{4}-\d{2}-\d{2}|\d{4}$/.test(id)) s -= 6;   // prefer unpinned aliases
    return s;
  };
  return [...ids].sort((a, b) => score(b) - score(a))[0] || null;
}
function pickEmbedModel(ids) {
  const score = (id) => {
    let s = 0;
    if (/embedding/i.test(id)) s += 20;
    if (/text-embedding/i.test(id)) s += 10;
    if (/small/i.test(id)) s += 8;                     // cheapest that works well
    if (/large/i.test(id)) s += 2;
    const v = /(\d+)/.exec(id.replace(/[^0-9]/g, " ").trim());
    if (v) s += Number(v[1]);
    if (/exp|preview|ada/i.test(id)) s -= 15;
    return s;
  };
  return [...ids].sort((a, b) => score(b) - score(a))[0] || null;
}
const NEIGHBOURS = 4;      // links kept per khayal — caps density so it never hairballs
/* Two different scales: embedding cosines sit high (related ≈ 0.6+), word
   overlap sits very low (a strong lexical match is ≈ 0.2). One threshold for
   both would either connect everything or nothing. */
const EMBED_MIN = 0.6;
/* deliberately strict: weak word overlap produces confident nonsense
   ("3-D printing business" ↔ "stop optimising the tool"), and showing nothing
   is better than showing a wrong connection */
const LEX_MIN = 0.15;
const CHAT_CONTEXT = 8;    // khayals handed to the model when answering

/* ================= local fallback: bag-of-words vectors ================= */
const STOP = new Set(("a an the and or but if then than that this these those of in on at to for with from by as is are was were be been being it its i me my we our you your he she they them their " +
  "so just very really much many more most some any all no not do does did done have has had will would can could should about into over under out up down " +
  "hai hain tha thi the ka ke ki ko se me mein par bhi aur ya toh jo woh yeh ye kya kyun nahi nahin hum tum aap main mera meri mere apna").split(" "));

function tokenise(text) {
  return String(text || "").toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/* Inverse document frequency, so words you use constantly ("start", "think")
   stop dominating the match and rare, meaningful words carry the weight. */
let idf = new Map();
let idfBuiltFor = -1;
function buildIdf() {
  const N = thoughts.length || 1;
  const df = new Map();
  for (const t of thoughts) {
    for (const w of new Set(tokenise((t.title ? t.title + " " : "") + t.text))) {
      df.set(w, (df.get(w) || 0) + 1);
    }
  }
  idf = new Map();
  for (const [w, d] of df) idf.set(w, Math.log((N + 1) / (d + 0.5)));
  idfBuiltFor = thoughts.length;
}
function idfFor(w) {
  if (idfBuiltFor !== thoughts.length) buildIdf();
  return idf.get(w) !== undefined ? idf.get(w) : Math.log(thoughts.length + 1);
}

/* tf-idf vector as a plain map, cosine-compared */
function lexVector(text) {
  const m = new Map();
  for (const w of tokenise(text)) m.set(w, (m.get(w) || 0) + 1);
  let norm = 0;
  for (const [k, v] of m) {
    const weighted = (1 + Math.log(v)) * idfFor(k);
    m.set(k, weighted);
    norm += weighted * weighted;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of m) m.set(k, v / norm);
  return m;
}
function lexSim(a, b) {
  if (!a || !b) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) { const o = big.get(k); if (o) dot += v * o; }
  return dot;
}

/* ================= embeddings ================= */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/* One batch call, whichever provider is configured. */
async function embedBatch(texts) {
  const key = smartKey();
  if (!key) throw new Error("No API key");
  const model = embedModel();
  if (!model) throw new Error("No embedding model — tap Test in Settings");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const clipped = texts.map((t) => String(t).slice(0, 8000));
  try {
    let url, headers, body;
    if (smartProvider() === "gemini") {
      url = `${smartBase()}/models/${model}:batchEmbedContents?key=${encodeURIComponent(key)}`;
      headers = { "Content-Type": "application/json" };
      body = { requests: clipped.map((t) => ({ model: "models/" + model, content: { parts: [{ text: t }] } })) };
    } else {
      url = `${smartBase()}/embeddings`;
      headers = { "Content-Type": "application/json", Authorization: "Bearer " + key };
      body = { model, input: clipped };
    }
    const res = await fetch(url, { method: "POST", headers, signal: ctrl.signal, body: JSON.stringify(body) });
    if (!res.ok) {
      let d = ""; try { d = (await res.json()).error?.message || ""; } catch (_) {}
      throw new Error(friendlyApiError(res.status, d));
    }
    const data = await res.json();
    if (smartProvider() === "gemini") {
      return (data.embeddings || []).map((e) => Float32Array.from(e.values));
    }
    return (data.data || [])
      .slice()
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((e) => Float32Array.from(e.embedding));
  } finally { clearTimeout(timer); }
}

async function embedOne(text) {
  const [vec] = await embedBatch([text]);
  if (!vec) throw new Error("No embedding returned");
  return vec;
}

/* give every khayal a vector, in chunks, tolerating failure */
let embedRunning = false;
async function embedMissing(onProgress) {
  if (embedRunning || !smartKey()) return { done: 0, total: 0 };
  const pending = thoughts.filter((t) => !t.vec);
  if (!pending.length) return { done: 0, total: 0 };
  embedRunning = true;
  let done = 0;
  try {
    for (let i = 0; i < pending.length; i += 40) {
      const chunk = pending.slice(i, i + 40);
      const vecs = await embedBatch(chunk.map((t) => (t.title ? t.title + ". " : "") + t.text));
      for (let j = 0; j < chunk.length; j++) {
        if (!vecs[j]) continue;
        chunk[j].vec = vecs[j];
        chunk[j].vecModel = embedModel();
        await dbPut("thoughts", chunk[j]);
        done++;
      }
      if (onProgress) onProgress(done, pending.length);
    }
  } finally { embedRunning = false; }
  return { done, total: pending.length };
}

/* ================= connections ================= */
let lexCache = new Map();   // id -> lexical vector
let graphEdges = [];        // { a, b, w }
let graphBuiltFor = 0;

function lexFor(t) {
  let v = lexCache.get(t.id);
  if (!v || v._n !== t.updatedAt || v._idf !== idfBuiltFor) {
    v = lexVector((t.title ? t.title + " " : "") + t.text);
    v._n = t.updatedAt;
    v._idf = idfBuiltFor;
    lexCache.set(t.id, v);
  }
  return v;
}

/* returns the score and which scale it's on, since the two aren't comparable */
function similarity(a, b) {
  if (a.vec && b.vec) return { s: cosine(a.vec, b.vec), semantic: true };
  return { s: lexSim(lexFor(a), lexFor(b)), semantic: false };
}

/* top matches for one khayal */
function relatedTo(t, limit = 4) {
  const out = [];
  for (const o of thoughts) {
    if (o.id === t.id) continue;
    const { s, semantic } = similarity(t, o);
    if (s >= (semantic ? EMBED_MIN : LEX_MIN)) out.push({ t: o, s, semantic });
  }
  out.sort((x, y) => y.s - x.s);
  return out.slice(0, limit);
}

/* k-nearest-neighbour graph: density stays bounded however many khayals exist */
function buildGraph() {
  const edges = new Map();
  for (const t of thoughts) {
    for (const { t: o, s } of relatedTo(t, NEIGHBOURS)) {
      const key = t.id < o.id ? t.id + "|" + o.id : o.id + "|" + t.id;
      const prev = edges.get(key);
      if (!prev || s > prev.w) edges.set(key, { a: t.id < o.id ? t.id : o.id, b: t.id < o.id ? o.id : t.id, w: s });
    }
  }
  graphEdges = [...edges.values()];
  graphBuiltFor = thoughts.length;
  return graphEdges;
}

function semanticCoverage() {
  const withVec = thoughts.filter((t) => t.vec).length;
  return { withVec, total: thoughts.length };
}

/* ================= constellation ================= */
const MapView = (() => {
  let canvas, ctx, dpr = 1, W = 0, H = 0;
  let nodes = [], links = [];
  let raf = null, running = false;
  let focusId = null;
  let cam = { x: 0, y: 0, z: 1 };
  let drag = null, pinch = null;
  let t0 = 0;

  const TIER_COLOR = ["#b5b1a8", "#b07d16", "#f05337"];
  const TIER_R = [3.4, 5, 7];

  function ensureCanvas() {
    canvas = document.getElementById("mapCanvas");
    if (!canvas) return false;
    ctx = canvas.getContext("2d");
    return true;
  }

  function resize() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* settle the layout once, up front, instead of simulating every frame */
  function layout() {
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const L = links.map((e) => ({ a: idx.get(e.a), b: idx.get(e.b), w: e.w }))
      .filter((e) => e.a !== undefined && e.b !== undefined);
    const n = nodes.length;
    if (!n) return;

    // start on a phyllotaxis spiral — pleasant even before forces run
    const golden = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach((nd, i) => {
      const r = 14 * Math.sqrt(i + 0.5);
      nd.x = Math.cos(i * golden) * r;
      nd.y = Math.sin(i * golden) * r;
      nd.vx = nd.vy = 0;
    });

    const iterations = n > 300 ? 120 : 220;
    const repel = 900;
    for (let step = 0; step < iterations; step++) {
      const alpha = 1 - step / iterations;
      // repulsion (capped pairwise work on big graphs)
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 0.01; }
          if (d2 > 90000) continue;
          const f = (repel / d2) * alpha;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      // springs pull connected khayals together, stronger the more alike they are
      for (const e of L) {
        const a = nodes[e.a], b = nodes[e.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const target = 58 - e.w * 26;
        const f = ((d - target) / d) * 0.09 * e.w * alpha;
        const fx = dx * f, fy = dy * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const nd of nodes) {
        nd.vx -= nd.x * 0.0016;   // gentle pull to centre
        nd.vy -= nd.y * 0.0016;
        nd.x += nd.vx; nd.y += nd.vy;
        nd.vx *= 0.82; nd.vy *= 0.82;
      }
    }
    // fit into view
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const nd of nodes) {
      minX = Math.min(minX, nd.x); maxX = Math.max(maxX, nd.x);
      minY = Math.min(minY, nd.y); maxY = Math.max(maxY, nd.y);
    }
    const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
    cam.z = Math.min((W - 60) / spanX, (H - 60) / spanY, 2.4);
    if (!isFinite(cam.z) || cam.z <= 0) cam.z = 1;
    cam.x = -(minX + maxX) / 2;
    cam.y = -(minY + maxY) / 2;
    nodes.forEach((nd, i) => { nd.seed = i * 0.7; });
  }

  function build() {
    const edges = buildGraph();
    nodes = thoughts.map((t) => ({
      id: t.id, tier: t.tier, title: t.title || t.text.slice(0, 40),
      x: 0, y: 0, vx: 0, vy: 0, seed: 0,
    }));
    const ids = new Set(nodes.map((n) => n.id));
    links = edges.filter((e) => ids.has(e.a) && ids.has(e.b));
    layout();
  }

  const toScreen = (nd, drift) => ({
    x: (nd.x + cam.x) * cam.z + W / 2 + drift.dx,
    y: (nd.y + cam.y) * cam.z + H / 2 + drift.dy,
  });

  function draw(ts) {
    if (!running) return;
    if (!t0) t0 = ts;
    const time = (ts - t0) / 1000;
    ctx.clearRect(0, 0, W, H);

    const still = document.body.classList.contains("no-motion");
    const neighbours = new Set();
    if (focusId) {
      for (const e of links) {
        if (e.a === focusId) neighbours.add(e.b);
        else if (e.b === focusId) neighbours.add(e.a);
      }
    }
    const pos = new Map();
    for (const nd of nodes) {
      const drift = still ? { dx: 0, dy: 0 } : {
        dx: Math.sin(time * 0.35 + nd.seed) * 1.6,
        dy: Math.cos(time * 0.31 + nd.seed * 1.3) * 1.6,
      };
      pos.set(nd.id, toScreen(nd, drift));
    }

    // links
    ctx.lineWidth = 1;
    for (const e of links) {
      const p = pos.get(e.a), q = pos.get(e.b);
      if (!p || !q) continue;
      const lit = focusId && (e.a === focusId || e.b === focusId);
      const dim = focusId && !lit;
      ctx.strokeStyle = lit
        ? `rgba(240,83,55,${0.25 + e.w * 0.5})`
        : `rgba(20,18,15,${(dim ? 0.03 : 0.05 + e.w * 0.13)})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }

    // nodes
    for (const nd of nodes) {
      const p = pos.get(nd.id);
      const isFocus = nd.id === focusId;
      const near = neighbours.has(nd.id);
      const dim = focusId && !isFocus && !near;
      const r = (TIER_R[nd.tier] || 3.4) * (isFocus ? 1.9 : 1) * Math.min(Math.max(cam.z, 0.7), 1.5);
      const col = TIER_COLOR[nd.tier] || TIER_COLOR[0];

      if (nd.tier === 2 && !dim) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.5);
        glow.addColorStop(0, "rgba(240,83,55,0.22)");
        glow.addColorStop(1, "rgba(240,83,55,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = dim ? 0.22 : 1;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (isFocus) {
        ctx.strokeStyle = "#16140f"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // label the focused star and its neighbours
    if (focusId) {
      ctx.font = "600 11px Jakarta, sans-serif";
      ctx.textAlign = "center";
      for (const nd of nodes) {
        if (nd.id !== focusId && !neighbours.has(nd.id)) continue;
        const p = pos.get(nd.id);
        const label = nd.title.length > 26 ? nd.title.slice(0, 25) + "…" : nd.title;
        const w = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.roundRect(p.x - w / 2 - 5, p.y + 10, w + 10, 16, 8);
        ctx.fill();
        ctx.fillStyle = nd.id === focusId ? "#16140f" : "#3d3a34";
        ctx.fillText(label, p.x, p.y + 22);
      }
    }
    raf = requestAnimationFrame(draw);
  }

  function hit(px, py) {
    let best = null, bestD = 22 * 22;
    for (const nd of nodes) {
      const p = toScreen(nd, { dx: 0, dy: 0 });
      const dx = p.x - px, dy = p.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = nd; }
    }
    return best;
  }

  function showHud(nd) {
    const hud = document.getElementById("mapHud");
    if (!nd) { hud.hidden = true; return; }
    const t = thoughts.find((x) => x.id === nd.id);
    if (!t) { hud.hidden = true; return; }
    const linked = links.filter((e) => e.a === nd.id || e.b === nd.id).length;
    document.getElementById("hudTitle").textContent = t.title || generateTitle(t.text);
    document.getElementById("hudMeta").textContent =
      `${["Regular", "High", "Core"][t.tier]} · ${relTime(t.createdAt)} · ${linked} connection${linked === 1 ? "" : "s"}`;
    document.getElementById("hudOpen").onclick = () => openDetail(nd.id);
    hud.hidden = false;
  }

  function bindGestures() {
    canvas.addEventListener("pointerdown", (e) => {
      // capture is a nicety; if the browser refuses it, dragging must still work
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      drag = { x: e.clientX, y: e.clientY, moved: false, sx: e.clientX, sy: e.clientY };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6) drag.moved = true;
      cam.x += dx / cam.z; cam.y += dy / cam.z;
      drag.x = e.clientX; drag.y = e.clientY;
    });
    canvas.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) {
        const r = canvas.getBoundingClientRect();
        const nd = hit(e.clientX - r.left, e.clientY - r.top);
        focusId = nd ? (focusId === nd.id ? null : nd.id) : null;
        showHud(focusId ? nd : null);
        if (nd) buzz(8);
      }
      drag = null;
    });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      cam.z = Math.max(0.25, Math.min(4, cam.z * f));
    }, { passive: false });
  }

  let bound = false;
  function start() {
    if (!ensureCanvas()) return;
    if (!bound) { bindGestures(); bound = true; }
    resize();
    const empty = document.getElementById("mapEmpty");
    if (thoughts.length < 2) {
      empty.hidden = false;
      empty.innerHTML = `<div class="empty-state"><span class="big">✦</span>Your map appears once you have a few khayals.<br>Keep catching them.</div>`;
      stop();
      ctx && ctx.clearRect(0, 0, W, H);
      document.getElementById("mapHud").hidden = true;
      updateStatus();
      return;
    }
    empty.hidden = true;
    build();
    focusId = null;
    document.getElementById("mapHud").hidden = true;
    running = true; t0 = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
    updateStatus();
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function updateStatus() {
    const { withVec, total } = semanticCoverage();
    const el = document.getElementById("mapStatus");
    if (!el) return;
    if (!total) { el.textContent = ""; return; }
    el.textContent = withVec === total && total > 0
      ? `${links.length} connections from meaning · ${total} khayals`
      : withVec > 0
      ? `${links.length} connections · ${withVec}/${total} khayals understood by meaning`
      : `${links.length} connections from shared words. Add a key in Settings for meaning-based links.`;
  }

  window.addEventListener("resize", () => { if (running) { resize(); layout(); } });

  /* focus a node by id — used by the tap handler, and lets anything else
     (or a test) drive the map without faking pointer events */
  function focus(id) {
    const nd = nodes.find((n) => n.id === id);
    focusId = nd ? id : null;
    showHud(nd || null);
    return !!nd;
  }
  const positions = () => nodes.map((n) => ({ id: n.id, ...toScreen(n, { dx: 0, dy: 0 }) }));

  return { start, stop, rebuild: start, updateStatus, isRunning: () => running,
    focus, positions, linkCount: () => links.length, nodeCount: () => nodes.length };
})();

/* ================= ask (RAG over your own khayals) ================= */
let chatHistory = [];

async function retrieveFor(question, k = CHAT_CONTEXT) {
  let qvec = null;
  if (smartKey() && thoughts.some((t) => t.vec)) {
    try { qvec = await embedOne(question); } catch (_) { qvec = null; }
  }
  const qlex = lexVector(question);
  const scored = thoughts.map((t) => {
    const s = qvec && t.vec ? cosine(qvec, t.vec) : lexSim(qlex, lexFor(t));
    return { t, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.filter((x) => x.s > 0.05).slice(0, k);
}

const ASK_PROMPT = `You are the user's own thinking partner. You can see only the khayals (personal notes) listed below — they are this person's own thoughts, written by them.

Rules:
- Answer using only these khayals. Never invent thoughts they did not write.
- If the khayals don't cover the question, say so plainly and mention what they have written about that is nearest.
- Refer to them as "you". Be warm, brief and concrete.
- When you draw on a specific khayal, cite it inline as [1], [2] matching the numbers below.
- Two short paragraphs at most unless they asked for a list.`;

async function askKhayals(question) {
  const hits = await retrieveFor(question);
  if (!hits.length) {
    return { answer: "I couldn't find anything in your khayals about that yet.", sources: [] };
  }
  const context = hits.map((h, i) =>
    `[${i + 1}] (${new Date(h.t.createdAt).toDateString()}, ${["regular", "high", "core"][h.t.tier]})\n${h.t.text}`
  ).join("\n\n");

  const key = smartKey();
  if (!key) {
    return {
      answer: "Add a free API key in Settings → Smart cleanup and I can talk through these with you. Until then, here are the khayals closest to what you asked:",
      sources: hits.map((h) => h.t),
    };
  }
  const text = await chatComplete(
    `${ASK_PROMPT}\n\nKHAYALS:\n${context}\n\nQUESTION: ${question}`,
    { temperature: 0.4, timeout: 25000 }
  );
  return { answer: text || "I couldn't put that into words.", sources: hits.map((h) => h.t) };
}
