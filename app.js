'use strict';
/*
 * NURO PARTY — 서버 없이 폰끼리 연결되는 파티게임.
 * 방장 폰이 게임 상태를 들고 있고(host-authoritative), 다른 폰은 PeerJS(WebRTC)로 붙어서
 * 행동(act)을 보내고 상태(state)를 받아 화면만 그린다.
 */

// ───────────────────────── utils ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = s => String(s || '').toLowerCase().replace(/[\s.,!?~'"`·\-_()]/g, '');
const vibrate = p => {
  const ua = navigator.userActivation;
  if (!navigator.vibrate || (ua && !ua.hasBeenActive)) return;
  try { navigator.vibrate(p); } catch { /* 미지원 */ }
};
const storage = area => ({
  get(k, d) { try { return area().getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { area().setItem(k, v); } catch { /* 사생활 보호 모드 */ } },
});
const ls = storage(() => localStorage);
const ss = storage(() => sessionStorage);

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function choseong(word) {
  let out = '';
  for (const ch of word) {
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) return null;
    out += CHO[Math.floor(c / 588)];
  }
  return out;
}

const ID_PREFIX = 'nuroparty-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const AVATARS = ['🦊', '🐼', '🐸', '🐯', '🐙', '🦄', '🐧', '🐻', '🐰', '🐵', '🐨', '🦁'];
const COLORS = ['#ff5d8f', '#ffb340', '#ffe14d', '#4dff9a', '#3dd6ff', '#9b8bff', '#d36bff', '#ff7a4d', '#5dffd6', '#a4ff4d', '#ff6bd9', '#6b9bff'];
const MAX_PLAYERS = 12;
const NUNCHI_WINDOW = 400; // ms 안에 연달아 누르면 "동시"로 판정

const GAMES = {
  liar:   { title: '라이어 게임', emoji: '🕵️', min: 3, tag: '추리 · 심리전', desc: '한 명만 제시어를 몰라요. 말로 설명하며 라이어를 찾아라!' },
  nunchi: { title: '눈치 게임',   emoji: '👀', min: 2, tag: '순발력',      desc: '1부터 한 명씩 터치! 겹치거나 끝까지 못 누르면 벌칙' },
  sync:   { title: '이심전심',    emoji: '🧠', min: 2, tag: '텔레파시',    desc: '같은 질문, 같은 답을 쓴 사람끼리 점수를 나눠요' },
  bomb:   { title: '초성 폭탄',   emoji: '💣', min: 2, tag: '스릴',        desc: '초성에 맞는 단어를 쓰면 폭탄이 넘어가요. 터지면 끝!' },
};

let myPid = ss.get('np_pid', '') || (() => { const id = 'p' + Math.random().toString(36).slice(2, 10); ss.set('np_pid', id); return id; })();

// ───────────────────────── sound ─────────────────────────
const soundOn = () => ls.get('np_sound', '1') === '1';
const sfx = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(f, d = 0.08, type = 'sine', v = 0.15, w = 0, f2) {
    if (!soundOn()) return;
    const c = ac(); if (!c) return;
    const t = c.currentTime + w, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, v) {
    if (!soundOn()) return;
    const c = ac(); if (!c) return;
    const len = Math.floor(c.sampleRate * d), b = c.createBuffer(1, len, c.sampleRate), data = b.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const s = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
    s.buffer = b; flt.type = 'lowpass'; flt.frequency.value = 900; g.gain.value = v;
    s.connect(flt); flt.connect(g); g.connect(c.destination); s.start();
  }
  return {
    unlock: () => { if (soundOn()) ac(); },
    tap: () => tone(700, 0.06, 'triangle', 0.18),
    pop: () => tone(500, 0.09, 'sine', 0.15, 0, 900),
    tick: (v = 1) => tone(1500, 0.025, 'square', 0.04 * v),
    go: () => tone(880, 0.3, 'square', 0.1, 0, 1320),
    whoosh: () => tone(300, 0.25, 'sawtooth', 0.06, 0, 1200),
    err: () => tone(220, 0.15, 'square', 0.08),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.16, i * 0.1)),
    lose: () => [392, 311, 247].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.07, i * 0.16)),
    boom: () => { noise(1.2, 0.9); tone(120, 0.6, 'sine', 0.4, 0, 40); },
  };
})();

// ───────────────────────── network ─────────────────────────
const PEER_OPTS = { debug: 0 };
const net = { peer: null, isHost: false, code: '', name: '', conns: new Map(), hostConn: null, offset: null };
const hostNow = () => Date.now() + (net.isHost ? 0 : (net.offset || 0));

function netErr(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return '방을 찾을 수 없어요. 코드를 다시 확인해 주세요.';
    case 'browser-incompatible': return '이 브라우저는 지원하지 않아요. 크롬이나 사파리 최신 버전을 써 주세요.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return '연결 서버에 닿을 수 없어요. 인터넷 연결을 확인해 주세요.';
    default: return '연결 중 문제가 생겼어요. 다시 시도해 주세요.';
  }
}
function fail(msg) { ui.status = 'error'; ui.msg = msg; render(); }

function createRoom(name) {
  ui.status = 'connecting'; ui.msg = '방 만드는 중…'; render();
  const code = Array.from({ length: 4 }, () => pick(CODE_CHARS)).join('');
  const peer = new Peer(ID_PREFIX + code, PEER_OPTS);
  let opened = false;
  peer.on('open', () => {
    opened = true;
    net.peer = peer; net.isHost = true; net.code = code; net.name = name;
    initHost(name);
  });
  peer.on('connection', setupHostConn);
  peer.on('disconnected', () => { if (!peer.destroyed) try { peer.reconnect(); } catch { /* 재시도 실패 */ } });
  peer.on('error', err => {
    if (!opened && err.type === 'unavailable-id') { peer.destroy(); createRoom(name); return; }
    if (!opened) fail(netErr(err));
    else console.warn('[host]', err);
  });
}

function joinRoom(code, name) {
  ui.status = 'connecting'; ui.msg = `${code} 방에 들어가는 중…`; render();
  if (net.peer) try { net.peer.destroy(); } catch { /* 이미 닫힘 */ }
  const peer = new Peer(PEER_OPTS);
  Object.assign(net, { peer, isHost: false, code, name, hostConn: null });
  let done = false;
  const timeout = setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch { /* */ } fail('연결 시간이 초과됐어요. 코드를 확인하고 다시 시도해 주세요.'); } }, 15000);
  peer.on('open', () => {
    const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
    net.hostConn = conn;
    conn.on('open', () => {
      done = true; clearTimeout(timeout);
      conn.send({ t: 'join', pid: myPid, name });
      history.replaceState(null, '', '?room=' + code);
    });
    conn.on('data', onHostData);
    const lost = () => { if (net.hostConn === conn && ui.status === 'room') { ui.status = 'lost'; render(); } };
    conn.on('close', lost);
    conn.on('error', lost);
  });
  peer.on('disconnected', () => { if (!peer.destroyed) try { peer.reconnect(); } catch { /* */ } });
  peer.on('error', err => {
    if (!done) { done = true; clearTimeout(timeout); try { peer.destroy(); } catch { /* */ } fail(netErr(err)); }
    else console.warn('[client]', err);
  });
}

