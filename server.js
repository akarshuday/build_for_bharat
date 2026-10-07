require('dotenv').config();
const express = require('express'), http = require('http'), { Server } = require('socket.io');
const DB = require('better-sqlite3'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), multer = require('multer');
const helmet = require('helmet'), rateLimit = require('express-rate-limit');
const PROD = process.env.NODE_ENV === 'production';
if (PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me')) {
  console.error('Refusing to start: set a long random JWT_SECRET in .env before running in production'); process.exit(1);
}
const db = new DB('data.db'), SECRET = process.env.JWT_SECRET || 'change-me';
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,uid TEXT UNIQUE,name TEXT,email TEXT UNIQUE,pass TEXT,role TEXT,skills TEXT);
CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY,manager_id INT,title TEXT,theme TEXT,description TEXT,published INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS members(project_id INT,user_id INT,UNIQUE(project_id,user_id));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,project_id INT,user_id INT,title TEXT,guide TEXT,alt TEXT,priority TEXT,hours REAL,status TEXT DEFAULT 'todo');
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,project_id INT,name TEXT,text TEXT,ts INT);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,user_id INT,text TEXT,read INTEGER DEFAULT 0,ts INT);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY,task_id INT,user_id INT,name TEXT,text TEXT,ts INT);
CREATE TABLE IF NOT EXISTS task_files(id INTEGER PRIMARY KEY,task_id INT,user_id INT,name TEXT,file TEXT,size INT,ts INT);`);
// safe migration: adds `due` to databases created before deadlines existed
try { db.exec(`ALTER TABLE tasks ADD COLUMN due TEXT`); } catch { /* column already there */ }
// safe migration: adds `depends_on` to databases created before dependencies existed
try { db.exec(`ALTER TABLE tasks ADD COLUMN depends_on INT`); } catch { /* column already there */ }
// safe migration: adds `experience` to databases created before the profile page existed
try { db.exec(`ALTER TABLE users ADD COLUMN experience TEXT`); } catch { /* column already there */ }
// ISO day strings in local time, e.g. 2026-03-12
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
const cleanDue = v => { if (v === null || v === undefined || v === '') return null; const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined; };

const app = express(), srv = http.createServer(app), io = new Server(srv);
// security headers; the CSP keeps Chart.js from the CDN and lets the inline app script and same-origin Socket.io work
app.use(helmet({
  strictTransportSecurity: PROD ? undefined : false,
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.tailwindcss.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com', 'https://db.onlinewebfonts.com'],
    imgSrc: ["'self'", 'data:', 'blob:'],
    // the landing page backdrops are CloudFront mp4s; without this media-src
    // falls back to default-src and every <video> is refused
    mediaSrc: ["'self'", 'blob:', 'https://d8j0ntlcm91z4.cloudfront.net'],
    connectSrc: ["'self'", 'ws:', 'wss:', 'https://cdnjs.cloudflare.com'],
    fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'https://db.onlinewebfonts.com'],
    objectSrc: ["'none'"], frameAncestors: ["'self'"], upgradeInsecureRequests: PROD ? [] : null
  } }
}));
// ---------- two UI worlds ----------
// "/"  -> the static landing page in public/landing-dist (plain HTML/CSS/JS, no build step)
// "/app" -> the plain HTML/JS app in public/index.html (no build step, no framework)
const PUB = path.join(__dirname, 'public'), LAND = path.join(PUB, 'landing-dist');
const APP_INDEX = path.join(PUB, 'index.html'), LAND_INDEX = path.join(LAND, 'index.html');
const landingBuilt = () => fs.existsSync(LAND_INDEX);
// the landing page is not part of the app, so it stays out of /app
const appPage = (q, s) => q.path.startsWith('/app/landing-dist') ? s.sendStatus(404) : s.sendFile(APP_INDEX);
app.use(express.json());
if (landingBuilt()) app.use(express.static(LAND, { index: 'index.html' }));
app.use('/app/landing-dist', (q, s) => s.sendStatus(404)); // the landing page is served from "/", not from inside the app
app.use('/app', express.static(PUB, { index: false, redirect: false }));
// 10 sign-in or sign-up attempts per IP per 15 minutes
const attempts = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' } });
const wrap = f => (q, s) => Promise.resolve(f(q, s)).catch(e => s.status(500).json({ error: e.message }));
const NO = s => s.status(403).json({ error: 'Not allowed' });
const auth = (q, s, n) => {
  try { q.user = db.prepare('SELECT * FROM users WHERE id=?').get(jwt.verify((q.headers.authorization || '').slice(7), SECRET).id); if (!q.user) throw 0; n(); }
  catch { s.status(401).json({ error: 'Please log in' }); }
};
// returns the project only if this user manages it or belongs to its team
const mine = (u, pid) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid); if (!p) return null;
  if (u.role === 'manager') return p.manager_id === u.id ? p : null;
  return db.prepare('SELECT 1 FROM members WHERE project_id=? AND user_id=?').get(pid, u.id) ? p : null;
};
const mgr = (q, s) => { const p = mine(q.user, q.params.id); if (!p || q.user.role !== 'manager') { NO(s); return null; } return p; };
const team = pid => db.prepare('SELECT u.* FROM users u JOIN members m ON m.user_id=u.id WHERE m.project_id=?').all(pid);
// store a notification and push it live to that user's sockets
const notify = (userId, text) => {
  const n = { user_id: userId, text, read: 0, ts: Date.now() };
  n.id = db.prepare('INSERT INTO notifications(user_id,text,read,ts) VALUES(?,?,0,?)').run(userId, text, n.ts).lastInsertRowid;
  io.to('u' + userId).emit('notify', n);
};

// ---------- Auth ----------
app.post('/api/signup', attempts, wrap((q, s) => {
  const { name, email, password, role, skills } = q.body;
  if (!name || !email || !password || password.length < 6) return s.status(400).json({ error: 'Name, email and a 6+ character password are required' });
  const r = role === 'manager' ? 'manager' : 'contributor'; let uid;
  do { uid = (r === 'manager' ? 'MGR-' : 'CON-') + Math.floor(10000 + Math.random() * 90000); } while (db.prepare('SELECT 1 FROM users WHERE uid=?').get(uid));
  try {
    const i = db.prepare('INSERT INTO users(uid,name,email,pass,role,skills) VALUES(?,?,?,?,?,?)').run(uid, name, email.toLowerCase(), bcrypt.hashSync(password, 10), r, skills || '');
    s.json({ token: jwt.sign({ id: i.lastInsertRowid }, SECRET) });
  } catch { s.status(400).json({ error: 'Email already registered' }); }
}));
app.post('/api/login', attempts, wrap((q, s) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((q.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(q.body.password || '', u.pass)) return s.status(401).json({ error: 'Wrong email or password' });
  s.json({ token: jwt.sign({ id: u.id }, SECRET) });
}));
app.get('/api/me', auth, (q, s) => {
  const u = q.user;
  const projects = u.role === 'manager' ? db.prepare('SELECT * FROM projects WHERE manager_id=?').all(u.id)
    : db.prepare('SELECT p.*,(SELECT group_concat(x.name) FROM users x JOIN members m2 ON m2.user_id=x.id WHERE m2.project_id=p.id) team FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=?').all(u.id);
  s.json({ user: { uid: u.uid, name: u.name, role: u.role, skills: u.skills, experience: u.experience }, projects });
});
app.patch('/api/me', auth, (q, s) => { // the logged-in user edits their own profile
  const u = q.user, d = q.body;
  const name = String(d.name ?? u.name ?? '').trim(), skills = String(d.skills ?? u.skills ?? ''), experience = String(d.experience ?? u.experience ?? '');
  if (!name || name.length > 60) return s.status(400).json({ error: 'Name must be 1 to 60 characters' });
  if (skills.length > 200) return s.status(400).json({ error: 'Skills must be 200 characters or fewer' });
  if (experience.length > 1000) return s.status(400).json({ error: 'Experience must be 1000 characters or fewer' });
  db.prepare('UPDATE users SET name=?,skills=?,experience=? WHERE id=?').run(name, skills, experience, u.id);
  s.json({ user: { uid: u.uid, name, role: u.role, skills, experience } });
});

// ---------- Projects & teams ----------
app.get('/api/users/search', auth, (q, s) => {
  const t = '%' + (q.query.q || '') + '%';
  s.json(db.prepare("SELECT uid,name,skills FROM users WHERE role='contributor' AND (uid LIKE ? OR name LIKE ?) LIMIT 10").all(t, t));
});
app.post('/api/projects', auth, (q, s) => {
  if (q.user.role !== 'manager') return NO(s);
  const { title, theme, description } = q.body; if (!title) return s.status(400).json({ error: 'Title is required' });
  s.json({ id: db.prepare('INSERT INTO projects(manager_id,title,theme,description) VALUES(?,?,?,?)').run(q.user.id, title, theme || '', description || '').lastInsertRowid });
});
app.get('/api/projects/:id', auth, (q, s) => {
  const p = mine(q.user, q.params.id); if (!p) return NO(s);
  const M = q.user.role === 'manager';
  let tasks = db.prepare('SELECT t.*,u.uid,u.name assignee,(SELECT d.title FROM tasks d WHERE d.id=t.depends_on) waits_for,(SELECT d.status FROM tasks d WHERE d.id=t.depends_on) dep_status FROM tasks t LEFT JOIN users u ON u.id=t.user_id WHERE project_id=?').all(p.id);
  const byId = new Map(db.prepare('SELECT id,task_id,name,size FROM task_files WHERE task_id IN (SELECT id FROM tasks WHERE project_id=?) ORDER BY id').all(p.id).map(f => [f.id, f]));
  tasks.forEach(t => t.files = [...byId.values()].filter(f => f.task_id === t.id));
  if (!M) tasks = p.published ? tasks.filter(t => t.user_id === q.user.id) : []; // master list is manager-only until published
  s.json({ project: p, members: team(p.id).map(({ uid, name, skills, experience }) => ({ uid, name, skills, experience })), tasks, isManager: M });
});
app.post('/api/projects/:id/members', auth, (q, s) => {
  const p = mgr(q, s); if (!p) return;
  const m = db.prepare("SELECT id FROM users WHERE uid=? AND role='contributor'").get((q.body.uid || '').toUpperCase());
  if (!m) return s.status(404).json({ error: 'No contributor with that ID' });
  if (db.prepare('INSERT OR IGNORE INTO members VALUES(?,?)').run(p.id, m.id).changes)
    notify(m.id, `You were added to the team for "${p.title}"`);
  s.json({ ok: 1 });
});

// ---------- Work Distributor AI ----------
const GROQ_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const DESC_MAX = 3000, TASK_MAX = 15, TASK_MIN = 8, STEP_MAX = 6;
const PRIORITIES = ['high', 'medium', 'low'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = n => Math.round(n * 10) / 10;
// never let the API key reach a log line or a response
const scrub = m => { const k = process.env.GROQ_API_KEY || ''; let t = String(m ?? ''); return (k ? t.split(k).join('[redacted]') : t).slice(0, 240); };
// a failure worth showing the manager as-is: bad model, bad key, network. Retrying cannot fix these.
class PlanError extends Error { constructor(msg, kind = 'fatal') { super(msg); this.kind = kind; } }

const SYSTEM_PROMPT = `You are a project work distributor. Output valid JSON only.`;
// 1: full brief, 2: short retry when the first answer cannot be parsed
const planPrompt = (p, members, steer) => `Project: ${p.title}
Theme: ${p.theme || 'not given'}
What is being built: ${String(p.description || '').slice(0, DESC_MAX) || 'not given'}
Team:
${members.map(m => `${m.uid} (${m.name}): skills: ${m.skills || 'not given'}${m.experience ? ` | experience: ${String(m.experience).slice(0, 500)}` : ''}`).join('\n')}${steer ? `\nThe project manager added these instructions, follow them (same JSON shape): ${steer}\n` : ''}
Create 8-15 tasks. Rules:
1. Every task has exactly one assignee_uid, copied exactly from the list above, chosen because those skills fit that task. Never invent a uid.
2. Keep total hours per person within 25% of each other.
3. Order the list so earlier tasks unblock later ones. Give each task due_days: how many days from today it is due, spread out from 1 to 45 so early work comes first.
4. depends_on_index is the 0-based index of an EARLIER task that must be finished first, or null when it can start immediately.
5. Write DETAILED instructions. guide must be 4-6 numbered steps a beginner could follow today: name the concrete screen, file, endpoint, table, setting or tool for each step, say what to type or click, and say how to check the step worked. No vague advice like "work on it" or "communicate with the team".
6. alt must be one genuinely different way to do the same task: a different tool, library, architecture or order of work, explained in 2-4 sentences. Not a variation of the same approach.
Return ONLY a JSON object of this exact shape:
{"tasks":[{"title","assignee_uid","priority":"high|medium|low","hours":number,"due_days":number,"depends_on_index":number or null,"guide":"1. ...\\n2. ...\\n3. ...\\n4. ...","alt":"a different approach, explained"}]}`;
// the retry keeps everything the model needs to plan properly, just packed into a few lines.
// the shape example matters: with one step in it the model answers with one step per guide
const shortPrompt = (p, members) => `Plan tasks for: ${p.title} (${p.theme || 'n/a'}). Build: ${String(p.description || '').replace(/\s+/g, ' ').slice(0, 700) || 'not given'}.
Team: ${members.map(m => `${m.uid} ${m.name.split(' ')[0]} (${String(m.skills || '').slice(0, 60)})`).join('; ')}.
Return ONLY JSON: {"tasks":[{"title","assignee_uid","priority":"high|medium|low","hours":number,"due_days":number,"depends_on_index":number or null,"guide":"1. step\\n2. step\\n3. step\\n4. step","alt":"other way"}]}
Need 8-15 tasks. One of those uids per task, hours within 25% per person, earlier tasks unblock later ones, due_days 1-45, guide 4-6 numbered steps, alt a genuinely different approach.`;

// Demo plan so the app still works with no API key, and the last resort after a bad AI answer
const demoPlan = (p, members) => ['Research and requirements', 'Design the structure', 'Build the core feature', 'Test everything', 'Review and polish']
  .map((t, i) => ({
    title: `${t}: ${p.title}`, assignee_uid: members[i % members.length].uid, priority: i < 2 ? 'high' : 'medium', hours: 3 + i, due_days: 3 + i * 7, depends_on_index: i ? i - 1 : null,
    guide: '1. Read the project brief.\n2. Break the work into small steps.\n3. Finish them one by one and note blockers.', alt: 'Pair up with a teammate or start from an existing template.'
  }));

async function askGroq(model, prompt) {
  let r, j;
  try {
    r = await fetch(GROQ_URL, {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.4, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }] })
    });
    j = await r.json();
  } catch (e) { throw new PlanError(`Could not reach the AI service: ${scrub(e.message)}`, 'fatal'); }
  if (!r.ok || !j.choices || !j.choices[0]) {
    const why = scrub(j?.error?.message) || `HTTP ${r.status}`;
    // a retired or misspelled model, or a rejected key: only the .env file can fix these
    if (/model/i.test(why) && /(not exist|unknown|deprecat|access|not found)/i.test(why)) throw new PlanError(`AI service error: ${why} (check GROQ_MODEL in .env)`, 'fatal');
    if (r.status === 401 || r.status === 403) throw new PlanError(`AI service error: ${why} (check GROQ_API_KEY in .env)`, 'fatal');
    // the account hit a Groq usage limit: waiting a moment is the only fix
    if (r.status === 429 || /too large|rate limit|tokens per minute|\bOTPM\b/i.test(why)) throw new PlanError('AI service is busy right now (usage limit reached), please try again in a minute', 'fatal');
    // the model choked on the shape we asked for: the shorter prompt may get through
    if (/json|failed_generation|schema|context length|too long/i.test(why)) throw new PlanError(`AI service error: ${why}`, 'retry');
    throw new PlanError(`AI service error: ${why}`, 'fatal');
  }
  return String(j.choices[0].message?.content || '');
}

// the model sometimes wraps JSON in prose or a code fence, and sometimes answers with a bare array
const parseAnswer = text => {
  const body = String(text || '').trim().replace(/```(?:json)?/gi, '').trim();
  const from = body.search(/[[{]/), to = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  for (const c of (from >= 0 && to > from ? [body, body.slice(from, to + 1)] : [body])) {
    try {
      const out = JSON.parse(c);
      const arr = Array.isArray(out) ? out : Array.isArray(out?.tasks) ? out.tasks : null;
      if (arr) return arr;
    } catch { /* not JSON in this shape, try the next */ }
  }
  throw new Error('answer had no tasks array');
};
const GENERIC_STEPS = ['Read the project brief and write down exactly what this task has to deliver.',
  'Split that into the smallest steps you can finish in one sitting, then do them in order.',
  'Check the result against the task and note anything you could not finish.'];
const asGuide = text => {
  // some models cram every step onto one line: "1. do this. 2. do that. 3. ship it."
  const flat = String(text || '').replace(/\r/g, '').replace(/\s(\d{1,2})[.)]\s+/g, '\n$1. ');
  const lines = flat.split('\n').map(l => l.trim().replace(/^(?:step\s*)?\d+[).:-]?\s*/i, '')).filter(l => l.length > 2);
  const steps = lines.length >= 3 ? lines.slice(0, STEP_MAX) : GENERIC_STEPS;
  return steps.map((l, i) => `${i + 1}. ${l}`).join('\n');
};
// Repair what can be repaired, drop only what is unusable; unknown assignees go to whoever has the lightest load
function normalise(raw, members) {
  const load = Object.fromEntries(members.map(m => [m.uid, 0]));
  const lightest = () => members.reduce((a, m) => load[m.uid] < load[a] ? m.uid : a, members[0].uid);
  const tasks = []; let dropped = 0;
  for (const t of raw.slice(0, TASK_MAX)) {
    if (!t || typeof t !== 'object') { dropped++; continue; }
    const title = String(t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) { dropped++; continue; }
    const wanted = String(t.assignee_uid ?? '').trim().toUpperCase();
    const uid = members.some(m => m.uid === wanted) ? wanted : lightest();
    const pr = String(t.priority ?? '').trim().toLowerCase();
    const hrs = Number(t.hours);
    const days = Number(t.due_days);
    const dep = Number(t.depends_on_index);
    tasks.push({
      title, assignee_uid: uid,
      priority: PRIORITIES.includes(pr) ? pr : 'medium',
      hours: round1(clamp(Number.isFinite(hrs) && hrs > 0 ? hrs : 3, 0.5, 40)),
      due_days: Number.isFinite(days) && days > 0 ? Math.round(clamp(days, 1, 365)) : null,
      depends_on_index: Number.isInteger(dep) && dep >= 0 && dep < tasks.length ? dep : null,
      guide: asGuide(t.guide), alt: String(t.alt ?? '').replace(/\s+/g, ' ').trim().slice(0, 600) || 'Do it the other way round: start from a finished example or template and adapt it, instead of building from scratch.'
    });
    load[uid] += tasks[tasks.length - 1].hours;
  }
  return { tasks, dropped };
}

