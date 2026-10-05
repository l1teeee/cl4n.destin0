# Clandestino (cl4n.destin0) - Project Rules

Clandestino is a private dining / mystery reservation platform ("EL CLAN ESTA ABIERTO"). Reservation windows open briefly and spaces fill within seconds.

**Core invariant: the system must never overbook. Allocated seats can never exceed capacity.**

- Product spec: `docs/PRODUCT_REQUIREMENTS.md`
- Architecture: `docs/architecture/ADR-001-architecture.md`

This file narrows the global `~/.claude/CLAUDE.md`, and this file wins where the two differ. The global destructive-action and Clean Architecture rules still apply.

## 1. Deployment gate: LOCAL FIRST

The required sequence is: architecture, implementation, automated engineering tests, the app running locally, owner review, explicit owner approval. Only then come git push, Vercel and Railway.

Approval means the owner explicitly says something equivalent to "approved", "puedes subirlo", "puedes hacer deploy", "haz push" or "publicalo". Approval of earlier changes does not carry over.

**Forbidden until approved:**
- pushing to GitHub
- deploying to Vercel or Railway
- creating any production deployment
- pointing a production domain
- modifying any existing production environment
- exposing the app publicly

**Allowed:** local git init, commits and branches; deployment config files and env templates; running the app and tests locally; local development infrastructure.

The GitHub repo `https://github.com/l1teeee/cl4n.destin0` is PUBLIC, so anything pushed becomes public. Never commit secrets. A local `.git/hooks/pre-push` hook blocks every push unless `CL4N_PUSH_AUTHORIZED=1` is set. After owner approval, set it only for that single push command.

**After owner approval only:**
1. Run a final technical review at the highest verified effort (`critical-reviewer`, xhigh). It covers only reservation integrity, concurrency, security, environment separation, migrations, production configuration, secrets and DB connectivity. It is not QA.
2. Then push, configure Railway and Vercel, set env vars, run production migrations, deploy and verify technical service health.

Never silently modify production after deployment.

## 2. QA policy

There is no AI QA phase. Do not create a QA agent, role, milestone or checklist. Do not do manual, visual, UX, browser or device QA, or acceptance testing / UAT. The owner does QA personally during owner review.

Automated engineering tests are not QA, and they are mandatory: unit, integration, API, database, concurrency, race-condition, idempotency and authorization tests, plus typecheck, lint, build validation and reservation-engine load tests.

Never claim "QA passed", "production approved", "user acceptance passed" or "ready for production" unless the owner said so. The engineering workflow ends at **READY FOR OWNER REVIEW**.

## 3. Models and roles

- **Orchestrator: Claude Opus, main session, effort high.** Owns architecture, orchestration, technical planning, product/domain modeling, task decomposition, DB strategy, concurrency decisions, security architecture and research synthesis. Reviews Codex output and decides whether the architecture or the implementation must change. It plans and reviews and never writes implementation code.
- **Researcher: Claude Sonnet, `researcher` subagent, effort medium, read-only.** Covers official docs, technology and library comparisons, and Railway, Vercel and PostgreSQL research. It reports to Opus and Opus decides.
- **Implementer: Codex `gpt-5.6-sol`, the ONLY code-writing agent.** Effort medium for normal work and high for critical work.
- **Critical reviewer: Claude Opus, `critical-reviewer` subagent, at the highest verified effort (xhigh).** Used only for production-critical concurrency review, DB integrity, race conditions, security review, difficult architecture decisions, critical failures and the final technical review before a deployment.

If Codex is unreachable, stop and tell the owner. Never fall back to opencode, Sonnet or Haiku for code.

Opus cannot change its own effort mid-session. For xhigh-level work, delegate to `critical-reviewer` with a self-contained brief, or ask the owner to switch the session with `/model`.

## 4. Codex invocation and effort

Run Codex with a surgical brief (exact files, the change and success criteria) piped on stdin. On this machine this exact sandbox setup is verified to work:

```
codex exec -m gpt-5.6-sol -c model_reasoning_effort=<medium|high> -c approval_policy=never \
  -s workspace-write -c sandbox_workspace_write.network_access=true -c 'windows.sandbox="unelevated"' \
  --add-dir "C:/Users/aleja/AppData/Local/npm-cache" -C <repo-or-worktree> -o <result.md> - < brief.md
```

- The default elevated Windows sandbox fails here with `helper_unknown_error`, so use the unelevated one.
- `codex exec resume <session-id>` (for example after a usage limit) does not accept `-s`, `-C` or `--add-dir`. `cd` into the worktree and pass `-c sandbox_mode=workspace-write -c 'sandbox_workspace_write.writable_roots=["C:/Users/aleja/AppData/Local/npm-cache"]'` instead.
- Never use `--dangerously-bypass-approvals-and-sandbox`, because the Vercel and Railway CLIs are installed and logged in on this machine.
- Always set the effort explicitly, because the global Codex config defaults to high.

- **medium:** scaffolding, UI components, forms, admin tables, CRUD, ordinary TypeScript, normal API endpoints, documentation and refactors with a clear spec.
- **high:** PostgreSQL concurrency, reservation allocation, SQL transactions, atomic capacity updates, idempotency, DB constraints, authentication, authorization, security-sensitive endpoints, rate limiting, race-condition handling, migrations that affect reservation integrity, and concurrency and load tests.

