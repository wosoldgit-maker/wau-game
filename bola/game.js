"use strict";
// =====================================================================
//  Jom Bola: 3D football you play with friends over a link.
//  The host's browser runs the match (sim), everyone draws it in 3D.
//  World units are metres. Sim: x along the pitch, y across, z up.
// =====================================================================

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;   // b - a, wrapped
const hyp = Math.hypot;

const STEP = 1 / 60;
const PR = 0.42;              // player body radius
const BR = 0.11;              // ball radius (real)
const GRAV = 9.8;
const ID_PREFIX = "jombola-";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TEAM_COLOR = { r: "#e63946", b: "#3a86ff" };
const TEAM_NAME = { r: "Red", b: "Blue", s: "Watching" };
const TEAM_SHORT = { r: "RED", b: "BLU" };

// Pitch sizes and formations for each team size (fractions: x from own goal, y across)
const SIZES = {
  11: { FW: 100, FH: 64, GW: 7.32, GH: 2.44,
    slots: [["GK", .03, .50, 1], ["DF", .19, .14, 3], ["DF", .17, .38, 4], ["DF", .17, .62, 5], ["DF", .19, .86, 2],
            ["MF", .33, .30, 8], ["MF", .30, .50, 6], ["MF", .33, .70, 10], ["FW", .44, .18, 11], ["FW", .46, .50, 9], ["FW", .44, .82, 7]] },
  7: { FW: 72, FH: 46, GW: 6, GH: 2.2,
    slots: [["GK", .04, .50, 1], ["DF", .2, .3, 4], ["DF", .2, .7, 5], ["MF", .33, .18, 8], ["MF", .31, .5, 6], ["MF", .33, .82, 10], ["FW", .45, .5, 9]] },
  5: { FW: 54, FH: 34, GW: 5, GH: 2.0,
    slots: [["GK", .05, .50, 1], ["DF", .22, .32, 4], ["DF", .22, .68, 5], ["MF", .34, .5, 10], ["FW", .45, .5, 9]] },
};
let teamSize = 11, FW = 100, FH = 64, GW = 7.32, GH = 2.44, SLOTS = SIZES[11].slots;
let BOX_D, BOX_W, SIX_D, SIX_W, CIRCLE_R, SPOT_D;
function applySize(n) {
  teamSize = n; const s = SIZES[n];
  FW = s.FW; FH = s.FH; GW = s.GW; GH = s.GH; SLOTS = s.slots;
  BOX_D = FW * 0.16; BOX_W = Math.min(FH * 0.6, 40.3); SIX_D = FW * 0.053; SIX_W = Math.min(FH * 0.29, 18.3);
  CIRCLE_R = FW * 0.087; SPOT_D = FW * 0.105;
}
applySize(11);
const PERSON_PREF = ["FW", "MF", "DF", "GK"];   // people take attacking places first

// =====================================================================
//  Shared state
// =====================================================================
let role = null, myId = null, roomCode = "", peer = null, hostConn = null;
let roster = [];            // people [{id, name, team}]
let matchLen = 300;         // real seconds for the whole match
let botsOn = true;

const sim = {
  players: new Map(),       // people
  bodies: [],               // footballers
  bodySeq: 1,
  ball: { x: 50, y: 32, z: 0, vx: 0, vy: 0, vz: 0, shot: 0 },
  owner: null, lastTouch: null, lastKicker: null,
  score: [0, 0], phase: "warm", phaseT: 0, elapsed: 0, half: 1, swap: false,
  scorer: "", events: [], nextId: 1, tick: 0, kickTeam: null,
  restart: null,            // {type, team, x, y}
  banner: "",
};

// What we draw (host copies from the sim, clients fill it from snapshots)
const view = { ball: { x: 50, y: 32, z: 0 }, players: [], score: [0, 0], phase: "warm", phaseT: 0, elapsed: 0,
  half: 1, swap: false, scorer: "", po: -1, ob: -1, banner: "", size: 11 };

// Which way each team attacks (swaps at half time)
function side(team) { return ((team === "r") !== sim.swap) ? 1 : -1; }
function ownGoalX(team) { return side(team) > 0 ? 0 : FW; }
function oppGoalX(team) { return FW - ownGoalX(team); }

// =====================================================================
//  Sound: crowd, kicks, whistle (all made with WebAudio, no files)
// =====================================================================
let actx = null, noiseBuf = null, crowd = null;
function initAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const len = actx.sampleRate * 2;
  noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
  const d = noiseBuf.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.2; }
  const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = actx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 650;
  const g = actx.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(actx.destination); src.start();
  crowd = { g, f, base: 0.06 };
  g.gain.setTargetAtTime(crowd.base, actx.currentTime, 1.5);
}
function tone(freq, dur, type = "sine", vol = 0.15, slide = 0) {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
}
function thud(freq, dur, vol, q = 1.2) {
  if (!actx) return;
  const t = actx.currentTime, src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(actx.destination); src.start(t, Math.random()); src.stop(t + dur);
}
function crowdSwell(level, hold, bright = 650) {
  if (!crowd) return;
  const t = actx.currentTime;
  crowd.g.gain.cancelScheduledValues(t); crowd.f.frequency.cancelScheduledValues(t);
  crowd.g.gain.setTargetAtTime(level, t, 0.08); crowd.f.frequency.setTargetAtTime(bright, t, 0.1);
  crowd.g.gain.setTargetAtTime(crowd.base, t + hold, 0.9); crowd.f.frequency.setTargetAtTime(650, t + hold, 0.9);
}
function whistle(n = 1, long = false) {
  for (let i = 0; i < n; i++) setTimeout(() => tone(2700, long && i === n - 1 ? 0.8 : 0.22, "square", 0.045), i * 300);
}
function playEvent(e) {
  fxEvent(e);
  if (!actx) return;
  if (e === "k") { thud(320, 0.09, 0.5); tone(110, 0.07, "sine", 0.15, -40); }
  else if (e === "l") { thud(260, 0.12, 0.6); tone(95, 0.1, "sine", 0.2, -30); }
  else if (e === "K") { thud(230, 0.15, 0.95); tone(78, 0.13, "sine", 0.35, -35); crowdSwell(0.14, 1, 1200); }
  else if (e === "h") { thud(420, 0.08, 0.5); }
  else if (e === "t") { thud(500, 0.22, 0.45, 0.6); }
  else if (e === "s") { thud(260, 0.1, 0.5); crowdSwell(0.17, 0.8, 1000); }
  else if (e === "p") { tone(1600, 0.06, "square", 0.04); thud(900, 0.05, 0.3); }      // post
  else if (e === "w") whistle(2);
  else if (e === "f") whistle(1);
  else if (e === "o") whistle(1);
  else if (e === "H") { whistle(2, true); crowdSwell(0.12, 1.5); }
  else if (e === "g") { crowdSwell(0.36, 2.8, 1800); [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, "triangle", 0.1), i * 110)); }
  else if (e === "e") { whistle(3, true); crowdSwell(0.2, 2, 1200); }
}

// =====================================================================
//  Small UI helpers
// =====================================================================
let toastTimer = 0;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
function show(id, on = true) { $(id).classList.toggle("hidden", !on); }
function cleanName(n) { return String(n || "").replace(/[<>]/g, "").trim().slice(0, 12) || "Player"; }
function makeCode() { let c = ""; for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
function gameLink() { return location.origin + location.pathname + "?room=" + roomCode; }
function peerOptions() {
  const ps = new URLSearchParams(location.search).get("ps");     // ?ps=host:port = own PeerJS server (testing)
  if (!ps) return { debug: 0 };
  const [host, port] = ps.split(":");
  return { host, port: Number(port || 9000), path: "/", secure: location.protocol === "https:", debug: 0 };
}

// =====================================================================
//  Start screen
// =====================================================================
const params = new URLSearchParams(location.search);
const linkRoom = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
const psParam = params.get("ps") ? "ps=" + params.get("ps") : "";
try { $("nameIn").value = localStorage.getItem("jombola-name") || ""; } catch (e) {}
if (linkRoom) { show("joinBlock"); show("createBlock", false); $("joinCode").textContent = linkRoom; }
function myName() {
  const n = cleanName($("nameIn").value);
  try { localStorage.setItem("jombola-name", n); } catch (e) {}
  return n;
}
$("btnCreate").onclick = $("btnCreate2").onclick = () => { initAudio(); startHost(myName()); };
$("btnJoin").onclick = () => { initAudio(); startClient(myName(), linkRoom); };
$("btnCode").onclick = () => {
  const c = $("codeIn").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 5) { $("startMsg").textContent = "The code has 5 letters."; return; }
  initAudio(); startClient(myName(), c);
};
$("btnRetry").onclick = () => location.reload();
const homeUrl = () => location.pathname + (psParam ? "?" + psParam : "");
$("btnNew").onclick = () => { location.href = homeUrl(); };
$("btnLeave").onclick = () => { if (peer) peer.destroy(); location.href = homeUrl(); };
function showError(title, msg) {
  $("errTitle").textContent = title; $("errMsg").textContent = msg;
  for (const id of ["start", "menu", "invite", "end"]) show(id, false);
  show("err");
}
function enterGame() {
  show("start", false); show("hud");
  $("helpTxt").innerHTML = isTouch
    ? "Left thumb: move.<br><b>With the ball</b> PASS (short tap = short pass, hold = longer / lofted), SHOOT (hold for power), SPRINT.<br><b>Without the ball</b> TACKLE (close = standing tackle, further = slide), SWITCH player, SPRINT."
    : "Arrows / WASD: move. Shift: sprint.<br><b>With the ball</b> J pass (hold = longer / lofted), K shoot (hold for power).<br><b>Without the ball</b> J tackle, K switch player.";
}

// =====================================================================
//  HOST: networking
// =====================================================================
function startHost(name, tries = 0) {
  $("startMsg").textContent = "Creating game…";
  roomCode = makeCode();
  peer = new Peer(ID_PREFIX + roomCode, peerOptions());
  peer.on("open", () => {
    role = "host"; myId = 0;
    addPlayer(0, name, null);
    history.replaceState(null, "", "?room=" + roomCode + (psParam ? "&" + psParam : ""));
    enterGame(); show("hostCtl"); openInvite();
    setInterval(hostLoop, 1000 / 60);
  });
  peer.on("connection", onClientConnection);
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
  peer.on("error", (err) => {
    if (err.type === "unavailable-id" && tries < 4) { peer.destroy(); startHost(name, tries + 1); return; }
    if (role === "host" && (err.type === "peer-unavailable" || err.type === "network")) return;
    if (role !== "host") showError("Can't create game", "Could not reach the game server. Check your internet and try again. (" + err.type + ")");
  });
}
function onClientConnection(conn) {
  let pid = null;
  conn.on("data", (m) => {
    if (!m || typeof m !== "object") return;
    if (pid !== null && sim.players.has(pid)) sim.players.get(pid).seen = performance.now();
    if (m.t === "h" && pid === null) {
      pid = sim.nextId++;
      addPlayer(pid, cleanName(m.n), conn);
      sendTo(conn, { t: "w", id: pid });
      toast(cleanName(m.n) + " joined");
    } else if (pid !== null) {
      const p = sim.players.get(pid);
      if (!p) return;
      if (m.t === "i") p.in = { x: clamp(+m.x || 0, -1, 1), y: clamp(+m.y || 0, -1, 1), s: !!m.s, p: !!m.p, r: !!m.r, sc: m.sc | 0, pc: m.pc | 0, wc: m.wc | 0 };
      else if (m.t === "tm") setTeam(p, m.v);
      else if (m.t === "pg") sendTo(conn, { t: "po", c: m.c });
    }
  });
  const gone = () => {
    if (pid === null || !sim.players.has(pid)) return;
    toast(sim.players.get(pid).name + " left");
    sim.players.delete(pid); afterRosterChange();
  };
  conn.on("close", gone); conn.on("error", gone);
}
setInterval(() => {   // drop people we haven't heard from in 6 s (locked phones)
  if (role !== "host") return;
  const now = performance.now();
  for (const p of [...sim.players.values()]) if (p.conn && now - p.seen > 6000) {
    sim.players.delete(p.id); try { p.conn.close(); } catch (e) {}
    toast(p.name + " left"); afterRosterChange();
  }
}, 1000);
function sendTo(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) {} }
function broadcast(msg) { for (const p of sim.players.values()) if (p.conn) sendTo(p.conn, msg); }

// =====================================================================
//  HOST: people, teams and footballers
// =====================================================================
function peopleOn(t) { return [...sim.players.values()].filter((p) => p.team === t); }
function bodyOf(person) { return sim.bodies.find((b) => b.ctrl === person.id) || null; }

function addPlayer(id, name, conn) {
  const r = peopleOn("r").length, b = peopleOn("b").length;
  const team = r + b < teamSize * 2 ? (r <= b ? "r" : "b") : "s";
  sim.players.set(id, { id, name, team, conn, seen: performance.now(),
    in: { x: 0, y: 0, s: false, p: false, r: false, sc: 0, pc: 0, wc: 0 }, lastP: 0, lastS: 0, lastW: 0, shootMode: null, passMode: null });
  afterRosterChange();
}
function setTeam(p, t) {
  if (!["r", "b", "s"].includes(t) || p.team === t) return;
  if (t !== "s" && peopleOn(t).length >= teamSize) { if (p.id === myId) toast("That team is full"); return; }
  p.team = t; afterRosterChange();
}
function slotPos(team, slot) {
  const f = SLOTS[slot] || SLOTS[SLOTS.length - 1];
  const sd = side(team);
  return { x: sd > 0 ? f[1] * FW : FW - f[1] * FW, y: sd > 0 ? f[2] * FH : FH - f[2] * FH };
}
function roleOf(b) { return (SLOTS[b.slot] || SLOTS[0])[0]; }
function newBody(team, slot) {
  const pos = slotPos(team, slot);
  return { id: sim.bodySeq++, team, slot, x: pos.x, y: pos.y, vx: 0, vy: 0, face: side(team) > 0 ? 0 : Math.PI,
    ctrl: null, ix: 0, iy: 0, sprint: false, kcd: 0, lastKick: -99, charging: false, charge: 0, queued: null,
    tackleT: 0, downT: 0, slideA: 0, standT: 0, diveT: 0, diveSide: 0, holdT: 0, wobble: Math.random() * 6.28,
    receiveT: 0, saveRoll: -1, stuckT: 0, unstick: null, dribPh: 0, stamina: 1 };
}
function arrangeTeams() {
  for (const t of ["r", "b"]) {
    const people = peopleOn(t), ids = new Set(people.map((p) => p.id));
    let mine = sim.bodies.filter((b) => b.team === t);
    for (const b of mine) if (b.ctrl !== null && !ids.has(b.ctrl)) { b.ctrl = null; b.charging = false; b.queued = null; }
    const want = botsOn ? SLOTS.length : people.length;
    const prefOf = (b) => PERSON_PREF.indexOf(roleOf(b)) * 20 + (SLOTS.length - b.slot);
    while (mine.length > want) {
      const free = mine.filter((b) => b.ctrl === null).sort((a, b) => prefOf(a) - prefOf(b));
      if (!free.length) break;
      const v = free[0]; sim.bodies.splice(sim.bodies.indexOf(v), 1); mine = mine.filter((b) => b !== v);
      if (sim.owner === v) sim.owner = null;
    }
    const order = SLOTS.map((s, i) => i).sort((a, b) => botsOn ? a - b : PERSON_PREF.indexOf(SLOTS[a][0]) - PERSON_PREF.indexOf(SLOTS[b][0]));
    for (const s of order) {
      if (mine.length >= want) break;
      if (!mine.some((b) => b.slot === s)) { const b = newBody(t, s); sim.bodies.push(b); mine.push(b); }
    }
    for (const p of people) {
      if (mine.some((b) => b.ctrl === p.id)) continue;
      const free = mine.filter((b) => b.ctrl === null).sort((a, b) => prefOf(a) - prefOf(b));
      if (free.length) free[0].ctrl = p.id;
    }
  }
}
function afterRosterChange() {
  arrangeTeams();
  roster = [...sim.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team }));
  broadcast({ t: "r", L: roster.map((p) => [p.id, p.name, p.team]), ml: matchLen, bo: botsOn ? 1 : 0, sz: teamSize });
  const both = sim.bodies.some((b) => b.team === "r") && sim.bodies.some((b) => b.team === "b");
  if (sim.phase === "warm" && both) startMatch();
  if (sim.phase !== "warm" && sim.phase !== "end" && !both) { sim.phase = "warm"; resetPositions(); }
  updateMenu();
}
function changeSize(n) {
  if (n === teamSize) return;
  applySize(n);
  sim.bodies = []; sim.owner = null; sim.lastTouch = null; sim.lastKicker = null;
  for (const p of sim.players.values()) if (p.team !== "s" && peopleOn(p.team).length > n) p.team = "s";
  sizeChanged();
  afterRosterChange();
  startMatch();
}