async function plan(p, members, instructions) {
  const started = Date.now(), steer = String(instructions || '').trim().slice(0, 500);
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const done = (tasks, source, note = '') => {
    console.log(`[plan] project ${p.id} -> ${tasks.length} tasks, ${Date.now() - started}ms, ${source}${note}`);
    return { tasks, source };
  };
  if (!process.env.GROQ_API_KEY) { const t = demoPlan(p, members); return done(t, 'demo', ' (no GROQ_API_KEY set)'); }
  const attempts = [planPrompt(p, members, steer), shortPrompt(p, members)];
  for (const [n, prompt] of attempts.entries()) {
    let answer;
    try { answer = await askGroq(model, prompt); }
    catch (e) {
      if (e.kind === 'fatal') { console.log(`[plan] project ${p.id} -> failed after ${Date.now() - started}ms: ${e.message}`); throw e; }
      answer = ''; // the model refused this shape: the shorter prompt gets one go
    }
    try {
      const { tasks, dropped } = normalise(parseAnswer(answer), members);
      if (tasks.length < 4) throw new Error('only ' + tasks.length + ' usable task(s)'); // too thin to be a plan
      const thin = tasks.length < TASK_MIN ? ` (only ${tasks.length} tasks)` : '';
      return done(tasks, 'ai', `${n ? ' (recovered on the short retry)' : dropped ? ` (${dropped} unusable dropped)` : ''}${thin}`);
    } catch { /* unusable answer: try the shorter prompt, then the demo plan */ }
  }
  return done(demoPlan(p, members), 'demo', ' (AI answer unusable)');
}
app.post('/api/projects/:id/generate', auth, wrap(async (q, s) => {
  const p = mgr(q, s); if (!p) return;
  const members = team(p.id); if (!members.length) return s.status(400).json({ error: 'Add team members first' });
  let plan1;
  try { plan1 = await plan(p, members, q.body.instructions); }
  catch (e) { return s.status(502).json({ error: scrub(e.message) }); } // the old tasks stay put
  const list = plan1.tasks;
  db.prepare('DELETE FROM tasks WHERE project_id=?').run(p.id); db.prepare('UPDATE projects SET published=0 WHERE id=?').run(p.id);
  const ins = db.prepare('INSERT INTO tasks(project_id,user_id,title,guide,alt,priority,hours,due) VALUES(?,?,?,?,?,?,?,?)');
  const ids = list.map(t => {
    const days = Number(t.due_days);
    const due = Number.isFinite(days) && days > 0 ? dayFromNow(Math.min(days, 365)) : null;
    return Number(ins.run(p.id, members.find(x => x.uid === t.assignee_uid).id, t.title, t.guide, t.alt, t.priority, t.hours, due).lastInsertRowid);
  });
  // the AI points at positions in its own list; turn them into real task ids (earlier tasks only, so no cycles)
  list.forEach((t, i) => {
    if (t.depends_on_index !== null) db.prepare('UPDATE tasks SET depends_on=? WHERE id=?').run(ids[t.depends_on_index], ids[i]);
  });
  s.json({ count: list.length, source: plan1.source });
}));
app.post('/api/projects/:id/publish', auth, (q, s) => {
  const p = mgr(q, s); if (!p) return;
  db.prepare('UPDATE projects SET published=1 WHERE id=?').run(p.id);
  for (const m of team(p.id)) {
    const c = db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id=? AND user_id=?').get(p.id, m.id).c;
    notify(m.id, `"${p.title}" plan published: ${c ? `${c} task${c > 1 ? 's' : ''} for you` : 'no tasks for you yet'}`);
  }
  s.json({ ok: 1 });
});

