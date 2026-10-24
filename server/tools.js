// Agent tools for the mock AMC system. Each tool takes (args, ctx) and returns plain JSON.
// ctx = { db, user, role, photos: { photo_1: {url,mime,base64} }, location, areaName, message, photoHint }
import { save, readImageForModel } from './store.js';
import { hasGemini, visionJSON } from './gemini.js';

export const STAGES = ['Filed', 'Acknowledged', 'Assigned', 'In progress', 'Completed', 'Verified', 'Reopened'];
export const ISSUE_TYPES = ['pothole', 'garbage', 'streetlight', 'waterlogging'];
export const ISSUE_LABEL = {
  pothole: 'Pothole', garbage: 'Garbage', streetlight: 'Broken streetlight', waterlogging: 'Waterlogging', unknown: 'Not a civic issue',
};
export const POINTS = {
  valid_complaint: 10, plus_one: 2, verify_fix: 5, complaint_completed: 15, fake_report: -10, duplicate_report: -10,
};
const REASON = {
  valid_complaint: 'Valid complaint filed',
  plus_one: '+1 on an existing complaint',
  verify_fix: 'Verified a fix',
  complaint_completed: 'Your complaint was completed',
  fake_report: 'Fake / non-civic report',
  duplicate_report: 'Duplicate report',
};
export const BADGES = [
  { name: 'Pothole Hunter', icon: '🕳️', desc: '5 road complaints completed', stat: 'potholeCompleted', goal: 5 },
  { name: 'Clean Street Champion', icon: '🧹', desc: '5 garbage complaints completed', stat: 'garbageCompleted', goal: 5 },
  { name: 'Light Keeper', icon: '💡', desc: '3 streetlight complaints completed', stat: 'streetlightCompleted', goal: 3 },
  { name: 'Flood Watch', icon: '🌊', desc: 'Reported waterlogging', stat: 'waterloggingReports', goal: 1 },
  { name: 'Truth Checker', icon: '🔎', desc: '10 fixes verified', stat: 'verifications', goal: 10 },
  { name: 'Ward Guardian', icon: '🛡️', desc: 'Top citizen in your ward this month', dynamic: true },
];
export const TITLES = ['New Citizen', 'Active Citizen', 'Civic Hero', 'Ward Champion', '🏆 Highest Civic Honour'];

// ---------- helpers ----------
const nowIso = () => new Date().toISOString();
const addDays = (iso, d) => new Date(new Date(iso).getTime() + d * 864e5).toISOString();
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const clean = (s) => String(s ?? '').trim();