// =====================================================================
//  HOST: match flow (kick-off, half time, restarts)
// =====================================================================
function placeForKickoff() {
  const kt = sim.kickTeam || "r";
  for (const b of sim.bodies) {
    const pos = slotPos(b.team, b.slot);
    b.x = pos.x; b.y = pos.y; b.vx = b.vy = 0; b.face = side(b.team) > 0 ? 0 : Math.PI;
    b.charging = false; b.charge = 0; b.queued = null; b.tackleT = b.downT = b.standT = b.diveT = 0; b.kcd = 0; b.receiveT = 0;
    // Stay in your own half, and out of the centre circle unless you're kicking off
    const sd = side(b.team);
    if (sd > 0) b.x = Math.min(b.x, FW / 2 - 1); else b.x = Math.max(b.x, FW / 2 + 1);
    if (b.team !== kt && hyp(b.x - FW / 2, b.y - FH / 2) < CIRCLE_R + 1) b.x = FW / 2 - sd * (CIRCLE_R + 1.5);
  }
  const mates = sim.bodies.filter((b) => b.team === kt).sort((a, b) => hyp(a.x - FW / 2, a.y - FH / 2) - hyp(b.x - FW / 2, b.y - FH / 2));
  const human = mates.find((b) => b.ctrl !== null && roleOf(b) !== "GK");
  const taker = human || mates.find((b) => roleOf(b) === "FW") || mates[0];
  if (taker) { taker.x = FW / 2 - side(kt) * 0.6; taker.y = FH / 2; taker.face = side(kt) > 0 ? 0 : Math.PI; }
  const helper = mates.find((b) => b !== taker && roleOf(b) !== "GK" && roleOf(b) !== "DF");
  if (helper) { helper.x = FW / 2 - side(kt) * 1.5; helper.y = FH / 2 + 5; }
  Object.assign(sim.ball, { x: FW / 2, y: FH / 2, z: 0, vx: 0, vy: 0, vz: 0 });
  sim.owner = null; sim.lastTouch = null; sim.lastKicker = null; sim.restart = null;
}
function resetPositions() { placeForKickoff(); }
function startMatch() {
  sim.score = [0, 0]; sim.elapsed = 0; sim.half = 1; sim.swap = false;
  sim.kickTeam = Math.random() < 0.5 ? "r" : "b"; sim.firstKick = sim.kickTeam;
  placeForKickoff();
  sim.phase = "kickoff"; sim.phaseT = 2.5;
  show("end", false);
}
const hasTeams = () => sim.bodies.some((b) => b.team === "r") && sim.bodies.some((b) => b.team === "b");

// Ball went out: throw-in, corner or goal kick (or a free kick after a foul)
function awardRestart(type, team, x, y) {
  sim.restart = { type, team, x, y };
  sim.owner = null;
  Object.assign(sim.ball, { x, y, z: 0, vx: 0, vy: 0, vz: 0 });
  sim.phase = "restart"; sim.phaseT = 1.3;
  sim.banner = { throw: "THROW-IN", corner: "CORNER", goalkick: "GOAL KICK", free: "FREE KICK" }[type] || "";
  // Who takes it: the keeper for goal kicks, otherwise the nearest outfield player (a person if close)
  const mates = sim.bodies.filter((b) => b.team === team);
  let taker = type === "goalkick" ? mates.find((b) => roleOf(b) === "GK") : null;
  if (!taker) {
    const cands = mates.filter((b) => roleOf(b) !== "GK").sort((a, b) => hyp(a.x - x, a.y - y) - hyp(b.x - x, b.y - y));
    taker = cands[0];
    const person = cands.find((b) => b.ctrl !== null && hyp(b.x - x, b.y - y) < hyp(taker.x - x, taker.y - y) + 12);
    if (person) taker = person;
  }
  sim.restart.taker = taker ? taker.id : null;
  // A person on that team takes control of the taker
  if (taker && taker.ctrl === null) {
    let who = null, wd = 1e9;
    for (const p of sim.players.values()) {
      if (p.team !== team) continue;
      const pb = bodyOf(p); const d = pb ? hyp(pb.x - x, pb.y - y) : 0;
      if (d < wd) { wd = d; who = p; }
    }
    if (who && roleOf(taker) !== "GK") switchPlayer(who, taker);
  }
  for (const b of sim.bodies) { b.charging = false; b.charge = 0; b.queued = null; b.tackleT = 0; }
  sim.events.push(type === "free" ? "f" : "o");
}
function beginRestartPlay() {
  const r = sim.restart; if (!r) return;
  const taker = sim.bodies.find((b) => b.id === r.taker);
  if (taker) {
    const inX = r.x < FW / 2 ? 1 : -1, inY = r.y < FH / 2 ? 1 : -1;
    // stand behind the ball, facing into the pitch
    let fx = 0, fy = 0;
    if (r.type === "throw") fy = inY; else if (r.type === "corner") { fx = inX; fy = inY; } else fx = side(taker.team);
    const fl = hyp(fx, fy) || 1; fx /= fl; fy /= fl;
    taker.x = r.x - fx * 0.55; taker.y = r.y - fy * 0.55; taker.face = Math.atan2(fy, fx); taker.vx = taker.vy = 0;
    sim.owner = taker; sim.lastTouch = taker; taker.holdT = 0; taker.kcd = 0;
    taker.restartHold = r.type;     // can't dribble a throw-in / corner: must pass
  }
  sim.restart = null; sim.phase = "play";
}

// =====================================================================
//  HOST: switching player
// =====================================================================
function switchPlayer(person, to = null) {
  const cur = bodyOf(person), b = sim.ball;
  if (!to) {
    const px = b.x + b.vx * 0.35, py = b.y + b.vy * 0.35;
    const nearGoal = Math.abs(px - ownGoalX(person.team)) < BOX_D;
    let best = null, bd = 1e9;
    for (const q of sim.bodies) {
      if (q.team !== person.team || q.ctrl !== null || q === cur) continue;
      if (roleOf(q) === "GK" && !nearGoal) continue;
      const d = hyp(q.x - px, q.y - py);
      if (d < bd) { bd = d; best = q; }
    }
    to = best;
  }
  if (!to || to.ctrl !== null) return;
  if (cur) { cur.ctrl = null; cur.charging = false; cur.charge = 0; cur.queued = null; }
  to.ctrl = person.id; to.queued = null; to.charging = false;
  if (person.shootMode !== "switched") person.shootMode = null;
  person.passMode = null;
}

// =====================================================================
//  HOST: kicking
// =====================================================================
function kickDir(b, q) {
  let dx = Math.cos(b.face), dy = Math.sin(b.face);
  if (q && q.dir) { dx = q.dir.x; dy = q.dir.y; }
  else if (b.ctrl !== null) {
    const person = sim.players.get(b.ctrl);
    if (person && hyp(person.in.x, person.in.y) > 0.3) { dx = person.in.x; dy = person.in.y; }
  }
  const l = hyp(dx, dy) || 1;
  return { dx: dx / l, dy: dy / l };
}
// Teammate a pass is meant for: inside a cone around the aim; power picks near or far
function pickPassTarget(b, dx, dy, power) {
  const ball = sim.ball;
  let best = null, bs = 1e9;
  const want = 6 + Math.pow(power ?? 0.4, 1.3) * 42;
  for (const m of sim.bodies) {
    if (m.team !== b.team || m === b) continue;
    const lead = 0.7;
    const mx = m.x + m.vx * lead - ball.x, my = m.y + m.vy * lead - ball.y, md = hyp(mx, my);
    if (md < 3 || md > 60) continue;
    const ang = Math.acos(clamp((mx * dx + my * dy) / md, -1, 1));
    if (ang > 0.6) continue;
    const score = ang * 30 + Math.abs(md - want) * 0.6;
    if (score < bs) { bs = score; best = { m, mx, my, md }; }
  }
  return best;
}
// Speed for a rolling ball to cover d metres and still be moving at vEnd
function rollSpeed(d, vEnd = 4) {
  const F = (v) => v / 0.35 - (1.6 / (0.35 * 0.35)) * Math.log(1.6 + 0.35 * v);
  let lo = vEnd, hi = 40;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (F(mid) - F(vEnd) < d) lo = mid; else hi = mid; }
  return lo;
}
// Assisted shot aim: point roughly at goal and it goes for the corner you lean to
function shotAim(b, dx, dy) {
  const ball = sim.ball, gx = oppGoalX(b.team);
  const tx = gx - ball.x, ty = FH / 2 - ball.y;
  const off = angDiff(Math.atan2(ty, tx), Math.atan2(dy, dx));
  if (Math.abs(off) >= 0.8) return null;
  const sideAim = Math.abs(off) < 0.06 ? (b.wobble > 3.14 ? 0.35 : -0.35) : clamp(off * 3.5, -1, 1);
  return { x: gx, y: FH / 2 + sideAim * side(b.team) * GW * 0.38 };
}
function doKick(b, q) {
  const ball = sim.ball;
  let { dx, dy } = kickDir(b, q);
  let speed, vz = 0, passTo = null;
  const isGK = roleOf(b) === "GK";
  if (q.type === "pass") {
    const best = pickPassTarget(b, dx, dy, q.power);
    const lofted = q.lob || (best ? best.md > 26 : q.power > 0.75) || (isGK && (!best || best.md > 18));
    if (best) {
      passTo = best.m;
      dx = best.mx / best.md; dy = best.my / best.md;
      if (lofted) {
        const vh = clamp(best.md / 1.25, 12, 26), T = best.md / vh;
        speed = vh; vz = GRAV * T / 2 * 0.92;
      } else speed = clamp(rollSpeed(best.md, 3.5 + (q.power ?? 0.4) * 3), 6, 30);
    } else {
      const d = 6 + (q.power ?? 0.4) * 38;
      if (lofted) { const vh = clamp(d / 1.25, 12, 26); speed = vh; vz = GRAV * (d / vh) / 2 * 0.92; }
      else speed = rollSpeed(d, 2);
    }
    sim.events.push(vz > 0 ? "l" : "k");
  } else {
    const gx = oppGoalX(b.team), td = hyp(gx - ball.x, FH / 2 - ball.y);
    const aim = shotAim(b, dx, dy);
    if (aim) { const ax = aim.x - ball.x, ay = aim.y - ball.y, al = hyp(ax, ay); dx = ax / al; dy = ay / al; }
    const p = q.power;
    const err = (p > 0.85 ? (p - 0.85) * 0.9 : 0.015) + td / 900 + (b.sprint ? 0.03 : 0);
    const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 2 * err;
    dx = Math.cos(a); dy = Math.sin(a);
    speed = 15 + p * 17;
    // Height: a driven shot rises a little; too much power and it can fly over the bar
    const T = td / speed;
    const wantZ = 0.4 + p * 1.5 + (p > 0.85 ? (Math.random()) * (p - 0.85) * 12 : 0);
    vz = clamp((wantZ + 0.5 * GRAV * T * T) / Math.max(T, 0.2), 0.5, 12);
    ball.shot++;
    sim.events.push("K");
  }
  ball.x = b.x + dx * (PR + 0.2); ball.y = b.y + dy * (PR + 0.2); ball.z = Math.max(ball.z, 0.02);
  ball.vx = dx * speed; ball.vy = dy * speed; ball.vz = vz;
  b.face = Math.atan2(dy, dx);
  b.kcd = 0.3; b.lastKick = sim.tick; b.queued = null; b.restartHold = null;
  sim.owner = null; sim.lastTouch = b; sim.lastKicker = b;
  if (passTo) passTo.receiveT = 2.5;
  if (passTo && b.ctrl !== null && passTo.ctrl === null && roleOf(passTo) !== "GK") {
    const person = sim.players.get(b.ctrl);
    if (person) switchPlayer(person, passTo);
  }
}

// =====================================================================
//  HOST: people's controls
// =====================================================================
function isOnBall(b) { return sim.owner === b || (!sim.owner && sim.ball.z < 1 && hyp(sim.ball.x - b.x, sim.ball.y - b.y) < 2.2); }
function handlePeople() {
  for (const person of sim.players.values()) {
    const inp = person.in;
    const newPass = inp.pc !== person.lastP, newShoot = inp.sc !== person.lastS;
    person.lastP = inp.pc; person.lastS = inp.sc;
    if (person.team === "s") { person.lastW = inp.wc; continue; }
    if (inp.wc !== person.lastW) { person.lastW = inp.wc; switchPlayer(person); }
    const b = bodyOf(person);
    if (!b) continue;
    b.ix = inp.x; b.iy = inp.y; b.sprint = inp.r;
    const down = b.tackleT > 0 || b.downT > 0 || b.standT > 0;
    const onBall = isOnBall(b);

    // PASS (hold = more power, longer / lofted)  |  without the ball: TACKLE
    if (newPass && person.passMode === null && !down) {
      if (!onBall) {
        const d = hyp(sim.ball.x - b.x, sim.ball.y - b.y);
        if (d < 1.9) startStandTackle(b); else if (d < 6) startSlide(b);
        person.passMode = "tackle";
      } else if (b.charging !== "shot") person.passMode = "pass";
    }
    if (person.passMode === "pass") {
      if (inp.p) { b.charging = "pass"; b.charge = Math.min(1, b.charge + STEP / 0.75); }
      else { b.queued = { type: "pass", power: Math.max(0.1, b.charge), t: 0.45 }; b.charging = false; b.charge = 0; person.passMode = null; }
    } else if (person.passMode === "tackle" && !inp.p) person.passMode = null;

    // SHOOT (hold for power)  |  without the ball: SWITCH
    if (newShoot && person.shootMode === null) {
      if (!onBall) { switchPlayer(person); person.shootMode = "switched"; }
      else if (!down && b.charging !== "pass") person.shootMode = "shoot";
    }
    if (person.shootMode === "shoot") {
      if (inp.s) { b.charging = "shot"; b.charge = Math.min(1, b.charge + STEP / 0.9); }
      else { b.queued = { type: "shot", power: Math.max(0.2, b.charge), t: 0.45 }; b.charging = false; b.charge = 0; person.shootMode = null; }
    } else if (person.shootMode === "switched" && !inp.s) person.shootMode = null;
  }
}
function startSlide(b) {
  if (b.tackleT > 0 || b.downT > 0) return;
  const tx = sim.ball.x + sim.ball.vx * 0.2 - b.x, ty = sim.ball.y + sim.ball.vy * 0.2 - b.y;
  b.slideA = Math.atan2(ty, tx); b.face = b.slideA; b.tackleT = 0.55; b.won = false; b.fouled = false;
  b.charging = false; b.charge = 0; b.queued = null;
  sim.events.push("t");
}
function startStandTackle(b) {
  if (b.standT > 0) return;
  b.standT = 0.35; b.face = Math.atan2(sim.ball.y - b.y, sim.ball.x - b.x); b.won = false;
}