// Workload balancing: hand untouched ("todo") tasks from the busiest members to the least busy ones
app.post('/api/projects/:id/rebalance', auth, (q, s) => {
  const p = mgr(q, s); if (!p) return;
  const ids = team(p.id).map(m => m.id);
  const load = Object.fromEntries(ids.map(i => [i, db.prepare("SELECT COUNT(*) c FROM tasks WHERE project_id=? AND user_id=? AND status!='done'").get(p.id, i).c]));
  const pick = cmp => ids.reduce((a, b) => load[b] === load[a] ? a : cmp(load[b], load[a]) ? b : a);
  let moved = 0;
  while (ids.length > 1) {
    const hi = pick((a, b) => a > b), lo = pick((a, b) => a < b);
    if (hi === lo || load[hi] - load[lo] <= 1) break;
    const t = db.prepare("SELECT id,title FROM tasks WHERE project_id=? AND user_id=? AND status='todo' ORDER BY id LIMIT 1").get(p.id, hi); // only tasks nobody has started
    if (!t) break;
    db.prepare('UPDATE tasks SET user_id=? WHERE id=?').run(lo, t.id);
    notify(lo, `"${t.title}" was moved to you to even out the workload`);
    load[hi]--; load[lo]++; moved++;
  }
  s.json({ moved });
});