If a medium task fails twice or reveals unexpected complexity, re-run it at high. If high fails, or agents disagree, Opus reviews. If the issue touches data integrity, security, concurrency, money, capacity or production reliability, Opus may escalate to `critical-reviewer`.

## 5. Workflows

**Default workflow:**
1. Opus plans and decomposes the work.
2. Sonnet researches when needed, and Opus decides.
3. Codex implements and runs the tests.
4. Opus reviews against the checklist below.
5. If accepted, Opus commits locally and continues. If rejected, Codex fixes it and Opus reviews again.

**Reservation engine workflow:**
1. Opus designs and approves the concurrency and transaction strategy before any engine code exists.
2. Codex at high implements the engine and the concurrency tests.
3. Run these tests:
   - **A.** Capacity 20, 100 simultaneous requests, party size 1. Allocated must be 20 and oversold 0.
   - **B.** Capacity 20, 1,000 simultaneous requests, party size 1. Allocated must be at most 20 and oversold 0.
   - **C.** Capacity 20 with 19 allocated, 50 concurrent requests of party size 2. There must be 0 new reservations.
   - **D.** Mixed party sizes of 1, 2, 3 and 4. Allocated seats must never exceed capacity.
4. Any result of capacity + 1 rejects the implementation as a critical engineering bug. Codex at high fixes it and the tests run again.

**Review checklist:** correctness, architecture consistency, DB integrity, transaction safety, security, race conditions, error handling, test quality, unnecessary complexity and the global Clean Architecture rules.

If the implementation differs from the architecture decision, say explicitly which case applies:
- A. The implementation is wrong, so it goes back to Codex.
- B. The architecture should change, so update the ADR.

Never diverge silently.

## 6. Milestones

0. Architecture: research, then the ADR. No owner approval is needed unless a major blocker appears.
1. Project foundation: Next.js, TypeScript, lint, format, Tailwind, env config, DB layer, local PostgreSQL, migrations, auth foundation and project structure. The app runs locally.
2. Event domain: create, edit, open, close, scheduling and capacity rules.
3. Public experience: closed and open states, event info, the CTA and the reservation form. Minimal styling.
4. Reservation engine (Codex high): validation, duplicates, idempotency, atomic allocation, state checks, party size, timestamps and domain errors.
5. Concurrency (Codex high): Tests A-D, which must show zero overselling.
6. Admin UI: dashboard, capacity display, reservation list and detail, event controls and audit log view.
7. Security engineering (Codex high): admin auth, authorization, rate limits, bot protection, validation, safe errors, secret handling and security tests.
8. **Local review build: the STOP POINT.**
   1. Install, start the DB, migrate and seed the demo event and dev admin.
   2. Start the dev server and confirm it boots.
   3. Run all tests, the concurrency tests, typecheck, lint and the production build.
   4. Give the owner the exact URLs.

Do not ask for permission between ordinary milestones. Interrupt the owner early only for:
- a genuine architecture blocker
- missing access
- an irreversible operation
- a security-sensitive decision that needs owner input
- a requirement that materially changes the product

## 7. Owner review handoff

At Milestone 8, STOP. Do not push or deploy. Present **PROJECT READY FOR OWNER REVIEW** with:

1. Local public URL
2. Local admin URL
3. Development credentials
4. Implemented features
5. Architecture summary
6. Database strategy
7. Reservation concurrency strategy
8. Automated tests executed
9. Concurrency test results
10. Known technical limitations
11. Files that need design refinement
12. Restart commands
13. `git status`
14. Local commit history

Then WAIT. Implement any owner-requested design, text, form, admin, flow or functionality changes locally, and return to READY FOR OWNER REVIEW. Repeat until explicit deployment approval.

## 8. Git

- Keep a local repo with `origin` set to `https://github.com/l1teeee/cl4n.destin0`. No push before approval.
- The owner has authorized local commits. Claude commits locally after each accepted milestone using conventional messages (`feat: ...`, `test: ...`, `chore: ...`). Codex never commits or pushes.
- Parallel Codex work uses worktrees at `../cl4n.destin0-worktrees/codex-<slug>` on branch `agent/codex/<slug>`. Track it in `.agents/tasks.md`, which is gitignored. Merge only after the branch passes the full check gate.

## 9. Secrets and environment

- `.env.example` documents every variable. Never commit `.env`, `.env.local`, `.env.*.local`, Railway or Vercel secrets, or production credentials.
- Local development never touches a production database.
- These governance files must stay tracked: `CLAUDE.md`, `AGENTS.md`, `.claude/agents/researcher.md` and `.claude/agents/critical-reviewer.md`.

## 10. Definition of engineering complete

- The local app and admin run.
- An event can be created, its capacity configured, and it can be opened and closed.
- The public state changes correctly, and the reservation form works.
- Capacity is atomically protected.
- Idempotency, the duplicate policy, audit logging and auth all work.
- The rate limiting and bot protection foundation works.
- Automated tests pass, and the concurrency tests prove zero overselling.
- The production build compiles.
- The README, `.env.example` and local startup instructions exist.

The final status is READY FOR OWNER REVIEW. It is not QA PASSED, not PRODUCTION APPROVED and not DEPLOYED.