// =====================================================================
//  HOST: physics step
// =====================================================================
function postList() {
  return [{ x: 0, y: FH / 2 - GW / 2 }, { x: 0, y: FH / 2 + GW / 2 }, { x: FW, y: FH / 2 - GW / 2 }, { x: FW, y: FH / 2 + GW / 2 }];
}
function collideBodies(a, b, ra, rb) {
  const dx = b.x - a.x, dy = b.y - a.y, d = hyp(dx, dy);
  if (d >= ra + rb || d === 0) return false;
  const nx = dx / d, ny = dy / d, over = (ra + rb - d) / 2;
  a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv < 0) { const j = -rv * 0.6; a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny; }
  return true;
}
function canReach(b) {
  const ball = sim.ball, dx = ball.x - b.x, dy = ball.y - b.y, d = hyp(dx, dy);
  if (sim.owner === b) return true;
  if (d > 1.05 || ball.z > 0.8) return false;
  return (dx * Math.cos(b.face) + dy * Math.sin(b.face)) / (d || 1) > -0.3;
}
function inOwnBox(b, x = b.x, y = b.y) {
  return Math.abs(x - ownGoalX(b.team)) < BOX_D && Math.abs(y - FH / 2) < BOX_W / 2;
}

function step() {
  const ball = sim.ball, all = sim.bodies, dt = STEP;
  const frozen = sim.phase === "kickoff" || sim.phase === "half";
  const restart = sim.phase === "restart";
  if (!frozen) for (const b of all) if (b.ctrl === null && b.tackleT <= 0 && b.downT <= 0 && b.standT <= 0) botThink(b, all);

  // ---- move footballers
  for (const b of all) {
    b.kcd = Math.max(0, b.kcd - dt);
    if (b.diveT > 0) b.diveT -= dt;
    let ix = b.ix, iy = b.iy;
    if (b.receiveT > 0) {
      b.receiveT -= dt;
      if (sim.owner) b.receiveT = 0;
      else if (b.ctrl === null || hyp(ix, iy) < 0.2) {
        // Step in to meet the pass (or get under a lofted ball)
        let px, py;
        if (ball.z > 0.3 || ball.vz > 0.5) {
          const tl = (ball.vz + Math.sqrt(ball.vz * ball.vz + 2 * GRAV * Math.max(0, ball.z))) / GRAV;
          px = ball.x + ball.vx * tl; py = ball.y + ball.vy * tl;
        } else {
          const v2 = ball.vx * ball.vx + ball.vy * ball.vy || 1;
          const t = Math.max(0, ((b.x - ball.x) * ball.vx + (b.y - ball.y) * ball.vy) / v2);
          px = ball.x + ball.vx * t; py = ball.y + ball.vy * t;
        }
        const tx = px - b.x, ty = py - b.y, tl2 = hyp(tx, ty);
        if (tl2 > 0.3) { ix = tx / tl2 * Math.min(1, tl2 / 2); iy = ty / tl2 * Math.min(1, tl2 / 2); }
      }
    }
    const len = hyp(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    let top = b.sprint ? 7.8 : 5.4;
    if (sim.owner === b) top *= 0.9;
    if (b.charging) top = 3.2;
    if (b.restartHold && sim.owner === b) top = 0;
    const k = Math.min(1, (b.sprint ? 5.5 : 7) * dt);
    b.vx += (ix * top - b.vx) * k; b.vy += (iy * top - b.vy) * k;
    if (b.tackleT > 0) {
      b.tackleT -= dt;
      const sp = 2 + 8 * Math.max(0, b.tackleT / 0.55);
      b.vx = Math.cos(b.slideA) * sp; b.vy = Math.sin(b.slideA) * sp; b.face = b.slideA;
      if (b.tackleT <= 0) b.downT = 0.55;
    } else if (b.downT > 0) { b.downT -= dt; b.vx *= 0.8; b.vy *= 0.8; }
    if (b.standT > 0) { b.standT -= dt; b.vx *= 0.9; b.vy *= 0.9; }
    if (frozen) b.vx = b.vy = 0;
    b.x += b.vx * dt; b.y += b.vy * dt;

    // Turn towards where you're going
    let want = null, rate = sim.owner === b ? 9 : 13;
    if (b.tackleT > 0 || b.downT > 0) rate = 0;
    if (len > 0.25) want = Math.atan2(iy, ix);
    else if (hyp(b.vx, b.vy) > 0.8) want = Math.atan2(b.vy, b.vx);
    else if (sim.owner !== b) { want = Math.atan2(ball.y - b.y, ball.x - b.x); rate = 5; }
    if (want !== null) b.face += clamp(angDiff(b.face, want), -rate * dt, rate * dt);
  }
  // ---- bumping, posts, nets, edges
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) collideBodies(all[i], all[j], PR, PR);
  const posts = postList();
  for (const b of all) {
    for (const p of posts) { const dx = b.x - p.x, dy = b.y - p.y, d = hyp(dx, dy); if (d < PR + 0.06 && d > 0) { b.x = p.x + dx / d * (PR + 0.06); b.y = p.y + dy / d * (PR + 0.06); } }
    b.x = clamp(b.x, -3, FW + 3); b.y = clamp(b.y, -3, FH + 3);
    if (Math.abs(b.y - FH / 2) < GW / 2 + PR) b.x = clamp(b.x, -0.3, FW + 0.3);       // can't walk into the nets
    if (b.ctrl === null && b.tackleT <= 0 && b.downT <= 0) {
      const tryMove = hyp(b.ix, b.iy) > 0.4, moving = hyp(b.vx, b.vy) > 0.7;
      b.stuckT = tryMove && !moving ? b.stuckT + dt : 0;
      if (b.stuckT > 0.5) {
        const sd = Math.random() < 0.5 ? 1 : -1, l = hyp(b.ix, b.iy) || 1;
        b.unstick = { x: (-b.iy / l) * sd * 0.8 - (b.ix / l) * 0.3, y: (b.ix / l) * sd * 0.8 - (b.iy / l) * 0.3, t: 0.5 };
        b.stuckT = 0;
      }
    }
  }
  // During a restart the other team keeps its distance
  if (restart && sim.restart) {
    const r = sim.restart;
    for (const b of all) if (b.team !== r.team) {
      const dx = b.x - r.x, dy = b.y - r.y, d = hyp(dx, dy) || 1;
      if (d < 8) { b.x = r.x + dx / d * 8; b.y = r.y + dy / d * 8; }
    }
  }
  if (frozen || restart) return;

  // ---- slides and standing tackles
  for (const b of all) {
    if (b.tackleT > 0 && !b.won && !b.fouled) {
      if (hyp(ball.x - b.x, ball.y - b.y) < 1.15 && ball.z < 0.7) {
        if (sim.owner && sim.owner.team !== b.team) sim.owner.kcd = 0.7;
        const a = b.slideA + (Math.random() - 0.5) * 0.8;
        ball.vx = Math.cos(a) * 7 + b.vx * 0.2; ball.vy = Math.sin(a) * 7 + b.vy * 0.2; ball.vz = 0.5;
        sim.owner = null; sim.lastTouch = b; b.won = true;
      } else {
        for (const q of all) {
          if (q.team === b.team || q.downT > 0 || hyp(q.x - b.x, q.y - b.y) > PR * 2 + 0.15) continue;
          // Took the player, not the ball: foul
          b.fouled = true; q.downT = 0.7; q.vx = q.vy = 0;
          awardRestart("free", q.team, clamp(q.x, 1, FW - 1), clamp(q.y, 1, FH - 1));
          return;
        }
      }
    }
    if (b.standT > 0 && !b.won && sim.owner && sim.owner.team !== b.team && hyp(ball.x - b.x, ball.y - b.y) < 1.4) {
      b.won = true;
      const o = sim.owner;
      const fromFront = Math.cos(angDiff(o.face, Math.atan2(b.y - o.y, b.x - o.x))) > -0.2;
      if (Math.random() < (fromFront ? 0.6 : 0.3)) {
        o.kcd = 0.6;
        const a = Math.atan2(ball.y - o.y, ball.x - o.x) + (Math.random() - 0.5) * 1.6;
        ball.vx = Math.cos(a) * 4 + b.vx * 0.3; ball.vy = Math.sin(a) * 4 + b.vy * 0.3;
        sim.owner = null; sim.lastTouch = b; b.kcd = 0.1;
        sim.events.push("t");
      }
    }
  }
  // Pressure: being right on top of the ball carrier wins it now and then
  if (sim.owner) {
    for (const b of all) {
      if (b.team === sim.owner.team || b.kcd > 0 || b.tackleT > 0 || b.downT > 0) continue;
      if (hyp(ball.x - b.x, ball.y - b.y) < 0.7 && Math.random() < 0.005) {
        sim.owner.kcd = 0.5;
        ball.vx = (ball.x - sim.owner.x) * 4 + b.vx * 0.4; ball.vy = (ball.y - sim.owner.y) * 4 + b.vy * 0.4;
        sim.owner = null; sim.lastTouch = b; sim.events.push("t");
        break;
      }
    }
  }

  // ---- who controls the ball?
  if (!sim.owner || true) {
    let best = null, bd = 1e9;
    const fast = hyp(ball.vx, ball.vy);
    for (const b of all) {
      if (b.kcd > 0 || b.tackleT > 0 || b.downT > 0) continue;
      const d = hyp(ball.x - b.x, ball.y - b.y) - (sim.owner === b ? 0.3 : 0);
      const isGK = roleOf(b) === "GK" && inOwnBox(b);
      const goingIn = (ball.vx * -side(b.team)) > 6;
      const reach = isGK ? (goingIn && !sim.owner ? 1.9 : 1.1) : 0.85;
      if (d > reach) continue;
      if (ball.z > (isGK ? 2.7 : 0.95)) continue;
      const rel = hyp(ball.vx - b.vx, ball.vy - b.vy);
      if (sim.owner !== b && rel > 15) {
        if (!isGK) continue;
        if (b.saveRoll !== ball.shot) {
          b.saveRoll = ball.shot;
          const corner = Math.abs(ball.y + ball.vy * 0.2 - FH / 2) / (GW / 2);
          b.saveOk = Math.random() < clamp(1.05 - (fast - 15) * 0.035 - corner * 0.25, 0.25, 0.92);
        }
        if (!b.saveOk) continue;
      }
      if (d < bd) { bd = d; best = b; }
    }
    if (best && best !== sim.owner && roleOf(best) === "GK" && hyp(ball.vx - best.vx, ball.vy - best.vy) > 12) {
      best.diveT = 0.7;
      const lat = -Math.sin(best.face) * (ball.x - best.x) + Math.cos(best.face) * (ball.y - best.y);
      best.diveSide = lat >= 0 ? 1 : -1;
      sim.events.push("s");
      if (fast > 23 || ball.z > 2.0) {           // too hot to hold: parry it away
        ball.vx = -ball.vx * 0.25 + (Math.random() - 0.5) * 6; ball.vy = (Math.random() - 0.5) * 14; ball.vz = 3;
        sim.lastTouch = best; best.kcd = 0.6; best = null;
      }
    }
    if (best !== sim.owner) {
      sim.owner = best;
      if (best) {
        sim.lastTouch = best; best.holdT = 0; best.restartHold = null;
        ball.z = 0; ball.vz = 0;
        if (best.ctrl === null && roleOf(best) !== "GK") {   // a computer teammate won it: the nearest person takes over
          let who = null, wd = 1e9;
          for (const person of sim.players.values()) {
            if (person.team !== best.team) continue;
            const pb = bodyOf(person); const d = pb ? hyp(pb.x - best.x, pb.y - best.y) : 0;
            if (d < wd) { wd = d; who = person; }
          }
          if (who) switchPlayer(who, best);
        }
      }
    }
  }

  // ---- queued kicks fire when the ball is at the foot
  for (const b of all) {
    if (!b.queued) continue;
    b.queued.t -= dt;
    if (canReach(b) && b.kcd <= 0) doKick(b, b.queued);
    else if (b.queued.t <= 0) b.queued = null;
  }

  // ---- headers: a ball at head height near a player gets nodded on
  if (!sim.owner && ball.z > 1.15 && ball.z < 2.5) {
    for (const b of all) {
      if (b.kcd > 0 || b.tackleT > 0 || b.downT > 0 || hyp(ball.x - b.x, ball.y - b.y) > 0.75) continue;
      if (roleOf(b) === "GK" && inOwnBox(b)) continue;
      const gx = oppGoalX(b.team), toGoal = hyp(gx - ball.x, FH / 2 - ball.y);
      let a, sp, vz;
      if (toGoal < 18) {
        const ty = FH / 2 + (Math.random() - 0.5) * GW * 0.9;
        a = Math.atan2(ty - ball.y, gx - ball.x); sp = 13; vz = -0.5; ball.shot++;
      } else { a = Math.atan2(FH / 2 - ball.y, gx - ball.x) + (Math.random() - 0.5) * 1.2; sp = 10; vz = 3.5; }
      ball.vx = Math.cos(a) * sp; ball.vy = Math.sin(a) * sp; ball.vz = vz;
      b.kcd = 0.4; b.lastHead = sim.tick; b.face = a; sim.lastTouch = b; sim.lastKicker = b;
      sim.events.push("h");
      break;
    }
  }

  // ---- the ball
  if (sim.owner) {
    const o = sim.owner;
    o.holdT += dt;
    const sp = hyp(o.vx, o.vy);
    o.dribPh += sp * dt;
    const touch = sp > 1 ? (1 - Math.cos(o.dribPh / 1.1)) * 0.22 * Math.min(1, sp / 5) : 0;
    const reach = PR + 0.2 + touch;
    const tx = o.x + Math.cos(o.face) * reach, ty = o.y + Math.sin(o.face) * reach;
    ball.vx = o.vx + (tx - ball.x) * 14; ball.vy = o.vy + (ty - ball.y) * 14; ball.vz = 0; ball.z = 0;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
  } else {
    if (ball.z > 0 || ball.vz > 0) {
      ball.vz -= GRAV * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.z += ball.vz * dt;
      ball.vx *= 1 - 0.06 * dt; ball.vy *= 1 - 0.06 * dt;
      if (ball.z <= 0) {
        ball.z = 0;
        if (ball.vz < -1.8) { ball.vz = -ball.vz * 0.45; ball.vx *= 0.82; ball.vy *= 0.82; } else ball.vz = 0;
      }
    } else {
      const s = hyp(ball.vx, ball.vy);
      if (s > 0) { const s2 = Math.max(0, s - (1.6 + 0.35 * s) * dt); ball.vx *= s2 / s; ball.vy *= s2 / s; }
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    }
    if (ball.z < 1.9) for (const b of all) {
      const dx = ball.x - b.x, dy = ball.y - b.y, d = hyp(dx, dy);
      if (d < PR + BR && d > 0) {
        const nx = dx / d, ny = dy / d;
        ball.x = b.x + nx * (PR + BR); ball.y = b.y + ny * (PR + BR);
        const rv = (ball.vx - b.vx) * nx + (ball.vy - b.vy) * ny;
        if (rv < 0) { ball.vx -= 1.35 * rv * nx; ball.vy -= 1.35 * rv * ny; }
        sim.lastTouch = b;
      }
    }
  }
  // Posts and crossbar
  if (ball.z < GH + BR) for (const p of posts) {
    const dx = ball.x - p.x, dy = ball.y - p.y, d = hyp(dx, dy);
    if (d < 0.06 + BR && d > 0) {
      const nx = dx / d, ny = dy / d, rv = ball.vx * nx + ball.vy * ny;
      ball.x = p.x + nx * (0.06 + BR + 0.01); ball.y = p.y + ny * (0.06 + BR + 0.01);
      if (rv < 0) { ball.vx -= 1.7 * rv * nx; ball.vy -= 1.7 * rv * ny; }
      sim.owner = null; sim.events.push("p");
    }
  }
  for (const gx of [0, FW]) {
    const crossing = (ball.x - gx) * (ball.x - ball.vx * dt - gx) <= 0;
    if (crossing && Math.abs(ball.y - FH / 2) < GW / 2 && Math.abs(ball.z - GH) < 0.16) {
      ball.vz = -Math.abs(ball.vz) * 0.5 - 1; ball.vx = -ball.vx * 0.5; ball.x = gx + (gx === 0 ? 0.15 : -0.15);
      sim.events.push("p");
    }
  }

  // ---- goal, or out of play
  if (sim.phase !== "play" && sim.phase !== "warm") return;
  const inMouth = Math.abs(ball.y - FH / 2) < GW / 2 - BR && ball.z < GH - BR;
  if ((ball.x < -BR || ball.x > FW + BR) && inMouth) {
    if (sim.phase === "warm") { Object.assign(ball, { x: FW / 2, y: FH / 2, z: 0, vx: 0, vy: 0, vz: 0 }); sim.owner = null; return; }
    const end = ball.x < 0 ? 0 : FW;
    const scored = ownGoalX("r") === end ? "b" : "r";
    sim.score[scored === "r" ? 0 : 1]++;
    sim.kickTeam = scored === "r" ? "b" : "r";
    let lt = sim.lastTouch;
    if (lt && lt.team !== scored && sim.lastKicker && sim.lastKicker.team === scored) lt = sim.lastKicker;
    if (lt && lt.team !== scored) sim.scorer = "Own goal";
    else if (lt && lt.ctrl !== null && sim.players.get(lt.ctrl)) sim.scorer = sim.players.get(lt.ctrl).name;
    else if (lt) sim.scorer = TEAM_NAME[scored] + " #" + SLOTS[lt.slot][3];
    else sim.scorer = TEAM_NAME[scored];
    sim.owner = null; ball.vx *= 0.25; ball.vy *= 0.25;
    sim.phase = "goal"; sim.phaseT = 3.2; sim.banner = "";
    sim.events.push("g");
    return;
  }
  if (ball.y < -BR || ball.y > FH + BR) {
    if (sim.phase === "warm") { Object.assign(ball, { x: FW / 2, y: FH / 2, z: 0, vx: 0, vy: 0, vz: 0 }); return; }
    const team = sim.lastTouch && sim.lastTouch.team === "r" ? "b" : "r";
    awardRestart("throw", team, clamp(ball.x, 1, FW - 1), ball.y < 0 ? 0 : FH);
    return;
  }
  if (ball.x < -BR || ball.x > FW + BR) {
    if (sim.phase === "warm") { Object.assign(ball, { x: FW / 2, y: FH / 2, z: 0, vx: 0, vy: 0, vz: 0 }); return; }
    const end = ball.x < 0 ? 0 : FW;
    const defending = ownGoalX("r") === end ? "r" : "b";
    const attacking = defending === "r" ? "b" : "r";
    if (sim.lastTouch && sim.lastTouch.team === defending) awardRestart("corner", attacking, end === 0 ? 0.3 : FW - 0.3, ball.y < FH / 2 ? 0.3 : FH - 0.3);
    else awardRestart("goalkick", defending, end === 0 ? SIX_D : FW - SIX_D, FH / 2 + (ball.y < FH / 2 ? -SIX_W / 4 : SIX_W / 4));
  }
}