// Re-planning: remove a member, hand their unfinished tasks to the least-loaded teammates
app.post('/api/projects/:id/replan', auth, (q, s) => {
  const p = mgr(q, s); if (!p) return;
  const out = db.prepare('SELECT id FROM users WHERE uid=?').get(q.body.uid || '');
  if (out) { db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(p.id, out.id); notify(out.id, `You were removed from "${p.title}"`); }
  const ms = team(p.id); if (!ms.length) return s.status(400).json({ error: 'No members left on the team' });
  const load = Object.fromEntries(ms.map(m => [m.id, db.prepare("SELECT COUNT(*) c FROM tasks WHERE project_id=? AND user_id=? AND status!='done'").get(p.id, m.id).c]));
  const orphans = db.prepare("SELECT id,title FROM tasks WHERE project_id=? AND status!='done' AND user_id NOT IN (SELECT user_id FROM members WHERE project_id=?)").all(p.id, p.id);
  for (const t of orphans) { const l = Object.entries(load).sort((a, b) => a[1] - b[1])[0][0]; db.prepare('UPDATE tasks SET user_id=?,status=? WHERE id=?').run(l, 'todo', t.id); notify(+l, `"${t.title}" was assigned to you`); load[l]++; }
  s.json({ moved: orphans.length });
});