function onHostData(m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'welcome') { myPid = m.pid; ss.set('np_pid', m.pid); }
  else if (m.t === 'state') {
    // 지연시간만큼 작게 잡히므로 가장 큰 값이 실제 시계 차이에 가장 가깝다
    const sample = m.now - Date.now();
    net.offset = net.offset == null ? sample : Math.max(net.offset, sample);
    ui.status = 'room';
    setView({ s: m.s, me: m.me || {} });
  }
  else if (m.t === 'toast') { toast(m.text); sfx.err(); }
  else if (m.t === 'reject') fail(m.reason);
}

function act(a, data = {}) {
  const m = { a, ...data };
  if (net.isHost) {
    // 방장은 지연이 0이라 눈치 게임에서 유리하니 살짝 늦춰 준다
    if (a === 'tap') setTimeout(() => handleAct(myPid, m), 60);
    else handleAct(myPid, m);
  } else if (net.hostConn && net.hostConn.open) net.hostConn.send({ t: 'act', ...m });
  else toast('연결이 끊겼어요');
}

// ───────────────────────── host: state ─────────────────────────
let S = null;       // 모두에게 공개되는 상태
let SECRET = {};    // 방장만 아는 정보 (라이어, 답안, 폭탄 시간…)
let timers = [];
const usedPrompts = new Set();

function schedule(ms, fn) {
  const h = setTimeout(() => { timers = timers.filter(x => x !== h); fn(); }, Math.max(0, ms));
  timers.push(h);
}
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

const player = pid => S.players.find(p => p.pid === pid);
const onlinePids = () => S.players.filter(p => p.online).map(p => p.pid);
const activePids = () => S.g.players.filter(pid => player(pid) && player(pid).online);
function addScore(pid, n) {
  const p = player(pid);
  if (p) p.score += n;
  S.g.gain = S.g.gain || {};
  S.g.gain[pid] = (S.g.gain[pid] || 0) + n;
}

function addPlayer(pid, name) {
  const usedAv = new Set(S.players.map(p => p.av));
  const i = Math.max(0, AVATARS.findIndex(a => !usedAv.has(a)));
  S.players.push({ pid, name, av: AVATARS[i], color: COLORS[i], score: 0, online: true });
}

function initHost(name) {
  S = { code: net.code, hostPid: myPid, players: [], phase: 'lobby', game: 'liar', settings: { liarCat: 'random', liarMode: 'normal' }, g: null, rounds: 0 };
  addPlayer(myPid, name);
  ui.status = 'room';
  broadcast();
}

function setupHostConn(conn) {
  conn.on('data', m => {
    if (!m || typeof m !== 'object' || !S) return;
    if (m.t === 'join') handleJoin(conn, m);
    else if (m.t === 'act' && conn._pid) handleAct(conn._pid, m);
  });
  const gone = () => {
    const pid = conn._pid;
    if (!pid || net.conns.get(pid) !== conn) return;
    net.conns.delete(pid);
    const p = player(pid);
    if (p) p.online = false;
    if (S.g && HOST[S.game].check) HOST[S.game].check();
    broadcast();
  };
  conn.on('close', gone);
  conn.on('error', gone);
}

function handleJoin(conn, m) {
  let name = String(m.name || '').trim().slice(0, 8) || '플레이어';
  let p = player(String(m.pid || '')) || S.players.find(x => !x.online && x.name === name);
  if (!p) {
    if (S.players.length >= MAX_PLAYERS) {
      conn.send({ t: 'reject', reason: `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명)` });
      setTimeout(() => conn.close(), 500);
      return;
    }
    const pid = String(m.pid || ('p' + Math.random().toString(36).slice(2, 10)));
    for (let tries = 0; S.players.some(x => x.name === name) && tries < 30; tries++) name = name.slice(0, 7) + (rand(9) + 1);
    addPlayer(pid, name);
    p = player(pid);
  } else {
    const old = net.conns.get(p.pid);
    if (old && old !== conn) { old._pid = null; try { old.close(); } catch { /* */ } }
    p.online = true;
  }
  conn._pid = p.pid;
  net.conns.set(p.pid, conn);
  conn.send({ t: 'welcome', pid: p.pid });
  broadcast();
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  queueMicrotask(() => {
    broadcastQueued = false;
    const now = Date.now();
    for (const [pid, conn] of net.conns) {
      if (conn.open) try { conn.send({ t: 'state', now, s: S, me: privFor(pid) }); } catch (e) { console.warn(e); }
    }
    setView({ s: JSON.parse(JSON.stringify(S)), me: privFor(myPid) });
  });
}
const privFor = pid => (S.g && HOST[S.game].priv ? HOST[S.game].priv(pid) : {});

function notify(pid, text) {
  if (pid === myPid) { toast(text); sfx.err(); return; }
  const c = net.conns.get(pid);
  if (c && c.open) c.send({ t: 'toast', text });
}

function handleAct(pid, m) {
  if (!S) return;
  const isHost = pid === S.hostPid;
  switch (m.a) {
    case 'pickGame':
      if (isHost && S.phase === 'lobby' && GAMES[m.game]) { S.game = m.game; broadcast(); }
      return;
    case 'setting':
      if (isHost && S.phase === 'lobby' && m.key in S.settings) { S.settings[m.key] = String(m.val); broadcast(); }
      return;
    case 'start': case 'again':
      if (isHost) startGame();
      return;
    case 'lobby':
      if (isHost) { clearTimers(); S.phase = 'lobby'; S.g = null; SECRET = {}; broadcast(); }
      return;
    case 'kick': {
      const p = player(m.pid);
      if (isHost && S.phase === 'lobby' && p && !p.online && p.pid !== S.hostPid) { S.players = S.players.filter(x => x !== p); broadcast(); }
      return;
    }
  }
  if (S.g && HOST[S.game].act) HOST[S.game].act(pid, m, isHost);
}

function startGame() {
  const G = GAMES[S.game];
  if (onlinePids().length < G.min) { notify(S.hostPid, `${G.title}은(는) 최소 ${G.min}명이 필요해요`); return; }
  clearTimers();
  SECRET = {};
  S.rounds++;
  HOST[S.game].start();
  broadcast();
}