// =====================================================================
//  HOST: computer players
// =====================================================================
function goTo(b, tx, ty, speed, sprint = false) {
  const dx = tx - b.x, dy = ty - b.y, d = hyp(dx, dy);
  const sp = speed * Math.min(1, d / 1.5);
  let ux = d > 0.15 ? dx / d : 0, uy = d > 0.15 ? dy / d : 0;
  for (const o of sim.bodies) {   // step around other players
    if (o === b) continue;
    const rx = o.x - b.x, ry = o.y - b.y, rd = hyp(rx, ry);
    if (rd > d || rd > PR * 2 + 0.9 || rx * ux + ry * uy <= 0) continue;
    let t1 = -ry / rd, t2 = rx / rd;
    const along = t1 * ux + t2 * uy;
    if (Math.abs(along) < 0.3) { if (t1 * (FW / 2 - b.x) + t2 * (FH / 2 - b.y) < 0) { t1 = -t1; t2 = -t2; } }
    else if (along < 0) { t1 = -t1; t2 = -t2; }
    ux = ux * 0.3 + t1; uy = uy * 0.3 + t2;
    const l = hyp(ux, uy) || 1; ux /= l; uy /= l;
  }
  b.ix = ux * sp; b.iy = uy * sp; b.sprint = sprint && d > 4;
}
function nearestOpp(b, all, x = b.x, y = b.y) {
  let best = null, bd = 1e9;
  for (const q of all) if (q.team !== b.team) { const d = hyp(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
  return { q: best, d: bd };
}
function laneClear(all, team, x0, y0, x1, y1, width) {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
  let m = 1e9;
  for (const q of all) {
    if (q.team === team) continue;
    const t = clamp(((q.x - x0) * dx + (q.y - y0) * dy) / L2, 0, 1);
    m = Math.min(m, hyp(x0 + dx * t - q.x, y0 + dy * t - q.y));
  }
  return m > width ? m : 0;
}
function bestPass(b, all, maxD, forwardOnly = false) {
  const sd = side(b.team);
  let best = null, bs = -1e9;
  for (const m of all) {
    if (m.team !== b.team || m === b || roleOf(m) === "GK") continue;
    const tx = m.x + m.vx * 0.6, ty = m.y + m.vy * 0.6, d = hyp(tx - b.x, ty - b.y);
    if (d < 5 || d > maxD) continue;
    const open = Math.min(nearestOpp(m, all, tx, ty).d, 10);
    const lane = laneClear(all, b.team, b.x, b.y, tx, ty, 1.2);
    const lob = !lane && d > 14 && open > 4;
    if (!lane && !lob) continue;
    const prog = (tx - b.x) * sd;
    if (forwardOnly && (prog < 8 || open < 4)) continue;
    // Forward passes into space are worth most; going backwards costs
    const score = prog * (prog > 0 ? 1 : 2) + Math.min(open, 8) * 1.2 + (lane ? Math.min(lane, 4) : 0) - d * 0.05 - (lob ? 3 : 0);
    if (score > bs) { bs = score; best = { m, tx, ty, d, lob, prog, open }; }
  }
  return best;
}
function queuePassTo(b, p, extraLob = false) {
  const dx = p.tx - b.x, dy = p.ty - b.y, d = hyp(dx, dy);
  b.queued = { type: "pass", t: 0.25, power: clamp((d - 6) / 42, 0.1, 1), lob: p.lob || extraLob || d > 28, dir: { x: dx / d, y: dy / d } };
}

function botThink(b, all) {
  const ball = sim.ball, sd = side(b.team), own = ownGoalX(b.team), gx = oppGoalX(b.team);
  if (b.unstick && b.unstick.t > 0) { b.unstick.t -= STEP; b.ix = b.unstick.x; b.iy = b.unstick.y; b.sprint = false; return; }
  const dist = (q) => hyp(ball.x - q.x, ball.y - q.y);
  const r = roleOf(b);

  // Restarts: the taker walks up to the ball, the rest take up positions
  if (sim.phase === "restart" && sim.restart) {
    const rs = sim.restart;
    if (rs.taker === b.id) { goTo(b, rs.x, rs.y, 1); return; }
    const home = slotPos(b.team, b.slot);
    let tx = home.x + (ball.x - FW / 2) * 0.5, ty = home.y * 0.7 + ball.y * 0.3;
    if (rs.type === "corner") {
      if (rs.team === b.team && r !== "GK" && r !== "DF") { tx = gx - sd * (SIX_D + 3 + b.slot % 3 * 3); ty = FH / 2 + ((b.slot % 3) - 1) * 4; }
      if (rs.team !== b.team && r !== "GK") { tx = own + sd * (SIX_D + 1 + b.slot % 4 * 2); ty = FH / 2 + ((b.slot % 5) - 2) * 3; }
    }
    if (r === "GK") { tx = own + sd * 1.2; ty = FH / 2; }
    goTo(b, clamp(tx, 2, FW - 2), clamp(ty, 2, FH - 2), 0.8);
    return;
  }

  if (sim.owner === b) { botWithBall(b, all); return; }
  const weHaveIt = sim.owner && sim.owner.team === b.team;
  const theyHaveIt = sim.owner && sim.owner.team !== b.team;

  // ---- goalkeeper
  if (r === "GK") {
    const inBox = Math.abs(ball.x - own) < BOX_D && Math.abs(ball.y - FH / 2) < BOX_W / 2;
    const others = Math.min(...all.filter((q) => q !== b).map(dist));
    if (inBox && !weHaveIt && ball.z < 2 && dist(b) < others + 1.5) { goTo(b, ball.x, ball.y, 1, true); return; }
    // On the line between ball and goal, coming out a little as the ball gets near
    const dGoal = hyp(ball.x - own, ball.y - FH / 2);
    const out = clamp(1 + (40 - dGoal) * 0.06, 0.8, 4);
    const a = Math.atan2(ball.y - FH / 2, (ball.x - own) * sd);
    let tx = own + sd * Math.cos(a) * out, ty = FH / 2 + Math.sin(a) * out;
    if (!sim.owner && ball.vx * sd < -6) {      // shot coming: get across
      const lineX = own + sd * 0.8, t = (lineX - ball.x) / ball.vx;
      if (t > 0) ty = ball.y + ball.vy * t;
    }
    goTo(b, tx, clamp(ty, FH / 2 - GW / 2 - 0.5, FH / 2 + GW / 2 + 0.5), 1, true);
    return;
  }

  // ---- who presses
  let chaser = null, cover = null;
  if (!weHaveIt) {
    const free = all.filter((q) => q.team === b.team && q.ctrl === null && roleOf(q) !== "GK" && q.downT <= 0 && q.tackleT <= 0)
      .sort((p, q) => dist(p) - dist(q));
    chaser = free[0] || null;
    if (Math.abs(ball.x - own) < FW * 0.45) cover = free[1] || null;
    const cd = chaser ? dist(chaser) : 1e9;
    if (all.some((q) => q.team === b.team && q.ctrl !== null && dist(q) < 3 && dist(q) < cd)) { cover = chaser; chaser = null; }
  }
  if (b === chaser) {
    let px = ball.x, py = ball.y;
    if (!sim.owner) {   // run to where the ball will be
      const t = Math.min(1.5, dist(b) / 7);
      px += ball.vx * t * 0.7; py += ball.vy * t * 0.7;
      if (ball.z > 0.5) { const tl = (ball.vz + Math.sqrt(ball.vz * ball.vz + 2 * GRAV * ball.z)) / GRAV; px = ball.x + ball.vx * tl; py = ball.y + ball.vy * tl; }
    } else {
      const o = sim.owner;   // approach from the goal side
      px = ball.x - sd * 0.6; py = ball.y;
      // Tackle now and then (not every frame): jockey first, then go in
      b.tackleCd = (b.tackleCd || 0) - STEP;
      if (b.tackleCd <= 0 && hyp(o.x - b.x, o.y - b.y) < 2) {
        b.tackleCd = 1.2 + Math.random() * 1.2;
        if (Math.random() < 0.85) startStandTackle(b);
        else if (Math.cos(angDiff(o.face, Math.atan2(b.y - o.y, b.x - o.x))) > 0) startSlide(b);
      }
    }
    goTo(b, clamp(px, -1, FW + 1), clamp(py, -1, FH + 1), 1, dist(b) > 5);
    return;
  }
  if (b === cover) {
    goTo(b, ball.x + (own - ball.x) * 0.3, ball.y + (FH / 2 - ball.y) * 0.3, 1, dist(b) > 10);
    return;
  }
  // ---- team shape: slide with the ball, push up when we have it
  const home = slotPos(b.team, b.slot);
  const push = weHaveIt ? { FW: 0.17, MF: 0.11, DF: 0.06 }[r] * FW : (theyHaveIt ? -0.02 * FW : 0);
  let tx = home.x + (ball.x - FW / 2) * 0.55 + sd * push;
  let ty = home.y * 0.72 + ball.y * 0.28 + Math.sin(sim.tick / 120 + b.wobble) * 2;
  if (weHaveIt && r === "FW") ty += Math.sin(sim.tick / 90 + b.wobble) * 4;      // forwards make runs
  if (!weHaveIt && r === "DF" && (ball.x - tx) * sd < 6) tx = ball.x - sd * 9;    // stay goal-side
  // Don't run past the last defender (keep onside)
  if (weHaveIt) {
    const defs = all.filter((q) => q.team !== b.team && roleOf(q) !== "GK").map((q) => q.x * sd);
    const line = defs.length ? Math.max(...defs) : FW;
    if (tx * sd > Math.max(line, ball.x * sd)) tx = Math.max(line, ball.x * sd) / sd;
  }
  goTo(b, clamp(tx, 2, FW - 2), clamp(ty, 2, FH - 2), 0.85, hyp(tx - b.x, ty - b.y) > 14);
}

function botWithBall(b, all) {
  if (b.queued) return;
  const sd = side(b.team), gx = oppGoalX(b.team), r = roleOf(b);
  const toGoal = hyp(gx - b.x, FH / 2 - b.y), goalAng = Math.atan2(FH / 2 - b.y, gx - b.x);
  // Restarts: play it straight away
  if (b.restartHold) {
    if (b.restartHold === "corner") {
      const inBox = all.filter((m) => m.team === b.team && m !== b && Math.abs(m.x - gx) < BOX_D && Math.abs(m.y - FH / 2) < BOX_W / 2);
      const t = inBox[Math.floor(Math.random() * inBox.length)];
      const tx = t ? t.x : gx - sd * SPOT_D, ty = t ? t.y : FH / 2;
      queuePassTo(b, { tx, ty, lob: true }, true);
    } else {
      const p = bestPass(b, all, b.restartHold === "throw" ? 22 : 55);
      if (p) queuePassTo(b, p);
      else { const tx = b.x + sd * 25, ty = FH / 2; queuePassTo(b, { tx, ty, lob: true }, true); }
    }
    return;
  }
  if (r === "GK") {
    goTo(b, b.x, b.y, 0);
    if (b.holdT > 1) { const p = bestPass(b, all, 60); if (p) queuePassTo(b, p, p.d > 20); else queuePassTo(b, { tx: b.x + sd * 40, ty: FH / 2, lob: true }, true); }
    return;
  }
  const near = nearestOpp(b, all);
  // Shoot when in range and nobody is in the way
  const lane = laneClear(all.filter((q) => roleOf(q) !== "GK"), b.team, b.x, b.y, gx, FH / 2, 0.8);
  if (toGoal < 25 && lane && Math.abs(angDiff(b.face, goalAng)) < 1.0) {
    const ty = FH / 2 + (Math.random() < 0.5 ? -1 : 1) * GW * (0.25 + Math.random() * 0.15);
    const a = Math.atan2(ty - b.y, gx - b.x);
    b.queued = { type: "shot", power: clamp(0.45 + toGoal / 60 + Math.random() * 0.2, 0.4, 0.9), t: 0.25, dir: { x: Math.cos(a), y: Math.sin(a) } };
    return;
  }
  // Wide near the byline: cross it in
  if (Math.abs(b.x - gx) < BOX_D * 0.9 && Math.abs(b.y - FH / 2) > BOX_W / 2 - 2) {
    const inBox = all.filter((m) => m.team === b.team && m !== b && Math.abs(m.x - gx) < BOX_D && Math.abs(m.y - FH / 2) < BOX_W / 2 - 2);
    const t = inBox.sort((p, q) => nearestOpp(q, all).d - nearestOpp(p, all).d)[0];
    queuePassTo(b, { tx: t ? t.x : gx - sd * SPOT_D, ty: t ? t.y : FH / 2, lob: true }, true);
    return;
  }
  // Under pressure (someone right in front): pass. A teammate making a good run: play him in.
  const inFront = near.q && (near.q.x - b.x) * sd > -0.5;
  const pressed = near.d < 2.3 && inFront;
  if (pressed && b.holdT > 0.3) {
    const p = bestPass(b, all, 35);
    if (p) { queuePassTo(b, p); return; }
  }
  if (b.holdT > 0.5 && Math.random() < 0.03) {
    const p = bestPass(b, all, 45, true);
    if (p) { queuePassTo(b, p); return; }
  }
  if (b.holdT > 5) {
    const p = bestPass(b, all, 50);
    if (p) queuePassTo(b, p); else queuePassTo(b, { tx: b.x + sd * 30, ty: FH / 2, lob: true }, true);
    return;
  }
  // Dribble towards goal, going round whoever is in front; wingers go down the line
  let tx = gx - sd * BOX_D * 0.8, ty = FH / 2;
  if ((r === "FW" || r === "MF") && Math.abs(b.y - FH / 2) > FH * 0.25) { tx = gx - sd * 6; ty = b.y; }
  for (const q of all) {
    if (q.team === b.team) continue;
    const qx = q.x - b.x, qy = q.y - b.y, qd = hyp(qx, qy);
    if (qd < 6 && qx * sd > 0) ty += (b.y < q.y ? -1 : 1) * 8;
  }
  const space = near.d > 7 || (near.q && (near.q.x - b.x) * sd < 0);
  goTo(b, tx, clamp(ty, 2, FH - 2), 0.95, space);
}

// =====================================================================
//  HOST: loop and sending the match to everyone
// =====================================================================
function hostUpdate() {
  const me = sim.players.get(0);
  if (me) me.in = readInput();
  handlePeople();
  step();
  const ph = sim.phase;
  if (ph === "play" || ph === "restart") {
    sim.elapsed += STEP;
    if (sim.half === 1 && sim.elapsed >= matchLen / 2 && ph === "play") {
      sim.phase = "half"; sim.phaseT = 3.5; sim.banner = "HALF TIME"; sim.events.push("H");
    } else if (sim.elapsed >= matchLen && ph === "play") {
      sim.elapsed = matchLen; sim.phase = "end"; sim.banner = "FULL TIME"; sim.events.push("e");
    }
  }
  if (ph === "restart") { sim.phaseT -= STEP; if (sim.phaseT <= 0) beginRestartPlay(); }
  else if (ph === "goal") { sim.phaseT -= STEP; if (sim.phaseT <= 0) { placeForKickoff(); sim.phase = "kickoff"; sim.phaseT = 2; } }
  else if (ph === "half") {
    sim.phaseT -= STEP;
    if (sim.phaseT <= 0) { sim.half = 2; sim.swap = true; sim.kickTeam = sim.firstKick === "r" ? "b" : "r"; placeForKickoff(); sim.phase = "kickoff"; sim.phaseT = 2; sim.banner = ""; }
  } else if (ph === "kickoff") {
    sim.phaseT -= STEP;
    if (sim.phaseT <= 0) {
      sim.phase = "play"; sim.events.push("w");
      const kt = sim.kickTeam, tk = sim.bodies.filter((b) => b.team === kt).sort((a, b) => hyp(a.x - FW / 2, a.y - FH / 2) - hyp(b.x - FW / 2, b.y - FH / 2))[0];
      if (tk) { sim.owner = tk; sim.lastTouch = tk; tk.holdT = 0; }
    }
  }
}
let hostLast = 0, hostAcc = 0;
function hostLoop() {
  const now = performance.now();
  if (!hostLast) hostLast = now;
  hostAcc += Math.min(0.25, (now - hostLast) / 1000);
  hostLast = now;
  while (hostAcc >= STEP) {
    hostUpdate(); hostAcc -= STEP; sim.tick++;
    if (sim.tick % 3 === 0) sendState();
  }
}
const r2 = (v) => Math.round(v * 100) / 100;
function bodyFlags(b) {
  return (b.charging ? 1 : 0) | (sim.tick - b.lastKick < 16 ? 2 : 0) | (sim.owner === b ? 4 : 0) | (b.tackleT > 0 ? 8 : 0) |
    (b.diveT > 0 ? 16 : 0) | (b.charging === "pass" ? 32 : 0) | (b.downT > 0 ? 64 : 0) | (b.sprint && hyp(b.vx, b.vy) > 6 ? 128 : 0) |
    (b.standT > 0 ? 256 : 0) | (b.lastHead && sim.tick - b.lastHead < 20 ? 512 : 0) | (b.diveSide > 0 ? 1024 : 0);
}
function kickPreview(b) {
  if (!b.charging || b.ctrl === null) return [-1, 0, 0];
  const { dx, dy } = kickDir(b, null);
  if (b.charging === "pass") { const t = pickPassTarget(b, dx, dy, b.charge); return [t ? t.m.id : -1, 0, 0]; }
  const aim = shotAim(b, dx, dy);
  return aim ? [-1, r2(aim.x), r2(aim.y)] : [-1, r2(sim.ball.x + dx * 20), r2(sim.ball.y + dy * 20)];
}
function sendState() {
  const msg = {
    t: "s", T: Math.round(performance.now()),
    b: [r2(sim.ball.x), r2(sim.ball.y), r2(sim.ball.z)],
    p: sim.bodies.map((b) => [b.id, r2(b.x), r2(b.y), r2(b.face), bodyFlags(b), b.team === "r" ? 0 : 1, b.slot,
      b.ctrl === null ? -1 : b.ctrl, Math.round(b.charge * 20), r2(b.vx), r2(b.vy), ...kickPreview(b)]),
    sc: sim.score, el: Math.round(sim.elapsed * 10) / 10, ph: sim.phase, pt: r2(sim.phaseT), sn: sim.scorer,
    ob: sim.owner ? sim.owner.id : -1, h: sim.half, sw: sim.swap ? 1 : 0, bn: sim.banner, sz: teamSize, ml: matchLen,
  };
  if (sim.events.length) { msg.e = sim.events; sim.events.forEach(playEvent); sim.events = []; }
  broadcast(msg);
}

// =====================================================================
//  CLIENT: joining, receiving the match, predicting your own player
// =====================================================================
const snaps = [];
let clockOffset = null, lastSnapAt = 0;
function startClient(name, code, tries = 0) {
  roomCode = code;
  $("startMsg").textContent = "Connecting to " + code + "…";
  peer = new Peer(peerOptions());
  let opened = false;
  const timer = setTimeout(() => {
    if (opened) return;
    if (tries < 1) { try { peer.destroy(); } catch (e) {} startClient(name, code, tries + 1); return; }
    showError("Can't connect", "The game " + code + " did not answer. The host may have closed it, or the network is blocking it. Ask the host for a new link.");
  }, 15000);
  peer.on("open", () => {
    hostConn = peer.connect(ID_PREFIX + code, { serialization: "json", reliable: true });
    hostConn.on("open", () => { opened = true; clearTimeout(timer); role = "client"; hostConn.send({ t: "h", n: name }); enterGame(); });
    hostConn.on("data", onHostData);
    hostConn.on("close", () => { if (opened) showError("Game ended", "The host left or the connection dropped."); });
  });
  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") { clearTimeout(timer); showError("Game not found", "No game with code " + code + " is running. The host may have closed it. Ask them for a new link."); }
    else if (!opened && err.type !== "disconnected") { clearTimeout(timer); showError("Can't connect", "Could not reach the game server. Check your internet and try again. (" + err.type + ")"); }
  });
}
let rtt = 120;
function onHostData(m) {
  if (!m || typeof m !== "object") return;
  if (m.t === "w") myId = m.id;
  else if (m.t === "po") rtt += (performance.now() - m.c - rtt) * 0.3;
  else if (m.t === "r") {
    roster = m.L.map(([id, name, team]) => ({ id, name, team }));
    matchLen = m.ml; botsOn = !!m.bo;
    if (m.sz && m.sz !== teamSize) { applySize(m.sz); sizeChanged(); }
    updateMenu();
  } else if (m.t === "s") {
    const now = performance.now(), d = now - m.T;
    if (clockOffset === null || d < clockOffset) clockOffset = d; else clockOffset += (d - clockOffset) * 0.01;
    if (m.sz && m.sz !== teamSize) { applySize(m.sz); sizeChanged(); }
    snaps.push(m); lastSnapAt = now;
    if (snaps.length > 40) snaps.shift();
    if (m.e) m.e.forEach(playEvent);
  }
}
setInterval(() => { if (role === "client" && hostConn && hostConn.open) hostConn.send({ t: "pg", c: performance.now() }); }, 2000);
let lastSent = "", lastSentAt = 0;
setInterval(() => {
  if (role !== "client" || !hostConn || !hostConn.open) return;
  const inp = readInput();
  const msg = { t: "i", x: +inp.x.toFixed(2), y: +inp.y.toFixed(2), s: inp.s ? 1 : 0, p: inp.p ? 1 : 0, r: inp.r ? 1 : 0, sc: inp.sc, pc: inp.pc, wc: inp.wc };
  const key = JSON.stringify(msg), now = performance.now();
  if (key !== lastSent || now - lastSentAt > 250) { hostConn.send(msg); lastSent = key; lastSentAt = now; }
}, 1000 / 30);