// ---------- Tasks ----------
// fields the manager may edit on a task; the keys are fixed, so they are safe to use in SQL
const EDIT = {
  title: v => { const s = String(v).trim(); if (!s || s.length > 200) throw new Error('Title must be 1 to 200 characters'); return s; },
  guide: v => String(v).slice(0, 4000), alt: v => String(v).slice(0, 4000),
  priority: v => { const s = String(v).toLowerCase(); if (!['high', 'medium', 'low'].includes(s)) throw new Error('Priority must be high, medium or low'); return s; },
  hours: v => { const n = Number(v); if (!(n > 0) || n > 100) throw new Error('Hours must be a number between 0 and 100'); return n; }
};
app.post('/api/projects/:id/tasks', auth, (q, s) => { // manual task, manager only
  const p = mgr(q, s); if (!p) return;
  const title = String(q.body.title || '').trim(); if (!title) return s.status(400).json({ error: 'Title is required' });
  const ms = team(p.id), m = ms.find(x => x.uid === q.body.assignee_uid) || ms[0];
  if (!m) return s.status(400).json({ error: 'Add team members first' });
  const hours = Number(q.body.hours), pr = String(q.body.priority || '').toLowerCase();
  const id = db.prepare('INSERT INTO tasks(project_id,user_id,title,guide,alt,priority,hours) VALUES(?,?,?,?,?,?,?)').run(p.id, m.id, title.slice(0, 200),
    String(q.body.guide || '').slice(0, 4000) || 'Ask your project manager for the steps for this task.',
    String(q.body.alt || '').slice(0, 4000) || 'Pair up with a teammate or start from an existing template.',
    ['high', 'medium', 'low'].includes(pr) ? pr : 'medium', Number.isFinite(hours) && hours > 0 ? Math.min(hours, 100) : 2).lastInsertRowid;
  s.json({ id });
});
app.delete('/api/tasks/:id', auth, (q, s) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(q.params.id);
  if (!t || q.user.role !== 'manager' || !mine(q.user, t.project_id)) return NO(s);
  db.prepare('DELETE FROM tasks WHERE id=?').run(t.id); s.json({ ok: 1 });
});
app.patch('/api/tasks/:id', auth, (q, s) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(q.params.id), p = t && mine(q.user, t.project_id); if (!p) return NO(s);
  const { status, assignee_uid, due } = q.body;
  if (q.user.role === 'manager') {
    const m = assignee_uid && db.prepare('SELECT id FROM users WHERE uid=?').get(assignee_uid);
    if (m) { db.prepare('UPDATE tasks SET user_id=? WHERE id=?').run(m.id, t.id); if (m.id !== t.user_id) notify(m.id, `"${t.title}" (${p.title}) is now assigned to you`); }
    if (['todo', 'submitted', 'done'].includes(status)) db.prepare('UPDATE tasks SET status=? WHERE id=?').run(status, t.id);
    if (status === 'done' && t.status !== 'done' && t.user_id) notify(t.user_id, `"${t.title}" was approved`);
    if (status === 'todo' && t.status === 'submitted' && t.user_id) notify(t.user_id, `"${t.title}" was sent back, please give it another go`);
    if (q.body.due !== undefined) { const d = cleanDue(due); if (d === undefined) return s.status(400).json({ error: 'Due date must be a date like 2026-03-12' }); db.prepare('UPDATE tasks SET due=? WHERE id=?').run(d, t.id); }
    for (const k of Object.keys(EDIT)) if (q.body[k] !== undefined) {
      let v; try { v = EDIT[k](q.body[k]); } catch (e) { return s.status(400).json({ error: e.message }); }
      db.prepare(`UPDATE tasks SET ${k}=? WHERE id=?`).run(v, t.id);
    }
  } else {
    if (t.user_id !== q.user.id || t.status === 'done') return NO(s);
    if (status === 'submitted' && t.depends_on) {
      const d = db.prepare('SELECT title,status FROM tasks WHERE id=?').get(t.depends_on);
      if (d && d.status !== 'done') return s.status(400).json({ error: `Finish "${d.title}" first: this task is waiting for it` });
    }
    if (['todo', 'submitted'].includes(status)) db.prepare('UPDATE tasks SET status=? WHERE id=?').run(status, t.id);
    if (status === 'submitted' && t.status !== 'submitted') notify(p.manager_id, `${q.user.name} sent "${t.title}" for review (${p.title})`);
  }
  s.json({ ok: 1 });
});

