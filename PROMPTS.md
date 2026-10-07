# Bright Llama: prompts for your coding agent

## How to use this file
1. Open the `bright-llama` folder in your agent (Cursor, Claude Code, Copilot, Windsurf or similar).
2. Paste the **Master context** once at the start of the chat. Paste it again if you start a new chat.
3. Paste **one prompt at a time**, in order. After each one, run `npm start`, test what it says under "Check", and only then move on.
4. If something breaks, use the **Fix prompt** at the end.

---

## Master context (paste first)

```
You are helping me finish a web app called Bright Llama. Read server.js, public/index.html and GUIDE.md before changing anything.

What it is: two portals. Contributors sign up and get a unique ID (CON-12345). Project managers (MGR-12345) create projects with a theme and description, search contributor IDs to build a team, and click "Generate tasks with AI". The AI (Groq API) writes a master task list that only the manager sees until they click Publish. Each contributor then sees only their own tasks, each with a "how to do it" guide and an alternative way, ticks them done, and the manager approves. Progress shows as dots (one dot per task) and a bar chart. Team chat is real time. If a member leaves, the manager re-plans and their unfinished tasks are reassigned.

Stack: Node.js, Express, Socket.io, better-sqlite3, JWT auth, plain HTML/JS in public/index.html, Chart.js from a CDN.

Rules:
- Keep this stack. Do not add React, TypeScript or a build step unless I ask.
- Make small, focused changes. Do not rewrite files that already work.
- Every new API route must check the logged-in user with the existing auth and mine() helpers.
- Escape all user text before putting it in HTML (use the existing esc()).
- The AI uses Groq (GROQ_API_KEY, GROQ_MODEL in .env). Never put keys in code.
- After each change, tell me exactly how to test it in the browser.
```

---

## Prompt 1: Deadlines and overdue dots
```
Add deadlines to tasks.
1. Add a nullable "due" column (ISO date text) to the tasks table. Handle existing databases safely with an ALTER TABLE inside try/catch.
2. In plan() in server.js, ask the AI to return "due_days" (days from today) for each task, and store due = today + due_days.
3. Show the due date on each task card in public/index.html.
4. Add a red "overdue" dot style when due is in the past and status is not done. Add it to the legend and to the progress counts.
5. Let the manager edit a task's due date through PATCH /api/tasks/:id.
Check: generate tasks, set a past due date as manager, and the dot turns red for both the manager and the contributor.
```

## Prompt 2: Task dependencies
```
Add task dependencies.
1. Add a nullable depends_on column (task id) to tasks, with safe migration.
2. Ask the AI in plan() to return "depends_on_index" (index of another task in its own list, or null). After inserting all tasks, convert indexes to real task ids.
3. In PATCH /api/tasks/:id, if a contributor tries to submit a task whose dependency is not done, return 400 with a clear message.
4. Show "Waits for: <title>" on the task card and disable its checkbox until the dependency is done.
Check: submit a dependent task first, it is refused with a clear message; approve the first task and it works.
```

## Prompt 3: Notifications
```
Add notifications.
1. New table notifications(id, user_id, text, read INTEGER DEFAULT 0, ts INTEGER).
2. Create a notify(userId, text) helper. Call it when: a member is added to a team, tasks are published (notify each contributor), a task is submitted (notify the manager), a task is approved or sent back (notify the contributor), a task is reassigned, and someone is removed in re-plan.
3. Routes: GET /api/notifications (latest 30 for the current user) and POST /api/notifications/read.
4. Also push through Socket.io: each socket joins a room "u<userId>" on connect, and notify() emits "notify" to it.
5. In the header add a bell with an unread count and a dropdown list. Clicking it marks all as read.
Check: with two browsers, adding a member shows a bell count on the contributor's screen without refreshing.
```

## Prompt 4: Regenerate with feedback and edit tasks
```
Let the manager steer the AI and edit drafts.
1. Next to "Generate tasks with AI" add a text box "Instructions (optional)", for example "make it 8 tasks, focus on design first". Send it as body.instructions to /generate and add it to the prompt inside plan().
2. Let the manager edit a task's title, guide, alternative, priority and hours before publishing (inline form on the task card, saved with PATCH /api/tasks/:id, manager only).
3. Let the manager delete a task and add a manual task for any member.
Check: generate, edit a title, delete one, add one manually, publish, and the contributor sees the final version.
```