const INTERP_MS = 110;
function clientView(frameDt) {
  if (!snaps.length) return;
  const rt = performance.now() - clockOffset - INTERP_MS;
  let a = snaps[snaps.length - 1], b = a, f = 0;
  for (let i = snaps.length - 1; i > 0; i--) {
    if (snaps[i - 1].T <= rt) { a = snaps[i - 1]; b = snaps[i]; f = clamp((rt - a.T) / Math.max(1, b.T - a.T), 0, 1); break; }
  }
  if (rt < snaps[0].T) { a = b = snaps[0]; f = 0; }
  const L = (x, y) => x + (y - x) * f;
  const pa = new Map(a.p.map((p) => [p[0], p]));
  view.ball = { x: L(a.b[0], b.b[0]), y: L(a.b[1], b.b[1]), z: L(a.b[2], b.b[2]) };
  view.players = b.p.map((q) => {
    const o = pa.get(q[0]) || q, ctrl = q[7] === -1 ? null : q[7];
    const r = ctrl !== null ? roster.find((r) => r.id === ctrl) : null;
    return { id: q[0], x: L(o[1], q[1]), y: L(o[2], q[2]), a: o[3] + angDiff(o[3], q[3]) * f, k: q[4], team: q[5] ? "b" : "r",
      slot: q[6], ctrl, charge: q[8] / 20, vx: q[9], vy: q[10], name: r ? r.name : "", tgt: q[11], ax: q[12], ay: q[13] };
  });
  const last = snaps[snaps.length - 1];
  Object.assign(view, { score: last.sc, phase: last.ph, phaseT: last.pt, elapsed: last.el, scorer: last.sn, ob: last.ob,
    half: last.h, swap: !!last.sw, banner: last.bn });
  matchLen = last.ml || matchLen;
  predictMe(last, frameDt);
}
// Your own player answers your thumb at once; it's kept in line with the host
let pred = null;
function predictMe(last, frameDt) {
  const me = view.players.find((p) => p.ctrl !== null && p.ctrl === myId);
  if (!me) { pred = null; return; }
  const q = last.p.find((x) => x[0] === me.id);
  if (!q) return;
  const ahead = clamp((rtt / 2 + (performance.now() - lastSnapAt)) / 1000, 0, 0.3);
  const sx = q[1] + q[9] * ahead, sy = q[2] + q[10] * ahead;
  const busy = view.phase === "kickoff" || view.phase === "half" || (q[4] & (8 | 64 | 16));
  if (!pred || pred.id !== me.id || busy) { pred = { id: me.id, x: q[1], y: q[2], vx: q[9], vy: q[10], a: q[3] }; if (busy) return; }
  const inp = readInput();
  let top = inp.r ? 7.8 : 5.4;
  if (view.ob === me.id) top *= 0.9;
  if (q[4] & 1) top = 3.2;
  const k = Math.min(1, (inp.r ? 5.5 : 7) * frameDt);
  pred.vx += (inp.x * top - pred.vx) * k; pred.vy += (inp.y * top - pred.vy) * k;
  pred.x += pred.vx * frameDt; pred.y += pred.vy * frameDt;
  const err = hyp(sx - pred.x, sy - pred.y);
  const pull = err > 3 ? 1 : Math.min(1, frameDt * 5);
  pred.x += (sx - pred.x) * pull; pred.y += (sy - pred.y) * pull;
  if (hyp(inp.x, inp.y) > 0.25) pred.a += clamp(angDiff(pred.a, Math.atan2(inp.y, inp.x)), -13 * frameDt, 13 * frameDt);
  else pred.a += angDiff(pred.a, q[3]) * 0.2;
  me.x = pred.x; me.y = pred.y; me.a = pred.a;
  if (view.ob === me.id) view.ball = { x: me.x + Math.cos(me.a) * (PR + 0.2), y: me.y + Math.sin(me.a) * (PR + 0.2), z: 0 };
}
function hostView() {
  view.ball = { x: sim.ball.x, y: sim.ball.y, z: sim.ball.z };
  view.players = sim.bodies.map((b) => {
    const p = b.ctrl !== null ? sim.players.get(b.ctrl) : null, pv = kickPreview(b);
    return { id: b.id, x: b.x, y: b.y, a: b.face, k: bodyFlags(b), team: b.team, slot: b.slot, ctrl: b.ctrl, charge: b.charge,
      vx: b.vx, vy: b.vy, name: p ? p.name : "", tgt: pv[0], ax: pv[1], ay: pv[2] };
  });
  Object.assign(view, { score: sim.score, phase: sim.phase, phaseT: sim.phaseT, elapsed: sim.elapsed, scorer: sim.scorer,
    ob: sim.owner ? sim.owner.id : -1, half: sim.half, swap: sim.swap, banner: sim.banner });
}

