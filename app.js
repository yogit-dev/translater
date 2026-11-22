(() => {
const C = Object.assign({ defaultThem: "es-ES", defaultMe: "en-US", speak: true }, window.CONFIG || {});
const $ = s => document.querySelector(s);
// [speech code, translate code, name]
const LANGS = [["en-US","en","English"],["es-ES","es","Spanish"],["fr-FR","fr","French"],["de-DE","de","German"],["it-IT","it","Italian"],["pt-BR","pt","Portuguese"],["hi-IN","hi","Hindi"],["ar-SA","ar","Arabic"],["ru-RU","ru","Russian"],["ja-JP","ja","Japanese"],["ko-KR","ko","Korean"],["zh-CN","zh-CN","Chinese (Simplified)"],["tr-TR","tr","Turkish"],["nl-NL","nl","Dutch"],["pl-PL","pl","Polish"],["id-ID","id","Indonesian"],["bn-BD","bn","Bengali"],["ur-PK","ur","Urdu"],["ta-IN","ta","Tamil"],["te-IN","te","Telugu"],["th-TH","th","Thai"],["vi-VN","vi","Vietnamese"],["uk-UA","uk","Ukrainian"],["sv-SE","sv","Swedish"],["el-GR","el","Greek"],["he-IL","he","Hebrew"],["fa-IR","fa","Persian"],["cs-CZ","cs","Czech"],["da-DK","da","Danish"],["fi-FI","fi","Finnish"],["nb-NO","no","Norwegian"],["hu-HU","hu","Hungarian"],["ro-RO","ro","Romanian"],["bg-BG","bg","Bulgarian"],["hr-HR","hr","Croatian"],["sk-SK","sk","Slovak"],["sl-SI","sl","Slovenian"],["sr-RS","sr","Serbian"],["lt-LT","lt","Lithuanian"],["lv-LV","lv","Latvian"],["et-EE","et","Estonian"],["ms-MY","ms","Malay"],["fil-PH","tl","Filipino"],["sw-KE","sw","Swahili"],["af-ZA","af","Afrikaans"],["mr-IN","mr","Marathi"],["gu-IN","gu","Gujarati"],["kn-IN","kn","Kannada"],["ml-IN","ml","Malayalam"],["ne-NP","ne","Nepali"],["si-LK","si","Sinhala"],["km-KH","km","Khmer"],["zh-TW","zh-TW","Chinese (Traditional)"],["ca-ES","ca","Catalan"],["is-IS","is","Icelandic"],["am-ET","am","Amharic"],["zu-ZA","zu","Zulu"],["ka-GE","ka","Georgian"],["hy-AM","hy","Armenian"]];
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const fill = (sel, def) => { sel.replaceChildren(...[...LANGS].sort((a, b) => a[2].localeCompare(b[2])).map(l => new Option(l[2], l[0]))); sel.value = def; };
fill($("#langThem"), C.defaultThem);
fill($("#langMe"), C.defaultMe);
$("#speakOn").checked = !!C.speak;
const find = code => LANGS.find(l => l[0] === code);

let A, B, who = "them", running = false, speaking = false, voiceOn = true;
let rec = null, live = null, n = 0, timer = 0, lock = null;
const P = { them: { panel: $("#pTop"), log: $("#logTop") }, me: { panel: $("#pBot"), log: $("#logBot") } };
const other = w => (w === "them" ? "me" : "them");
const spk = w => (w === "them" ? A : B);
const tgt = w => (w === "them" ? B : A);

// ---------- translation: on-device Chrome model when ready, free web fallback otherwise ----------
const ready = {};
const tc = l => (l[1] === "zh-TW" ? "zh-Hant" : l[1].split("-")[0]);
function warm(a, b) {
  if (!("Translator" in self)) return;
  for (const [x, y] of [[a, b], [b, a]]) {
    const o = { sourceLanguage: tc(x), targetLanguage: tc(y) };
    Translator.availability(o)
      .then(s => (s === "unavailable" ? null : Translator.create(o)))
      .then(t => { if (t) ready[x[1] + ">" + y[1]] = t; })
      .catch(() => {});
  }
}
async function web(text, from, to) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from[1]}&tl=${to[1]}&dt=t&q=${encodeURIComponent(text)}`, { signal: ctl.signal });
    const j = await r.json();
    return j[0].map(x => x[0]).join("");
  } catch {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from[1]}|${to[1]}`);
    return (await r.json()).responseData.translatedText;
  } finally { clearTimeout(t); }
}
async function translate(text, from, to) {
  if (from === to) return text;
  const t = ready[from[1] + ">" + to[1]];
  if (t) { try { return await t.translate(text); } catch {} }
  return web(text, from, to);
}