## Prompt 5: Skill profile and experience
```
Add a profile page.
1. Add "experience" (free text) to users, with safe migration.
2. PATCH /api/me to update name, skills and experience. Validate lengths.
3. Add a "Profile" button in the header that opens a form. Show a contributor's ID with a copy button.
4. Include experience in the member lines sent to the AI in plan().
Check: change skills, regenerate tasks, and the assignments reflect the new skills.
```

## Prompt 6: Workload balancing view and whole-team re-plan
```
Improve re-planning.
1. Add a manager-only "Workload" card on the Tasks tab: for each member show open tasks, total hours, and a bar. Highlight anyone with more than 1.5 times the team average.
2. Add POST /api/projects/:id/rebalance that moves "todo" tasks (never submitted or done) from overloaded members to the least-loaded ones until the difference is at most 1 task. Return how many moved.
3. Add a "Rebalance" button that calls it and refreshes.
4. Keep the existing "Remove and replan" behaviour and notify affected members.
Check: give one member many tasks by reassigning, click Rebalance, and the bars even out.
```

## Prompt 7: Task comments and file proof
```
Add per-task comments and proof uploads.
1. New table comments(id, task_id, user_id, name, text, ts). Routes: GET and POST /api/tasks/:id/comments, allowed only for the manager of the project or the task's assignee.
2. Install multer. POST /api/tasks/:id/files accepts one file up to 5 MB (png, jpg, pdf, zip, txt only), saves it in uploads/ with a random name, and records it in a task_files table. Serve downloads only through an authenticated route, not as a public folder.
3. In each task card add a "Discuss" section (comments) and an "Attach proof" button. Show attached files to the manager.
4. Add uploads/ to .gitignore.
Check: contributor uploads a file, the manager can download it, an unrelated contributor cannot.
```

## Prompt 8: Polish and safety
```
Polish the app.
1. Replace every alert() with a small toast message, and confirm() with an inline confirm.
2. Add loading states to buttons that call the API, and disable them while waiting.
3. Add express-rate-limit on /api/login and /api/signup (10 attempts per 15 minutes per IP).
4. Add helmet with a content security policy that still allows Chart.js from cdnjs.cloudflare.com and Socket.io from the same origin.
5. Refuse to start in production if JWT_SECRET is missing or equals "change-me".
6. Make the layout work well on a 375px wide phone.
Check: log in with a wrong password 11 times and get blocked; open the app on a phone-sized window.
```

## Prompt 9: Better Work Distributor AI (Groq)
```
Improve the Work Distributor in plan() in server.js. It uses Groq's OpenAI-compatible chat completions API.
1. Keep response_format {type:"json_object"} and the {"tasks":[...]} shape.
2. Validate the AI output: each task needs title, assignee_uid (must be a real team member, otherwise assign to the least-loaded member), priority (high|medium|low), hours (number), guide, alt. Drop or repair bad items instead of crashing.
3. If parsing fails, retry once with a shorter prompt, then fall back to the demo tasks.
4. Limit the project description sent to the AI to 3000 characters.
5. Log a one-line summary of each generation (project id, task count, time taken), never the API key.
Check: set a wrong GROQ_MODEL in .env and confirm the app shows a clear error instead of crashing.
```

## Prompt 10: Deploy
```
Prepare the app to deploy on Render.
1. Make sure the app reads PORT from the environment and listens on 0.0.0.0.
2. Add a /health route that returns {ok:true}.
3. Write a short DEPLOY.md with exact steps for Render: build command, start command, environment variables (JWT_SECRET, GROQ_API_KEY, GROQ_MODEL), and how to attach a persistent disk for data.db.
4. List what I must change before real users arrive (HTTPS, backups, moving to PostgreSQL).
```

---

## Fix prompt (use any time something breaks)
```
Something is not working.
What I did: <steps>
What I expected: <result>
What happened: <result>
Error text from the browser console and from the terminal: <paste both>
First explain the cause in two sentences. Then make the smallest fix. Do not change unrelated code. Tell me how to re-test.
```

## Extra: a stronger Work Distributor prompt you can reuse
Paste this into plan() if you want more detailed output:
```
You are a project work distributor. Given a project theme, a description of exactly what is being built, and a team with skills, create a realistic task plan.
Rules: 8 to 15 tasks; every task is assigned to exactly one team member whose skills fit; keep hours balanced within 25% across people; order tasks so earlier ones unblock later ones; the guide is 3 to 6 numbered steps a beginner could follow; the alt is one genuinely different way to do the same task.
Return only JSON: {"tasks":[{"title","assignee_uid","priority","hours","due_days","depends_on_index","guide","alt"}]}
```