// =====================================================================
//  3D: renderer, stadium, players, ball, camera
// =====================================================================
const glCanvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1426);
scene.fog = new THREE.Fog(0x0a1426, 140, 320);
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
scene.add(new THREE.HemisphereLight(0xe8eeff, 0x26361e, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-30, 80, 40); scene.add(sun);

const W3 = (x, y, z = 0) => new THREE.Vector3(x - FW / 2, z, y - FH / 2);   // sim -> three.js
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const shadowTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const flatPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

let stadium = null;
function buildStadium() {
  if (stadium) { scene.remove(stadium); stadium.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  stadium = new THREE.Group(); scene.add(stadium);
  const M = 7;                       // grass beyond the lines
  const pxm = 14, tw = Math.round((FW + 2 * M) * pxm), th = Math.round((FH + 2 * M) * pxm);
  // Pitch: mown stripes and lines painted into one texture
  const pitchTex = canvasTex(tw, th, (g) => {
    const rnd = seeded(3);
    g.fillStyle = "#2c7d3a"; g.fillRect(0, 0, tw, th);
    const n = 14;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? "#2f8640" : "#348f45"; g.fillRect((M + i * FW / n) * pxm, M * pxm, FW / n * pxm, FH * pxm); }
    for (let i = 0; i < 9000; i++) { g.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.04)"; g.fillRect(rnd() * tw, rnd() * th, 2, 2); }
    const P = (v) => (v + M) * pxm;
    g.strokeStyle = "rgba(255,255,255,0.92)"; g.lineWidth = 0.12 * pxm; g.fillStyle = "#fff";
    g.strokeRect(P(0), P(0), FW * pxm, FH * pxm);
    g.beginPath(); g.moveTo(P(FW / 2), P(0)); g.lineTo(P(FW / 2), P(FH)); g.stroke();
    g.beginPath(); g.arc(P(FW / 2), P(FH / 2), CIRCLE_R * pxm, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(P(FW / 2), P(FH / 2), 0.25 * pxm, 0, Math.PI * 2); g.fill();
    for (const e of [0, 1]) {
      const x0 = e ? FW - BOX_D : 0, s0 = e ? FW - SIX_D : 0, spot = e ? FW - SPOT_D : SPOT_D;
      g.strokeRect(P(x0), P(FH / 2 - BOX_W / 2), BOX_D * pxm, BOX_W * pxm);
      g.strokeRect(P(s0), P(FH / 2 - SIX_W / 2), SIX_D * pxm, SIX_W * pxm);
      g.beginPath(); g.arc(P(spot), P(FH / 2), 0.25 * pxm, 0, Math.PI * 2); g.fill();
      const dA = Math.acos(clamp((BOX_D - SPOT_D) / (CIRCLE_R), -1, 1));
      g.beginPath(); if (e) g.arc(P(spot), P(FH / 2), CIRCLE_R * pxm, Math.PI - dA, Math.PI + dA); else g.arc(P(spot), P(FH / 2), CIRCLE_R * pxm, -dA, dA); g.stroke();
      for (const cy of [0, FH]) { g.beginPath(); g.arc(P(e ? FW : 0), P(cy), 1 * pxm, 0, Math.PI * 2); g.stroke(); }
    }
  });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(FW + 2 * M, FH + 2 * M).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: pitchTex }));
  stadium.add(pitch);
  // Surrounding track
  const track = new THREE.Mesh(new THREE.PlaneGeometry(FW + 60, FH + 60).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1d3a24 }));
  track.position.y = -0.02; stadium.add(track);

  // Advertising boards
  const ads = [["JOM BOLA", "#ffd23f", "#111"], ["WAU TERBANG", "#e63946", "#fff"], ["LIPAS SMASH", "#8b5a2b", "#fff"],
               ["JOM BACA IQRA", "#1f8a5b", "#fff"], ["JOM TAEKWONDO", "#3a86ff", "#fff"], ["BOP DESK", "#2b2d42", "#ffd23f"]];
  const adTex = canvasTex(2048, 64, (g) => {
    const seg = 2048 / ads.length;
    ads.forEach(([t, bg, fg], i) => { g.fillStyle = bg; g.fillRect(i * seg, 0, seg, 64); g.fillStyle = fg; g.font = "900 34px system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, i * seg + seg / 2, 34); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(i * seg + seg - 3, 0, 3, 64); });
  });
  const boardH = 0.9, gap = 4.5;
  const mkBoard = (len, x, z, ry) => {
    const t = adTex.clone(); t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 60, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, boardH), new THREE.MeshBasicMaterial({ map: t }));
    m.position.set(x, boardH / 2, z); m.rotation.y = ry; stadium.add(m);
  };
  mkBoard(FW + 2 * gap, 0, -(FH / 2 + gap), 0);
  mkBoard(FW + 2 * gap, 0, FH / 2 + gap, Math.PI);
  mkBoard(FH + 2 * gap, -(FW / 2 + gap), 0, Math.PI / 2);
  mkBoard(FH + 2 * gap, FW / 2 + gap, 0, -Math.PI / 2);

  // Stands with a crowd (far side and both ends; the TV camera sits in the near stand)
  const crowdTex = canvasTex(512, 256, (g) => {
    const rnd = seeded(11);
    g.fillStyle = "#151c28"; g.fillRect(0, 0, 512, 256);
    const shirts = ["#e63946", "#c92a37", "#3a86ff", "#2a64c4", "#f1f1f1", "#ffd23f", "#222", "#7a7f87", "#e63946", "#3a86ff"];
    for (let y = 4; y < 256; y += 8) for (let x = 3 + (y / 8 % 2) * 3; x < 512; x += 7) {
      if (rnd() < 0.07) continue;
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)]; g.fillRect(x - 2.5, y, 5, 4);
      g.fillStyle = ["#f1c7a5", "#d9a074", "#b77b4f", "#8d5a36", "#5e3b22"][Math.floor(rnd() * 5)];
      g.beginPath(); g.arc(x, y - 1, 1.8, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "rgba(0,0,0,0.18)"; for (let y = 0; y < 256; y += 16) g.fillRect(0, y, 512, 2);
  });
  const standDepth = 34, standRise = 18;
  const mkStand = (len, cx, cz, ry) => {
    const t = crowdTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(len / 26, standDepth / 17);
    const geo = new THREE.PlaneGeometry(len, hyp(standDepth, standRise));
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: t, color: 0x8a8f99 }));
    const ang = Math.atan2(standRise, standDepth);
    m.rotation.order = "YXZ"; m.rotation.y = ry; m.rotation.x = -(Math.PI / 2 - ang);
    m.position.set(cx, standRise / 2 + 1.2, cz); stadium.add(m);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.6, 14), new THREE.MeshLambertMaterial({ color: 0x1b2333 }));
    roof.rotation.y = ry; const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    roof.position.set(cx + dir.x * (standDepth / 2 - 6), standRise + 6, cz + dir.z * (standDepth / 2 - 6)); stadium.add(roof);
  };
  const off = gap + 2 + standDepth / 2;
  mkStand(FW + 30, 0, -(FH / 2 + off), 0);
  mkStand(FH + 30, -(FW / 2 + off), 0, -Math.PI / 2 + Math.PI);
  mkStand(FH + 30, FW / 2 + off, 0, Math.PI / 2 + Math.PI);
  // Floodlights
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a4250 }), lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * (FW / 2 + 16), pz = sz * (FH / 2 + 22), h = 42;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, h, 8), poleMat); pole.position.set(px, h / 2, pz); stadium.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 0.6), lampMat); lamp.position.set(px, h + 1, pz); lamp.lookAt(0, 0, 0); stadium.add(lamp);
  }
  // Goals: posts, bar, net
  const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const netTex = canvasTex(128, 128, (g) => { g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 3; for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); } });
  const D = 2.2;
  for (const e of [0, 1]) {
    const gx = e ? FW : 0, dir = e ? 1 : -1;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GH, 10), postMat);
      post.position.copy(W3(gx, FH / 2 + s * GW / 2, GH / 2)); stadium.add(post);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, GH * 0.8, 6), postMat);
      back.position.copy(W3(gx + dir * D, FH / 2 + s * GW / 2, GH * 0.4)); stadium.add(back);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GW + 0.12, 10), postMat);
    bar.rotation.x = Math.PI / 2; bar.position.copy(W3(gx, FH / 2, GH)); stadium.add(bar);
    const nm = (w, h) => { const t = netTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 0.9, h / 0.9);
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }); };
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH * 0.8), nm(GW, GH * 0.8));
    backNet.rotation.y = Math.PI / 2; backNet.position.copy(W3(gx + dir * D, FH / 2, GH * 0.4)); stadium.add(backNet);
    const roofLen = hyp(D, GH * 0.2);
    const topNet = new THREE.Mesh(new THREE.PlaneGeometry(roofLen, GW), nm(roofLen, GW));
    topNet.rotation.x = -Math.PI / 2; topNet.rotation.y = 0; topNet.position.copy(W3(gx + dir * D / 2, FH / 2, GH * 0.9));
    topNet.rotation.z = dir * Math.atan2(GH * 0.2, D); stadium.add(topNet);
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(D * dir, 0); shape.lineTo(D * dir, GH * 0.8); shape.lineTo(0, GH); shape.lineTo(0, 0);
      const sideNet = new THREE.Mesh(new THREE.ShapeGeometry(shape), nm(D, GH));
      sideNet.position.copy(W3(gx, FH / 2 + s * GW / 2, 0)); stadium.add(sideNet);
    }
    for (const cy of [0, FH]) {     // corner flags
      const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), postMat); fp.position.copy(W3(gx, cy, 0.75)); stadium.add(fp);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
      fl.position.copy(W3(gx, cy, 1.35)); fl.position.x += 0.22; stadium.add(fl);
    }
  }
}

// ---- footballers ----------------------------------------------------
const KIT = {
  r: { shirt: 0xd62839, shorts: 0xffffff, socks: 0xd62839 }, b: { shirt: 0x2f6fe0, shorts: 0x0d1b3d, socks: 0x2f6fe0 },
  rGK: { shirt: 0x1fae6a, shorts: 0x111111, socks: 0x1fae6a }, bGK: { shirt: 0xff9f1c, shorts: 0x111111, socks: 0xff9f1c },
};
const SKIN = [0xf1c7a5, 0xd9a074, 0xb77b4f, 0x8d5a36, 0x5e3b22, 0xe8b48c], HAIR = [0x1d140e, 0x3b2414, 0x5b3a1e, 0x111111, 0x7a4a20, 0xc9a15a];
const matCache = new Map();
function mat(color) { if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color })); return matCache.get(color); }
const G = {
  torso: new THREE.BoxGeometry(0.24, 0.56, 0.42).translate(0, 0.28, 0),
  shorts: new THREE.BoxGeometry(0.26, 0.24, 0.4).translate(0, -0.06, 0),
  thigh: new THREE.BoxGeometry(0.15, 0.46, 0.15).translate(0, -0.23, 0),
  shin: new THREE.BoxGeometry(0.13, 0.44, 0.13).translate(0, -0.22, 0),
  boot: new THREE.BoxGeometry(0.26, 0.09, 0.13).translate(0.05, -0.46, 0),
  upper: new THREE.BoxGeometry(0.11, 0.28, 0.11).translate(0, -0.14, 0),
  lower: new THREE.BoxGeometry(0.095, 0.3, 0.095).translate(0, -0.42, 0),
  head: new THREE.SphereGeometry(0.125, 12, 10),
  hair: new THREE.SphereGeometry(0.133, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  neck: new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8),
};
function numberTex(n, team) {
  return canvasTex(64, 64, (g) => { g.font = "900 46px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = team === "r" ? "#fff" : "#fff"; g.lineWidth = 4; g.strokeStyle = "rgba(0,0,0,0.35)"; g.strokeText(String(n), 32, 35); g.fillText(String(n), 32, 35); });
}
function labelTex(text, color) {
  return canvasTex(256, 64, (g) => {
    g.font = "800 34px -apple-system, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const w = Math.min(250, g.measureText(text).width + 26);
    g.fillStyle = "rgba(0,0,0,0.6)"; g.beginPath(); g.roundRect ? g.roundRect(128 - w / 2, 8, w, 48, 12) : g.rect(128 - w / 2, 8, w, 48); g.fill();
    g.fillStyle = color; g.fillText(text, 128, 33);
  });
}
const models = new Map();
function makeModel(p) {
  const isGK = SLOTS[p.slot] && SLOTS[p.slot][0] === "GK";
  const kit = KIT[p.team + (isGK ? "GK" : "")];
  const k = Math.abs(p.id) * 7 + (p.team === "b" ? 3 : 0);
  const skin = mat(SKIN[k % SKIN.length]), hair = mat(HAIR[(k >> 1) % HAIR.length]);
  const root = new THREE.Group(), tilt = new THREE.Group(), hips = new THREE.Group();
  root.add(tilt); tilt.add(hips); hips.position.y = 0.95;
  const shorts = new THREE.Mesh(G.shorts, mat(kit.shorts)); hips.add(shorts);
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(new THREE.Mesh(G.torso, mat(kit.shirt)));
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), new THREE.MeshBasicMaterial({ map: numberTex(SLOTS[p.slot] ? SLOTS[p.slot][3] : "", p.team), transparent: true }));
  num.position.set(-0.125, 0.33, 0); num.rotation.y = -Math.PI / 2; torso.add(num);
  const neck = new THREE.Mesh(G.neck, skin); neck.position.y = 0.6; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.74; torso.add(head);
  head.add(new THREE.Mesh(G.head, skin));
  const hr = new THREE.Mesh(G.hair, hair); hr.rotation.z = 0.35; hr.position.x = -0.01; head.add(hr);
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(0, -0.08, s * 0.11); hips.add(thigh);
    thigh.add(new THREE.Mesh(G.thigh, skin));
    const knee = new THREE.Group(); knee.position.y = -0.44; thigh.add(knee);
    knee.add(new THREE.Mesh(G.shin, mat(kit.socks)));
    knee.add(new THREE.Mesh(G.boot, mat(0x151515)));
    legs.push({ thigh, knee });
    const sh = new THREE.Group(); sh.position.set(0, 0.52, s * 0.27); torso.add(sh);
    sh.add(new THREE.Mesh(G.upper, mat(kit.shirt)));
    sh.add(new THREE.Mesh(G.lower, isGK ? mat(0xf0f0f0) : skin));
    arms.push(sh);
  }
  const shadow = new THREE.Mesh(flatPlane, shadowMat); shadow.scale.set(1.3, 1, 1.3); shadow.position.y = 0.02;
  const group = new THREE.Group(); group.add(root); group.add(shadow);
  scene.add(group);
  return { group, root, tilt, hips, torso, head, legs, arms, ph: Math.random() * 6, lx: p.x, ly: p.y, sp: 0, team: p.team, slot: p.slot, label: null, labelText: "" };
}
function animateModel(m, p, dt) {
  const moved = hyp(p.x - m.lx, p.y - m.ly);
  m.sp += (moved / Math.max(dt, 0.001) - m.sp) * 0.2; m.lx = p.x; m.ly = p.y;
  const sp = Math.min(m.sp, 9), amp = clamp(sp / 6, 0, 1.25);
  m.ph += moved * 2.3;
  const k = p.k;
  const s = Math.sin(m.ph);
  const [L, R] = m.legs;
  let tL = s * 0.75 * amp, tR = -s * 0.75 * amp;
  let kL = -Math.max(0, -Math.sin(m.ph)) * 1.25 * amp - 0.08 * amp, kR = -Math.max(0, Math.sin(m.ph)) * 1.25 * amp - 0.08 * amp;
  let aL = -s * 0.7 * amp, aR = s * 0.7 * amp, aLx = 0.12, aRx = -0.12;
  let lean = -0.1 * amp - ((k & 128) ? 0.12 : 0), hipY = 0.95 + Math.abs(Math.cos(m.ph)) * 0.04 * amp, tiltX = 0, tiltY = 0;
  if (k & 1) { tR = -0.7 - (p.charge || 0) * 0.5; kR = -1.1; lean = 0.08; aLx = 0.6; aRx = -0.6; }           // winding up
  if (k & 2) { tR = 1.3; kR = -0.1; tL = -0.25; lean = 0.15; aLx = 0.7; aRx = -0.7; }                           // strike
  if (k & 256) { tR = 1.1; kR = 0; lean = -0.2; }                                                                // poke tackle
  if (k & 512) { lean = -0.45; hipY += 0.25; }                                                                   // header
  if (k & 8) { hipY = 0.3; lean = 1.25; tL = 1.5; kL = 0; tR = 0.9; kR = -1.3; aL = 2.4; aR = 1.6; aLx = 0.4; aRx = -0.4; } // slide
  if (k & 64) { hipY = 0.55; lean = 0.5; tL = 1.2; kL = -1.6; tR = 1.0; kR = -1.4; aL = 0.6; aR = 0.6; }           // getting up
  if (k & 16) { tiltX = ((k & 1024) ? 1 : -1) * 1.25; hipY = 0.75; aL = 3.0; aR = 3.0; lean = 0; }                 // keeper dive
  L.thigh.rotation.z = tL; R.thigh.rotation.z = tR; L.knee.rotation.z = kL; R.knee.rotation.z = kR;
  m.arms[0].rotation.z = aL; m.arms[1].rotation.z = aR; m.arms[0].rotation.x = aLx; m.arms[1].rotation.x = aRx;
  m.torso.rotation.z = lean; m.hips.position.y = hipY;
  m.tilt.rotation.x = tiltX;
  m.root.rotation.y = -p.a;
  m.group.position.set(p.x - FW / 2, 0, p.y - FH / 2);
}