// ---------- Comments & proof uploads ----------
// a task's talk: the project's manager or the task's assignee, nobody else
const canTask = (q, s) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(q.params.id);
  if (!t || !mine(q.user, t.project_id) || (q.user.role !== 'manager' && t.user_id !== q.user.id)) { NO(s); return null; }
  return t;
};
app.get('/api/tasks/:id/comments', auth, (q, s) => {
  const t = canTask(q, s); if (!t) return;
  s.json(db.prepare('SELECT id,name,text,ts FROM comments WHERE task_id=? ORDER BY id DESC LIMIT 100').all(t.id).reverse());
});
app.post('/api/tasks/:id/comments', auth, (q, s) => {
  const t = canTask(q, s); if (!t) return;
  const text = String(q.body.text || '').trim(); if (!text) return s.status(400).json({ error: 'Comment cannot be empty' });
  const row = { task_id: t.id, user_id: q.user.id, name: q.user.name, text: text.slice(0, 1000), ts: Date.now() };
  row.id = db.prepare('INSERT INTO comments(task_id,user_id,name,text,ts) VALUES(?,?,?,?,?)').run(row.task_id, row.user_id, row.name, row.text, row.ts).lastInsertRowid;
  const other = q.user.role === 'manager' ? t.user_id : db.prepare('SELECT manager_id FROM projects WHERE id=?').get(t.project_id).manager_id;
  if (other && other !== q.user.id) notify(other, `${row.name} commented on "${t.title}"`);
  s.json(row);
});