// ---------- captions ----------
function line(side, w) {
  const p = document.createElement("p");
  p.className = "ln " + w;
  p.dir = "auto";
  P[side].log.append(p);
  while (P[side].log.children.length > 30) P[side].log.firstChild.remove();
  return p;
}
function startLive() {
  live = { src: line(who, who), dst: line(other(who), who), n: ++n, w: who };
  live.src.classList.add("live"); live.dst.classList.add("live");
}
function preview(text) {
  if (!live) startLive();
  live.src.textContent = text;
  clearTimeout(timer);
  const cur = live;
  timer = setTimeout(async () => {
    try { const t = await translate(text, spk(cur.w), tgt(cur.w)); if (live === cur) cur.dst.textContent = t; } catch {}
  }, 200);
}
async function commit(text) {
  if (!text) return;
  if (!live) startLive();
  const cur = live; live = null; clearTimeout(timer);
  cur.src.textContent = text; cur.src.classList.remove("live");
  let t;
  try { t = await translate(text, spk(cur.w), tgt(cur.w)); } catch { t = "Translation failed. Check your connection."; }
  cur.dst.textContent = t; cur.dst.classList.remove("live");
  say(t, tgt(cur.w));
}

// ---------- speaking (pauses the mic so the phone doesn't hear itself) ----------
function say(text, l) {
  if (!voiceOn || !text || !running) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = l[0];
  speaking = true; stopRec();
  const done = () => { speaking = false; setTimeout(listen, 200); };
  u.onend = done; u.onerror = done;
  speechSynthesis.speak(u);
}

// ---------- listening ----------
function stopRec() { if (rec) { const r = rec; rec = null; r.onend = null; try { r.abort(); } catch {} } }
function listen() {
  if (!running || speaking || rec) return;
  const r = new SR(); rec = r;
  r.lang = spk(who)[0]; r.continuous = true; r.interimResults = true;
  r.onresult = e => {
    let fin = "", tmp = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const x = e.results[i];
      if (x.isFinal) fin += x[0].transcript; else tmp += x[0].transcript;
    }
    if (fin) commit(fin.trim()); else if (tmp) preview(tmp.trim());
  };
  r.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { end(); $("#msg").textContent = "Microphone is blocked. Allow it in your browser settings, then start again."; }
  };
  r.onend = () => { if (rec === r) { rec = null; if (running && !speaking) setTimeout(listen, 120); } };
  try { r.start(); } catch { rec = null; }
}

function paint() {
  P.them.panel.classList.toggle("on", who === "them");
  P.me.panel.classList.toggle("on", who === "me");
  $("#swap").dataset.me = who === "me" ? "1" : "0";
  $("#who").textContent = who === "them" ? "Hearing them in " + A[2] : "Hearing you in " + B[2];
}

// ---------- controls ----------
$("#go").onclick = async () => {
  $("#msg").textContent = "";
  if (!SR) { $("#msg").textContent = "This browser can’t do live speech recognition. Open the page in Chrome or Edge."; return; }
  A = find($("#langThem").value); B = find($("#langMe").value);
  voiceOn = $("#speakOn").checked;
  warm(A, B);
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); }
  catch { $("#msg").textContent = "Microphone access is needed to listen."; return; }
  P.them.log.replaceChildren(); P.me.log.replaceChildren();
  $("#voice").textContent = voiceOn ? "Voice on" : "Voice off";
  $("#voice").setAttribute("aria-pressed", voiceOn);
  $("#setup").hidden = true; $("#stage").hidden = false;
  running = true; who = "them"; live = null;
  try { lock = await navigator.wakeLock.request("screen"); } catch {}
  paint(); listen();
};
$("#swap").onclick = () => {
  who = other(who);
  stopRec(); speechSynthesis.cancel(); speaking = false;
  live = null; clearTimeout(timer);
  paint(); listen();
};
$("#voice").onclick = () => {
  voiceOn = !voiceOn;
  $("#voice").textContent = voiceOn ? "Voice on" : "Voice off";
  $("#voice").setAttribute("aria-pressed", voiceOn);
  if (!voiceOn) { speechSynthesis.cancel(); }
};
function end() {
  running = false; stopRec(); speechSynthesis.cancel(); speaking = false;
  if (lock) { lock.release().catch(() => {}); lock = null; }
  $("#stage").hidden = true; $("#setup").hidden = false;
}
$("#end").onclick = end;
})();