// ---- ball, markers ------------------------------------------------------
const BALL_VIS = 0.2;
const ballTex = canvasTex(256, 128, (g) => {
  g.fillStyle = "#f7f7f7"; g.fillRect(0, 0, 256, 128); g.fillStyle = "#1b1b1b";
  for (let i = 0; i < 12; i++) { const x = (i % 6) * 43 + (i > 5 ? 21 : 0), y = i > 5 ? 88 : 40; g.beginPath();
    for (let k = 0; k < 5; k++) { const a = k * 1.2566 - 1.57; g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13); } g.fill(); }
});
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_VIS, 18, 14), new THREE.MeshLambertMaterial({ map: ballTex }));
scene.add(ballMesh);
const ballShadow = new THREE.Mesh(flatPlane, shadowMat); scene.add(ballShadow);
const ringGeo = new THREE.RingGeometry(0.62, 0.8, 32).rotateX(-Math.PI / 2);
const ownerRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
ownerRing.position.y = 0.03; scene.add(ownerRing);
const myRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false }));
myRing.position.y = 0.035; scene.add(myRing);
const coneGeo = new THREE.ConeGeometry(0.18, 0.32, 4).rotateX(Math.PI);
const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.9, depthWrite: false }));
targetRing.position.y = 0.04; scene.add(targetRing);
const aimLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const aimLine = new THREE.Line(aimLineGeo, new THREE.LineDashedMaterial({ color: 0xffd23f, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.9 }));
scene.add(aimLine);
const markers = new Map();    // body id -> {cone, label}

let ballRollAxis = new THREE.Vector3(), lastBallPos = null;
function updateWorld(dt) {
  const seen = new Set();
  const myBody = view.players.find((p) => p.ctrl !== null && p.ctrl === myId);
  for (const p of view.players) {
    seen.add(p.id);
    let m = models.get(p.id);
    if (!m || m.team !== p.team || m.slot !== p.slot) { if (m) scene.remove(m.group); m = makeModel(p); models.set(p.id, m); }
    animateModel(m, p, dt);
    // Marker over person-controlled players: a cone and their name
    let mk = markers.get(p.id);
    if (p.ctrl !== null) {
      const mine = p.ctrl === myId;
      const color = mine ? 0xffd23f : (p.team === "r" ? 0xff6b78 : 0x7fb0ff);
      if (!mk) { mk = { cone: new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color })), label: null, text: "" }; scene.add(mk.cone); markers.set(p.id, mk); }
      mk.cone.material.color.setHex(color);
      mk.cone.position.set(p.x - FW / 2, 2.35 + Math.sin(performance.now() / 220) * 0.08, p.y - FH / 2);
      mk.cone.rotation.y += dt * 2;
      const text = p.name || "";
      if (text !== mk.text) {
        if (mk.label) { scene.remove(mk.label); mk.label.material.map.dispose(); }
        mk.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(text, mine ? "#ffd23f" : "#fff"), depthTest: false }));
        mk.label.scale.set(2.6, 0.65, 1); scene.add(mk.label); mk.text = text;
      }
      mk.label.position.set(p.x - FW / 2, 2.95, p.y - FH / 2);
    } else if (mk) { scene.remove(mk.cone); if (mk.label) scene.remove(mk.label); markers.delete(p.id); }
  }
  for (const [id, m] of models) if (!seen.has(id)) { scene.remove(m.group); models.delete(id); const mk = markers.get(id); if (mk) { scene.remove(mk.cone); if (mk.label) scene.remove(mk.label); markers.delete(id); } }

  // Ball: rolls in the direction it moves; its shadow shows how high it is
  const b = view.ball;
  ballMesh.position.set(b.x - FW / 2, BALL_VIS + Math.max(0, b.z), b.y - FH / 2);
  if (lastBallPos) {
    const dx = b.x - lastBallPos.x, dy = b.y - lastBallPos.y, d = hyp(dx, dy);
    if (d > 0.001 && d < 3) { ballRollAxis.set(dy, 0, -dx).normalize(); ballMesh.rotateOnWorldAxis(ballRollAxis, -d / BALL_VIS); }
  }
  lastBallPos = { x: b.x, y: b.y };
  const hz = Math.max(0, b.z);
  ballShadow.position.set(b.x - FW / 2, 0.025, b.y - FH / 2);
  const ss = 0.75 + hz * 0.12; ballShadow.scale.set(ss, 1, ss);

  // Ring under the ball carrier (team colour), yellow ring under you
  const owner = view.ob >= 0 ? view.players.find((p) => p.id === view.ob) : null;
  ownerRing.visible = !!owner;
  if (owner) {
    ownerRing.position.x = owner.x - FW / 2; ownerRing.position.z = owner.y - FH / 2;
    ownerRing.material.color.set(TEAM_COLOR[owner.team]);
    ownerRing.material.opacity = 0.6 + 0.35 * Math.sin(performance.now() / 150);
  }
  myRing.visible = !!myBody;
  if (myBody) { myRing.position.x = myBody.x - FW / 2; myRing.position.z = myBody.y - FH / 2; }

  // Previews while winding up: pass target ring / shot aim line
  targetRing.visible = false; aimLine.visible = false;
  if (myBody && (myBody.k & 1)) {
    if ((myBody.k & 32) && myBody.tgt >= 0) {
      const t = view.players.find((q) => q.id === myBody.tgt);
      if (t) {
        targetRing.visible = true; targetRing.position.x = t.x - FW / 2; targetRing.position.z = t.y - FH / 2;
        const sc = 1 + Math.sin(performance.now() / 120) * 0.08; targetRing.scale.set(sc, 1, sc);
        aimLine.visible = true; aimLine.material.color.setHex(0x9fd0ff);
        aimLineGeo.setFromPoints([W3(b.x, b.y, 0.06), W3(t.x, t.y, 0.06)]); aimLine.computeLineDistances();
      }
    } else if (!(myBody.k & 32) && (myBody.ax || myBody.ay)) {
      aimLine.visible = true; aimLine.material.color.setHex(0xffd23f);
      const atGoal = Math.abs(myBody.ax - FW) < 1 || Math.abs(myBody.ax) < 1;
      aimLineGeo.setFromPoints([W3(b.x, b.y, 0.06), W3(myBody.ax, myBody.ay, atGoal ? 1 : 0.06)]); aimLine.computeLineDistances();
    }
  }
}

// ---- TV camera: high in the near stand, panning with the ball -------------
const cam = { x: 0, z: 0, shake: 0 };
function updateCamera(dt) {
  const b = view.ball;
  const aspect = glCanvas.clientWidth / Math.max(1, glCanvas.clientHeight);
  const portrait = aspect < 1;
  const dist = FH * 0.38 + 5, height = FH * 0.26 + 4;
  const halfView = Math.tan((camera.fov * Math.PI / 180) / 2) * hyp(dist, height) * aspect;
  const lim = Math.max(0, FW / 2 + 6 - halfView);
  const tx = clamp(b.x - FW / 2 + (view.players.length ? 0 : 0), -lim, lim);
  const tz = (b.y - FH / 2) * 0.45;
  const k = Math.min(1, dt * 2.6);
  cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k;
  cam.shake = Math.max(0, cam.shake - dt * 3);
  const sx = (Math.random() - 0.5) * cam.shake, sy = (Math.random() - 0.5) * cam.shake;
  camera.fov = portrait ? 52 : 30;
  camera.position.set(cam.x + sx, height + sy, FH / 2 + dist + cam.z * 0.3);
  camera.lookAt(cam.x, 0, cam.z - 2);
  camera.updateProjectionMatrix();
}
function sizeChanged() {
  buildStadium();
  for (const [, m] of models) scene.remove(m.group);
  models.clear();
  for (const [, mk] of markers) { scene.remove(mk.cone); if (mk.label) scene.remove(mk.label); }
  markers.clear();
  $("sizeSel").value = String(teamSize);
}
buildStadium();

// =====================================================================
//  Input: keyboard, and touch (left = joystick, right = buttons)
// =====================================================================
const keys = new Set();
const ctl = { pc: 0, sc: 0, wc: 0 };
let isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (!e.repeat) {
    if (e.code === "KeyJ" || e.code === "KeyX") ctl.pc++;
    if (e.code === "KeyK" || e.code === "Space") ctl.sc++;
    if (e.code === "KeyQ" || e.code === "KeyL") ctl.wc++;
  }
  keys.add(e.code);
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

const ui = $("ui"), uctx = ui.getContext("2d");
let W = 0, H = 0, udpr = 1;
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const touchBtn = { shoot: null, pass: null, sprint: null };
const STICK_R = 55;
function buttonLayout() {
  const s = clamp(Math.min(W, H) / 390, 0.85, 1.2);
  return {
    shoot: { x: W - 72 * s, y: H - 86 * s, r: 44 * s },
    pass: { x: W - 178 * s, y: H - 56 * s, r: 38 * s },
    sprint: { x: W - 168 * s, y: H - 160 * s, r: 31 * s },
  };
}
ui.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse") isTouch = true;
  if (e.pointerType === "mouse") return;
  initAudio();
  const L = buttonLayout();
  let hit = null, hd = 1e9;
  for (const [k, b] of Object.entries(L)) { const d = hyp(e.clientX - b.x, e.clientY - b.y); if (d < b.r + 20 && d - b.r < hd) { hd = d - b.r; hit = k; } }
  if (hit && touchBtn[hit] === null) {
    touchBtn[hit] = e.pointerId;
    if (hit === "pass") ctl.pc++;
    if (hit === "shoot") ctl.sc++;
  } else if (!hit && e.clientX < W * 0.5 && stick.id === null) Object.assign(stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
});
ui.addEventListener("pointermove", (e) => { if (e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; } });
const endPointer = (e) => {
  if (e.pointerId === stick.id) stick.id = null;
  for (const k in touchBtn) if (touchBtn[k] === e.pointerId) touchBtn[k] = null;
};
ui.addEventListener("pointerup", endPointer);
ui.addEventListener("pointercancel", endPointer);

// Screen direction -> pitch direction (the camera looks across the pitch from the near touchline)
function readInput() {
  if (myTeam() === "s" || document.querySelector(".overlay:not(.hidden):not(#end)"))
    return { x: 0, y: 0, s: false, p: false, r: false, sc: ctl.sc, pc: ctl.pc, wc: ctl.wc };
  let sx = 0, sy = 0;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) sx -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) sx += 1;
  if (keys.has("ArrowUp") || keys.has("KeyW")) sy -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) sy += 1;
  if (stick.id !== null) {
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = hyp(dx, dy);
    if (d > 6) { const m = Math.min(1, d / STICK_R); sx = (dx / d) * m; sy = (dy / d) * m; }
  }
  const len = hyp(sx, sy); if (len > 1) { sx /= len; sy /= len; }
  return {
    x: sx, y: sy,
    s: keys.has("KeyK") || keys.has("Space") || touchBtn.shoot !== null,
    p: keys.has("KeyJ") || keys.has("KeyX") || touchBtn.pass !== null,
    r: keys.has("ShiftLeft") || keys.has("ShiftRight") || touchBtn.sprint !== null,
    sc: ctl.sc, pc: ctl.pc, wc: ctl.wc,
  };
}