// ───────────────────────── host: game logic ─────────────────────────
const HOST = {
  liar: {
    start() {
      const ps = shuffle(onlinePids());
      const cat = S.settings.liarCat in LIAR_WORDS ? S.settings.liarCat : pick(Object.keys(LIAR_WORDS));
      const [word, fake] = shuffle(LIAR_WORDS[cat]);
      SECRET = { liar: pick(ps), word, fake, votes: {} };
      S.g = { id: S.rounds, players: ps, cat, mode: S.settings.liarMode, ready: [], voted: [], counts: {}, caught: null, deadline: 0, result: null };
      S.phase = 'liar_reveal';
    },
    priv(pid) {
      if (!S.g.players.includes(pid) || S.phase === 'liar_result') return {};
      const { liar, word, fake } = SECRET;
      const me = { myVote: SECRET.votes[pid] || null };
      if (pid === liar) {
        me.card = S.g.mode === 'fool' ? { role: 'citizen', word: fake } : { role: 'liar' };
        if (S.phase === 'liar_guess') me.guessing = true;
      } else me.card = { role: 'citizen', word };
      return me;
    },
    act(pid, m, isHost) {
      const g = S.g, inGame = g.players.includes(pid);
      if (m.a === 'ready' && S.phase === 'liar_reveal' && inGame && !g.ready.includes(pid)) {
        g.ready.push(pid); this.check(); broadcast();
      } else if (m.a === 'toVote' && isHost && S.phase === 'liar_talk') {
        S.phase = 'liar_vote'; broadcast();
      } else if (m.a === 'vote' && S.phase === 'liar_vote' && inGame && g.players.includes(m.target) && m.target !== pid) {
        SECRET.votes[pid] = m.target;
        if (!g.voted.includes(pid)) g.voted.push(pid);
        this.check(); broadcast();
      } else if (m.a === 'skip' && isHost) {
        if (S.phase === 'liar_reveal') { S.phase = 'liar_talk'; broadcast(); }
        else if (S.phase === 'liar_vote') this.tally();
      } else if (m.a === 'guess' && S.phase === 'liar_guess' && pid === SECRET.liar) {
        const guess = String(m.text || '').trim().slice(0, 20);
        this.finish(norm(guess) && norm(guess) === norm(SECRET.word) ? 'guessed' : 'caught', guess);
      }
    },
    check() {
      if (!S.g) return;
      const g = S.g, act = activePids();
      if (S.phase === 'liar_reveal' && act.every(p => g.ready.includes(p))) S.phase = 'liar_talk';
      else if (S.phase === 'liar_vote' && act.every(p => g.voted.includes(p))) this.tally();
    },
    tally() {
      const counts = {};
      for (const t of Object.values(SECRET.votes)) counts[t] = (counts[t] || 0) + 1;
      const max = Math.max(0, ...Object.values(counts));
      const tops = Object.keys(counts).filter(k => counts[k] === max);
      S.g.counts = counts;
      if (max > 0 && tops.length === 1 && tops[0] === SECRET.liar) {
        S.phase = 'liar_guess';
        S.g.caught = SECRET.liar;
        S.g.deadline = Date.now() + 30000;
        schedule(30000, () => this.finish('caught', ''));
        broadcast();
      } else this.finish(max === 0 || tops.length > 1 ? 'tie' : 'wrong', '');
    },
    finish(reason, guess) {
      clearTimers();
      const g = S.g, { liar, word, fake } = SECRET;
      const liarWin = reason !== 'caught';
      g.gain = {};
      if (liarWin) addScore(liar, reason === 'guessed' ? 2 : 3);
      else g.players.filter(p => p !== liar).forEach(p => addScore(p, 1));
      g.result = { liar, word, fake, reason, liarWin, guess, votes: { ...SECRET.votes } };
      S.phase = 'liar_result';
      broadcast();
    },
  },

  nunchi: {
    start() {
      const ps = onlinePids(), startAt = Date.now() + 4000;
      S.g = { id: S.rounds, players: ps, target: ps.length, calls: [], startAt, endAt: startAt + 10000 + ps.length * 1500, ending: false, result: null };
      S.phase = 'nunchi_play';
      schedule(S.g.endAt - Date.now(), () => this.finish('timeout'));
    },
    act(pid, m) {
      const g = S.g;
      if (m.a !== 'tap' || S.phase !== 'nunchi_play' || !g.players.includes(pid)) return;
      const now = Date.now();
      if (now < g.startAt) { this.finish('false', [pid]); return; }
      if (g.calls.some(c => c.pid === pid)) return;
      const last = g.calls[g.calls.length - 1];
      if (last && now - last.t < NUNCHI_WINDOW) {
        // 방금 나온 숫자와 겹침 → 같은 숫자를 외친 사람 전원 탈락
        g.calls.push({ pid, n: last.n, t: now, col: true });
        g.calls.forEach(c => { if (c.n === last.n) c.col = true; });
        if (!g.ending) { g.ending = true; schedule(NUNCHI_WINDOW, () => this.finish('collide')); }
      } else {
        if (g.ending) return;
        g.calls.push({ pid, n: (last ? last.n : 0) + 1, t: now });
        if (g.calls.length >= g.target - 1) { g.ending = true; schedule(NUNCHI_WINDOW, () => this.finish('last')); }
      }
      broadcast();
    },
    finish(reason, falsePids) {
      if (S.phase !== 'nunchi_play') return;
      clearTimers();
      const g = S.g;
      let losers;
      if (reason === 'false') losers = falsePids;
      else {
        const col = [...new Set(g.calls.filter(c => c.col).map(c => c.pid))];
        if (col.length) { losers = col; reason = 'collide'; }
        else losers = g.players.filter(p => !g.calls.some(c => c.pid === p));
      }
      g.gain = {};
      g.players.filter(p => !losers.includes(p)).forEach(p => addScore(p, 1));
      g.result = { losers, reason };
      S.phase = 'nunchi_result';
      broadcast();
    },
  },

  sync: {
    start() { this.round(1); },
    round(n) {
      let pool = SYNC_PROMPTS.filter(p => !usedPrompts.has(p));
      if (!pool.length) { usedPrompts.clear(); pool = SYNC_PROMPTS.slice(); }
      const prompt = pick(pool);
      usedPrompts.add(prompt);
      SECRET = { answers: {} };
      S.g = { id: S.rounds, n, players: onlinePids(), prompt, submitted: [], deadline: Date.now() + 40000, result: null };
      S.phase = 'sync_answer';
      schedule(40000, () => this.reveal());
    },
    priv(pid) { return { myAnswer: SECRET.answers ? (SECRET.answers[pid] ?? null) : null }; },
    act(pid, m, isHost) {
      const g = S.g;
      if (m.a === 'answer' && S.phase === 'sync_answer' && g.players.includes(pid) && !(pid in SECRET.answers)) {
        const t = String(m.text || '').trim().slice(0, 20);
        if (!t) return;
        SECRET.answers[pid] = t;
        g.submitted.push(pid);
        this.check(); broadcast();
      } else if (m.a === 'skip' && isHost && S.phase === 'sync_answer') this.reveal();
      else if (m.a === 'next' && isHost && S.phase === 'sync_reveal') { clearTimers(); this.round(g.n + 1); broadcast(); }
    },
    check() {
      if (S.g && S.phase === 'sync_answer' && activePids().every(p => S.g.submitted.includes(p))) this.reveal();
    },
    reveal() {
      if (S.phase !== 'sync_answer') return;
      clearTimers();
      const g = S.g, groups = {};
      for (const [pid, t] of Object.entries(SECRET.answers)) {
        const k = norm(t) || t;
        (groups[k] = groups[k] || { text: t, pids: [] }).pids.push(pid);
      }
      const list = Object.values(groups).sort((a, b) => b.pids.length - a.pids.length);
      const perfect = list.length === 1 && list[0].pids.length >= 2 && list[0].pids.length === g.players.length;
      g.gain = {};
      list.forEach(gr => { if (gr.pids.length >= 2) gr.pids.forEach(p => addScore(p, gr.pids.length - 1 + (perfect ? 2 : 0))); });
      g.result = { groups: list, perfect, none: g.players.filter(p => !(p in SECRET.answers)) };
      S.phase = 'sync_reveal';
      broadcast();
    },
  },

  bomb: {
    start() {
      const ps = onlinePids(), fuse = 25000 + rand(30000);
      SECRET = { explodeAt: Date.now() + fuse };
      S.g = { id: S.rounds, players: ps, cho: pick(CHO_PAIRS), holder: pick(ps), used: [], result: null };
      S.phase = 'bomb_play';
      schedule(fuse, () => this.explode());
    },
    act(pid, m) {
      const g = S.g;
      if (m.a !== 'pass' || S.phase !== 'bomb_play' || pid !== g.holder) return;
      const w = String(m.word || '').replace(/\s/g, '').slice(0, 10);
      if (choseong(w) !== g.cho) { notify(pid, `초성 ${g.cho}에 맞는 단어가 아니에요!`); return; }
      if (g.used.some(u => u.w === w)) { notify(pid, '이미 나온 단어예요!'); return; }
      g.used.push({ w, pid });
      this.passFrom(pid);
      broadcast();
    },
    passFrom(pid) {
      const g = S.g;
      const others = g.players.filter(p => p !== pid && player(p) && player(p).online);
      const prev = g.used.length > 1 ? g.used[g.used.length - 2].pid : null;
      const pool = others.filter(p => p !== prev);
      g.holder = pick(pool.length ? pool : others.length ? others : [pid]);
    },
    check() {
      // 폭탄 든 사람이 나가면 다른 사람에게 넘긴다
      if (S.g && S.phase === 'bomb_play' && !(player(S.g.holder) && player(S.g.holder).online)) this.passFrom(S.g.holder);
    },
    explode() {
      if (S.phase !== 'bomb_play') return;
      const g = S.g;
      g.gain = {};
      g.players.filter(p => p !== g.holder).forEach(p => addScore(p, 1));
      g.result = { loser: g.holder };
      S.phase = 'bomb_result';
      broadcast();
    },
  },
};

