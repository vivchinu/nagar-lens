// The Nagar Lens agent: Gemini function-calling loop, with an offline rule-based fallback
// that calls the same tools so the demo never dead-ends.
import { getDb, saveDataUrl } from './store.js';
import { generate, hasGemini, modelName } from './gemini.js';
import { tools, functionDeclarations, summarize, drainInbox, findTicket, findWard, ISSUE_LABEL } from './tools.js';

const SYSTEM = `You are "Nagar Lens", the civic complaint agent for the Ahmedabad Municipal Corporation (AMC). This is a MOCK AMC system for a demo.
Always use tools for facts. Never invent ticket IDs, statuses, wards, points or names.

REPORT FLOW (a photo_ref is attached and the citizen is reporting a problem):
1. analyze_image(image_ref).
2. If issueType is "unknown": politely say the photo doesn't look like a civic issue and ask for a clearer photo. Only if it is obviously a joke/irrelevant photo (selfie, meme, food), call award_points(action="fake_report"). Stop.
3. lookup_ward_department with areaName if the context has one, otherwise lat/lng, plus the issueType.
4. create_ticket with user, issueType, severity, description, wardId, lat, lng, photo_ref.
5. If create_ticket returns duplicate=true: do NOT file again; tell the user the existing ticket ID and to tap "+1 I see this too".
6. If created: award_points(user, "valid_complaint", ticketId).
STATUS: get_status (ticketId "my latest" when the user doesn't give one; use the focused ticket if provided). If verifiedFixed is true, say "Completed and verified fixed".
LISTS: list_complaints(area or user). LEADERBOARD / "highest civic honour" / "who is top": get_leaderboard(scope "city" unless a ward is named). BADGES / points: get_badges.
OFFICER role only: update_status. When the officer completes a ticket with an after photo: update_status(stage "Completed", after_photo_ref) THEN verify_completion(ticketId).
CITIZEN with an after photo asking to verify a completed ticket: verify_completion(ticketId, after_photo_ref).
"+1" requests: plus_one(ticketId).
Reply style: 1–3 short, friendly sentences for a phone screen. Mention ticket IDs, ward and department. No markdown tables, no bullet lists longer than 3 items.`;