// proof uploads: kept out of public/ and served only through the checked route below
const ALLOWED = ['.png', '.jpg', '.jpeg', '.pdf', '.zip', '.txt'];
const store = multer.diskStorage({
  destination: (rq, f, cb) => { fs.mkdirSync('uploads', { recursive: true }); cb(null, 'uploads'); },
  filename: (rq, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase().slice(0, 10))
});
const upload = multer({
  storage: store, limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (rq, f, cb) => { const e = path.extname(f.originalname).toLowerCase(); ALLOWED.includes(e) ? cb(null, true) : cb(new Error('Only png, jpg, pdf, zip or txt files are allowed')); }
});
app.post('/api/tasks/:id/files', auth, (q, s, n) => { q.task = canTask(q, s); if (q.task) n(); }, upload.single('file'), (q, s) => {
  if (!q.file) return s.status(400).json({ error: 'Choose a file to attach' });
  const name = path.basename(q.file.originalname).slice(0, 120);
  const id = db.prepare('INSERT INTO task_files(task_id,user_id,name,file,size,ts) VALUES(?,?,?,?,?,?)').run(q.task.id, q.user.id, name, q.file.filename, q.file.size, Date.now()).lastInsertRowid;
  s.json({ id, name, size: q.file.size });
});
app.get('/api/tasks/:id/files/:fid', auth, (q, s) => {
  const t = canTask(q, s); if (!t) return;
  const f = db.prepare('SELECT * FROM task_files WHERE id=? AND task_id=?').get(q.params.fid, t.id);
  if (!f) return s.status(404).json({ error: 'File not found' });
  const full = path.resolve('uploads', f.file);
  if (!full.startsWith(path.resolve('uploads') + path.sep) || !fs.existsSync(full)) return s.status(404).json({ error: 'File not found' });
  s.download(full, f.name);
});
// multer errors (wrong type, over 5 MB) should be a clean message, not an HTML 500
app.use((err, q, s, n) => s.status(400).json({ error: /too large/i.test(err.message) ? 'File must be 5 MB or smaller' : String(err.message).slice(0, 200) }));