// ───────────────────────── client: view ─────────────────────────
let view = null;
const ui = { status: 'home', msg: '', flipped: false, peek: false, peekTimer: 0, showQR: false, pendingCode: '', focusAfter: null, lastTick: 0 };

function setView(v) {
  const prev = view;
  view = v;
  onViewChange(prev, v);
  render();
}

const V = () => view.s;
const me = () => view.me || {};
const P = pid => view.s.players.find(p => p.pid === pid);
const amHost = () => !!view && view.s.hostPid === myPid;
const inviteUrl = code => location.origin + location.pathname + '?room=' + code;

function onViewChange(prev, cur) {
  const ps = prev && prev.s, s = cur.s;
  if (!ps) return;
  const screenChanged = ps.phase !== s.phase || (ps.g && ps.g.id) !== (s.g && s.g.id) || (ps.g && ps.g.n) !== (s.g && s.g.n);
  const playing = !!s.g && s.g.players.includes(myPid);
  if (screenChanged) {
    switch (s.phase) {
      case 'liar_result': {
        const r = s.g.result;
        if (!playing) sfx.pop(); else if (r.liarWin === (r.liar === myPid)) sfx.win(); else sfx.lose();
        break;
      }
      case 'nunchi_result':
        if (s.g.result.losers.includes(myPid)) { sfx.lose(); vibrate([200, 80, 200]); } else sfx.win();
        break;
      case 'sync_reveal': if (s.g.result.perfect) sfx.win(); else sfx.pop(); break;
      case 'bomb_result': sfx.boom(); vibrate(s.g.result.loser === myPid ? 600 : 150); flash(); break;
      case 'liar_guess': sfx.pop(); if (cur.me.guessing) vibrate([100, 50, 100]); break;
      case 'lobby': break;
      default: sfx.pop();
    }
    if (s.phase === 'bomb_play' && s.g.holder === myPid) { vibrate([120, 60, 120]); ui.focusAfter = '#bomb-main input'; }
  } else {
    if (s.phase === 'bomb_play' && ps.g.holder !== s.g.holder) {
      sfx.whoosh();
      if (s.g.holder === myPid) { vibrate([120, 60, 120]); ui.focusAfter = '#bomb-main input'; }
    }
    if (s.phase === 'nunchi_play' && s.g.calls.length > ps.g.calls.length) {
      const c = s.g.calls[s.g.calls.length - 1];
      if (c.col) { sfx.lose(); vibrate(200); } else if (c.pid !== myPid) sfx.tap();
    }
    const online = x => x.players.filter(p => p.online).length;
    if (s.phase === 'lobby' && online(s) > online(ps)) sfx.pop();
  }
}

function screenKey() {
  if (ui.status !== 'room' || !view) return ui.status + ':' + ui.msg;
  const s = view.s;
  return `${s.phase}:${s.g ? s.g.id : 0}:${s.g && s.g.n ? s.g.n : 0}`;
}

// 같은 화면이면 data-live 영역만 바꿔 끼워서 입력 중인 칸·애니메이션이 날아가지 않게 한다
let lastKey = null;
function render() {
  const key = screenKey();
  if (key !== lastKey) { ui.flipped = false; ui.peek = false; }
  const html = buildScreen();
  if (key === lastKey) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('[data-live]').forEach(n => {
      const cur = document.getElementById(n.id);
      if (cur && cur.innerHTML !== n.innerHTML) cur.innerHTML = n.innerHTML;
    });
  } else {
    app.innerHTML = html;
    lastKey = key;
    window.scrollTo(0, 0);
  }
  if (ui.focusAfter) { const el = $(ui.focusAfter); ui.focusAfter = null; if (el) el.focus({ preventScroll: true }); }
  tick();
}

function buildScreen() {
  switch (ui.status) {
    case 'home': return homeScreen();
    case 'connecting': return `<div class="screen enter center-screen"><div class="spinner"></div><p class="sub">${esc(ui.msg)}</p></div>`;
    case 'error': return `<div class="screen enter center-screen"><div class="big-emoji">😵</div><h2>앗!</h2><p class="sub">${esc(ui.msg)}</p><button class="btn primary big" data-act="home">처음으로</button></div>`;
    case 'lost': return `<div class="screen enter center-screen"><div class="big-emoji">📡</div><h2>연결이 끊겼어요</h2><p class="sub">화면이 꺼지거나 네트워크가 바뀌면 끊길 수 있어요.<br>점수는 그대로 남아 있어요!</p><button class="btn primary big" data-act="reconnect">다시 연결</button><button class="btn ghost" data-act="home">처음으로</button></div>`;
  }
  const s = V(), fn = SCREENS[s.phase] || SCREENS.lobby;
  return `<div class="screen enter">${topbar(s)}${fn(s)}</div>`;
}

