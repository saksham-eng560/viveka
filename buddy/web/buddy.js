/* Sheru, the Lighthouse desk buddy: presentation + interaction.
 * The brain lives in the backend (/api/buddy/*). Inside the macOS app this page is
 * loaded in a transparent always-on-top window; window.webkit.messageHandlers.buddy
 * is the bridge for native things (click-through regions, dragging, activating apps).
 */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const NATIVE = params.has("native") || !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.buddy);
  const DASHBOARD = params.get("dash") || "http://localhost:3000";
  const POLL_MS = 1000;

  const $ = (id) => document.getElementById(id);
  const ui = {
    wrap: $("sheru-wrap"), host: $("sheru"), chip: $("status-chip"),
    bubble: $("bubble"), title: $("bubble-title"), text: $("bubble-text"), source: $("bubble-source"),
    actions: $("bubble-actions"), close: $("bubble-close"), timer: $("bubble-timer"),
    chatForm: $("chat-form"), chatInput: $("chat-input"),
  };
  if (!NATIVE) document.body.classList.add("preview");

  const native = (msg) => {
    try { window.webkit.messageHandlers.buddy.postMessage(msg); } catch (_) { /* preview in a browser */ }
  };

  // ------------------------------------------------------------------ state
  const st = {
    lastId: 0, firstPoll: true, baseMood: "idle", profile: null, queue: [], current: null,
    hideTimer: null, typeTimer: null, moodTimer: null, chatting: false, menuOpen: false, offline: false,
    activeAlertId: null, voice: false, sounds: true,
  };
  let svg = null;

  // ---------------------------------------------------------------- figure
  async function loadFigure() {
    const res = await fetch("sheru.svg", { cache: "no-cache" });
    ui.host.innerHTML = await res.text();
    svg = ui.host.querySelector("svg");
    svg.removeAttribute("width"); svg.removeAttribute("height");
    setMood("idle");
    scheduleBlink(); scheduleFidget(); reportHitRects();
  }

  const MOODS = ["idle", "happy", "celebrate", "wave", "alert", "worried", "think", "sleep", "break", "wisdom", "focus", "talk", "heart"];
  function setMood(m) {
    if (!svg) return;
    const mood = m === "talk" ? "idle" : (MOODS.includes(m) ? m : "idle");
    MOODS.forEach((x) => svg.classList.remove("mood-" + x));
    svg.classList.add("mood-" + mood);
  }
  function oneShot(cls, ms = 700) {
    ui.host.classList.remove(cls); void ui.host.offsetWidth; ui.host.classList.add(cls);
    setTimeout(() => ui.host.classList.remove(cls), ms);
  }
  function scheduleBlink() {
    setTimeout(() => {
      ui.host.classList.add("blink");
      setTimeout(() => ui.host.classList.remove("blink"), 130);
      if (Math.random() < 0.25) setTimeout(() => { ui.host.classList.add("blink"); setTimeout(() => ui.host.classList.remove("blink"), 120); }, 260);
      scheduleBlink();
    }, 2200 + Math.random() * 4200);
  }
  function scheduleFidget() {
    setTimeout(() => {
      if (!st.current && st.baseMood !== "sleep") {
        const r = Math.random();
        if (r < 0.4) oneShot("wiggle-ears", 600); else if (r < 0.75) oneShot("flick", 700); else lookAround();
      }
      scheduleFidget();
    }, 7000 + Math.random() * 9000);
  }

  // eyes follow the cursor (native sends window-local coordinates; previews use mousemove)
  let lastLook = 0;
  function look(x, y) {
    if (!svg) return;
    const r = ui.host.getBoundingClientRect();
    const scale = r.width / 200;
    const eyeX = r.left + 100 * scale, eyeY = r.top + 104 * scale;
    const dx = x - eyeX, dy = y - eyeY;
    const dist = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, dist / 260);
    const tx = (dx / dist) * 3.2 * k, ty = (dy / dist) * 2.6 * k;
    ["sh-eye-l", "sh-eye-r"].forEach((id) => { const el = svg.querySelector("#" + id); if (el) el.style.transform = `translate(${tx}px, ${ty}px)`; });
    lastLook = Date.now();
  }
  function lookAround() {
    if (Date.now() - lastLook < 4000) return;
    const r = ui.host.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    look(cx + (Math.random() - 0.5) * 600, r.top + (Math.random() - 0.3) * 300);
    setTimeout(() => { if (Date.now() - lastLook > 900) look(cx, r.top + 70); }, 1400);
  }
  window.sheru = { look, say: (text) => show({ id: -Date.now(), kind: "info", mood: "talk", text, ttl: 8, actions: [] }) };
  if (!NATIVE) window.addEventListener("mousemove", (e) => look(e.clientX, e.clientY));

  // -------------------------------------------------------------- hit areas
  let lastRects = "";
  function reportHitRects() {
    const rects = [];
    const add = (el) => {
      if (!el || el.hidden) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) rects.push({ x: Math.round(r.left) - 2, y: Math.round(r.top) - 2, w: Math.round(r.width) + 4, h: Math.round(r.height) + 4 });
    };
    if (svg) {
      const r = ui.host.getBoundingClientRect();
      rects.push({ x: Math.round(r.left + r.width * 0.16), y: Math.round(r.top + r.height * 0.06), w: Math.round(r.width * 0.72), h: Math.round(r.height * 0.9) });
    }
    add(ui.bubble);
    const key = JSON.stringify(rects);
    if (key !== lastRects) { lastRects = key; native({ type: "hit", rects }); }
  }
  setInterval(reportHitRects, 400);
  new ResizeObserver(reportHitRects).observe(ui.bubble);

  // ----------------------------------------------------------------- sound
  let audio = null;
  function chime(kind) {
    if (!st.sounds) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume().catch(() => {});
      const notes = kind === "alert" ? [659.3, 880] : kind === "happy" ? [784, 1046.5] : [880];
      notes.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = f;
        const t = audio.currentTime + i * 0.13;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.3);
      });
    } catch (_) { /* no audio */ }
  }
  function speak(text) {
    if (!st.voice || !("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, ""));
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => v.lang === "en-IN") || voices.find((v) => /Samantha|Karen|Moira/.test(v.name)) || null;
      u.pitch = 1.35; u.rate = 1.03; u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------- bubble
  function clearTimers() {
    clearTimeout(st.hideTimer); clearInterval(st.typeTimer); st.hideTimer = null; st.typeTimer = null;
    ui.timer.className = ""; ui.host.classList.remove("talking");
  }

  function typeText(text, done) {
    const chars = Array.from(text);
    let i = 0;
    ui.text.textContent = "";
    ui.text.classList.add("typing-caret");
    ui.host.classList.add("talking");
    const speed = chars.length > 140 ? 14 : 24;
    st.typeTimer = setInterval(() => {
      i = Math.min(chars.length, i + 2);
      ui.text.textContent = chars.slice(0, i).join("");
      if (i >= chars.length) {
        clearInterval(st.typeTimer); st.typeTimer = null;
        ui.text.classList.remove("typing-caret"); ui.host.classList.remove("talking");
        reportHitRects();
        done && done();
      }
    }, speed);
  }

  function renderActions(actions) {
    ui.actions.innerHTML = "";
    (actions || []).forEach((a, idx) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "pill" + (idx === 0 ? " primary" : ""); b.textContent = a.label;
      b.addEventListener("click", (e) => { e.stopPropagation(); onAction(a); });
      ui.actions.appendChild(b);
    });
  }

  function show(msg) {
    clearTimers();
    st.current = msg; st.menuOpen = false;
    if (!msg.keepChat) { st.chatting = false; ui.chatForm.hidden = true; }
    ui.bubble.hidden = false;
    ui.bubble.classList.remove("leaving");
    ui.bubble.className = `kind-${msg.kind}${msg.level ? " lvl-" + msg.level : ""}`;
    void ui.bubble.offsetWidth;
    ui.title.textContent = msg.title || "";
    ui.source.textContent = msg.source ? (msg.kind === "quote" ? `— Swami Vivekananda · ${msg.source}` : msg.source) : "";
    renderActions(msg.actions);
    const mood = msg.mood || "talk";
    setMood(mood);
    if (mood === "alert") oneShot("shake", 600);
    else if (mood === "celebrate") oneShot("jump", 1900);
    else if (mood === "happy" || mood === "wave") oneShot("hop", 650);
    if (msg.alert) chime("alert"); else if (mood === "celebrate") chime("happy");
    speak((msg.title ? msg.title + ". " : "") + msg.text);
    typeText(msg.text, () => {
      if (msg.ttl !== null && msg.ttl !== undefined && !msg.alert && !st.chatting) {
        const ms = Math.max(4000, msg.ttl * 1000);
        ui.timer.style.animationDuration = ms + "ms"; ui.timer.className = "run";
        st.hideTimer = setTimeout(() => hide(), ms);
      }
    });
    reportHitRects();
  }

  function hide() {
    clearTimers();
    if (ui.bubble.hidden) return;
    ui.bubble.classList.add("leaving");
    setTimeout(() => {
      ui.bubble.hidden = true; ui.bubble.classList.remove("leaving");
      st.current = null; st.chatting = false; st.menuOpen = false;
      setMood(st.baseMood);
      reportHitRects();
      native({ type: "blur" });
      next();
    }, 190);
  }

  ui.bubble.addEventListener("mouseenter", () => { if (st.hideTimer) { clearTimeout(st.hideTimer); st.hideTimer = null; ui.timer.style.animationPlayState = "paused"; } });
  ui.bubble.addEventListener("mouseleave", () => {
    const m = st.current;
    if (m && !st.typeTimer && !st.chatting && !st.menuOpen && m.ttl !== null && !m.alert) st.hideTimer = setTimeout(() => hide(), 3500);
  });
  ui.close.addEventListener("click", (e) => {
    e.stopPropagation();
    const m = st.current;
    if (m && m.alert && m.id > 0) post("/api/buddy/action", { action: "dismiss", messageId: m.id });
    hide();
  });

  function next() {
    if (st.current || !st.queue.length) return;
    show(st.queue.shift());
  }

  function enqueue(msg) {
    if (msg.alert) {
      // alerts jump the queue and replace whatever is on screen (unless the user is typing to Sheru)
      st.queue = st.queue.filter((m) => m.alert);
      if (st.chatting) { st.queue.unshift(msg); return; }
      show(msg); return;
    }
    if (st.queue.length > 4) st.queue.shift();
    st.queue.push(msg);
    next();
  }

  // --------------------------------------------------------------- actions
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function onAction(a) {
    const m = st.current;
    switch (a.id) {
      case "open_onboarding":
        native({ type: "open", url: DASHBOARD + "/?onboarding=1" });
        if (!NATIVE) window.open(DASHBOARD + "/?onboarding=1", "_blank");
        hide(); return;
      case "dashboard":
        native({ type: "open", url: DASHBOARD }); if (!NATIVE) window.open(DASHBOARD, "_blank"); hide(); return;
      case "chat":
        openChat(); return;
      default: break;
    }
    try {
      const res = await post("/api/buddy/action", { action: a.id, messageId: m && m.id > 0 ? m.id : null, minutes: a.minutes || null });
      if (res.activate && res.activate.bundleId) native({ type: "activate", bundleId: res.activate.bundleId });
      if (res.message) { st.lastId = Math.max(st.lastId, res.message.id); show(res.message); } else hide();
    } catch (_) {
      show({ id: -1, kind: "info", mood: "worried", text: "I can't reach my brain right now. Is ./start.sh still running?", ttl: 6, actions: [] });
    }
  }

  function openMenu() {
    const hushed = st.lastState && st.lastState.hushUntil;
    const name = st.profile ? st.profile.firstName : "friend";
    const lines = [
      `Hi ${name}! What shall we do?`, `At your service, ${name}!`, `Rawr! Need something, ${name}?`,
    ];
    const actions = st.profile ? [
      { id: "quote", label: "Swamiji quote" }, { id: "fact", label: "Fun fact" }, { id: "chat", label: "Talk to me" },
      { id: "break", label: "5-min break", minutes: 5 },
      hushed ? { id: "resume", label: "Wake up" } : { id: "hush", label: "Quiet 30 min", minutes: 30 },
      { id: "dashboard", label: "Dashboard" },
    ] : [{ id: "open_onboarding", label: "Set my goals" }];
    show({ id: -Date.now(), kind: "menu", mood: "wave", title: "", text: lines[Math.floor(Math.random() * lines.length)], ttl: 12, actions });
    st.menuOpen = true;
  }

  function openChat() {
    clearTimers();
    st.chatting = true; st.menuOpen = false;
    const greeting = st.current && st.current.kind === "chat" ? st.current.text : "Ask me anything: focus tips, Swamiji's life, or how your day is going.";
    show({ id: -Date.now(), kind: "chat", mood: "talk", title: "Chat with Sheru", text: greeting, ttl: null, actions: [], keepChat: true });
    st.chatting = true;
    ui.chatForm.hidden = false;
    native({ type: "focus" });
    setTimeout(() => ui.chatInput.focus(), 60);
    reportHitRects();
  }

  ui.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = ui.chatInput.value.trim();
    if (!text) return;
    ui.chatInput.value = ""; ui.chatInput.disabled = true;
    setMood("think");
    clearTimers();
    ui.text.textContent = "…";
    ui.text.classList.add("typing-caret");
    try {
      const res = await post("/api/buddy/chat", { text });
      show({ id: -Date.now(), kind: "chat", mood: res.mood || "talk", title: "Sheru", text: res.reply, ttl: null, actions: [], keepChat: true });
    } catch (_) {
      show({ id: -Date.now(), kind: "chat", mood: "worried", title: "Sheru", text: "Hmm, my brain isn't answering. Try again in a moment?", ttl: null, actions: [], keepChat: true });
    }
    st.chatting = true; ui.chatForm.hidden = false; ui.chatInput.disabled = false; ui.chatInput.focus();
  });
  ui.chatInput.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  // ------------------------------------------------------------ click/drag
  let down = null;
  ui.wrap.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY, dragging: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!down || down.dragging) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down.dragging = true;
      native({ type: "dragStart" });
    }
  });
  window.addEventListener("pointerup", () => {
    if (!down) return;
    const wasDrag = down.dragging;
    down = null;
    if (wasDrag) return;
    oneShot("squish", 400);
    if (Math.random() < 0.3) { svg && svg.classList.add("mood-heart"); setTimeout(() => svg && svg.classList.remove("mood-heart"), 1300); }
    if (st.current && st.menuOpen) { hide(); return; }
    if (st.current && st.current.alert) return; // keep the alert; its buttons are right there
    openMenu();
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.current && !st.current.alert) hide(); });

  // ----------------------------------------------------------------- polling
  const prettyVerdict = (now) => {
    if (!now) return "";
    const icon = now.verdict === "focus" ? "✓" : now.verdict === "distraction" ? "!" : "·";
    return `${icon} ${now.label}`;
  };

  async function poll() {
    try {
      const res = await fetch(`/api/buddy/state?since=${st.lastId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const s = await res.json();
      st.lastState = s;
      if (st.offline) { st.offline = false; if (st.current && st.current.kind === "offline") hide(); }
      st.profile = s.profile;
      st.voice = !!(s.profile && s.profile.voice);
      st.sounds = !s.profile || s.profile.sounds !== false;
      st.baseMood = s.mood;
      if (!st.current) setMood(st.baseMood === "idle" && s.now && s.now.verdict === "focus" ? "focus" : st.baseMood);
      ui.chip.textContent = prettyVerdict(s.now);

      let msgs = s.messages || [];
      if (st.firstPoll) {
        // don't replay history on (re)load: only the last half minute, plus a live alert
        const cutoff = Date.now() / 1000 - 30;
        msgs = msgs.filter((m) => m.ts >= cutoff || m.id === s.activeAlertId);
        st.firstPoll = false;
      }
      msgs.forEach((m) => { st.lastId = Math.max(st.lastId, m.id); enqueue(m); });
      st.lastId = Math.max(st.lastId, s.lastId || 0);

      // an alert that the backend considers resolved (user went back to work) disappears
      if (st.current && st.current.alert && st.current.id > 0 && s.activeAlertId !== st.current.id) hide();
      st.activeAlertId = s.activeAlertId;
    } catch (_) {
      if (!st.offline) {
        st.offline = true;
        show({ id: -1, kind: "offline", mood: "sleep", title: "Snoozing…", text: "I can't see my brain (the Lighthouse backend). Start it with ./start.sh and I'll wake up!", ttl: null, actions: [] });
      }
    } finally {
      setTimeout(poll, POLL_MS);
    }
  }

  loadFigure().then(() => { native({ type: "ready" }); poll(); }).catch(() => poll());
})();