const pick = (calls, name) => [...calls].reverse().find((c) => c.name === name);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Plain-English reply built from tool results (used by the offline agent, and if Gemini fails mid-run).
export function composeReply(calls, ctx) {
  const create = pick(calls, 'create_ticket');
  const analyze = pick(calls, 'analyze_image');
  const lookup = pick(calls, 'lookup_ward_department');
  const verify = pick(calls, 'verify_completion');
  const update = pick(calls, 'update_status');
  const status = pick(calls, 'get_status');
  const list = pick(calls, 'list_complaints');
  const board = pick(calls, 'get_leaderboard');
  const badges = pick(calls, 'get_badges');
  const plus = pick(calls, 'plus_one');

  if (create?.result?.created) {
    const r = create.result, a = analyze?.result;
    return `Filed! Ticket ${r.ticketId}: ${ISSUE_LABEL[a?.issueType] || 'issue'}${a ? ` (${a.severity})` : ''} in ${r.ward.name}, Ward ${r.ward.number}, sent to ${r.departmentShort}. Expected fix by ${fmtDate(r.expectedBy)}. +10 points!`;
  }
  if (create?.result?.duplicate) {
    const r = create.result;
    return `This looks already reported: ${r.existingTicketId} (${r.existingStatus}), ${r.distanceM} m away by ${r.reportedBy}. Tap "+1 I see this too" instead of filing again.`;
  }
  if (analyze && analyze.result?.issueType === 'unknown') return `That photo doesn't look like a civic issue. Try a clear photo of the pothole, garbage, streetlight or waterlogging.`;
  if (lookup?.result?.error) return lookup.result.error;
  if (verify?.result && !verify.result.error) {
    const r = verify.result;
    if (r.alreadyVerified) return `${r.ticketId} is already verified fixed ✓.`;
    return r.fixed
      ? `${update ? `${r.ticketId} marked Completed. ` : ''}AI before/after check passed: ${r.explanation} Status is now Verified ✓.`
      : `AI check failed: ${r.explanation} ${r.ticketId} has been Reopened.`;
  }
  if (update?.result && !update.result.error) return `${update.result.ticketId} is now "${update.result.status}".${update.result.crew ? ` Crew: ${update.result.crew}.` : ''}`;
  if (plus?.result) return plus.result.error || (plus.result.already ? `You already +1'd ${plus.result.ticketId}.` : `Thanks! ${plus.result.ticketId} now has ${plus.result.plusOnes} supporters. +2 points.`);
  if (status?.result) {
    const r = status.result;
    if (!r.found) return r.message;
    if (r.verifiedFixed) return `${r.ticketId} is Completed and verified fixed ✓. ${r.verification?.explanation || ''}`.trim();
    if (r.status === 'Completed') return `${r.ticketId} is Completed by ${r.crew} — waiting for photo verification.`;
    return `${r.ticketId} is "${r.status}" with ${r.department}. Crew: ${r.crew}. Expected by ${fmtDate(r.expectedBy)}${r.overdue ? ' (overdue)' : ''}.`;
  }
  if (list?.result) {
    const r = list.result;
    if (r.error) return r.error;
    const top = r.open.slice(0, 3).map((c) => `${c.id} ${ISSUE_LABEL[c.issueType].toLowerCase()} (${c.status})`).join('; ');
    return `${r.area}: ${r.openCount} open and ${r.completedCount} completed complaints.${top ? ` Open: ${top}.` : ''}`;
  }
  if (board?.result) {
    const r = board.result;
    const h = r.highestCivicHonour;
    const top3 = r.leaders.slice(0, 3).map((l) => `${l.rank}. ${l.name} (${l.points})`).join(', ');
    return `${h ? `🏆 ${h.name} holds the Highest Civic Honour with ${h.points} points. ` : ''}Top in ${r.scope}: ${top3}.`;
  }
  if (badges?.result && !badges.result.error) {
    const r = badges.result;
    const earned = r.badges.filter((b) => b.earned).map((b) => `${b.icon} ${b.name}`).join(', ') || 'none yet';
    return `${r.user}: ${r.points} points, title "${r.title}". Badges: ${earned}.${r.nextTitle ? ` ${r.nextTitle.pointsNeeded} points to ${r.nextTitle.title}.` : ''}`;
  }
  return `I can file a complaint from a photo, check status ("What's the status?"), list complaints in an area, or show the leaderboard.`;
}