// ───────────────────────── client: components ─────────────────────────
function tag(pid, cls = '') {
  const p = P(pid);
  if (!p) return '';
  return `<span class="tag ${cls} ${p.online ? '' : 'off'}" style="--c:${p.color}"><i>${p.av}</i>${esc(p.name)}${pid === myPid ? '<em>나</em>' : ''}</span>`;
}
function dot(pid, done) {
  const p = P(pid);
  return p ? `<span class="dot ${done ? 'done' : ''} ${p.online ? '' : 'off'}" style="--c:${p.color}" title="${esc(p.name)}">${p.av}</span>` : '';
}
const spectate = s => (s.g && !s.g.players.includes(myPid) ? '<div class="spectate">👀 관전 중이에요 — 다음 판부터 함께해요</div>' : '');
const titleBlock = (kicker, title, sub = '') => `<div class="title-block"><div class="kicker">${kicker}</div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;

function topbar(s) {
  return `<div class="topbar" id="topbar" data-live>
    <div class="room-chip">ROOM <b>${esc(s.code)}</b></div>
    <div class="grow"></div>
    <button class="icon-btn" data-act="sound" aria-label="소리 켜기/끄기">${soundOn() ? '🔊' : '🔇'}</button>
    <button class="icon-btn" data-act="leave" aria-label="나가기">🚪</button>
  </div>`;
}

function scoreboard(gain = {}) {
  const ps = [...V().players].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];
  return `<div class="card scores"><div class="card-title">🏆 누적 점수</div>${ps.map((p, i) => `
    <div class="score-row ${p.pid === myPid ? 'me' : ''}">
      <span class="rank">${medals[i] || i + 1}</span>${tag(p.pid)}<span class="grow"></span>
      ${gain[p.pid] ? `<span class="gain">+${gain[p.pid]}</span>` : ''}<b class="pts">${p.score}</b>
    </div>`).join('')}</div>`;
}

function resultCtl(label = '🔁 한 판 더', a = 'again') {
  return amHost()
    ? `<div class="ctl"><button class="btn primary big" data-act="${a}">${label}</button><button class="btn ghost" data-act="lobby">🏠 다른 게임 고르기</button></div>`
    : `<div class="wait">⏳ 방장이 다음 판을 준비하고 있어요</div>`;
}

function qrSvg(url) {
  if (!window.qrcode) return '<p class="hint">QR을 불러오지 못했어요</p>';
  const q = window.qrcode(0, 'M');
  q.addData(url);
  q.make();
  return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

function cardFace(c, g) {
  if (!c) return '';
  if (c.role === 'liar') return `<div class="big-emoji">🤫</div><div class="role display">당신은 라이어!</div><p>카테고리는 <b>${esc(g.cat)}</b><br>다른 사람 설명을 듣고 제시어를 추리하세요</p>`;
  return `<div class="cat">${esc(g.cat)}</div><div class="word display">${esc(c.word)}</div><p>라이어에게 들키지 않게 설명하세요</p>`;
}

// ───────────────────────── client: screens ─────────────────────────
function homeScreen() {
  const name = esc(ls.get('np_name', ''));
  const code = esc(ui.pendingCode);
  const invited = !!ui.pendingCode;
  return `<div class="screen enter home">
    <div class="logo">
      <div class="logo-burst">🎉</div>
      <h1 class="display"><span>NURO</span> PARTY</h1>
      <p class="tagline">폰 하나씩 들고 모이면 끝!<br>설치 없이 바로 하는 친구 파티게임</p>
    </div>
    ${invited ? `<div class="invited">🎟️ <b>${code}</b> 방에 초대받았어요! 닉네임만 정하면 바로 입장</div>` : ''}
    <form class="card stack" data-form="home" autocomplete="off">
      <label class="label" for="name">닉네임</label>
      <input class="field" id="name" maxlength="8" placeholder="최대 8글자" value="${name}" enterkeyhint="done">
      ${invited ? '' : '<button class="btn primary big" type="button" data-act="create">✨ 방 만들기</button><div class="or"><span>또는 코드로 참가</span></div>'}
      <div class="join-row">
        <input class="field code-input" id="code" maxlength="4" placeholder="ABCD" value="${code}" autocapitalize="characters" spellcheck="false">
        <button class="btn ${invited ? 'primary' : 'yellow'}" type="submit">참가하기</button>
      </div>
      ${invited ? '<button class="btn ghost sm" type="button" data-act="create">내가 새 방 만들기</button>' : ''}
    </form>
    <div class="game-list">
      ${Object.values(GAMES).map(g => `<div class="mini-game"><span class="e">${g.emoji}</span><div><b>${g.title}</b><small>${g.desc}</small></div></div>`).join('')}
    </div>
    <ul class="features"><li>📱 각자 폰으로</li><li>👥 2~12명</li><li>🌐 다른 와이파이여도 OK</li></ul>
  </div>`;
}

const SCREENS = {
  lobby(s) {
    const host = amHost(), n = s.players.filter(p => p.online).length, G = GAMES[s.game];
    const chip = (key, val, label) => `<button class="chip ${s.settings[key] === val ? 'on' : ''}" ${host ? `data-act="set" data-key="${key}" data-val="${val}"` : 'tabindex="-1"'}>${label}</button>`;
    const liarSettings = `<div class="card settings">
      <div class="label">카테고리</div>
      <div class="chips">${chip('liarCat', 'random', '🎲 랜덤')}${Object.keys(LIAR_WORDS).map(c => chip('liarCat', c, c)).join('')}</div>
      <div class="label">모드</div>
      <div class="chips">${chip('liarMode', 'normal', '😎 일반')}${chip('liarMode', 'fool', '🤪 바보 모드')}</div>
      <p class="hint">${s.settings.liarMode === 'fool' ? '바보 모드: 라이어도 비슷한 가짜 제시어를 받아서 자기가 라이어인 줄 몰라요!' : '일반 모드: 라이어는 카테고리만 알고 제시어는 몰라요.'}</p>
    </div>`;
    return `
    <section class="card invite">
      <div class="invite-top">
        <div><div class="label">초대 코드</div><div class="code display">${esc(s.code)}</div></div>
        <button class="btn sm ghost" data-act="qr">QR 코드</button>
      </div>
      <div id="qr" data-live>${ui.showQR ? `<div class="qr">${qrSvg(inviteUrl(s.code))}</div><p class="hint center">옆 친구는 카메라로 찍으면 바로 입장!</p>` : ''}</div>
      <button class="btn yellow" data-act="share">📨 초대 링크 보내기</button>
    </section>
    <div id="lobby-players" data-live>
      <h3>참가자 ${n}/${MAX_PLAYERS}</h3>
      <div class="players">${s.players.map(p => `
        <div class="pl ${p.online ? '' : 'off'}" style="--c:${p.color}" ${host && !p.online && p.pid !== s.hostPid ? `data-act="kick" data-pid="${p.pid}"` : ''}>
          <div class="av">${p.av}</div><div class="nm">${esc(p.name)}</div>
          ${p.pid === s.hostPid ? '<div class="crown">👑</div>' : ''}${p.pid === myPid ? '<div class="me-badge">나</div>' : ''}
          ${p.online ? '' : '<div class="offl">오프라인</div>'}
        </div>`).join('')}</div>
    </div>
    <div id="lobby-games" data-live>
      <h3>${host ? '게임을 골라 주세요' : '방장이 고른 게임'}</h3>
      <div class="games">${Object.entries(GAMES).map(([id, g]) => `
        <button class="game ${s.game === id ? 'sel' : ''}" ${host ? `data-act="pick" data-game="${id}"` : 'tabindex="-1"'}>
          <span class="e">${g.emoji}</span><b>${g.title}</b><small class="gtag">${g.tag} · ${g.min}명+</small>
        </button>`).join('')}</div>
      <p class="game-desc">${G.emoji} ${G.desc}</p>
      ${s.game === 'liar' ? liarSettings : ''}
    </div>
    <div id="lobby-start" data-live>${host
      ? `<button class="btn primary big" data-act="start" ${n < G.min ? 'disabled' : ''}>${G.emoji} ${G.title} 시작!</button>
         ${n < G.min ? `<p class="hint center">최소 ${G.min}명이 필요해요 · 친구를 초대하세요</p>` : ''}
         <p class="hint center">👑 방장 폰이 꺼지면 방이 닫혀요. 화면을 켜 두세요!</p>`
      : `<div class="wait">⏳ 방장이 게임을 시작하길 기다리는 중…</div>`}</div>
    ${s.rounds ? scoreboard() : ''}`;
  },

  // ── 라이어 게임 ──
  liar_reveal(s) {
    const g = s.g, c = me().card, inG = g.players.includes(myPid), ready = g.ready.includes(myPid);
    return `${spectate(s)}
    ${titleBlock('🕵️ 라이어 게임', '내 카드 확인', `카테고리 <b>${esc(g.cat)}</b> · 옆 사람이 못 보게 확인하세요!`)}
    ${inG ? `<div class="flip" data-act="flip"><div class="flip-in">
      <div class="face front"><div class="big-emoji">🃏</div><b>탭해서 카드 뒤집기</b></div>
      <div class="face back ${c && c.role === 'liar' ? 'liar' : ''}">${cardFace(c, g)}</div>
    </div></div>` : ''}
    <div id="liar-ready" data-live>
      ${inG ? `<button class="btn primary big" data-act="ready" ${ready || !ui.flipped ? 'disabled' : ''}>${ready ? '✅ 확인 완료' : ui.flipped ? '확인했어요!' : '카드를 먼저 뒤집어 주세요'}</button>` : ''}
      <div class="progress-row">${g.players.map(p => dot(p, g.ready.includes(p))).join('')}</div>
      <p class="hint center">${g.ready.length}/${g.players.length}명 확인</p>
      ${amHost() ? '<button class="btn ghost sm" data-act="skip">기다리지 않고 진행</button>' : ''}
    </div>`;
  },

  liar_talk(s) {
    const g = s.g, inG = g.players.includes(myPid);
    return `${spectate(s)}
    ${titleBlock(`🕵️ 라이어 게임 · ${esc(g.cat)}`, '돌아가며 한 마디씩!', '순서대로 제시어를 <b>한 문장</b>으로 설명하세요.<br>너무 쉬우면 라이어가 눈치채요 😏')}
    <ol class="order">${g.players.map((p, i) => `<li><span class="num">${i + 1}</span>${tag(p)}</li>`).join('')}</ol>
    ${inG ? `<button class="btn ghost" data-act="peek">👁️ 내 카드 다시 보기</button><div id="peek" data-live>${ui.peek ? `<div class="card peek ${me().card && me().card.role === 'liar' ? 'liar' : ''}">${cardFace(me().card, g)}</div>` : ''}</div>` : ''}
    <div id="liar-talk-ctl" data-live>${amHost() ? '<button class="btn primary big" data-act="toVote">🗳️ 투표 시작</button>' : '<div class="wait">설명이 끝나면 방장이 투표를 시작해요</div>'}</div>`;
  },

  liar_vote(s) {
    const g = s.g, inG = g.players.includes(myPid), mv = me().myVote;
    return `${spectate(s)}
    ${titleBlock('🕵️ 라이어 게임', '라이어는 누구?', '가장 수상한 사람을 고르세요. 모두 투표하면 바로 개표!')}
    <div id="vote" data-live>
      <div class="vote-grid">${g.players.filter(p => p !== myPid).map(p => {
        const pl = P(p);
        return pl ? `<button class="vote ${mv === p ? 'sel' : ''}" style="--c:${pl.color}" ${inG ? `data-act="vote" data-pid="${p}"` : 'tabindex="-1"'}>
          <span class="av">${pl.av}</span><span class="nm">${esc(pl.name)}</span>${g.voted.includes(p) ? '<span class="chk">투표함</span>' : ''}
        </button>` : '';
      }).join('')}</div>
      <p class="hint center">${g.voted.length}/${g.players.length}명 투표 · 개표 전까지 바꿀 수 있어요</p>
      ${amHost() ? '<button class="btn ghost sm" data-act="skip">지금 바로 개표하기</button>' : ''}
    </div>`;
  },

  liar_guess(s) {
    const g = s.g;
    if (me().guessing) {
      return `${titleBlock('🎯 들켰다!', '마지막 기회', `${g.mode === 'fool' ? '사실 당신이 라이어였어요 🤪 ' : ''}진짜 제시어를 맞히면 역전승!`)}
      <form class="card stack" data-form="guess" autocomplete="off">
        <input class="field" name="t" maxlength="20" placeholder="제시어는 바로…" enterkeyhint="send">
        <button class="btn primary big">정답 제출</button>
      </form>
      <div class="timer">⏱ <span data-deadline="${g.deadline}"></span>초</div>`;
    }
    return `${titleBlock('🎯 라이어 검거!', `${tag(g.caught, 'lg')}`, '라이어가 제시어를 맞히면 역전승이에요. 숨죽이고 기다리세요…')}
    <div class="suspense">🤔</div>
    <div class="timer">⏱ <span data-deadline="${g.deadline}"></span>초</div>`;
  },

  liar_result(s) {
    const g = s.g, r = g.result, playing = g.players.includes(myPid), won = r.liarWin === (r.liar === myPid);
    const reason = {
      tie: '표가 갈려서 라이어가 유유히 도망쳤어요 🏃',
      wrong: '엉뚱한 사람을 지목했어요 😵',
      guessed: `잡혔지만 제시어 「${esc(r.guess)}」를 맞혔어요! 🎯`,
      caught: r.guess ? `「${esc(r.guess)}」… 땡! 시민들의 완벽한 승리` : '제시어를 못 맞혔어요. 시민들의 승리!',
    }[r.reason];
    const counts = g.counts || {};
    const voters = t => Object.entries(r.votes).filter(([, v]) => v === t).map(([k]) => dot(k, true)).join('');
    const rows = [...g.players].sort((a, b) => (counts[b] || 0) - (counts[a] || 0)).map(p =>
      `<div class="vote-row ${p === r.liar ? 'liar' : ''}">${tag(p)}<span class="voters">${voters(p)}</span><b>${counts[p] || 0}표</b></div>`).join('');
    return `<div class="banner ${r.liarWin ? 'red' : 'blue'}">
      <div class="kicker">${playing ? (won ? '🎉 이겼다!' : '😭 졌다…') : '결과'}</div>
      <h1 class="display">${r.liarWin ? '라이어 승리!' : '시민 승리!'}</h1><p>${reason}</p>
    </div>
    <div class="card reveal">
      <div class="label">라이어는</div><div class="reveal-big">${tag(r.liar, 'lg')}</div>
      <div class="label">제시어</div><div class="word display">${esc(r.word)}</div>
      ${g.mode === 'fool' ? `<p class="hint">🤪 라이어가 받은 가짜 제시어: <b>${esc(r.fake)}</b></p>` : ''}
    </div>
    <div class="card"><div class="card-title">🗳️ 투표 결과</div>${rows}</div>
    ${scoreboard(g.gain)}${resultCtl()}`;
  },

  // ── 눈치 게임 ──
  nunchi_play(s) {
    const g = s.g, inG = g.players.includes(myPid), mine = g.calls.find(c => c.pid === myPid);
    const next = (g.calls.length ? g.calls[g.calls.length - 1].n : 0) + 1;
    return `${spectate(s)}
    ${titleBlock('👀 눈치 게임', `1부터 ${g.target}까지!`, '숫자를 외치며 한 명씩 터치! <b>동시에 누르면 탈락</b>, <b>끝까지 못 눌러도 탈락</b>. 시작 전에 누르면 부정출발 🚫')}
    <div class="go" data-go="${g.startAt}"></div>
    <div id="nunchi-btn" data-live>${inG ? (mine
      ? `<div class="tap-done ${mine.col ? 'col' : ''}">${mine.col ? '💥' : '✅'}<b>${mine.n}</b></div>`
      : `<button class="tap" data-act="tap"><span>${next}</span><small>터치!</small></button>`) : ''}</div>
    <div class="bar"><i data-bar="${g.endAt}" data-from="${g.startAt}"></i></div>
    <div id="nunchi-calls" data-live><div class="calls">${g.calls.map(c => `<div class="call ${c.col ? 'col' : ''}"><b>${c.n}</b>${tag(c.pid)}</div>`).join('')}</div></div>`;
  },

  nunchi_result(s) {
    const g = s.g, r = g.result, lost = r.losers.includes(myPid);
    const reason = { collide: '💥 동시에 눌러버렸다!', last: '🐢 끝까지 못 눌렀다!', timeout: '⏰ 시간 초과!', false: '🚫 부정 출발!' }[r.reason];
    return `<div class="banner ${lost ? 'red' : 'blue'}">
      <div class="kicker">${reason}</div><h1 class="display">벌칙 당첨</h1>
      <div class="losers">${r.losers.map(p => tag(p, 'lg')).join('')}</div>
      ${g.players.includes(myPid) ? `<p>${lost ? '벌칙은 친구들이 정해 줄 거예요 😈' : '살아남았다! +1점'}</p>` : ''}
    </div>
    ${g.calls.length ? `<div class="card"><div class="card-title">외친 순서</div><div class="calls">${g.calls.map(c => `<div class="call ${c.col ? 'col' : ''}"><b>${c.n}</b>${tag(c.pid)}</div>`).join('')}</div></div>` : ''}
    ${scoreboard(g.gain)}${resultCtl()}`;
  },

  // ── 이심전심 ──
  sync_answer(s) {
    const g = s.g, inG = g.players.includes(myPid), my = me().myAnswer;
    return `${spectate(s)}
    ${titleBlock(`🧠 이심전심 · ${g.n}번째 질문`, `<span class="prompt">${esc(g.prompt)}</span>`, '다른 사람들이 쓸 것 같은 답을 쓰세요. 같은 답이 많을수록 점수!')}
    <div id="sync-form" data-live>${inG ? (my != null
      ? `<div class="card submitted"><div class="label">✅ 제출 완료</div><div class="word display">${esc(my)}</div></div>`
      : `<form class="card stack" data-form="answer" autocomplete="off"><input class="field" name="t" maxlength="20" placeholder="내 답은…" enterkeyhint="send"><button class="btn primary big">제출</button></form>`) : ''}</div>
    <div class="timer">⏱ <span data-deadline="${g.deadline}"></span>초</div>
    <div id="sync-status" data-live>
      <div class="progress-row">${g.players.map(p => dot(p, g.submitted.includes(p))).join('')}</div>
      <p class="hint center">${g.submitted.length}/${g.players.length}명 제출</p>
      ${amHost() ? '<button class="btn ghost sm" data-act="skip">바로 공개하기</button>' : ''}
    </div>`;
  },

  sync_reveal(s) {
    const g = s.g, r = g.result;
    return `${titleBlock(`🧠 이심전심 · ${g.n}번째 질문`, `<span class="prompt">${esc(g.prompt)}</span>`)}
    ${r.perfect ? '<div class="banner gold"><h1 class="display">완벽한 이심전심!</h1><p>모두 같은 답! 보너스 +2점</p></div>' : ''}
    <div class="groups">${r.groups.map((gr, i) => `
      <div class="group ${gr.pids.length > 1 ? 'match' : ''}" style="animation-delay:${i * 0.12}s">
        <div class="ans display">${esc(gr.text)}</div>
        <div class="who">${gr.pids.map(p => tag(p)).join('')}</div>
        ${gr.pids.length > 1 ? `<div class="g-pts">+${gr.pids.length - 1 + (r.perfect ? 2 : 0)}</div>` : '<div class="g-pts zero">혼자 😢</div>'}
      </div>`).join('') || '<p class="hint center">아무도 답하지 않았어요 🦗</p>'}</div>
    ${r.none.length ? `<p class="hint center">미제출: ${r.none.map(p => esc(P(p) ? P(p).name : '')).join(', ')}</p>` : ''}
    ${scoreboard(g.gain)}${resultCtl('➡️ 다음 질문', 'next')}`;
  },

  // ── 초성 폭탄 ──
  bomb_play(s) {
    const g = s.g, mine = g.holder === myPid;
    return `${spectate(s)}
    <div class="title-block"><div class="kicker">💣 초성 폭탄</div><div class="cho display">${g.cho.split('').join(' ')}</div>
      <p class="sub">초성에 맞는 단어를 쓰면 폭탄이 랜덤으로 넘어가요.<br>언제 터질지는 아무도 몰라요!</p></div>
    <div id="bomb-main" data-live>${mine
      ? `<div class="bomb-wrap hot"><div class="bomb">💣</div></div><div class="you-have">폭탄이 나한테 왔다!!</div>
         <form class="card stack" data-form="pass" autocomplete="off"><input class="field" name="t" maxlength="10" placeholder="${g.cho} 로 시작하는 단어" enterkeyhint="send"><button class="btn primary big">💨 던지기!</button></form>`
      : `<div class="bomb-wrap"><div class="bomb small">💣</div></div><div class="holder">${tag(g.holder, 'lg')}<span>폭탄을 들고 있어요</span></div>`}</div>
    <div id="bomb-used" data-live><div class="card"><div class="card-title">나온 단어 ${g.used.length}개</div><div class="used">${g.used.slice().reverse().map(u => `<span class="w" style="--c:${P(u.pid) ? P(u.pid).color : '#fff'}">${esc(u.w)}</span>`).join('') || '<span class="hint">아직 없어요</span>'}</div></div></div>`;
  },

  bomb_result(s) {
    const g = s.g, r = g.result, lost = r.loser === myPid;
    return `<div class="banner red boom"><div class="big-emoji">💥</div><h1 class="display">펑!!</h1>
      <div class="losers">${tag(r.loser, 'lg')}</div><p>${lost ? '내 손에서 터졌다… 😭' : g.players.includes(myPid) ? '살았다! 😮‍💨 +1점' : ''}</p></div>
    <div class="card"><div class="card-title">초성 ${g.cho} · 나온 단어 ${g.used.length}개</div><div class="used">${g.used.map(u => `<span class="w" style="--c:${P(u.pid) ? P(u.pid).color : '#fff'}">${esc(u.w)}</span>`).join('') || '<span class="hint">하나도 못 썼어요 😅</span>'}</div></div>
    ${scoreboard(g.gain)}${resultCtl()}`;
  },
};

// ───────────────────────── client: ticker / fx ─────────────────────────
function tick() {
  const now = hostNow();
  document.querySelectorAll('[data-deadline]').forEach(el => {
    const v = String(Math.max(0, Math.ceil((+el.dataset.deadline - now) / 1000)));
    if (el.textContent !== v) el.textContent = v;
    const t = el.closest('.timer');
    if (t) t.classList.toggle('urgent', +v <= 5);
  });
  document.querySelectorAll('[data-bar]').forEach(el => {
    const end = +el.dataset.bar, from = +el.dataset.from;
    el.style.transform = `scaleX(${Math.min(1, Math.max(0, (end - now) / (end - from)))})`;
  });
  document.querySelectorAll('[data-go]').forEach(el => {
    const d = +el.dataset.go - now;
    if (d > 0) {
      const t = String(Math.ceil(d / 1000));
      if (el.textContent !== t) { el.textContent = t; el.className = 'go'; void el.offsetWidth; el.className = 'go count'; sfx.tick(2); }
    } else if (!el.classList.contains('went')) { el.textContent = 'GO!'; el.className = 'go went'; sfx.go(); vibrate(60); }
  });
  if (view && ui.status === 'room' && view.s.phase === 'bomb_play') {
    const mine = view.s.g.holder === myPid;
    if (Date.now() - ui.lastTick > (mine ? 450 : 900)) { ui.lastTick = Date.now(); sfx.tick(mine ? 1.2 : 0.4); }
  }
}
setInterval(tick, 150);

function flash() {
  const d = document.createElement('div');
  d.className = 'flash';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 900);
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 600);
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

let wakeLock = null;
async function requestWake() {
  try {
    if ('wakeLock' in navigator && !wakeLock && ui.status === 'room' && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* 지원 안 함 */ }
}

async function shareInvite() {
  const code = V().code, url = inviteUrl(code);
  const text = `NURO PARTY에서 같이 놀자! 🎉 방 코드: ${code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'NURO PARTY', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요! 친구에게 붙여넣기 하세요'); } catch { window.prompt('이 링크를 친구에게 보내세요', url); }
}

