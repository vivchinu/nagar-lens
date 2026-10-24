import './style.css';
import { SceneManager, STATUS_COLORS } from './scene.js';

// ---------- icons (SF-Symbols-like line icons) ----------
const P = {
  home: '<path d="M3.5 10.5 12 3.8l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  track: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
  honours: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  me: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.3-3.8 4.2-5.8 7.5-5.8s6.2 2 7.5 5.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.4-2h6.2L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 3.5"/>',
  sparkle: '<path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  ar: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="m12 7.5 4 2.3v4.4l-4 2.3-4-2.3V9.8z"/>',
  map: '<path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2zM9 4.5v13M15 6.5v13"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z"/>',
  people: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><circle cx="16.5" cy="8" r="2.5"/><path d="M15.5 13.6c2.3.1 4.1 1.5 4.8 4.4"/>',
  location: '<path d="M20 4 4 11l7 2 2 7z"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

// ---------- state ----------
const S = {
  data: null,
  user: safeGet('nl.user') || 'Riya Shah',
  role: safeGet('nl.role') === 'officer' ? 'officer' : 'citizen',
  loc: null,
  area: safeGet('nl.area') || '',
  tab: 'home',
  trackScope: 'mine',
  honourScope: 'city',
  chat: [],
  history: [],
  busy: false,
  arSupported: false,
  sheet: null, // { type: 'report' | 'ticket' | 'ask' | 'choose', ... }
  ba: {}, // before/after choice per ticket
};
let R = null; // report flow state

const $ = (id) => document.getElementById(id);
const ISSUE = { pothole: ['🕳️', 'Pothole'], garbage: ['🗑️', 'Garbage'], streetlight: ['💡', 'Broken streetlight'], waterlogging: ['🌊', 'Water logging'] };
const TYPE_ORDER = ['pothole', 'garbage', 'streetlight', 'waterlogging'];
const TOOL_META = {
  analyze_image: ['🔍', 'Analyzing image'],
  lookup_ward_department: ['📍', 'Finding ward & department'],
  check_duplicates: ['👥', 'Checking duplicates'],
  create_ticket: ['🎫', 'Creating ticket'],
  get_status: ['📋', 'Checking status'],
  list_complaints: ['🗂️', 'Listing complaints'],
  update_status: ['🛠️', 'Updating status'],
  verify_completion: ['🧪', 'Verifying the fix'],
  award_points: ['⭐', 'Awarding points'],
  plus_one: ['👍', 'Adding your +1'],
  get_badges: ['🏅', 'Checking badges'],
  get_leaderboard: ['🏆', 'Checking leaderboard'],
};
const STEP_LABELS = ['Filed', 'Ack', 'Assigned', 'Working', 'Done'];
const STAGE_IDX = { Filed: 0, Acknowledged: 1, Assigned: 2, 'In progress': 3, Completed: 4, Verified: 4, Reopened: 0 };
const TITLE_EMOJI = { 'New Citizen': '🌱', 'Active Citizen': '🏅', 'Civic Hero': '⭐', 'Ward Champion': '🛡️', '🏆 Highest Civic Honour': '🏆' };

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const first = (name) => String(name || '').split(' ')[0];
const initials = (name) => String(name || '?').split(' ').map((x) => x[0]).join('').slice(0, 2);
const me = () => S.data?.users.find((u) => u.name === S.user);
const ticket = (id) => S.data?.complaints.find((c) => c.id === id);
const ward = (id) => S.data?.wards.find((w) => w.id === id);
const deptFor = (type) => S.data?.departments.find((d) => d.issueTypes.includes(type));
const isDone = (c) => ['Completed', 'Verified'].includes(c.status);
const titleText = (t) => `${TITLE_EMOJI[t] || '🏅'} ${String(t).replace('🏆 ', '')}`;
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function relTime(iso) {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// ---------- 3D scene ----------
const scene = new SceneManager($('scene'), {
  onPinTap: (id) => openTicket(id),
  onPlaced: (kind, p) => {
    toast(kind === 'map' ? '🗺️ Ward map placed — tap a pin' : `📍 Pinned ${ticket(p.key) ? p.key : 'your complaint'} here`, 'green');
    renderArHud();
  },
  onSessionEnd: () => {
    document.body.classList.remove('in-ar');
    hideArView();
  },
  onHint: (text) => {
    $('arHint').textContent = text || '';
    $('arHint').classList.toggle('hidden', !text);
  },
});
scene.paused = true;

// ---------- API ----------
// Empty = same origin. Set VITE_API_BASE at build time to host the front end separately (e.g. Firebase Hosting).
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const url = (p) => (typeof p === 'string' && /^\/(api|media)\//.test(p) ? API_BASE + p : p);
async function api(path, body) {
  const res = await fetch(url(path), body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

// POST with NDJSON streaming; calls onEvent for each tool event and resolves with the final 'done' payload.
async function streamPost(path, body, onEvent) {
  const res = await fetch(url(`${path}?stream=1`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'error') throw new Error(ev.error);
      if (ev.type === 'done') done = ev;
      else onEvent?.(ev);
    }
  }
  if (!done) throw new Error('No reply from the agent');
  return done;
}

async function refresh() {
  S.data = await api('/api/state');
  if (!me()) S.user = S.data.users[0].name;
  scene.setData(S.data);
  renderChrome();
  renderTab(true);
  if (S.sheet?.type === 'ticket') renderSheet();
  renderArHud();
}

// ---------- chrome ----------
function renderChrome() {
  const u = me();
  $('meAv').textContent = initials(u.name);
  $('mePts').textContent = `🏅 ${u.points}`;
  $('brandSub').textContent = S.role === 'officer' ? 'Officer mode · AMC' : 'AMC civic agent';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === S.tab));
}

function buildTabbar() {
  const label = { home: 'Home', track: 'Track', honours: 'Honours', me: 'Me' };
  document.querySelectorAll('.tab').forEach((t) => (t.innerHTML = `${icon(t.dataset.tab)}<span>${label[t.dataset.tab]}</span>`));
  $('fab').innerHTML = icon('plus');
}

function renderTab(still = false) {
  const el = $('screen');
  const html = { home: homeHTML, track: trackHTML, honours: honoursHTML, me: meHTML }[S.tab]();
  el.classList.toggle('still', still);
  el.innerHTML = html;
  if (!still) el.scrollTop = 0;
}

function setTab(tab) {
  S.tab = tab;
  renderChrome();
  renderTab();
}

// ---------- shared bits ----------
function pill(status) {
  return `<span class="pill" style="--c:${STATUS_COLORS[status] || '#999'}"><i></i>${esc(status)}${status === 'Verified' ? ' ✓' : ''}</span>`;
}

function stepper(status, labels = false) {
  const idx = STAGE_IDX[status] ?? 0;
  const c = STATUS_COLORS[status] || '#999';
  const dots = STEP_LABELS.map((_, i) => `<span class="${i <= idx ? 'on' : ''} ${i === idx ? 'cur' : ''}"></span>`).join('');
  const lab = labels ? `<div class="step-labels">${STEP_LABELS.map((l, i) => `<span class="${i <= idx ? 'on' : ''}">${l}</span>`).join('')}</div>` : '';
  return `<div class="stepper" style="--c:${c}"><div class="track"></div><div class="fill" style="width:calc(${(idx / 4) * 100}% - ${(idx / 4) * 10}px)"></div><div class="dots">${dots}</div></div>${lab}`;
}

function nextTier(u) {
  const top = Math.max(...S.data.users.map((x) => x.points));
  if (u.points < 100) return { text: `${100 - u.points} to Active Citizen`, frac: u.points / 100 };
  if (u.points < 500) return { text: `${500 - u.points} to Civic Hero`, frac: (u.points - 100) / 400 };
  if (u.points < top) return { text: `${top - u.points + 1} to top of city`, frac: 0.85 };
  return { text: 'Top of Ahmedabad 🏆', frac: 1 };
}

function cardHTML(c, { officer = false } = {}) {
  const [, label] = ISSUE[c.issueType] || ['', c.issueType];
  const w = ward(c.ward);
  const desc = (c.description || '').split(/[.—]/)[0].replace(/^Offline mode: /, '') || c.wardName;
  let action = '';
  if (officer) {
    const next = { Filed: ['Acknowledge', 'Acknowledged'], Acknowledged: ['Assign crew', 'Assigned'], Assigned: ['Start work', 'In progress'], Reopened: ['Restart work', 'In progress'] }[c.status];
    if (next) action = `<button class="btn navy sm" style="margin-top:12px" data-act="stage" data-id="${c.id}" data-stage="${next[1]}">${next[0]}</button>`;
    else if (c.status === 'In progress') action = `<button class="btn green sm" style="margin-top:12px" data-act="complete" data-id="${c.id}">📸 Mark completed</button>`;
    else if (c.status === 'Completed') action = `<div class="c-foot" style="margin-top:10px"><span>⏳ Waiting for citizen to verify</span></div>`;
    else action = `<div class="c-foot" style="margin-top:10px"><span style="color:var(--green);font-weight:600">✓ Verified fixed</span></div>`;
  }
  return `<div class="card c-card pressable" role="button" tabindex="0" data-act="ticket" data-id="${c.id}">
    <div class="c-top">
      <img class="thumb" src="${esc(url(c.photoUrl) || '')}" alt="" loading="lazy" />
      <div class="grow">
        <div class="c-title">${esc(desc.toLowerCase().startsWith(label.split(' ').pop().toLowerCase()) || desc.toLowerCase().startsWith(label.toLowerCase().split(' ')[0]) ? desc : `${label} · ${desc}`)}</div>
        <div class="c-sub mono">${esc(c.id)} · Ward ${w?.number ?? ''}</div>
        <div class="c-sub">${esc(c.wardName)}</div>
      </div>
      ${pill(c.status)}
    </div>
    ${stepper(c.status)}
    ${officer ? action : `<div class="c-foot"><span class="plus">👥 ${c.plusOnes} other${c.plusOnes === 1 ? '' : 's'} see this too</span><span>${relTime(c.createdAt)}</span></div>`}
  </div>`;
}

function toolsHTML(calls, title = 'AGENT · TOOL CALLS', right = '') {
  return `<div class="tools"><div class="h"><span>${title}</span><span>${right}</span></div><div data-tools>${calls.map(toolRowHTML).join('')}</div></div>`;
}
function toolRowHTML(c) {
  const [ic, label] = TOOL_META[c.name] || ['🔧', c.name];
  const pending = !c.result;
  const err = c.result?.error;
  return `<div class="tool ${pending ? 'pending' : err ? 'err' : ''}" data-tid="${c.id}">
    <div class="ti">${pending ? '<span class="spin"></span>' : ic}</div>
    <div><div class="tt">${esc(pending ? `${label}…` : c.summary || label)}</div><div class="tn mono">${esc(c.name)}()</div></div>
  </div>`;
}
// Incrementally update a tool panel without re-animating existing rows.
function patchTools(root, calls) {
  const box = root?.querySelector('[data-tools]');
  if (!box) return;
  for (const c of calls) {
    const html = toolRowHTML(c);
    const el = box.querySelector(`[data-tid="${c.id}"]`);
    if (!el) box.insertAdjacentHTML('beforeend', html);
    else if (el.outerHTML !== html) { el.insertAdjacentHTML('afterend', html); el.remove(); box.querySelector(`[data-tid="${c.id}"]`).style.animation = 'none'; }
  }
}
function upsertCall(list, ev) {
  const i = list.findIndex((c) => c.id === ev.id);
  if (i >= 0) list[i] = { ...list[i], ...ev };
  else list.push({ ...ev });
}

// ---------- tabs ----------
function homeHTML() {
  const u = me();
  const nt = nextTier(u);
  const mine = S.data.complaints.filter((c) => c.user === u.name).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const around = S.data.complaints
    .filter((c) => c.user !== u.name && !isDone(c))
    .sort((a, b) => (b.ward === u.homeWard) - (a.ward === u.homeWard) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  return `
    <div class="hero">
      <div class="hi">Namaste,</div>
      <div class="name">${esc(first(u.name))}</div>
      <span class="title-pill">${esc(titleText(u.title))}</span>
      <div class="pts-row"><div class="big">${u.points}<small>civic points</small></div><div class="next">${esc(nt.text)}</div></div>
      <div class="bar"><i style="width:${Math.max(4, nt.frac * 100)}%"></i></div>
    </div>
    ${S.role === 'officer' ? `<button class="card row-card pressable" data-act="tab" data-tab="track"><span class="ic navy">${icon('shield')}</span><span class="grow"><b>Officer queue</b><small>${S.data.complaints.filter((c) => !isDone(c)).length} open tickets to advance</small></span><span class="chev">${icon('chev')}</span></button>` : ''}
    <button class="cta pressable" data-act="report">
      <span class="tile">${icon('camera')}</span>
      <span><b>Report an issue</b><small>Snap a photo. The agent finds the ward, department and files it.</small></span>
    </button>
    <button class="card row-card pressable" data-act="openAR">
      <span class="ic navy">${icon('ar')}</span>
      <span class="grow"><b>${S.arSupported ? 'Look around in AR' : '3D ward map'}</b><small>${S.arSupported ? 'See complaint pins anchored around you' : 'Every complaint on a live city map'}</small></span>
      <span class="chev">${icon('chev')}</span>
    </button>
    <button class="card ask-pill pressable" data-act="ask"><span class="spark">${icon('sparkle')}</span>Ask “What's the status of my complaint?”</button>
    <div class="section-h"><h2>Your complaints</h2><button data-act="tab" data-tab="track">See all</button></div>
    ${mine.length ? mine.slice(0, 3).map((c) => cardHTML(c)).join('') : `<div class="card empty"><b>No complaints yet</b>Tap ＋ to report your first civic issue and earn 10 points.</div>`}
    ${around.length ? `<div class="section-h"><h2>Around your ward</h2></div>${around.map((c) => cardHTML(c)).join('')}` : ''}
  `;
}

function trackHTML() {
  const officer = S.role === 'officer';
  const u = me();
  const order = { 'In progress': 0, Reopened: 1, Assigned: 2, Acknowledged: 3, Filed: 4, Completed: 5, Verified: 6 };
  let list = [...S.data.complaints];
  if (officer) list.sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
  else {
    if (S.trackScope === 'mine') list = list.filter((c) => c.user === u.name);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const open = S.data.complaints.filter((c) => !isDone(c)).length;
  return `
    <div class="large-title">${officer ? 'Officer queue' : 'Track'}</div>
    ${officer ? `<div class="banner">🛠️ <span><b>Officer mode is on.</b> Advance tickets and upload “after” photos here. The agent verifies each fix.</span></div>` : '<p class="subtitle">Follow every complaint from Filed to Done.</p>'}
    <form class="search" data-form="track"><span class="muted">${icon('track')}</span><input name="q" placeholder="Ticket ID, e.g. AMC-W12-0457" autocomplete="off" /><button type="submit">Track</button></form>
    ${officer ? `<div class="section-h" style="margin-top:4px"><h2>Officer queue · ${open}</h2></div>` : `<div class="seg"><button class="${S.trackScope === 'mine' ? 'on' : ''}" data-act="scope" data-v="mine">Mine</button><button class="${S.trackScope === 'all' ? 'on' : ''}" data-act="scope" data-v="all">All Ahmedabad</button></div>`}
    ${list.length ? list.map((c) => cardHTML(c, { officer })).join('') : `<div class="card empty"><b>Nothing here yet</b>Your reported complaints will show up here.</div>`}
  `;
}

function honoursHTML() {
  const u = me();
  let users = [...S.data.users];
  if (S.honourScope === 'ward') users = users.filter((x) => x.homeWard === u.homeWard);
  users.sort((a, b) => b.points - a.points);
  const [a, b, c] = users;
  const pod = (x, cls, medal) => (x ? `<div class="pod ${cls}"><div class="medal">${medal}</div><b>${esc(first(x.name))}${x.name === u.name ? ' (you)' : ''}</b><small>${x.points} pts</small>${cls === 'first' ? `<div class="honour">${S.honourScope === 'city' ? 'HIGHEST CIVIC<br>HONOUR' : 'WARD<br>CHAMPION'}</div>` : ''}</div>` : '<div></div>');
  const earned = S.data.catalog.badges.filter((bd) => u.badges.includes(bd.name)).length;
  const wn = ward(u.homeWard)?.name;
  return `
    <div class="large-title">Honours</div>
    <div class="seg"><button class="${S.honourScope === 'city' ? 'on' : ''}" data-act="hscope" data-v="city">Ahmedabad</button><button class="${S.honourScope === 'ward' ? 'on' : ''}" data-act="hscope" data-v="ward">My ward · ${esc(wn)}</button></div>
    <div class="podium">${pod(b, 'second', '🥈')}${pod(a, 'first', '🏆')}${pod(c, 'third', '🥉')}</div>
    <div class="card rank-list">${users.map((x, i) => `<div class="rank ${x.name === u.name ? 'me' : ''}"><span class="n">${i + 1}</span><span class="grow"><b>${esc(x.name)}${x.name === u.name ? ' (you)' : ''}</b><small>${esc(titleText(x.title))}</small></span><span class="p">${x.points}</span></div>`).join('')}</div>
    <div class="section-h"><h2>Your badges · ${earned}/${S.data.catalog.badges.length}</h2></div>
    <div class="badges">${S.data.catalog.badges.map((bd) => {
      const on = u.badges.includes(bd.name);
      const prog = bd.stat ? `${Math.min(u.stats?.[bd.stat] || 0, bd.goal)}/${bd.goal}` : 'Top of ward';
      return `<div class="badge ${on ? '' : 'off'}"><span class="e">${bd.icon}</span><b>${esc(bd.name)}</b><small>${on ? 'Earned' : esc(prog)}</small></div>`;
    }).join('')}</div>
    <p class="foot-note">Points: report +10 · “I see this too” +2 · verify a fix +5 · your complaint fixed +15.</p>
  `;
}

function meHTML() {
  const u = me();
  const rank = [...S.data.users].sort((a, b) => b.points - a.points).findIndex((x) => x.name === u.name);
  const mine = S.data.complaints.filter((c) => c.user === u.name);
  const ai = S.data.agent.gemini;
  return `
    <div class="card profile">
      <div class="medal">${['🏆', '🥈', '🥉'][rank] || '🏅'}</div>
      <h3>${esc(u.name)}</h3>
      <p>${esc(titleText(u.title))} · ${u.points} points</p>
      <div class="stats">
        <div><small>FILED</small><b>${mine.length}</b></div>
        <div><small>FIXED</small><b>${mine.filter(isDone).length}</b></div>
        <div><small>VERIFIED</small><b>${u.stats?.verifications || 0}</b></div>
      </div>
    </div>
    <div class="section-h"><h2>Demo controls</h2><span class="mode-pill ${ai ? 'ai' : ''}">${ai ? `AI: ${esc(S.data.agent.model)}` : 'AI: offline mock'}</span></div>
    <div class="card list">
      <div class="list-row"><span class="ic" style="background:#3b82f6">${icon('me')}</span><span class="grow"><b>Signed in as</b><small>Switch citizen for the demo</small></span>
        <select data-change="user">${S.data.users.map((x) => `<option ${x.name === u.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <button class="list-row" data-act="toggleRole"><span class="ic" style="background:#f59e0b">${icon('shield')}</span><span class="grow"><b>Officer mode</b><small>AMC staff view: advance status, upload after photos</small></span><span class="switch ${S.role === 'officer' ? 'on' : ''}"></span></button>
      <button class="list-row" data-act="openMap"><span class="ic" style="background:#10b981">${icon('map')}</span><span class="grow"><b>AR ward map</b><small>All complaints on a table${S.arSupported ? ' in AR' : ' (3D view)'}</small></span><span class="chev">${icon('chev')}</span></button>
      <div class="list-row"><span class="ic" style="background:#8b5cf6">${icon('location')}</span><span class="grow"><b>Report location</b><small>${S.loc ? `GPS ±${Math.round(S.loc.accuracy)} m` : 'No GPS'}${S.area ? ` · using ${esc(S.area)}` : ''}</small></span>
        <select data-change="area"><option value="">Auto (GPS)</option>${S.data.wards.map((w) => `<option ${S.area === w.name ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
      <button class="list-row" data-act="reset"><span class="ic" style="background:#ef4444">${icon('reset')}</span><span class="grow"><b>Reset demo data</b><small>Restore the seed complaints and points</small></span><span class="chev">${icon('chev')}</span></button>
    </div>
    <p class="foot-note">Mock AMC system for the Build·Hack·Garba hackathon. Not connected to any real portal.</p>
  `;
}

// ---------- sheets ----------
function openSheet(type, opts = {}) {
  S.sheet = { type, ...opts };
  $('sheetBackdrop').classList.remove('hidden');
  const sh = $('sheet');
  sh.classList.remove('hidden');
  sh.style.animation = 'none';
  void sh.offsetWidth;
  sh.style.animation = '';
  renderSheet();
  sh.scrollTop = 0;
}
function closeSheet() {
  S.sheet = null;
  $('sheet').classList.add('hidden');
  $('sheetBackdrop').classList.add('hidden');
  scene.focus(null);
}
function sheetHead(title, { dashes = 0, right = '' } = {}) {
  return `<div class="sheet-h"><h2>${title}</h2>${dashes ? `<div class="progress-dashes">${[1, 2, 3].map((i) => `<i class="${i <= dashes ? 'on' : ''}"></i>`).join('')}</div>` : ''}${right}<button class="x-btn" data-act="close" aria-label="Close">${icon('x')}</button></div>`;
}
function renderSheet() {
  if (!S.sheet) return;
  const fn = { report: reportHTML, ticket: ticketHTML, ask: askHTML, choose: chooseHTML, confirm: confirmHTML }[S.sheet.type];
  $('sheet').innerHTML = `<div class="grab"></div>${fn()}`;
  if (S.sheet.type === 'ask') renderChat();
}

// ----- report flow -----
function startReport() {
  R = { step: 'snap', photo: null, calls: [], draft: null, form: null, filed: null, filing: false };
  openSheet('report');
}

function locationInfo() {
  if (!S.loc) return { ok: false, title: 'Location unavailable', sub: 'Pick your area below' };
  const near = nearestWard(S.loc.lat, S.loc.lng);
  if (near.km > 15) return { ok: false, title: 'Location not in Ahmedabad', sub: 'Pick your area below' };
  return { ok: true, title: `Using your GPS · ±${Math.round(S.loc.accuracy)} m`, sub: `${near.inside ? 'In' : 'Near'} ${near.ward.name} (Ward ${near.ward.number})` };
}

function reportHTML() {
  if (R.step === 'snap') {
    const li = locationInfo();
    return `${sheetHead('Report an issue', { dashes: 1 })}
      <button class="photo-drop pressable" data-act="rPhoto" data-src="camera"><div class="cam">${icon('camera')}</div><b>Take a photo of the problem</b><small>Pothole, garbage, broken streetlight or water logging</small></button>
      <div class="btn-row"><button class="btn white" data-act="rPhoto" data-src="gallery">${icon('image')} Gallery</button><button class="btn white" data-act="rPhoto" data-src="sample">✨ Sample photo</button></div>
      <div class="card loc-card"><span class="dot ${li.ok && !S.area ? 'ok' : ''}"></span><div><b>${esc(S.area ? `Area: ${S.area}` : li.title)}</b><small>${esc(S.area ? 'Chosen by you — the agent will use this' : li.sub)}</small></div></div>
      <div class="label-sm">Area</div>
      <div class="chips">${li.ok ? `<button class="chip ${!S.area ? 'on' : ''}" data-act="area" data-v="">📡 Auto (GPS)</button>` : ''}${S.data.wards.map((w) => `<button class="chip ${S.area === w.name ? 'on' : ''}" data-act="area" data-v="${esc(w.name)}">${esc(w.name)}</button>`).join('')}</div>
      <input class="field" style="margin-top:10px" data-change="areaText" placeholder="Or type an area, e.g. CG Road" value="${S.data.wards.some((w) => w.name === S.area) ? '' : esc(S.area)}" />`;
  }
  if (R.step === 'working') {
    return `${sheetHead('Agent is working…', { dashes: 2 })}
      <div class="photo scan"><img src="${R.photo.dataUrl}" alt="Your photo" /><span class="cap">Your photo</span></div>
      ${toolsHTML(R.calls, 'AGENT · TOOL CALLS', '<span class="spin"></span>')}`;
  }
  if (R.step === 'check') {
    const d = R.draft, f = R.form;
    const [ic, label] = ISSUE[f.issueType];
    const dept = deptFor(f.issueType);
    const w = d.ward;
    const dup = d.duplicate;
    return `${sheetHead('Check & file', { dashes: 2 })}
      ${toolsHTML(R.calls, 'AGENT · TOOL CALLS', d.mock ? 'offline' : '')}
      ${!d.isCivic ? `<div class="warn">🤔 <span>The agent doesn't think this photo shows a civic issue. If it does, pick the type below and file it.</span></div>` : ''}
      ${dup ? `<div class="warn">👥 <span><b>Already reported ${dup.distanceM} m away:</b> ${esc(dup.existingTicketId)} (${esc(dup.existingStatus)}) by ${esc(dup.reportedBy)}. Add your +1 instead of filing again.</span></div>` : ''}
      <div class="card form-card">
        <div class="eyebrow">Pick the issue type</div>
        <div class="big-type">${ic} ${esc(label)}</div>
        <div class="chips">${TYPE_ORDER.map((t) => `<button class="chip ${f.issueType === t ? 'on' : ''}" data-act="rType" data-v="${t}">${ISSUE[t][0]} ${ISSUE[t][1]}</button>`).join('')}</div>
        <div class="label-sm" style="margin-left:0">How serious?</div>
        <div class="seg" style="margin:0">${['low', 'medium', 'high'].map((s) => `<button class="${f.severity === s ? 'on' : ''}" data-act="rSev" data-v="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
        <dl class="kv">
          <dt>Ward</dt><dd>${w ? `Ward ${w.number} · ${esc(w.name)}` : '—'}${d.wardMethod === 'home-ward' ? ' <span class="muted">(home ward)</span>' : ''}</dd>
          <dt>Department</dt><dd>${esc(dept?.name)}</dd>
          <dt>Resolution</dt><dd>~${dept?.slaDays} days</dd>
        </dl>
      </div>
      <div class="label-sm">Note (optional)</div>
      <input class="field" data-change="rNote" placeholder="e.g. Near the bus stop, very deep" value="${esc(f.note)}" />
      <div style="margin-top:16px">
        ${dup ? `<button class="btn primary" data-act="plusOne" data-id="${esc(dup.existingTicketId)}">👍 +1 ${esc(dup.existingTicketId)} instead</button><button class="btn ghost" data-act="rFile" data-force="1">File as a new complaint anyway</button>`
    : `<button class="btn primary" data-act="rFile" ${R.filing ? 'disabled' : ''}>${R.filing ? '<span class="spin"></span> Filing…' : 'File complaint'}</button>`}
      </div>`;
  }
  // filed
  const t = ticket(R.filed.ticketId) || R.filed.ticket;
  const w = ward(t.ward);
  const dept = deptFor(t.issueType);
  return `<div class="sheet-h"><h2></h2><button class="x-btn" data-act="close" aria-label="Close">${icon('x')}</button></div>
    <div class="center">
      <div class="done-ring">${icon('check')}</div>
      <h2 style="margin:0;font-size:24px;letter-spacing:-0.03em">Complaint filed</h2>
      <div class="tid mono">${esc(t.id)} <button data-act="copy" data-v="${esc(t.id)}">Copy</button></div>
      <div class="muted" style="font-size:13.5px">${esc(ISSUE[t.issueType][1])} · Ward ${w?.number} · ${esc(t.wardName)}<br>${esc(dept?.name)} will acknowledge it soon.</div>
      <div class="plus-pts">+10 civic points</div>
    </div>
    ${stepper(t.status, true)}
    ${toolsHTML(R.calls)}
    <div style="margin-top:14px">
      <button class="btn primary" data-act="pinIt" data-id="${esc(t.id)}">${icon('pin')} ${S.arSupported ? 'Pin it on the spot in AR' : 'See it on the 3D ward map'}</button>
      <button class="btn ghost" data-act="close">Done</button>
    </div>`;
}

async function pickPhoto(src) {
  if (src === 'sample') return samplePhoto('pothole');
  const input = src === 'gallery' ? $('galleryInput') : $('cameraInput');
  return new Promise((resolve) => {
    input.value = '';
    const done = async (file) => {
      input.onchange = input.oncancel = null;
      if (!file) return resolve(null);
      try { resolve({ ...(await downscale(file)), name: file.name }); } catch (e) { toast(`Could not read photo: ${e.message}`, 'red'); resolve(null); }
    };
    input.onchange = () => done(input.files?.[0]);
    input.oncancel = () => done(null);
    input.click();
  });
}

async function downscale(src, max = 1024) {
  let img;
  if (typeof src === 'string') {
    img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('image load failed')); i.src = src; });
  } else img = await createImageBitmap(src);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k) || 800;
  c.height = Math.round(img.height * k) || 600;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.82);
  const t = document.createElement('canvas');
  const tk = 200 / Math.max(c.width, c.height);
  t.width = c.width * tk; t.height = c.height * tk;
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return { dataUrl, thumb: t.toDataURL('image/jpeg', 0.7) };
}
const samplePhoto = async (kind) => ({ ...(await downscale(url(`/media/seed/${kind}.svg`), 900)), name: `sample-${kind}.jpg` });

async function runDraft(photo) {
  R.photo = photo;
  R.step = 'working';
  R.calls = [];
  renderSheet();
  try {
    const out = await streamPost('/api/agent', {
      draft: true, image: photo.dataUrl, photoName: photo.name, user: S.user, role: 'citizen',
      location: S.loc, areaName: S.area || undefined,
    }, (ev) => {
      if (ev.type === 'tool_call' || ev.type === 'tool_result') { upsertCall(R.calls, ev); patchTools($('sheet'), R.calls); }
      if (ev.type === 'status') toast(ev.text);
    });
    if (!R || S.sheet?.type !== 'report') return;
    R.draft = out.draft;
    R.calls = out.toolCalls;
    R.form = { issueType: out.draft.issueType, severity: out.draft.severity, note: '' };
    R.step = 'check';
    renderSheet();
  } catch (e) {
    toast(`Agent error: ${e.message}`, 'red', 4000);
    R.step = 'snap';
    renderSheet();
  }
}

async function fileComplaint(force = false) {
  if (R.filing) return;
  R.filing = true;
  renderSheet();
  const d = R.draft, f = R.form;
  try {
    const out = await streamPost('/api/report/file', {
      user: S.user, issueType: f.issueType, severity: f.severity,
      description: f.issueType === d.issueType ? d.description : '', note: f.note,
      wardId: d.ward?.id, photoUrl: d.photoUrl, location: S.loc, areaName: S.area || undefined, force,
    }, (ev) => {
      if (ev.type === 'tool_call' || ev.type === 'tool_result') {
        upsertCall(R.calls, { ...ev, id: `f${ev.id}` });
        patchTools($('sheet'), R.calls);
      }
    });
    R.filing = false;
    R.calls = [...R.calls.filter((c) => !String(c.id).startsWith('f')), ...out.toolCalls.map((c) => ({ ...c, id: `f${c.id}` }))];
    if (out.duplicate) { R.draft.duplicate = out.duplicate; renderSheet(); return; }
    if (!out.created) throw new Error(out.error || 'Not created');
    R.filed = out;
    R.step = 'filed';
    await refresh();
    renderSheet();
    scene.focus(out.ticketId);
    celebrate(out.celebrations, { quiet: true });
  } catch (e) {
    R.filing = false;
    toast(e.message, 'red');
    renderSheet();
  }
}

// ----- ticket detail -----
function openTicket(id) {
  if (!ticket(id)) return toast(`No ticket ${id}`, 'red');
  scene.focus(id);
  openSheet('ticket', { id });
}

function ticketHTML() {
  const t = ticket(S.sheet.id);
  if (!t) return sheetHead('Not found');
  const [ic, label] = ISSUE[t.issueType];
  const w = ward(t.ward);
  const dept = deptFor(t.issueType);
  const owner = S.data.users.find((u) => u.name === t.user);
  const officer = S.role === 'officer';
  const hasAfter = !!t.afterPhotoUrl;
  const view = S.ba[t.id] || (hasAfter && isDone(t) ? 'after' : 'before');
  const mineT = t.user === S.user;
  const supported = (t.supporters || []).includes(S.user);
  const tl = [...t.timeline].reverse().map((e) => `<li style="--dot:${STATUS_COLORS[e.stage] || '#999'}"><b>${esc(e.stage)}</b><small>${fmtTime(e.at)} · ${esc(e.by || '')}${e.note ? ` — ${esc(e.note)}` : ''}</small></li>`).join('');
  let actions = '';
  if (officer) {
    const next = { Filed: ['Acknowledge', 'Acknowledged'], Acknowledged: ['Assign crew', 'Assigned'], Assigned: ['Start work', 'In progress'], Reopened: ['Restart work', 'In progress'] }[t.status];
    actions = `${next ? `<button class="btn navy" data-act="stage" data-id="${t.id}" data-stage="${next[1]}">${next[0]}</button>` : ''}
      ${!isDone(t) ? `<button class="btn green" style="margin-top:8px" data-act="complete" data-id="${t.id}">📸 Mark completed with after photo</button>` : ''}
      ${isDone(t) ? `<button class="btn white" data-act="stage" data-id="${t.id}" data-stage="Reopened">Reopen ticket</button>` : ''}`;
  } else {
    actions = `<div class="btn-row" style="margin-top:0">
      <button class="btn ${mineT || supported ? 'white' : 'primary'}" data-act="plusOne" data-id="${t.id}" ${mineT || supported ? 'disabled' : ''}>👍 ${mineT ? 'Your report' : supported ? 'Seen it' : 'I see this too'} · ${t.plusOnes}</button>
      <button class="btn white" data-act="askStatus" data-id="${t.id}">${icon('sparkle')} Status</button></div>
      ${scene.inAR ? `<button class="btn navy" style="margin-top:8px" data-act="pinHere" data-id="${t.id}">${icon('pin')} Pin it here in AR</button>` : ''}`;
  }
  return `<div class="sheet-h"><h2>${ic} ${esc(label)}</h2>${officer ? '<span class="mode-pill">Officer</span>' : ''}<button class="x-btn" data-act="close" aria-label="Close">${icon('x')}</button></div>
    <div class="photo">
      <img src="${esc(url(view === 'after' ? t.afterPhotoUrl : t.photoUrl))}" alt="${view} photo" />
      ${hasAfter ? `<div class="ba"><button class="${view === 'before' ? 'on' : ''}" data-act="ba" data-id="${t.id}" data-v="before">Before</button><button class="${view === 'after' ? 'on' : ''}" data-act="ba" data-id="${t.id}" data-v="after">After</button></div>` : ''}
      <span class="cap">${view === 'after' ? 'After repair' : 'Reported photo'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <b class="mono" style="font-size:16px">${esc(t.id)}</b>${pill(t.status)}
    </div>
    <div class="reporter">Reported by <b>${esc(first(t.user))}</b> · ${esc(titleText(owner?.title || ''))}</div>
    ${stepper(t.status, true)}
    ${!officer && t.status === 'Completed' ? `<div class="verify-card"><b>✅ The department says this is fixed. Is it?</b><p>You're the eyes on the ground. Confirm to close it.</p>
      <div class="btn-row"><button class="btn green sm" data-act="verify" data-id="${t.id}" data-v="fixed">Yes, fixed · +5</button><button class="btn white sm" data-act="verify" data-id="${t.id}" data-v="not_fixed">Not fixed</button></div></div>` : ''}
    ${t.verification ? `<div class="verify-card" style="${t.verification.fixed ? '' : 'background:#fdecec;border-color:#f6caca'}"><b>${t.verification.fixed ? '✓ Verified fixed' : '↺ Reopened'}</b><p style="${t.verification.fixed ? '' : 'color:#8a2b2b'}">${esc(t.verification.explanation)} — ${esc(t.verification.by)}</p></div>` : ''}
    <div class="grid2">
      <div class="cell"><small>Ward</small><b>Ward ${w?.number} · ${esc(w?.name)}</b></div>
      <div class="cell"><small>Department</small><b>${esc(dept?.name)}</b></div>
      <div class="cell"><small>Crew</small><b>${esc(t.crew || 'Not assigned yet')}</b></div>
      <div class="cell"><small>Expected by</small><b>${fmtDay(t.expectedBy)}</b></div>
      <div class="cell"><small>Severity</small><b>${esc(t.severity)}</b></div>
      <div class="cell"><small>Others affected</small><b>👥 ${t.plusOnes}</b></div>
    </div>
    <div style="margin-top:14px">${actions}</div>
    <div class="label-sm">Timeline</div>
    <ul class="timeline">${tl}</ul>`;
}

// ----- officer: choose after photo -----
function chooseHTML() {
  return `${sheetHead('Upload the “after” photo')}
    <p class="muted" style="margin:-6px 0 14px;font-size:14px">The agent compares it with the original photo before closing <b class="mono">${esc(S.sheet.id)}</b>.</p>
    <button class="btn navy" data-act="afterPhoto" data-src="camera">${icon('camera')} Take photo</button>
    <div class="btn-row"><button class="btn white" data-act="afterPhoto" data-src="gallery">${icon('image')} Gallery</button><button class="btn white" data-act="afterPhoto" data-src="sample">✨ Sample “fixed road”</button></div>`;
}

function confirmHTML() {
  return `${sheetHead('Reset demo?')}
    <p class="muted" style="margin:-6px 0 16px">Restores the seed complaints, users and points.</p>
    <button class="btn primary" data-act="doReset">Reset now</button>
    <button class="btn ghost" data-act="close">Cancel</button>`;
}

// ----- ask chat -----
function askHTML() {
  const sug = S.role === 'officer'
    ? ['List open complaints', 'Show complaints in Navrangpura', 'Who has the highest civic honour?']
    : ["What's the status?", 'Complaints in Navrangpura', 'Who has the highest civic honour?', 'My badges'];
  const ai = S.data.agent.gemini;
  return `${sheetHead(`<span style="color:var(--orange)">${icon('sparkle')}</span> Ask Nagar Lens`, { right: `<span class="mode-pill ${ai ? 'ai' : ''}">${ai ? 'Gemini' : 'offline'}</span>` })}
    <div class="chat" id="chatLog"></div>
    <div class="suggest">${sug.map((s) => `<button data-act="suggest" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <form class="composer" data-form="ask">
      <button type="button" class="round" data-act="mic" aria-label="Speak">${icon('mic')}</button>
      <input id="askInput" placeholder="Ask anything about complaints" autocomplete="off" enterkeyhint="send" />
      <button type="submit" class="round send" aria-label="Send">${icon('send')}</button>
    </form>`;
}

function linkify(text) {
  return esc(text).replace(/AMC-W\d+-\d{4}/g, (id) => `<a data-act="ticket" data-id="${id}">${id}</a>`);
}
function bubbleHTML(m) {
  if (m.role === 'me') return `<div class="bubble me">${esc(m.text)}${m.thumb ? `<img src="${m.thumb}" alt="" />` : ''}</div>`;
  const chips = (m.tools || []).map((c) => `<span class="tchip ${c.result ? '' : 'pending'}">${c.result ? '🔧' : '<span class="spin"></span>'} <span class="mono">${esc(c.name)}()</span></span>`).join('');
  const body = m.text ? linkify(m.text) : '<span class="typing"><i></i><i></i><i></i></span>';
  return `<div class="bubble bot">${body}${chips ? `<div class="tchips">${chips}</div>` : ''}</div>`;
}
function renderChat() {
  const log = $('chatLog');
  if (!log) return;
  if (!S.chat.length) {
    S.chat.push({ role: 'bot', text: `Namaste ${first(S.user)}! Ask me about any complaint — status, your area, badges or the leaderboard.` });
  }
  log.innerHTML = S.chat.map(bubbleHTML).join('');
  const sh = $('sheet');
  sh.scrollTop = sh.scrollHeight;
}
function updateLastBubble() {
  const log = $('chatLog');
  if (!log) return;
  const lastEl = log.lastElementChild;
  const html = bubbleHTML(S.chat[S.chat.length - 1]);
  if (lastEl) { lastEl.insertAdjacentHTML('afterend', html); lastEl.remove(); log.lastElementChild.style.animation = 'none'; }
  $('sheet').scrollTop = $('sheet').scrollHeight;
}

async function askAgent(text, { role = S.role, image, photoName, thumb, ticketId } = {}) {
  if (S.busy) return toast('The agent is still working…');
  if (S.sheet?.type !== 'ask') openSheet('ask');
  S.busy = true;
  S.chat.push({ role: 'me', text, thumb });
  const bot = { role: 'bot', text: '', tools: [] };
  S.chat.push(bot);
  renderChat();
  let out = null;
  try {
    out = await streamPost('/api/agent', {
      message: text, image, photoName, ticketId, role, user: S.user,
      location: S.loc, areaName: S.area || undefined, history: S.history.slice(-6),
    }, (ev) => {
      if (ev.type === 'tool_call' || ev.type === 'tool_result') { upsertCall(bot.tools, ev); updateLastBubble(); }
    });
    bot.text = out.reply;
    bot.tools = out.toolCalls;
    S.history.push({ role: 'user', text }, { role: 'model', text: out.reply });
  } catch (e) {
    bot.text = `⚠ ${e.message}. Is the server running?`;
  } finally {
    S.busy = false;
  }
  updateLastBubble();
  if (out) {
    await refresh();
    if (out.ticketId) scene.focus(out.ticketId);
    celebrate(out.celebrations);
  }
}

// Direct one-tool actions from buttons.
async function runTool(name, args, extra = {}) {
  try {
    const out = await api(`/api/tools/${name}`, { args, user: S.user, role: S.role, ...extra });
    const r = out.toolCall.result;
    if (r?.error) toast(r.error, 'red', 3500);
    else toast(`${TOOL_META[name]?.[0] || '🔧'} ${out.toolCall.summary}`);
    await refresh();
    celebrate(out.celebrations);
    return r;
  } catch (e) {
    toast(e.message, 'red');
    return null;
  }
}

// ---------- celebrations ----------
function celebrate(items, { quiet = false } = {}) {
  if (!items?.length) return;
  const pts = items.filter((i) => i.kind === 'points');
  const total = pts.reduce((a, b) => a + b.delta, 0);
  const badges = items.filter((i) => i.kind === 'badge');
  const title = items.find((i) => i.kind === 'title' && i.upgrade);
  const completed = pts.some((p) => p.action === 'complaint_completed');
  const verified = pts.some((p) => p.action === 'verify_fix');
  const screens = badges.map((b, i) => ({ icon: b.icon, eyebrow: 'BADGE UNLOCKED', title: b.badge, desc: b.desc, gain: i === 0 && total ? `+${total} points` : null }));
  if (!badges.length && (completed || verified) && total) {
    screens.push({ icon: completed ? '🎉' : '🔎', eyebrow: completed ? 'COMPLAINT FIXED' : 'FIX VERIFIED', title: completed ? 'It’s fixed!' : 'Thanks for checking', desc: pts.map((p) => p.reason).join(' · '), gain: `+${total} points` });
  }
  if (title) screens.push({ icon: TITLE_EMOJI[title.to] || '🏅', eyebrow: 'NEW TITLE', title: title.to.replace('🏆 ', ''), desc: `${title.from.replace('🏆 ', '')} → ${title.to.replace('🏆 ', '')}` });
  pulseChip();
  if (screens.length) {
    if (scene.inAR) arCelebrate(screens);
    else showModal(screens);
  } else if (total && !quiet) {
    toast(`${total > 0 ? '+' : ''}${total} points · ${pts[0].reason}`, total > 0 ? 'green' : 'red');
  }
}

async function arCelebrate(screens) {
  for (const s of screens) {
    scene.popBadge({ icon: s.icon, title: s.title, points: s.gain ? parseInt(s.gain.replace('+', ''), 10) : null });
    toast(`${s.eyebrow === 'NEW TITLE' ? '🎉 New title' : '🏅 ' + s.eyebrow.toLowerCase()}: ${s.title}`, 'gold', 3200);
    await sleep(3000);
  }
}

let modalQueue = [];
function showModal(screens) {
  modalQueue = screens;
  renderModal();
}
function renderModal() {
  const m = $('modal');
  const s = modalQueue.shift();
  if (!s) { m.classList.add('hidden'); m.innerHTML = ''; return; }
  const colors = ['#f07f1d', '#ffcb45', '#22c55e', '#3b82f6', '#ef4444', '#ffffff'];
  const confetti = Array.from({ length: 44 }, () => {
    const dur = 2.2 + Math.random() * 2;
    return `<i style="left:${Math.random() * 100}%;background:${colors[(Math.random() * colors.length) | 0]};animation-duration:${dur}s;animation-delay:${Math.random() * 0.6}s;--dx:${(Math.random() - 0.5) * 200}px;--rot:${(Math.random() - 0.5) * 1080}deg"></i>`;
  }).join('');
  m.innerHTML = `<div class="confetti">${confetti}</div>
    <div class="inner">
      <div class="coin"><div class="face">${s.icon}</div></div>
      <div class="eyebrow">${esc(s.eyebrow)}</div>
      <h2>${esc(s.title)}</h2>
      <p>${esc(s.desc || '')}</p>
      ${s.gain ? `<div class="gain">${esc(s.gain)}</div>` : ''}
      <button class="btn primary" data-act="modalNext">${modalQueue.length ? 'Next' : 'Awesome'}</button>
    </div>`;
  m.classList.remove('hidden');
}

// ---------- AR view ----------
function showArView() {
  $('arView').classList.remove('hidden');
  scene.paused = false;
  renderArHud();
}
function hideArView() {
  $('arView').classList.add('hidden');
  scene.paused = true;
  $('arHint').classList.add('hidden');
}
async function startImmersive(after) {
  showArView();
  document.body.classList.add('in-ar');
  try {
    const { domOverlay } = await scene.startAR($('overlay'));
    if (!domOverlay) toast('DOM overlay unavailable — controls may be hidden', 'red', 4000);
    renderArHud();
    after?.();
  } catch (e) {
    document.body.classList.remove('in-ar');
    toast(`Could not start AR: ${e.message}`, 'red', 4000);
    renderArHud();
  }
}
function openAR({ place, key } = {}) {
  closeSheet();
  if (S.arSupported) {
    startImmersive(() => {
      if (place === 'pin') scene.beginPlacement('pin', { key });
      else if (place === 'map') scene.beginPlacement('map');
      else toast('Nearby complaints are shown as pins. Tap one for details.', '', 3500);
    });
  } else {
    showArView();
    if (key) scene.focus(key);
  }
}
function renderArHud() {
  if (!S.data) return;
  const cs = S.data.complaints;
  const open = cs.filter((c) => !isDone(c)).length;
  $('arSummary').innerHTML = `Ahmedabad · ${cs.length} complaints <span>(${open} open)</span>`;
  $('legend').innerHTML = Object.entries(STATUS_COLORS).filter(([k]) => k !== 'Pending').map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('');
  if (scene.inAR) {
    $('arNote').textContent = '';
    $('arActions').innerHTML = `<button class="btn primary" data-act="report">${icon('camera')} Report</button>
      <button class="btn white" data-act="${scene.mapPlacedInAR ? 'arPins' : 'arMap'}">${icon(scene.mapPlacedInAR ? 'pin' : 'map')} ${scene.mapPlacedInAR ? 'Show pins' : 'Ward map'}</button>`;
  } else {
    $('arNote').textContent = S.arSupported ? 'Drag to rotate · pinch to zoom · tap a pin' : 'WebXR AR needs Chrome on an ARCore Android phone over HTTPS. Drag to rotate.';
    $('arActions').innerHTML = S.arSupported ? `<button class="btn primary" data-act="startAR">${icon('ar')} Start AR</button>` : '';
  }
}

// ---------- misc ----------
function nearestWard(lat, lng) {
  let best = null, bd = Infinity;
  for (const w of S.data.wards) {
    const inside = lat >= w.bbox.minLat && lat <= w.bbox.maxLat && lng >= w.bbox.minLng && lng <= w.bbox.maxLng;
    if (inside) return { ward: w, inside: true, km: 0 };
    const km = Math.hypot((w.center.lat - lat) * 111, (w.center.lng - lng) * 102);
    if (km < bd) { bd = km; best = w; }
  }
  return { ward: best, inside: false, km: bd };
}
function toast(text, kind = '', ms = 2600) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
function pulseChip() {
  $('meChip').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 450, iterations: 2, easing: 'ease-out' });
}
function setRole(role) {
  S.role = role;
  safeSet('nl.role', role);
  scene.setMode(role);
  S.history = [];
  renderChrome();
  renderTab(true);
  if (S.sheet?.type === 'ticket') renderSheet();
  toast(role === 'officer' ? '🛠️ Officer mode on' : '🙋 Citizen mode');
}
function setUser(name) {
  S.user = name;
  safeSet('nl.user', name);
  S.chat = [];
  S.history = [];
  renderChrome();
  renderTab();
  toast(`Signed in as ${name}`);
}

let rec = null;
function toggleMic(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice input is not supported in this browser');
  if (rec) return rec.stop();
  rec = new SR();
  rec.lang = 'en-IN';
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e) => {
    let s = '';
    for (const r of e.results) { s += r[0].transcript; if (r.isFinal) finalText = s; }
    const inp = $('askInput');
    if (inp) inp.value = s;
  };
  rec.onerror = (e) => toast(`Mic: ${e.error}`, 'red');
  rec.onend = () => {
    btn?.classList.remove('live');
    rec = null;
    const inp = $('askInput');
    const text = (finalText || inp?.value || '').trim();
    if (text) { if (inp) inp.value = ''; askAgent(text); }
  };
  btn?.classList.add('live');
  rec.start();
}

// ---------- actions (event delegation) ----------
const ACT = {
  tab: (d) => setTab(d.tab),
  report: () => startReport(),
  ask: () => { openSheet('ask'); setTimeout(() => $('askInput')?.focus(), 350); },
  openAR: () => openAR(),
  openMap: () => openAR({ place: 'map' }),
  startAR: () => openAR(),
  arMap: () => scene.beginPlacement('map'),
  arPins: () => { scene.showPins(); renderArHud(); },
  close: () => closeSheet(),
  scope: (d) => { S.trackScope = d.v; renderTab(true); },
  hscope: (d) => { S.honourScope = d.v; renderTab(true); },
  ticket: (d) => openTicket(d.id),
  toggleRole: () => setRole(S.role === 'officer' ? 'citizen' : 'officer'),
  reset: () => openSheet('confirm'),
  doReset: async () => {
    await api('/api/demo/reset', {});
    S.chat = []; S.history = []; S.ba = {};
    closeSheet();
    await refresh();
    toast('Demo data restored', 'green');
    if (location.pathname === '/demo') history.replaceState(null, '', '/');
  },
  // report
  rPhoto: async (d) => { const p = await pickPhoto(d.src); if (p) runDraft(p); },
  area: (d) => { S.area = d.v; safeSet('nl.area', S.area); renderSheet(); },
  rType: (d) => { R.form.issueType = d.v; renderSheet(); },
  rSev: (d) => { R.form.severity = d.v; renderSheet(); },
  rFile: (d) => fileComplaint(!!d.force),
  copy: (d) => { navigator.clipboard?.writeText(d.v).then(() => toast('Ticket ID copied'), () => toast(d.v)); },
  pinIt: (d) => openAR({ place: 'pin', key: d.id }),
  pinHere: (d) => { closeSheet(); scene.beginPlacement('pin', { key: d.id }); },
  // ticket
  ba: (d) => { S.ba[d.id] = d.v; renderSheet(); },
  plusOne: async (d) => { await runTool('plus_one', { ticketId: d.id }); if (S.sheet?.type === 'report') closeSheet(); },
  askStatus: (d) => askAgent(`What's the status of ${d.id}?`, { ticketId: d.id }),
  verify: (d) => runTool('verify_completion', { ticketId: d.id, citizenVerdict: d.v }),
  stage: (d) => runTool('update_status', { ticketId: d.id, stage: d.stage }),
  complete: (d) => openSheet('choose', { id: d.id }),
  afterPhoto: async (d) => {
    const id = S.sheet.id;
    const p = d.src === 'sample' ? await samplePhoto('pothole-fixed') : await pickPhoto(d.src);
    if (!p) return;
    askAgent(`Mark ${id} as Completed using the attached after photo, then verify the fix.`, { role: 'officer', ticketId: id, image: p.dataUrl, photoName: p.name, thumb: p.thumb });
  },
  // chat
  suggest: (d) => askAgent(d.v),
  mic: (_d, el) => toggleMic(el),
  modalNext: () => renderModal(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') e.preventDefault();
  ACT[el.dataset.act]?.(el.dataset, el, e);
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset?.change;
  if (k === 'user') setUser(e.target.value);
  if (k === 'area') { S.area = e.target.value; safeSet('nl.area', S.area); renderTab(true); }
  if (k === 'areaText') { S.area = e.target.value.trim(); safeSet('nl.area', S.area); renderSheet(); }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset?.change === 'rNote' && R?.form) R.form.note = e.target.value;
});
document.addEventListener('submit', (e) => {
  const f = e.target.dataset?.form;
  if (!f) return;
  e.preventDefault();
  if (f === 'ask') {
    const inp = $('askInput');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    askAgent(text);
  }
  if (f === 'track') {
    const q = e.target.q.value.trim().toUpperCase();
    const t = S.data.complaints.find((c) => c.id === q || c.id.endsWith(`-${q.padStart(4, '0')}`) || c.id.endsWith(q));
    t ? openTicket(t.id) : toast(`No ticket “${q}”`, 'red');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.getAttribute?.('role') === 'button') e.target.click();
  if (e.key === 'Escape') closeSheet();
});
$('sheetBackdrop').onclick = closeSheet;
$('meChip').onclick = () => setTab('me');
$('fab').onclick = () => startReport();
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => setTab(t.dataset.tab)));
$('arClose').onclick = () => (scene.inAR ? scene.endAR() : hideArView());

// Taps on DOM UI must not also count as AR "select" taps.
['#arView .ar-top', '#arView .ar-bottom', '#sheet', '#sheetBackdrop', '#modal', '#toasts'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('beforexrselect', (e) => e.preventDefault());
});

if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    (p) => {
      S.loc = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      scene.setUserLocation(S.loc);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  );
}

window.nagarLens = { scene, state: S, refresh, celebrate }; // handy for debugging from the console

(async function init() {
  buildTabbar();
  scene.setMode(S.role);
  S.arSupported = await SceneManager.arSupported();
  try {
    await refresh();
  } catch (e) {
    $('screen').innerHTML = `<div class="card empty" style="margin-top:20px"><b>Can't reach the server</b>${esc(e.message)}. Run <span class="mono">npm run dev</span>.</div>`;
    return;
  }
  renderTab();
  if (location.pathname === '/demo') openSheet('confirm');
})();