// =====================================================================
//  Menu, invite, full time, scoreboard
// =====================================================================
function myTeam() { const r = roster.find((p) => p.id === myId); return r ? r.team : "s"; }
function chooseTeam(t) { if (role === "host") setTeam(sim.players.get(0), t); else if (hostConn) hostConn.send({ t: "tm", v: t }); }
$("tR").onclick = () => chooseTeam("r"); $("tB").onclick = () => chooseTeam("b"); $("tS").onclick = () => chooseTeam("s");
$("btnMenu").onclick = () => { updateMenu(); show("menu"); };
$("btnMenuClose").onclick = () => show("menu", false);
$("sizeSel").onchange = () => { if (role === "host") { changeSize(+$("sizeSel").value); show("menu", false); toast(teamSize + " a side"); } };
$("lenSel").onchange = () => { matchLen = +$("lenSel").value; if (role === "host") afterRosterChange(); };
$("btnRestart").onclick = () => { if (role === "host" && hasTeams()) { startMatch(); show("menu", false); toast("New match!"); } };
$("btnBots").onclick = () => { if (role !== "host") return; botsOn = !botsOn; afterRosterChange(); };
$("btnAgain").onclick = () => { if (role === "host" && hasTeams()) startMatch(); };
function updateMenu() {
  const t = myTeam();
  $("tR").classList.toggle("on", t === "r"); $("tB").classList.toggle("on", t === "b"); $("tS").classList.toggle("on", t === "s");
  const list = $("plist"); list.innerHTML = "";
  for (const team of ["r", "b", "s"]) for (const p of roster.filter((q) => q.team === team)) {
    const row = document.createElement("div"); row.className = "pl";
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = TEAM_COLOR[team] || "#888";
    const nm = document.createElement("span"); nm.style.flex = "1"; nm.textContent = p.name + (p.id === myId ? " (you)" : "") + (p.id === 0 ? " ⭐" : "");
    const tm = document.createElement("span"); tm.className = "small"; tm.textContent = TEAM_NAME[team];
    row.append(dot, nm, tm); list.append(row);
  }
  if (botsOn) {
    const hr = roster.filter((q) => q.team === "r").length, hb = roster.filter((q) => q.team === "b").length;
    const n = Math.max(0, teamSize - hr) + Math.max(0, teamSize - hb);
    if (n) { const row = document.createElement("div"); row.className = "pl small"; row.textContent = "🤖 + " + n + " computer players"; list.append(row); }
  }
  $("btnBots").textContent = "🤖 Computer players: " + (botsOn ? "ON" : "OFF");
  $("lenSel").value = String(matchLen); $("sizeSel").value = String(teamSize);
}
function openInvite() { $("roomCode").textContent = roomCode; $("linkBox").textContent = gameLink(); show("btnShare", !!navigator.share); show("invite"); }
$("btnInvite").onclick = openInvite;
$("btnInviteClose").onclick = () => show("invite", false);
$("btnCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(gameLink()); toast("Link copied"); }
  catch (e) { const r = document.createRange(); r.selectNodeContents($("linkBox")); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    try { document.execCommand("copy"); toast("Link copied"); } catch (e2) { toast("Press and hold the link to copy it"); } }
};
$("btnShare").onclick = () => { navigator.share({ title: "Jom Bola", text: "Come play football with me! Code " + roomCode, url: gameLink() }).catch(() => {}); };

let endShown = false, hudKey = "";
function updateHud() {
  const minute = Math.min(90, Math.floor((view.elapsed / Math.max(1, matchLen)) * 90));
  const me = view.players.find((p) => p.ctrl !== null && p.ctrl === myId);
  const key = view.score[0] + "-" + view.score[1] + "|" + minute + "|" + (me ? me.id : "");
  if (key !== hudKey) {
    hudKey = key;
    $("score").textContent = view.score[0] + " - " + view.score[1];
    $("clock").textContent = view.phase === "warm" ? "–" : minute + "'";
    if (me) { $("ctrlName").textContent = "▶ " + (me.name || "You") + "  #" + (SLOTS[me.slot] ? SLOTS[me.slot][3] : ""); show("ctrlName"); }
    else show("ctrlName", false);
  }
  const isEnd = view.phase === "end";
  if (isEnd && !endShown) {
    const [r, b] = view.score;
    $("endScore").innerHTML = '<span style="color:var(--red)">' + r + '</span> – <span style="color:var(--blue)">' + b + "</span>";
    $("endWin").textContent = r > b ? "Red win! 🏆" : b > r ? "Blue win! 🏆" : "It's a draw!";
    show("btnAgain", role === "host"); show("endWait", role !== "host"); show("end");
  }
  if (!isEnd && endShown) show("end", false);
  endShown = isEnd;
  show("rotate", !!role && H > W);
}

// =====================================================================
//  2D overlay: buttons, radar, banners, power bar, confetti
// =====================================================================
const confetti = [];
let goalAt = 0, goalTeam = "r", prevScore = [0, 0], phaseSeen = "";
function fxEvent(e) {
  if (e === "K") cam.shake = Math.max(cam.shake, 0.25);
  else if (e === "s") cam.shake = Math.max(cam.shake, 0.15);
  else if (e === "g") cam.shake = 0.5;
}
function startConfetti(team) {
  const cols = team === "r" ? ["#e63946", "#ff8fa0", "#ffd23f", "#fff"] : ["#3a86ff", "#9cc4ff", "#ffd23f", "#fff"];
  for (let i = 0; i < 160; i++) confetti.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 60,
    vy: 90 + Math.random() * 140, a: Math.random() * 6, va: (Math.random() - 0.5) * 10, w: 5 + Math.random() * 6, c: cols[i % cols.length] });
}
function txt(t, x, y, size, color, weight = 800, stroke = true) {
  uctx.font = weight + " " + size + "px -apple-system, system-ui, sans-serif"; uctx.textAlign = "center"; uctx.textBaseline = "middle";
  if (stroke) { uctx.lineJoin = "round"; uctx.lineWidth = size / 5; uctx.strokeStyle = "rgba(0,0,0,0.6)"; uctx.strokeText(t, x, y); }
  uctx.fillStyle = color; uctx.fillText(t, x, y);
}
function pill(t, x, y, bg, fg = "#fff", size = 14) {
  uctx.font = "800 " + size + "px -apple-system, system-ui, sans-serif";
  const w = uctx.measureText(t).width + 26;
  uctx.fillStyle = bg; uctx.beginPath(); uctx.roundRect ? uctx.roundRect(x - w / 2, y - size, w, size * 2, size) : uctx.rect(x - w / 2, y - size, w, size * 2); uctx.fill();
  txt(t, x, y + 1, size, fg, 800, false);
}
function toScreen(x, y, z) {
  const v = new THREE.Vector3(x - FW / 2, z, y - FH / 2).project(camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, behind: v.z > 1 };
}
function drawUI(dt) {
  uctx.setTransform(udpr, 0, 0, udpr, 0, 0);
  uctx.clearRect(0, 0, W, H);
  if (!role) return;
  const now = performance.now();
  const me = view.players.find((p) => p.ctrl !== null && p.ctrl === myId);

  // Power bar over your player while winding up
  if (me && (me.k & 1)) {
    const s = toScreen(me.x, me.y, 3.4), c = clamp(me.charge || 0, 0, 1), isPass = me.k & 32, w = 64;
    uctx.fillStyle = "rgba(0,0,0,0.65)"; uctx.fillRect(s.x - w / 2 - 2, s.y - 7, w + 4, 12);
    uctx.fillStyle = isPass ? (c > 0.7 ? "#2f80ed" : "#7cc0ff") : (c > 0.85 ? "#ff5a3c" : c > 0.5 ? "#ffd23f" : "#7ee081");
    uctx.fillRect(s.x - w / 2, s.y - 5, w * c, 8);
    txt(isPass ? (c > 0.6 ? "LONG PASS" : "PASS") : "SHOT", s.x, s.y - 16, 11, "#fff");
  }

  // Radar (bottom centre)
  const rw = Math.min(150, W * 0.17), rh = rw * FH / FW, rx = W / 2 - rw / 2, ry = H - rh - 10;
  uctx.fillStyle = "rgba(10,25,15,0.6)"; uctx.fillRect(rx - 3, ry - 3, rw + 6, rh + 6);
  uctx.strokeStyle = "rgba(255,255,255,0.5)"; uctx.lineWidth = 1; uctx.strokeRect(rx, ry, rw, rh);
  uctx.beginPath(); uctx.moveTo(rx + rw / 2, ry); uctx.lineTo(rx + rw / 2, ry + rh); uctx.stroke();
  for (const p of view.players) {
    const mine = p.ctrl !== null && p.ctrl === myId;
    uctx.fillStyle = TEAM_COLOR[p.team];
    uctx.beginPath(); uctx.arc(rx + clamp(p.x / FW, 0, 1) * rw, ry + clamp(p.y / FH, 0, 1) * rh, mine ? 3.6 : 2.6, 0, Math.PI * 2); uctx.fill();
    if (mine) { uctx.strokeStyle = "#ffd23f"; uctx.lineWidth = 1.6; uctx.stroke(); }
  }
  uctx.fillStyle = "#fff"; uctx.beginPath(); uctx.arc(rx + clamp(view.ball.x / FW, 0, 1) * rw, ry + clamp(view.ball.y / FH, 0, 1) * rh, 2.2, 0, Math.PI * 2); uctx.fill();

  // Banners
  const midY = H * 0.36;
  if (role === "client" && snaps.length && now - lastSnapAt > 3000) {
    uctx.fillStyle = "rgba(0,0,0,0.6)"; uctx.fillRect(0, midY - 40, W, 80);
    txt("Waiting for the host…", W / 2, midY - 10, 24, "#ffd23f"); txt("Their game may be paused. Ask them to open it again.", W / 2, midY + 18, 13, "#fff", 600, false);
  } else if (view.phase === "goal") {
    const t = (now - goalAt) / 1000, slide = 1 - Math.pow(1 - Math.min(1, t * 3), 3);
    const col = goalTeam === "r" ? ["#9d1823", "#e63946"] : ["#1747a6", "#3a86ff"];
    const gr = uctx.createLinearGradient(0, midY - 50, 0, midY + 50); gr.addColorStop(0, col[1]); gr.addColorStop(1, col[0]);
    uctx.save(); uctx.translate((slide - 1) * W, 0);
    uctx.fillStyle = gr; uctx.fillRect(0, midY - 50, W, 100);
    uctx.fillStyle = "#ffd23f"; uctx.fillRect(0, midY - 50, W, 4); uctx.fillRect(0, midY + 46, W, 4);
    uctx.restore();
    const pop = 1 + Math.max(0, 0.4 - t) * 1.5;
    uctx.save(); uctx.translate(W / 2, midY - 10); uctx.scale(pop, pop); txt("GOAL!", 0, 0, Math.min(60, W / 9), "#ffd23f", 900); uctx.restore();
    if (t > 0.3) txt(view.scorer || "", W / 2, midY + 28, 18, "#fff", 700);
  } else if (view.phase === "half" || view.phase === "end") {
    uctx.fillStyle = "rgba(10,18,34,0.85)"; uctx.fillRect(0, midY - 36, W, 72);
    txt(view.phase === "half" ? "HALF TIME" : "FULL TIME", W / 2, midY - 6, 30, "#ffd23f", 900);
    txt("Red " + view.score[0] + " – " + view.score[1] + " Blue", W / 2, midY + 22, 15, "#fff", 700, false);
  } else if (view.phase === "kickoff") {
    pill(view.half === 2 ? "SECOND HALF · KICK OFF" : "KICK OFF", W / 2, 58, "rgba(0,0,0,0.6)", "#ffd23f", 14);
  } else if (view.phase === "restart" && view.banner) {
    pill(view.banner, W / 2, 58, "rgba(0,0,0,0.6)", "#fff", 14);
  } else if (view.phase === "warm") {
    pill((role === "host" && roster.length < 2) ? "Warm-up · tap 🔗 Invite to add friends" : "Warm-up", W / 2, 58, "rgba(0,0,0,0.55)", "#fff", 13);
  }

  // Confetti
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i]; c.x += c.vx * dt; c.y += c.vy * dt; c.a += c.va * dt;
    if (c.y > H + 20) { confetti.splice(i, 1); continue; }
    uctx.save(); uctx.translate(c.x, c.y); uctx.rotate(c.a); uctx.fillStyle = c.c; uctx.fillRect(-c.w / 2, -c.w / 4, c.w, c.w / 2); uctx.restore();
  }

  // Touch controls
  if (!isTouch || myTeam() === "s") return;
  const jx = stick.id !== null ? stick.ox : 90, jy = stick.id !== null ? stick.oy : H - 95;
  uctx.globalAlpha = stick.id !== null ? 0.45 : 0.22;
  uctx.fillStyle = "#000"; uctx.beginPath(); uctx.arc(jx, jy, STICK_R, 0, Math.PI * 2); uctx.fill();
  uctx.strokeStyle = "#fff"; uctx.lineWidth = 2; uctx.stroke();
  let kx = jx, ky = jy;
  if (stick.id !== null) { const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = hyp(dx, dy), m = Math.min(d, STICK_R); if (d > 0) { kx = jx + dx / d * m; ky = jy + dy / d * m; } }
  uctx.globalAlpha = 0.7; uctx.fillStyle = "#fff"; uctx.beginPath(); uctx.arc(kx, ky, 24, 0, Math.PI * 2); uctx.fill();
  uctx.globalAlpha = 1;
  const onBall = me && ((me.k & 4) || (view.ob === -1 && view.ball.z < 1 && hyp(view.ball.x - me.x, view.ball.y - me.y) < 2.2));
  const L = buttonLayout();
  const btn = (b, label, color, active) => {
    uctx.globalAlpha = active ? 0.92 : 0.55; uctx.fillStyle = color;
    uctx.beginPath(); uctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); uctx.fill();
    uctx.globalAlpha = 1; uctx.lineWidth = 2; uctx.strokeStyle = "rgba(255,255,255,0.5)"; uctx.stroke();
    txt(label, b.x, b.y + 1, Math.round(b.r * 0.34), "#151515", 900, false);
  };
  btn(L.shoot, onBall ? "SHOOT" : "SWITCH", onBall ? "#ffd23f" : "#e9eef5", touchBtn.shoot !== null);
  btn(L.pass, onBall ? "PASS" : "TACKLE", onBall ? "#8ecbff" : "#ff8a7a", touchBtn.pass !== null);
  btn(L.sprint, "SPRINT", "#b6f0a8", touchBtn.sprint !== null);
}

// =====================================================================
//  Main loop
// =====================================================================
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / Math.max(1, H); camera.updateProjectionMatrix();
  udpr = Math.min(window.devicePixelRatio || 1, 2);
  ui.width = Math.round(W * udpr); ui.height = Math.round(H * udpr);
}
addEventListener("resize", resize);
resize();
let lastFrame = performance.now();
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (role === "host") hostView(); else if (role === "client") clientView(dt);
  if (view.phase === "goal" && phaseSeen !== "goal") { goalAt = now; goalTeam = view.score[0] > prevScore[0] ? "r" : "b"; startConfetti(goalTeam); }
  phaseSeen = view.phase;
  if (view.phase !== "goal") prevScore = [view.score[0], view.score[1]];
  updateWorld(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  drawUI(dt);
  if (role) updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