// ───────────────────────── input ─────────────────────────
function homeValues() {
  return { name: $('#name').value.trim().slice(0, 8), code: $('#code').value.trim().toUpperCase() };
}
function needName(name) {
  if (name) { ls.set('np_name', name); return false; }
  toast('닉네임을 입력해 주세요');
  $('#name').focus();
  return true;
}

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  requestWake();
  switch (a) {
    case 'tap': return; // pointerdown 에서 처리
    case 'create': { const { name } = homeValues(); if (!needName(name)) createRoom(name); return; }
    case 'home': location.href = location.pathname; return;
    case 'reconnect': joinRoom(net.code, net.name); return;
    case 'flip':
      ui.flipped = !ui.flipped;
      el.classList.toggle('on', ui.flipped);
      sfx.pop(); vibrate(20);
      render(); return;
    case 'peek':
      ui.peek = !ui.peek;
      clearTimeout(ui.peekTimer);
      if (ui.peek) ui.peekTimer = setTimeout(() => { ui.peek = false; render(); }, 4000);
      render(); return;
    case 'qr': ui.showQR = !ui.showQR; render(); return;
    case 'share': shareInvite(); return;
    case 'sound': ls.set('np_sound', soundOn() ? '0' : '1'); sfx.unlock(); render(); return;
    case 'leave':
      if (window.confirm(net.isHost ? '방을 닫을까요? 모두의 연결이 끊겨요.' : '방에서 나갈까요?')) {
        ui.status = 'left';
        try { net.peer && net.peer.destroy(); } catch { /* */ }
        location.href = location.pathname;
      }
      return;
    case 'pick': sfx.tap(); act('pickGame', { game: el.dataset.game }); return;
    case 'set': sfx.tap(); act('setting', { key: el.dataset.key, val: el.dataset.val }); return;
    case 'kick': if (window.confirm('오프라인인 이 플레이어를 내보낼까요?')) act('kick', { pid: el.dataset.pid }); return;
    case 'vote': sfx.tap(); vibrate(15); act('vote', { target: el.dataset.pid }); return;
    default: sfx.tap(); act(a); // start, again, lobby, ready, skip, toVote, next
  }
});