async function offlineAgent(ctx, exec) {
  const raw = ctx.message || '';
  const m = raw.toLowerCase();
  const hasPhoto = !!ctx.photos.photo_1;
  const ticketId = raw.match(/AMC-W\d+-\d{3,4}/i)?.[0] || ctx.ticketId;
  const stageWords = { acknowledg: 'Acknowledged', assign: 'Assigned', progress: 'In progress', reopen: 'Reopened', complet: 'Completed', done: 'Completed', fixed: 'Completed' };
  const stage = Object.entries(stageWords).find(([k]) => m.includes(k))?.[1];

  if (ctx.role === 'officer' && ticketId && stage) {
    const u = await exec('update_status', { ticketId, stage, after_photo_ref: hasPhoto ? 'photo_1' : undefined });
    if (stage === 'Completed' && u.afterPhotoUrl) await exec('verify_completion', { ticketId });
    return;
  }
  if (hasPhoto && ticketId && /verify|fixed|after|repair/.test(m)) {
    await exec('verify_completion', { ticketId, after_photo_ref: 'photo_1' });
    return;
  }
  if (/\+1|plus one|see this too/.test(m) && ticketId) {
    await exec('plus_one', { ticketId, user: ctx.user });
    return;
  }
  if (hasPhoto) {
    const a = await exec('analyze_image', { image_ref: 'photo_1' });
    if (a.error || a.issueType === 'unknown') return;
    const l = await exec('lookup_ward_department', { lat: ctx.location?.lat, lng: ctx.location?.lng, areaName: ctx.areaName, issueType: a.issueType });
    if (l.error) return;
    const c = await exec('create_ticket', {
      user: ctx.user, issueType: a.issueType, severity: a.severity, description: a.description,
      wardId: l.ward.id, lat: ctx.location?.lat, lng: ctx.location?.lng, photo_ref: 'photo_1',
    });
    if (c.created) await exec('award_points', { user: ctx.user, action: 'valid_complaint', ticketId: c.ticketId });
    return;
  }
  if (/honou?r|leader|top|rank|highest|champion|winning/.test(m)) {
    const ward = findWard(ctx.db, raw.replace(/.*\b(in|of|for)\b/i, ''));
    await exec('get_leaderboard', { scope: /ward/.test(m) && ward ? ward.name : 'city' });
    return;
  }
  if (/badge|points|my title|score/.test(m)) return void (await exec('get_badges', { user: ctx.user }));
  if (/status|progress|track|update|kya hua|what happened/.test(m)) return void (await exec('get_status', { ticketId: ticketId || 'my latest', user: ctx.user }));
  if (/show|list|complaint|issue|near|around/.test(m)) {
    const ward = ctx.db.wards.find((w) => [w.name, ...w.areas].some((a) => m.includes(a.toLowerCase())));
    await exec('list_complaints', { area: ward?.name, user: /\bmy\b/.test(m) ? ctx.user : undefined });
  }
}