// ---------- Notifications ----------
app.get('/api/notifications', auth, (q, s) => {
  const rows = db.prepare('SELECT id,text,read,ts FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(q.user.id);
  s.json({ items: rows, unread: rows.filter(r => !r.read).length });
});
app.post('/api/notifications/read', auth, (q, s) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=? AND read=0').run(q.user.id); s.json({ ok: 1 }); });

// ---------- Team chat (real time) ----------
app.get('/api/projects/:id/messages', auth, (q, s) => !mine(q.user, q.params.id) ? NO(s)
  : s.json(db.prepare('SELECT name,text,ts FROM messages WHERE project_id=? ORDER BY id DESC LIMIT 100').all(q.params.id).reverse()));
io.use((so, n) => { try { so.user = db.prepare('SELECT * FROM users WHERE id=?').get(jwt.verify(so.handshake.auth.token, SECRET).id); if (!so.user) throw 0; n(); } catch { n(new Error('auth')); } });
io.on('connection', so => {
  so.join('u' + so.user.id); // private room for this user's notifications
  so.on('join', pid => { if (mine(so.user, pid)) { so.pid = pid; so.join('p' + pid); } });
  so.on('msg', text => {
    if (!so.pid || !text) return;
    const m = { name: so.user.name, text: String(text).slice(0, 1000), ts: Date.now() };
    db.prepare('INSERT INTO messages(project_id,name,text,ts) VALUES(?,?,?,?)').run(so.pid, m.name, m.text, m.ts); io.to('p' + so.pid).emit('msg', m);
  });
});
// ---------- page routes: landing at "/", app at "/app" ----------
const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>Bright Llama</title>
<body style="background:#05060F;color:#EDEEFF;font:16px/1.6 system-ui;padding:12vh 8vw">
<p style="font-family:ui-monospace,monospace;letter-spacing:.18em;font-size:12px;color:#9AA0C8">BRIGHT LLAMA</p>
<h1 style="font-size:clamp(1.8rem,5vw,2.6rem);margin:.4rem 0">The landing page is missing</h1>
<p style="color:#9AA0C8;max-width:44ch"><code style="color:#00F0FF">public/landing-dist/index.html</code> is not there — restore the static landing files
(<code style="color:#00F0FF">index.html</code>, <code style="color:#00F0FF">styles.css</code>, <code style="color:#00F0FF">main.js</code>) and reload this page.
The app itself is already available at <a style="color:#00F0FF" href="/app">/app</a>.</p></body>`;
app.get('/app', appPage);
app.get('/app/{*rest}', appPage);                                    // the app is a single page: unknown /app paths get it too
app.get('/signup', (q, s) => s.sendFile(path.join(PUB, 'signup.html'))); // standalone React + Tailwind sign-up page
app.get('/{*rest}', (q, s) => {
  if (q.path.startsWith('/api/')) return s.status(404).json({ error: 'Not found' });   // an unknown API route is not a page
  if (!landingBuilt()) return s.status(503).type('html').send(NOT_BUILT);
  if (/\.[a-z0-9]{2,5}$/i.test(q.path)) return s.sendStatus(404);     // a missing asset is a 404, not the page
  s.sendFile(LAND_INDEX);                                            // landing deep links
});

srv.listen(process.env.PORT || 3000, () => {
  console.log('App      http://localhost:' + (process.env.PORT || 3000) + '/app');
  console.log('Landing  http://localhost:' + (process.env.PORT || 3000) + '/' + (landingBuilt() ? '' : '(public/landing-dist/index.html is missing)'));
});
