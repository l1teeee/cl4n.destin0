# Clandestino (cl4n.destin0) - worker rules

Read by Codex and by Gemini (agy). It extends your global worker contract. Read `docs/PRODUCT_REQUIREMENTS.md` and `docs/architecture/ADR-001-architecture.md` before changing domain, reservation or data code.

## Role
- Claude Opus orchestrates and owns every design decision. Implement the brief exactly. If the brief conflicts with an ADR, or the ADR looks wrong for the task, stop and report the conflict. Do not choose on your own.

## Deployment gate
- Never push, deploy to Vercel or Railway, create deployments, touch production environments, domains or databases, or expose the app publicly. Deployment config files and env templates are fine.
- Use only the local PostgreSQL described in the ADR. Never write real secrets; `.env.example` holds placeholders and documented local values only.

## Checks
- Run exactly the brief's Checks and report the commands, pass/fail counts and the first failure lines. Never call a task done while a check fails or was skipped without saying so.
- Tests: inside the Codex sandbox use `npm run test:agent` and `npm run test:concurrency:agent`; elsewhere `npm run test` and `npm run test:concurrency`. Always add `-- --maxWorkers=2` (low RAM).
- `npm run db:generate` and `next dev` fail inside the Codex sandbox (spawn EPERM). If a step needs them, stop and report.
- Never claim "QA passed", "production approved", "user acceptance passed" or "ready for production". Engineering ends at READY FOR OWNER REVIEW.

## Reservation integrity
- The system must never overbook. Any path that could allocate more seats than capacity, partially allocate a party, or allocate twice for one idempotency key is a critical defect, not an edge case.
- The database is authoritative. Never trust client-provided event IDs, capacity, availability, price, timestamps or statuses. Use DB time, stored in UTC.
- Test concurrent paths against a real PostgreSQL, never mocks or PGlite. Follow the lock order defined in the ADR.

## Environment
- Windows 11, no Docker, no WSL. package.json scripts must work under npm on Windows: no bash-only syntax.
- Spanish UI text must stay valid UTF-8; `tests/unit/source-encoding.test.ts` catches broken accents.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