async function geminiAgent(ctx, exec, history, { declarations = functionDeclarations, extraSystem = '' } = {}) {
  const lines = [
    `User: ${ctx.user} (role: ${ctx.role})`,
    ctx.photos.photo_1 ? `Attached photo: image_ref="photo_1"` : 'No photo attached.',
    ctx.location ? `GPS: lat ${ctx.location.lat}, lng ${ctx.location.lng} (±${Math.round(ctx.location.accuracy || 0)} m)` : 'GPS: unavailable',
    ctx.areaName ? `Area chosen by user: ${ctx.areaName}` : null,
    ctx.ticketId ? `Focused ticket: ${ctx.ticketId}` : null,
  ].filter(Boolean);
  const contents = [
    ...history.slice(-6).map((h) => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 600) }] })),
    { role: 'user', parts: [{ text: `[Context]\n${lines.join('\n')}\n\n[Message]\n${ctx.message || (ctx.photos.photo_1 ? 'Please report this issue.' : '')}` }] },
  ];
  for (let step = 0; step < 8; step++) {
    const r = await generate({
      systemInstruction: { parts: [{ text: SYSTEM + extraSystem }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { temperature: 0.2 },
    });
    const cand = r.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return parts.map((p) => p.text || '').join('').trim();
    contents.push(cand.content); // echo back as-is (keeps thought signatures)
    const responses = [];
    for (const p of calls) {
      const { name, args, id } = p.functionCall;
      const result = await exec(name, args || {});
      responses.push({ functionResponse: { ...(id ? { id } : {}), name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return '';
}

// ---------- shared plumbing ----------
function makeCtx(input) {
  return {
    db: getDb(),
    user: input.user || 'Riya Shah',
    role: input.role === 'officer' ? 'officer' : 'citizen',
    message: String(input.message || '').slice(0, 1000),
    photos: {},
    photoHint: input.photoName || '',
    location: input.location && Number.isFinite(+input.location.lat) ? { lat: +input.location.lat, lng: +input.location.lng, accuracy: +input.location.accuracy || null } : null,
    areaName: input.areaName || null,
    ticketId: input.ticketId || null,
  };
}

function makeExec(ctx, emit, toolCalls, { blocked = [] } = {}) {
  return async (name, args) => {
    const fn = tools[name];
    const id = `${toolCalls.length + 1}`;
    emit({ type: 'tool_call', id, name, args });
    let result;
    const started = Date.now();
    try {
      if (blocked.includes(name)) result = { error: `${name} is not allowed in this step. The citizen confirms first.` };
      else result = fn ? await fn(args || {}, ctx) : { error: `Unknown tool ${name}` };
    } catch (e) {
      console.error(`[tool ${name}]`, e);
      result = { error: e.message };
    }
    const call = { id, name, args, result, summary: summarize(name, args, result), ms: Date.now() - started };
    toolCalls.push(call);
    emit({ type: 'tool_result', ...call });
    return result;
  };
}

const last = (calls, name) => [...calls].reverse().find((c) => c.name === name)?.result;

const DRAFT_SYSTEM = `

DRAFT MODE (this turn only): the citizen will review and confirm before anything is filed.
Call analyze_image, then (if it is a civic issue) lookup_ward_department, then check_duplicates. Do NOT call create_ticket or award_points.
Then reply with one short sentence summarising what you found.`;

// Step 1 of reporting: analyse the photo, find ward + department, check duplicates. Nothing is filed.
async function runDraft(ctx, emit) {
  const toolCalls = [];
  const exec = makeExec(ctx, emit, toolCalls, { blocked: ['create_ticket', 'award_points', 'update_status'] });
  let reply = '';
  let mode = hasGemini() ? `gemini:${modelName()}` : 'offline';
  if (hasGemini()) {
    try {
      const allow = ['analyze_image', 'lookup_ward_department', 'check_duplicates'];
      reply = await geminiAgent(ctx, exec, [], { declarations: functionDeclarations.filter((d) => allow.includes(d.name)), extraSystem: DRAFT_SYSTEM });
    } catch (e) {
      console.warn('[draft] Gemini failed:', e.message);
      mode = 'offline (Gemini error)';
      emit({ type: 'status', text: 'Gemini unavailable — using offline agent' });
    }
  }
  // Same steps deterministically, filling in anything the model skipped.
  const a = last(toolCalls, 'analyze_image') || (await exec('analyze_image', { image_ref: 'photo_1' }));
  const civic = !!a && !a.error && a.issueType !== 'unknown';
  const type = civic ? a.issueType : 'pothole';
  let l = last(toolCalls, 'lookup_ward_department');
  if (!l || l.error) l = await exec('lookup_ward_department', { lat: ctx.location?.lat, lng: ctx.location?.lng, areaName: ctx.areaName, issueType: type });
  const d = last(toolCalls, 'check_duplicates') || (await exec('check_duplicates', { issueType: type, lat: ctx.location?.lat, lng: ctx.location?.lng }));
  const dept = ctx.db.departments.find((x) => x.issueTypes.includes(type));
  return {
    reply: reply || (civic ? `Looks like a ${ISSUE_LABEL[type].toLowerCase()} (${a.severity}). Check the details and file.` : 'This photo does not look like a civic issue. Pick the type yourself or retake the photo.'),
    toolCalls,
    mode,
    draft: {
      isCivic: civic, issueType: type, severity: a?.severity || 'medium', description: a?.description || '',
      confidence: a?.confidence ?? null, mock: !!a?.mock, photoUrl: ctx.photos.photo_1?.url || null,
      ward: l?.ward || null, wardMethod: l?.method || null,
      department: l?.department || (dept && { id: dept.id, name: dept.name, short: dept.short, slaDays: dept.slaDays }),
      duplicate: d?.duplicate ? d : null,
    },
    celebrations: [],
  };
}

/**
 * Runs one agent turn. `emit(event)` receives { type: 'tool_call' | 'tool_result' | 'status', ... } as they happen.
 * input.draft = true runs only the analysis half of a report (see runDraft).
 */
export async function runAgent(input, emit = () => {}) {
  const ctx = makeCtx(input);
  const { db } = ctx;
  if (input.image) ctx.photos.photo_1 = saveDataUrl(input.image, ctx.role === 'officer' ? 'after' : 'photo');
  if (input.draft) return runDraft(ctx, emit);

  const toolCalls = [];
  const exec = makeExec(ctx, emit, toolCalls);
  let reply = '';
  let mode = hasGemini() ? `gemini:${modelName()}` : 'offline';
  if (hasGemini()) {
    try {
      reply = await geminiAgent(ctx, exec, Array.isArray(input.history) ? input.history : []);
    } catch (e) {
      console.warn('[agent] Gemini failed:', e.message);
      mode = 'offline (Gemini error)';
      emit({ type: 'status', text: 'Gemini unavailable — switching to offline agent' });
      if (!toolCalls.length) await offlineAgent(ctx, exec);
    }
  } else {
    await offlineAgent(ctx, exec);
  }

  // Safety net: a filed ticket always earns its +10, even if the model forgot to call award_points.
  if (ctx.createdTicketId && !toolCalls.some((c) => c.name === 'award_points' && c.args?.action === 'valid_complaint')) {
    await exec('award_points', { user: ctx.user, action: 'valid_complaint', ticketId: ctx.createdTicketId });
  }
  if (!reply) reply = composeReply(toolCalls, ctx);

  const focus = ctx.createdTicketId || ctx.duplicateOf || ctx.ticketId || null;
  return {
    reply,
    toolCalls,
    mode,
    ticketId: focus,
    createdTicketId: ctx.createdTicketId || null,
    duplicateOf: ctx.duplicateOf || null,
    rejected: toolCalls.some((c) => c.name === 'analyze_image' && c.result?.issueType === 'unknown'),
    celebrations: ctx.role === 'citizen' ? drainInbox(db, ctx.user) : [],
    ticket: focus ? findTicket(db, focus) : null,
  };
}

// Step 2 of reporting: the citizen confirmed the draft → create_ticket + award_points.
export async function fileReport(input, emit = () => {}) {
  const ctx = makeCtx(input);
  const { db } = ctx;
  const url = String(input.photoUrl || '');
  if (url.startsWith('/media/uploads/')) ctx.photos.photo_1 = { url };
  const toolCalls = [];
  const exec = makeExec(ctx, emit, toolCalls);
  const note = String(input.note || '').trim().slice(0, 300);
  const description = [String(input.description || '').trim(), note && `Citizen note: ${note}`].filter(Boolean).join(' — ');
  const c = await exec('create_ticket', {
    user: ctx.user, issueType: input.issueType, severity: input.severity, description,
    wardId: input.wardId, lat: ctx.location?.lat, lng: ctx.location?.lng, photo_ref: 'photo_1', force: !!input.force,
    areaName: input.areaName || undefined,
  });
  if (c.created) await exec('award_points', { user: ctx.user, action: 'valid_complaint', ticketId: c.ticketId });
  return {
    created: !!c.created, ticketId: c.ticketId || c.existingTicketId || null, duplicate: c.duplicate ? c : null, error: c.error || null,
    toolCalls, celebrations: drainInbox(db, ctx.user), ticket: c.ticketId ? findTicket(db, c.ticketId) : null,
  };
}

// Run a single tool directly (UI buttons like +1 or officer stage changes), still reported as a tool call.
export async function runTool(name, input) {
  if (!tools[name]) throw new Error(`Unknown tool ${name}`);
  const ctx = makeCtx({ ...input, ticketId: input.args?.ticketId });
  if (input.image) ctx.photos.photo_1 = saveDataUrl(input.image, ctx.role === 'officer' ? 'after' : 'photo');
  const toolCalls = [];
  await makeExec(ctx, () => {}, toolCalls)(name, input.args || {});
  return { toolCall: toolCalls[0], celebrations: ctx.role === 'citizen' ? drainInbox(ctx.db, ctx.user) : [] };
}

