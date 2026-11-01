# Clandestino (cl4n.destin0) - project rules

Private dining / mystery reservation platform ("EL CLAN ESTA ABIERTO"). Reservation windows open briefly and seats fill within seconds.

**Core invariant: the system must never overbook. Allocated seats can never exceed capacity.**

- Product spec: `docs/PRODUCT_REQUIREMENTS.md`. Architecture: `docs/architecture/` (ADR-001 first).
- Live work state: `.agents/HANDOFF.md` and `.agents/tasks.md`.

This file narrows the global `~/.claude/CLAUDE.md`; its roles, routing, gate, git and Clean Architecture rules apply here.

## 1. Deployment gate: local first
- Order: implementation, gate, app running locally, owner review, explicit owner approval. Only then git push, Vercel and Railway.
- Approval means the owner explicitly says something like "approved", "puedes subirlo", "puedes hacer deploy", "haz push" or "publicalo". Approval of earlier changes does not carry over.
- Forbidden until approved: pushing to GitHub, deploying to Vercel or Railway, creating any production deployment, pointing a production domain, modifying any production environment, exposing the app publicly.
- Allowed: local commits and branches, deployment config files and env templates, running the app and tests locally.
- The GitHub repo `https://github.com/l1teeee/cl4n.destin0` is PUBLIC: anything pushed becomes public. Never commit secrets. `.git/hooks/pre-push` blocks every push unless `CL4N_PUSH_AUTHORIZED=1`; after approval set it only for that single push command.
- After approval only: (1) the brain runs the final technical review itself with skill `critical-review`, after asking the owner to set `/effort max`. Scope: reservation integrity, concurrency, security, environment separation, migrations, production config, secrets and DB connectivity. It is not QA. (2) Then push, configure Railway and Vercel, set env vars, run production migrations (memory `deployment-decisions`), deploy and verify service health.
- Never silently modify production after a deployment.

## 2. Verification
- No AI QA of any kind; the owner does QA during owner review.
- Gate for every task: `npm run typecheck`, `npm run lint`, `npm run format:check`; plus `npm run build` before merging to main.
- Critical lane in this project: reservation allocation, capacity, waitlist and cola promotion, idempotency, transactions and locks, auth and authorization, rate limits and bot protection, migrations, payments, message delivery. It also runs `npm run test -- --maxWorkers=2` and `npm run test:concurrency -- --maxWorkers=2`, and the brain reviews the diff with skill `critical-review` before merge.
- Reservation engine tests that must stay green. Any capacity + 1 result is a critical bug that rejects the change:
  - A. Capacity 20, 100 simultaneous requests, party size 1: allocated 20, oversold 0.
  - B. Capacity 20, 1,000 simultaneous requests, party size 1: allocated at most 20, oversold 0.
  - C. Capacity 20 with 19 allocated, 50 concurrent requests of party size 2: 0 new reservations.
  - D. Mixed party sizes 1 and 2: allocated seats never exceed capacity.
- Engine changes: the brain designs and approves the concurrency and transaction strategy first; Codex `gpt-6.1-sol` high implements it with its tests.
- If an implementation differs from the architecture, say which case applies: A. the implementation is wrong (back to the hand) or B. the architecture should change (update the ADR). Never diverge silently.
- Never claim "QA passed", "production approved", "user acceptance passed" or "ready for production". Engineering ends at READY FOR OWNER REVIEW.

## 3. Hands in this project
- Briefs in `.agents/briefs/`, results in `.agents/runs/`. Every brief that touches Spanish text says: UTF-8, edit with the editing tool, never PowerShell Set-Content or Out-File. Before merge, scan the diff for U+FFFD.
- Codex sandbox: tests use the `:agent` script variants; `npm run db:generate` and `next dev` fail (spawn EPERM), so those steps go to `worker-sonnet`.
- New worktree: `bash .agents/briefs/make-worktree.sh <name> <branch> <db-suffix> <port> [base]` (own DBs, log email and messaging, `npm ci`). Stop the embedded Postgres before `npm ci` in main (memory `npm-ci-local-db-lock`).

## 4. Owner review stop point
When a phase is ready: start the DB (`npm run db:start`), migrate, seed, start the dev server and confirm it boots, run the gate, the critical-lane tests and the production build, then STOP. Present READY FOR OWNER REVIEW with skill `owner-review`. Do not push or deploy. Implement owner-requested changes locally and return to READY FOR OWNER REVIEW until explicit deployment approval.

## 5. Git
- `origin` is `https://github.com/l1teeee/cl4n.destin0`. No push before approval.
- The owner authorized local commits: Claude commits locally after each accepted task or phase, with conventional messages (`feat:`, `fix:`, `test:`, `chore:`).

## 6. Secrets and environment
- `.env.example` documents every variable. Never commit `.env`, `.env.local`, `.env.*.local`, Railway or Vercel secrets or production credentials.
- Local development never touches a production database, except the owner's read-only launcher (memory `local-dev-points-to-railway-prod`).
- Tracked governance files: `CLAUDE.md`, `AGENTS.md`, `.claude/agents/researcher.md`, `.claude/skills/owner-review/SKILL.md`.

## 7. Definition of engineering complete
- Local app and admin run. Events can be created, configured, opened and closed. Public state and the reservation form work.
- Capacity is atomically protected. Idempotency, the duplicate policy, audit logging, auth, rate limiting and bot protection work.
- Gate and critical-lane tests pass, concurrency tests prove zero overselling, the production build compiles.
- README, `.env.example` and local startup instructions exist.
- Final status: READY FOR OWNER REVIEW, not QA PASSED, PRODUCTION APPROVED or DEPLOYED.