export function metersBetween(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function findUser(db, name) {
  const n = clean(name).toLowerCase();
  if (!n) return null;
  return db.users.find((u) => u.name.toLowerCase() === n) || db.users.find((u) => u.name.toLowerCase().split(' ')[0] === n.split(' ')[0]) || null;
}

export function findWard(db, q) {
  const s = clean(q).toLowerCase();
  if (!s) return null;
  const m = /^(?:ward\s*|w)?\s*(\d+)$/i.exec(s);
  if (m) return db.wards.find((w) => w.number === Number(m[1])) || null;
  const names = (w) => [w.name, ...w.areas].map((x) => x.toLowerCase());
  return (
    db.wards.find((w) => names(w).includes(s)) ||
    db.wards.find((w) => names(w).some((n) => s.includes(n))) ||
    (s.length >= 3 ? db.wards.find((w) => names(w).some((n) => n.includes(s))) : null) ||
    null
  );
}

export function wardByGps(db, lat, lng) {
  const inside = db.wards.find((w) => lat >= w.bbox.minLat && lat <= w.bbox.maxLat && lng >= w.bbox.minLng && lng <= w.bbox.maxLng);
  if (inside) return { ward: inside, method: 'gps' };
  let best = null, bestD = Infinity;
  for (const w of db.wards) {
    const d = metersBetween(lat, lng, w.center.lat, w.center.lng);
    if (d < bestD) { bestD = d; best = w; }
  }
  return { ward: best, method: 'gps-nearest', distanceKm: Math.round(bestD / 100) / 10 };
}

export function findTicket(db, id) {
  const s = clean(id).toUpperCase();
  if (!s) return null;
  return db.complaints.find((c) => c.id.toUpperCase() === s) || (/^\d{3,4}$/.test(s) ? db.complaints.find((c) => c.id.endsWith('-' + s.padStart(4, '0'))) : null) || null;
}

const deptFor = (db, issueType) => db.departments.find((d) => d.issueTypes.includes(issueType));
const deptById = (db, id) => db.departments.find((d) => d.id === id);
const wardById = (db, id) => db.wards.find((w) => w.id === id);
const wardInfo = (w) => w && { id: w.id, number: w.number, name: w.name, zone: w.zone };
const deptInfo = (d) => d && { id: d.id, name: d.name, short: d.short, contact: d.contact, slaDays: d.slaDays };

function brief(db, t) {
  return {
    id: t.id, issueType: t.issueType, severity: t.severity, status: t.status,
    ward: t.wardName, department: deptById(db, t.department)?.short, reportedBy: t.user,
    plusOnes: t.plusOnes, createdAt: t.createdAt,
  };
}

function normStage(s) {
  const v = clean(s).toLowerCase().replace(/[_-]/g, ' ');
  return STAGES.find((x) => x.toLowerCase() === v) || (v === 'inprogress' ? 'In progress' : null);
}

// Recompute dynamic badges (Ward Guardian) + titles. Gains go into each user's inbox for the UI to celebrate.
export function recompute(db) {
  const changes = [];
  const sorted = [...db.users].sort((a, b) => b.points - a.points);
  const cityTop = sorted[0];
  const wardTop = {};
  for (const u of sorted) if (!wardTop[u.homeWard]) wardTop[u.homeWard] = u;

  for (const u of db.users) {
    u.stats ||= {};
    u.inbox ||= [];
    const had = new Set(u.badges || []);
    const earned = new Set([...had].filter((b) => b !== 'Ward Guardian'));
    for (const b of BADGES) if (!b.dynamic && (u.stats[b.stat] || 0) >= b.goal) earned.add(b.name);
    if (wardTop[u.homeWard] === u) earned.add('Ward Guardian');
    for (const b of earned) {
      if (!had.has(b)) {
        const def = BADGES.find((x) => x.name === b);
        const ch = { kind: 'badge', user: u.name, badge: b, icon: def?.icon || '🏅', desc: def?.desc || '' };
        changes.push(ch); u.inbox.push(ch);
      }
    }
    u.badges = [...earned];

    const title = cityTop === u ? TITLES[4] : wardTop[u.homeWard] === u ? TITLES[3] : u.points >= 500 ? TITLES[2] : u.points >= 100 ? TITLES[1] : TITLES[0];
    if (title !== u.title) {
      const ch = { kind: 'title', user: u.name, from: u.title, to: title, upgrade: TITLES.indexOf(title) > TITLES.indexOf(u.title) };
      changes.push(ch);
      if (ch.upgrade) u.inbox.push(ch);
      u.title = title;
    }
  }
  return changes;
}

export function awardPoints(db, userName, action, ticketId) {
  const u = findUser(db, userName);
  if (!u) return { error: `Unknown user "${userName}"` };
  if (!(action in POINTS)) return { error: `Unknown action "${action}". Use one of ${Object.keys(POINTS).join(', ')}` };
  u.awardLog ||= [];
  const key = `${action}:${ticketId || '-'}`;
  if (ticketId && u.awardLog.includes(key)) {
    return { user: u.name, action, delta: 0, points: u.points, title: u.title, alreadyAwarded: true };
  }
  u.awardLog.push(key);
  const delta = POINTS[action];
  u.points = Math.max(0, u.points + delta);
  const t = ticketId ? findTicket(db, ticketId) : null;
  u.stats ||= {};
  const inc = (k) => (u.stats[k] = (u.stats[k] || 0) + 1);
  if (action === 'complaint_completed' && t) inc(`${t.issueType}Completed`);
  if (action === 'valid_complaint' && t?.issueType === 'waterlogging') inc('waterloggingReports');
  if (action === 'verify_fix') inc('verifications');
  u.inbox ||= [];
  u.inbox.push({ kind: 'points', user: u.name, delta, action, ticketId: t?.id || ticketId || null, reason: REASON[action] });
  const mine = recompute(db).filter((c) => c.user === u.name);
  save();
  return {
    user: u.name, action, delta, points: u.points, title: u.title, badges: u.badges,
    newBadges: mine.filter((c) => c.kind === 'badge').map((c) => c.badge),
    titleChange: mine.find((c) => c.kind === 'title') || null,
  };
}

export function drainInbox(db, userName) {
  const u = findUser(db, userName);
  if (!u || !u.inbox?.length) return [];
  const items = u.inbox;
  u.inbox = [];
  save();
  return items;
}

// ---------- vision ----------
const ANALYZE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isCivicIssue: { type: 'BOOLEAN' },
    issueType: { type: 'STRING', enum: [...ISSUE_TYPES, 'unknown'] },
    severity: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    description: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['isCivicIssue', 'issueType', 'severity', 'description', 'confidence'],
};
const ANALYZE_PROMPT = `You are a civic-issue inspector for the Ahmedabad Municipal Corporation.
Classify the main PUBLIC civic problem in this photo into exactly one category:
- pothole: damaged/cracked/broken road surface, potholes
- garbage: litter, dumped waste, overflowing bins, debris on street
- streetlight: broken, damaged, fallen or non-working street light / pole
- waterlogging: standing water or flooding on a road, blocked/overflowing drain
If the photo does not show a public civic problem (selfie, people, indoor scene, food, screenshot, meme, a clean normal street), set isCivicIssue=false and issueType="unknown".
severity: high = hazardous to traffic/health or large; medium = clearly noticeable; low = minor.
description: one short sentence about what you see. confidence: 0 to 1.`;

const VERIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    issueStillVisible: { type: 'BOOLEAN' },
    fixed: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    explanation: { type: 'STRING' },
  },
  required: ['issueStillVisible', 'fixed', 'confidence', 'explanation'],
};

function mockAnalyze(ctx, args, note) {
  const hint = `${args.hint || ''} ${ctx.photoHint || ''} ${ctx.message || ''}`.toLowerCase();
  if (/selfie|not civic|meme|food/.test(hint)) {
    return { isCivicIssue: false, issueType: 'unknown', severity: 'low', description: 'Offline mode: marked as not a civic issue.', confidence: 0.5, mock: true, note };
  }
  const issueType = /garbage|trash|waste|kachra|litter|dump/.test(hint) ? 'garbage'
    : /light|lamp|dark|pole/.test(hint) ? 'streetlight'
    : /water|flood|drain|rain/.test(hint) ? 'waterlogging' : 'pothole';
  return {
    isCivicIssue: true, issueType, severity: 'high',
    description: `Offline mode: assumed ${ISSUE_LABEL[issueType].toLowerCase()} (no vision model).`,
    confidence: 0.5, mock: true, note,
  };
}

// Same issue type, still open, within 30 m.
function findDuplicate(db, issueType, lat, lng) {
  if (lat == null || lng == null) return null;
  return db.complaints
    .filter((c) => c.issueType === issueType && !['Completed', 'Verified'].includes(c.status))
    .map((c) => ({ c, d: metersBetween(lat, lng, c.lat, c.lng) }))
    .filter((x) => x.d <= 30)
    .sort((a, b) => a.d - b.d)[0] || null;
}