// 눈치 게임 버튼은 click 보다 빠른 pointerdown 으로
app.addEventListener('pointerdown', e => {
  sfx.unlock();
  const el = e.target.closest('[data-act="tap"]');
  if (!el || el.classList.contains('pressed')) return;
  e.preventDefault();
  el.classList.add('pressed');
  vibrate(40);
  sfx.tap();
  act('tap');
});

app.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, input = f.elements.t, t = input ? input.value.trim() : '';
  switch (f.dataset.form) {
    case 'home': {
      const { name, code } = homeValues();
      if (needName(name)) return;
      if (!/^[A-Z]{4}$/.test(code)) { toast('4자리 방 코드를 입력해 주세요'); $('#code').focus(); return; }
      joinRoom(code, name);
      return;
    }
    case 'answer': case 'guess':
      if (!t) return;
      act(f.dataset.form, { text: t });
      input.blur();
      return;
    case 'pass': {
      const w = t.replace(/\s/g, '');
      if (choseong(w) !== V().g.cho) { toast(`초성 ${V().g.cho}에 맞게 써 주세요!`); sfx.err(); f.classList.remove('nope'); void f.offsetWidth; f.classList.add('nope'); return; }
      act('pass', { word: w });
      return;
    }
  }
});

app.addEventListener('input', e => {
  if (e.target.id === 'code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  requestWake();
  if (ui.status === 'lost' && !net.isHost) joinRoom(net.code, net.name);
});

window.addEventListener('beforeunload', e => {
  if (net.isHost && ui.status === 'room') { e.preventDefault(); e.returnValue = ''; }
});

// ───────────────────────── boot ─────────────────────────
ui.pendingCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (typeof Peer === 'undefined') fail('게임 엔진을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침 해 주세요.');
else render();
