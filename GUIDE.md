# Bright Llama: step-by-step guide

## What you already have (about 50%)
Working today: sign-up and login for two roles, unique IDs (CON-12345 / MGR-12345), project creation with a theme, team search by ID or name, teams shown on each contributor's profile, real-time team chat, AI task generation (manager-only draft, then publish), per-user task lists with "how to do it" and alternatives, check-off with manager approval, dot visualisation, progress bar chart, and re-planning when a member is removed.

Still to build (the other ~50%): see Part 4.

## Part 1: Run it on your computer (15 minutes)
1. Install **Node.js 20 or newer** from nodejs.org. Check with `node -v`.
2. Unzip the project and open a terminal inside the `bright-llama` folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and open it. Set `JWT_SECRET` to any long random text.
5. (Optional, for real AI) get a free key at console.groq.com, then paste it as `GROQ_API_KEY`. Without a key the app creates simple demo tasks so you can still test everything.
6. Run `npm start` and open http://localhost:3000.

## Part 2: Test the whole flow
1. Open a normal window and sign up as a **project manager**.
2. Open a private window and sign up as a **contributor**. Note the ID shown at the top (CON-xxxxx). Repeat in another browser for a second contributor.
3. As manager: create a project (title, theme, what you are building).
4. Open the project, go to **Team**, search the contributor's ID and click Add.
5. Go to **Tasks**, click **Generate tasks with AI**, review them (you can reassign each one), then click **Publish to team**.
6. As contributor: open the team on your home page, read a task's guide, tick it done.
7. As manager: click **Approve**. The dots turn green and **Progress** updates.
8. Open **Chat** in both windows and send a message.
9. In **Team**, click "Remove and replan tasks" to see re-planning.

## Part 3: How the code is organised
- `server.js`: all the backend (database, login, API, AI call, chat). Search it for the comments `---------- Auth`, `Projects`, `Work Distributor AI`, `Tasks`, `Team chat`.
- `public/index.html`: all the screens. `authView` is login, `home` is the dashboard, `proj` is the project page with its four tabs.
- `data.db`: created automatically on first run. Delete it to reset everything.

## Part 4: Finishing the other 50%
Easiest way: open `PROMPTS.md` and paste its prompts into your coding agent one at a time. The list below explains what each step does.
Do these in order, one at a time, testing after each.

1. **Deadlines and overdue dots.** Add a `due` column to `tasks` in `server.js`, accept it from the AI (add `"due_days"` to the prompt), show it on each task, and add a red dot style `.dot.overdue` when the date has passed.
2. **Task dependencies.** Add a `depends_on` column. In the PATCH route, refuse "submitted" if the task it depends on is not done.
3. **Notifications.** Create a `notifications(user_id, text, read)` table. Insert a row when tasks are published, a task is approved, or a member is added. Add `GET /api/notifications` and a bell icon in the header.
4. **Regenerate with feedback.** Add a text box next to "Generate" so the manager can say "make it fewer tasks" and pass it into the prompt in `plan()`.
5. **Skill profile editing.** Add a profile page with `PATCH /api/me` to update skills and experience.
6. **Whole-team re-plan.** Extend `/replan` to also rebalance when someone is overloaded (move `todo` tasks from the most loaded to the least loaded person).
7. **Task comments and file uploads.** New `comments` table; for files use the `multer` package and store them in an `uploads/` folder.
8. **Polish.** Replace the `alert()` pop-ups with toasts, add loading states, and split `index.html` into components (or move to React) once it grows.
9. **Security checks before going public.** Always set a strong `JWT_SECRET`, add `express-rate-limit` on login, and serve over HTTPS.

## Part 5: Put it online
1. Push the folder to GitHub (the `.gitignore` already hides `node_modules`, `.env` and `data.db`).
2. Create a web service on **Render** or **Railway**, connect the repository.
3. Build command: `npm install`. Start command: `npm start`.
4. Add `JWT_SECRET` and `GROQ_API_KEY` in the host's environment settings. Never commit them.
5. Add a persistent disk for `data.db`, or switch to PostgreSQL once you have real users.

## Common problems
- **Port already in use:** set `PORT=4000` in `.env`.
- **better-sqlite3 fails to install:** update Node to the latest LTS and run `npm install` again.
- **AI request failed:** check the Groq key. If the model name is rejected, set `GROQ_MODEL` in `.env` to a current model from console.groq.com/docs/models.
- **Chat not updating:** refresh both windows; chat only works for people on the project's team.