// ---------- the tools ----------
export const tools = {
  async check_duplicates(args, ctx) {
    const issueType = clean(args.issueType).toLowerCase();
    const lat = num(args.lat) ?? ctx.location?.lat ?? null;
    const lng = num(args.lng) ?? ctx.location?.lng ?? null;
    if (lat == null || lng == null) return { duplicate: false, checked: false, note: 'No GPS fix, so the 30 m duplicate check was skipped.' };
    const dup = findDuplicate(ctx.db, issueType, lat, lng);
    if (!dup) return { duplicate: false, checked: true, radiusM: 30 };
    ctx.duplicateOf = dup.c.id;
    return {
      duplicate: true, checked: true, existingTicketId: dup.c.id, distanceM: Math.round(dup.d),
      existingStatus: dup.c.status, plusOnes: dup.c.plusOnes, reportedBy: dup.c.user,
      suggestion: 'Suggest "+1 I see this too" on the existing ticket instead of filing a new one.',
    };
  },

  async analyze_image(args, ctx) {
    const photo = ctx.photos[args.image_ref] || ctx.photos.photo_1;
    if (!photo) return { error: 'No photo attached. Ask the user to take a photo of the issue.' };
    if (!hasGemini()) return { ...mockAnalyze(ctx, args), photoUrl: photo.url };
    try {
      const out = await visionJSON(ANALYZE_PROMPT, [photo], ANALYZE_SCHEMA);
      let issueType = ISSUE_TYPES.includes(out.issueType) ? out.issueType : 'unknown';
      if (!out.isCivicIssue) issueType = 'unknown';
      return {
        isCivicIssue: issueType !== 'unknown', issueType,
        severity: ['low', 'medium', 'high'].includes(out.severity) ? out.severity : 'medium',
        description: out.description, confidence: Math.round((out.confidence ?? 0.7) * 100) / 100, photoUrl: photo.url,
      };
    } catch (e) {
      console.warn('[analyze_image] Gemini failed, using offline guess:', e.message);
      return { ...mockAnalyze(ctx, args, 'Vision model unavailable; offline guess'), photoUrl: photo.url };
    }
  },

  async lookup_ward_department(args, ctx) {
    const { db } = ctx;
    const lat = num(args.lat) ?? ctx.location?.lat ?? null;
    const lng = num(args.lng) ?? ctx.location?.lng ?? null;
    let ward = null, method = null, distanceKm;
    const area = clean(args.areaName);
    if (area) { ward = findWard(db, area); method = 'area'; }
    if (!ward && lat != null && lng != null) ({ ward, method, distanceKm } = wardByGps(db, lat, lng));
    if (!ward && ctx.areaName) { ward = findWard(db, ctx.areaName); method = 'area'; }
    if (!ward && !area) {
      const u = findUser(db, ctx.user);
      ward = (u && wardById(db, u.homeWard)) || null;
      method = 'home-ward';
    }
    if (!ward) {
      return { error: `Could not find a ward for "${area}". Ask the user for their area.`, knownAreas: db.wards.map((w) => w.name) };
    }
    const issueType = clean(args.issueType).toLowerCase();
    const dept = ISSUE_TYPES.includes(issueType) ? deptFor(db, issueType) : null;
    return {
      areaName: area || (method === 'area' ? ctx.areaName : null) || ward.name,
      ward: wardInfo(ward), department: deptInfo(dept), method, distanceKm,
      note: method === 'gps-nearest' ? 'GPS is outside the mapped wards, so the nearest ward was used.'
        : method === 'home-ward' ? "No GPS or area given, so the citizen's home ward was used. Mention this to the user." : undefined,
    };
  },

  async create_ticket(args, ctx) {
    const { db } = ctx;
    const issueType = clean(args.issueType).toLowerCase();
    if (!ISSUE_TYPES.includes(issueType)) return { created: false, error: `issueType must be one of ${ISSUE_TYPES.join(', ')}` };
    const user = findUser(db, args.user) || findUser(db, ctx.user);
    if (!user) return { created: false, error: 'Unknown user' };

    let lat = num(args.lat) ?? ctx.location?.lat ?? null;
    let lng = num(args.lng) ?? ctx.location?.lng ?? null;
    const ward = findWard(db, args.wardId) || findWard(db, args.areaName) || (lat != null && lng != null ? wardByGps(db, lat, lng).ward : null) || findWard(db, ctx.areaName);
    if (!ward) return { created: false, error: 'Ward unknown. Call lookup_ward_department first.' };

    // No GPS, or GPS doesn't fall in the chosen ward (area typed by hand): place it near the ward centre.
    let approxLocation = false;
    const inWard = lat != null && lng != null && lat >= ward.bbox.minLat && lat <= ward.bbox.maxLat && lng >= ward.bbox.minLng && lng <= ward.bbox.maxLng;
    if (!inWard && (lat == null || clean(args.areaName || ctx.areaName))) {
      lat = ward.center.lat + (Math.random() - 0.5) * 0.006;
      lng = ward.center.lng + (Math.random() - 0.5) * 0.006;
      approxLocation = true;
    }

    if (!args.force) {
      const dup = findDuplicate(db, issueType, lat, lng);
      if (dup) {
        ctx.duplicateOf = dup.c.id;
        return {
          created: false, duplicate: true, existingTicketId: dup.c.id, distanceM: Math.round(dup.d),
          existingStatus: dup.c.status, plusOnes: dup.c.plusOnes, reportedBy: dup.c.user,
          suggestion: 'Do NOT file again. Ask the user to tap "+1 I see this too" on the existing ticket.',
        };
      }
    }

    const dept = deptFor(db, issueType);
    const seq = db.meta.nextSeq++;
    const id = `AMC-W${ward.number}-${String(seq).padStart(4, '0')}`;
    const photo = ctx.photos[args.photo_ref] || ctx.photos.photo_1;
    const at = nowIso();
    const t = {
      id, user: user.name, issueType,
      severity: ['low', 'medium', 'high'].includes(args.severity) ? args.severity : 'medium',
      description: clean(args.description), ward: ward.id, wardName: ward.name, department: dept.id,
      lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, approxLocation,
      photoUrl: photo?.url || null, afterPhotoUrl: null, status: 'Filed', crew: null,
      timeline: [{ stage: 'Filed', at, by: user.name, note: 'Filed via Nagar Lens AR' }],
      plusOnes: 0, supporters: [], createdAt: at, expectedBy: addDays(at, dept.slaDays), verification: null,
    };
    db.complaints.push(t);
    save();
    ctx.createdTicketId = id;
    return {
      created: true, ticketId: id, status: 'Filed', ward: wardInfo(ward), department: dept.name,
      departmentShort: dept.short, slaDays: dept.slaDays, expectedBy: t.expectedBy, lat: t.lat, lng: t.lng,
    };
  },

  async get_status(args, ctx) {
    const { db } = ctx;
    const q = clean(args.ticketId);
    let t = q && !/latest|last|my|recent/i.test(q) ? findTicket(db, q) : null;
    if (!t && !q && ctx.ticketId) t = findTicket(db, ctx.ticketId);
    if (!t) {
      const u = findUser(db, args.user) || findUser(db, ctx.user);
      t = db.complaints.filter((c) => c.user === u?.name).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    }
    if (!t) return { found: false, message: q ? `No ticket ${q}` : 'This user has no complaints yet.' };
    const dept = deptById(db, t.department);
    const done = ['Completed', 'Verified'].includes(t.status);
    ctx.ticketId = t.id;
    return {
      found: true, ticketId: t.id, status: t.status, stageNumber: STAGES.indexOf(t.status) + 1,
      issueType: t.issueType, severity: t.severity, ward: `${t.wardName} (Ward ${wardById(db, t.ward)?.number})`,
      department: dept?.name, departmentContact: dept?.contact, crew: t.crew || 'Not assigned yet',
      expectedBy: t.expectedBy, overdue: !done && new Date(t.expectedBy) < new Date(),
      verifiedFixed: t.status === 'Verified', verification: t.verification, plusOnes: t.plusOnes,
      reportedBy: t.user, photoUrl: t.photoUrl, afterPhotoUrl: t.afterPhotoUrl, timeline: t.timeline.slice(-6),
    };
  },

  async list_complaints(args, ctx) {
    const { db } = ctx;
    let list = db.complaints;
    let ward = null;
    if (clean(args.area)) {
      ward = findWard(db, args.area);
      if (!ward) return { error: `Unknown area "${args.area}"`, knownAreas: db.wards.map((w) => w.name) };
      list = list.filter((c) => c.ward === ward.id);
    }
    if (clean(args.user)) {
      const u = findUser(db, args.user);
      list = list.filter((c) => c.user === u?.name);
    }
    const isDone = (c) => ['Completed', 'Verified'].includes(c.status);
    const open = list.filter((c) => !isDone(c));
    const completed = list.filter(isDone);
    const status = clean(args.status) || 'all';
    return {
      area: ward ? `${ward.name} (Ward ${ward.number})` : 'All Ahmedabad', user: clean(args.user) || undefined,
      count: list.length, openCount: open.length, completedCount: completed.length,
      open: status === 'completed' ? [] : open.slice(0, 10).map((c) => brief(db, c)),
      completed: status === 'open' ? [] : completed.slice(0, 10).map((c) => brief(db, c)),
    };
  },

  async update_status(args, ctx) {
    const { db } = ctx;
    if (ctx.role !== 'officer') return { error: 'Only AMC officers can update status. Switch to Officer mode.' };
    const t = findTicket(db, args.ticketId);
    if (!t) return { error: `No ticket ${args.ticketId}` };
    const stage = normStage(args.stage);
    if (!stage) return { error: `Unknown stage. Use one of ${STAGES.join(', ')}` };
    if (stage === 'Verified') return { error: 'Use verify_completion to verify a fix.' };
    const dept = deptById(db, t.department);
    const photo = ctx.photos[args.after_photo_ref] || (stage === 'Completed' ? ctx.photos.photo_1 : null);
    if (photo) t.afterPhotoUrl = photo.url;
    if (['Assigned', 'In progress', 'Completed'].includes(stage) && !t.crew) {
      t.crew = dept.crews[t.id.charCodeAt(t.id.length - 1) % dept.crews.length];
    }
    t.status = stage;
    const note = clean(args.note) || (stage === 'Assigned' ? `${t.crew} assigned` : stage === 'Completed' ? (photo ? 'After photo uploaded' : 'Marked completed (no after photo)') : '');
    t.timeline.push({ stage, at: nowIso(), by: 'AMC Officer', note });
    let awarded = null;
    if (stage === 'Completed') {
      t.completedAt = nowIso();
      save();
      awarded = awardPoints(db, t.user, 'complaint_completed', t.id);
    }
    save();
    return {
      updated: true, ticketId: t.id, status: t.status, crew: t.crew, afterPhotoUrl: t.afterPhotoUrl,
      ownerAward: awarded, next: stage === 'Completed' ? 'Call verify_completion to check the after photo.' : undefined,
    };
  },

  async verify_completion(args, ctx) {
    const { db } = ctx;
    const t = findTicket(db, args.ticketId || ctx.ticketId);
    if (!t) return { error: `No ticket ${args.ticketId}` };
    if (t.status === 'Verified') return { alreadyVerified: true, ticketId: t.id, status: t.status, verification: t.verification };
    if (t.status !== 'Completed') return { error: `Ticket is "${t.status}". Only Completed tickets can be verified.` };

    // Citizen on the spot answers "Is it fixed?" directly.
    const verdict = clean(args.citizenVerdict).toLowerCase();
    if (verdict && ctx.role === 'citizen') {
      const fixed = verdict === 'fixed';
      const at = nowIso();
      const explanation = fixed ? 'Citizen confirmed the fix on the spot.' : 'Citizen reports the issue is still there.';
      t.verification = { fixed, confidence: 1, explanation, at, by: ctx.user };
      t.status = fixed ? 'Verified' : 'Reopened';
      t.timeline.push({ stage: t.status, at, by: ctx.user, note: explanation });
      save();
      const award = fixed && findUser(db, ctx.user) ? awardPoints(db, ctx.user, 'verify_fix', t.id) : null;
      return { ticketId: t.id, fixed, status: t.status, confidence: 1, explanation, byCitizen: true, verifierAward: award };
    }
    const newPhoto = ctx.photos[args.after_photo_ref] || ctx.photos.photo_1;
    if (newPhoto && !t.afterPhotoUrl) t.afterPhotoUrl = newPhoto.url;
    const after = newPhoto || readImageForModel(t.afterPhotoUrl);
    const before = readImageForModel(t.photoUrl);

    let res;
    const label = ISSUE_LABEL[t.issueType].toLowerCase();
    if (!t.afterPhotoUrl) return { error: 'No after photo to verify. Ask for an after photo.' };
    if (!hasGemini() || !after) {
      const hint = `${ctx.message || ''} ${ctx.photoHint || ''}`.toLowerCase();
      const fixed = !/not fixed|still|broken|fail/.test(hint);
      res = { issueStillVisible: !fixed, fixed, confidence: 0.6, explanation: fixed ? 'Offline mode: after photo accepted.' : 'Offline mode: marked as still visible.', mock: true };
    } else {
      const prompt = before
        ? `Image 1 is the BEFORE photo of a reported ${label} ("${t.description}"). Image 2 is the AFTER photo uploaded when the repair crew marked it completed. Is the ${label} fixed in the AFTER photo? If the problem is still visible, or the after photo is unrelated or unclear, set fixed=false. explanation: one short sentence.`
        : `A citizen reported a ${label} ("${t.description}"). This photo was uploaded as proof that it was repaired. Is the ${label} fixed / absent in this photo? If the problem is still visible or the photo is unrelated or unclear, set fixed=false. explanation: one short sentence.`;
      try {
        res = await visionJSON(prompt, before ? [before, after] : [after], VERIFY_SCHEMA);
      } catch (e) {
        console.warn('[verify_completion] Gemini failed:', e.message);
        res = { issueStillVisible: false, fixed: true, confidence: 0.5, explanation: 'Vision model unavailable; accepted provisionally.', mock: true };
      }
    }
    const fixed = !!res.fixed && !res.issueStillVisible;
    const at = nowIso();
    const by = ctx.role === 'officer' ? 'Nagar Lens AI' : ctx.user;
    t.verification = { fixed, confidence: Math.round((res.confidence ?? 0.7) * 100) / 100, explanation: res.explanation, at, by, mock: res.mock || undefined };
    if (fixed) {
      t.status = 'Verified';
      t.timeline.push({ stage: 'Verified', at, by, note: `Before/after check passed: ${res.explanation}` });
    } else {
      t.status = 'Reopened';
      t.timeline.push({ stage: 'Reopened', at, by, note: `Issue still visible: ${res.explanation}` });
    }
    save();
    let award = null;
    if (ctx.role === 'citizen' && fixed && findUser(db, ctx.user)) award = awardPoints(db, ctx.user, 'verify_fix', t.id);
    return { ticketId: t.id, fixed, status: t.status, confidence: t.verification.confidence, explanation: res.explanation, comparedWithBefore: !!before, verifierAward: award };
  },

  async award_points(args, ctx) {
    const t = args.ticketId ? findTicket(ctx.db, args.ticketId) : null;
    return awardPoints(ctx.db, args.user || ctx.user, clean(args.action), t?.id || clean(args.ticketId) || null);
  },

  async plus_one(args, ctx) {
    const { db } = ctx;
    const t = findTicket(db, args.ticketId || ctx.ticketId);
    if (!t) return { error: `No ticket ${args.ticketId}` };
    const u = findUser(db, args.user) || findUser(db, ctx.user);
    if (!u) return { error: 'Unknown user' };
    if (t.user === u.name) return { error: 'You reported this one — you cannot +1 your own complaint.', ticketId: t.id, plusOnes: t.plusOnes };
    t.supporters ||= [];
    if (t.supporters.includes(u.name)) return { already: true, ticketId: t.id, plusOnes: t.plusOnes };
    t.supporters.push(u.name);
    t.plusOnes = (t.plusOnes || 0) + 1;
    save();
    const award = awardPoints(db, u.name, 'plus_one', t.id);
    return { ticketId: t.id, plusOnes: t.plusOnes, award };
  },

  async get_badges(args, ctx) {
    const { db } = ctx;
    const u = findUser(db, args.user) || findUser(db, ctx.user);
    if (!u) return { error: 'Unknown user' };
    const nextTitle = u.points < 100 ? { title: 'Active Citizen', pointsNeeded: 100 - u.points } : u.points < 500 ? { title: 'Civic Hero', pointsNeeded: 500 - u.points } : null;
    return {
      user: u.name, points: u.points, title: u.title, homeWard: wardById(db, u.homeWard)?.name,
      badges: BADGES.map((b) => ({
        name: b.name, icon: b.icon, earned: (u.badges || []).includes(b.name), desc: b.desc,
        progress: b.dynamic ? undefined : `${Math.min(u.stats?.[b.stat] || 0, b.goal)}/${b.goal}`,
      })),
      nextTitle,
    };
  },

  async get_leaderboard(args, ctx) {
    const { db } = ctx;
    const scope = clean(args.scope || args.ward) || 'city';
    let users = [...db.users];
    let ward = null;
    if (!/^(city|all|ahmedabad)$/i.test(scope)) {
      ward = findWard(db, scope);
      if (ward) users = users.filter((u) => u.homeWard === ward.id);
    }
    users.sort((a, b) => b.points - a.points);
    const holder = db.users.find((u) => u.title === TITLES[4]);
    return {
      scope: ward ? `${ward.name} (Ward ${ward.number})` : 'Ahmedabad city',
      highestCivicHonour: holder ? { name: holder.name, points: holder.points } : null,
      leaders: users.slice(0, 10).map((u, i) => ({ rank: i + 1, name: u.name, points: u.points, title: u.title, ward: wardById(db, u.homeWard)?.name, badges: u.badges.length })),
    };
  },
};

// ---------- Gemini function declarations ----------
const S = (description, extra = {}) => ({ type: 'STRING', description, ...extra });
const N = (description) => ({ type: 'NUMBER', description });
export const functionDeclarations = [
  {
    name: 'analyze_image',
    description: 'Run vision on the attached photo to identify the civic issue (pothole, garbage, streetlight, waterlogging) and severity. Returns issueType "unknown" for non-civic photos.',
    parameters: { type: 'OBJECT', properties: { image_ref: S('Reference of the attached photo, e.g. "photo_1"') }, required: ['image_ref'] },
  },
  {
    name: 'lookup_ward_department',
    description: 'Find the AMC ward and responsible department. Prefer areaName if the user typed/said an area, otherwise use GPS lat/lng.',
    parameters: {
      type: 'OBJECT',
      properties: { lat: N('GPS latitude'), lng: N('GPS longitude'), areaName: S('Area or locality name, e.g. Navrangpura'), issueType: S('Issue type', { enum: ISSUE_TYPES }) },
    },
  },
  {
    name: 'create_ticket',
    description: 'File a complaint in the AMC system and get a tracking ID. Automatically checks for a duplicate of the same type within 30 m; if one exists it returns duplicate=true instead of filing.',
    parameters: {
      type: 'OBJECT',
      properties: {
        user: S('Citizen name'), issueType: S('Issue type', { enum: ISSUE_TYPES }), severity: S('Severity', { enum: ['low', 'medium', 'high'] }),
        description: S('Short description of the issue'), wardId: S('Ward id from lookup, e.g. "W12"'),
        lat: N('Latitude'), lng: N('Longitude'), photo_ref: S('Photo reference, e.g. "photo_1"'),
        force: { type: 'BOOLEAN', description: 'File even if a duplicate exists. Only if the user insists it is a different issue.' },
      },
      required: ['user', 'issueType', 'severity'],
    },
  },
  {
    name: 'get_status',
    description: 'Get the current stage, department, crew, expected date and timeline of a complaint. Use ticketId "my latest" for the user\'s most recent complaint.',
    parameters: { type: 'OBJECT', properties: { ticketId: S('Ticket ID like AMC-W12-0457, or "my latest"'), user: S('Citizen name') } },
  },
  {
    name: 'list_complaints',
    description: 'List open and completed complaints for an area/ward and/or a user.',
    parameters: { type: 'OBJECT', properties: { area: S('Area or ward name/number'), user: S('Citizen name'), status: S('Filter', { enum: ['open', 'completed', 'all'] }) } },
  },
  {
    name: 'update_status',
    description: 'OFFICER ONLY. Move a ticket to a new stage. When marking Completed, pass the after photo reference.',
    parameters: {
      type: 'OBJECT',
      properties: { ticketId: S('Ticket ID'), stage: S('New stage', { enum: STAGES.filter((s) => s !== 'Verified') }), after_photo_ref: S('After photo reference, e.g. "photo_1"'), note: S('Optional note') },
      required: ['ticketId', 'stage'],
    },
  },
  {
    name: 'verify_completion',
    description: 'Compare before/after photos of a Completed ticket with vision. If fixed → Verified; if the issue is still visible → Reopened.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ticketId: S('Ticket ID'), after_photo_ref: S('After photo reference if a new one is attached'),
        citizenVerdict: S('Citizen answer on the spot, skips the photo check', { enum: ['fixed', 'not_fixed'] }),
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'check_duplicates',
    description: 'Check whether the same issue type is already reported (still open) within 30 m of the GPS location.',
    parameters: { type: 'OBJECT', properties: { issueType: S('Issue type', { enum: ISSUE_TYPES }), lat: N('Latitude'), lng: N('Longitude') }, required: ['issueType'] },
  },
  {
    name: 'award_points',
    description: 'Award or deduct civic points. valid_complaint +10, plus_one +2, verify_fix +5, complaint_completed +15, fake_report -10, duplicate_report -10.',
    parameters: { type: 'OBJECT', properties: { user: S('Citizen name'), action: S('Action', { enum: Object.keys(POINTS) }), ticketId: S('Related ticket ID') }, required: ['user', 'action'] },
  },
  {
    name: 'plus_one',
    description: 'Add the user\'s "+1 I see this too" to an existing complaint (used instead of filing a duplicate).',
    parameters: { type: 'OBJECT', properties: { ticketId: S('Ticket ID'), user: S('Citizen name') }, required: ['ticketId'] },
  },
  {
    name: 'get_badges',
    description: 'Get a citizen\'s points, title, earned badges and progress.',
    parameters: { type: 'OBJECT', properties: { user: S('Citizen name') }, required: ['user'] },
  },
  {
    name: 'get_leaderboard',
    description: 'Get the leaderboard for the city or a ward, including who holds the Highest Civic Honour.',
    parameters: { type: 'OBJECT', properties: { scope: S('"city" or a ward/area name') } },
  },
];

// One-line summaries the UI shows for each step.
export function summarize(name, args, r) {
  if (!r) return '';
  if (r.error) return `⚠ ${r.error}`;
  const sev = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  switch (name) {
    case 'analyze_image':
      return r.issueType === 'unknown' ? 'Not a civic issue ✗' : `${ISSUE_LABEL[r.issueType]} (${sev(r.severity)})${r.mock ? ' · offline guess' : ` · ${Math.round(r.confidence * 100)}%`}`;
    case 'lookup_ward_department':
      return `${r.areaName} → Ward ${r.ward.number}${r.department ? ` → ${r.department.short}` : ''}${r.method === 'gps-nearest' ? ' (nearest)' : r.method === 'home-ward' ? ' (home ward)' : ''}`;
    case 'create_ticket':
      return r.created ? `Ticket ${r.ticketId} created` : r.duplicate ? `Already reported: ${r.existingTicketId} (${r.distanceM} m away)` : 'Not created';
    case 'get_status':
      return r.found ? `${r.ticketId} → ${r.status}${r.verifiedFixed ? ' ✓' : ''}` : r.message;
    case 'list_complaints':
      return `${r.area}: ${r.openCount} open, ${r.completedCount} completed`;
    case 'check_duplicates':
      return r.duplicate ? `Already reported: ${r.existingTicketId} (${r.distanceM} m away)` : r.checked ? 'No duplicate nearby' : 'Duplicate check skipped (no GPS)';
    case 'update_status':
      return `${r.ticketId} → ${r.status}`;
    case 'verify_completion':
      if (r.byCitizen) return r.fixed ? 'Citizen confirmed fix ✓' : 'Citizen says not fixed → Reopened';
      return r.alreadyVerified ? `${r.ticketId} already verified ✓` : r.fixed ? `Fix verified ✓ (${Math.round(r.confidence * 100)}%)` : 'Issue still visible → Reopened';
    case 'award_points':
      return r.alreadyAwarded ? `Already awarded to ${r.user}` : `${r.delta > 0 ? '+' : ''}${r.delta} pts → ${r.user} (${r.points})`;
    case 'plus_one':
      return r.already ? 'Already +1\'d' : `+1 on ${r.ticketId} (now ${r.plusOnes})`;
    case 'get_badges':
      return `${r.user}: ${r.badges.filter((b) => b.earned).length} badges · ${r.title}`;
    case 'get_leaderboard':
      return r.leaders[0] ? `#1 ${r.leaders[0].name} · ${r.leaders[0].points} pts` : 'No citizens yet';
    default:
      return '';
  }
}
