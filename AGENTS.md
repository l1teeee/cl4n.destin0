# Clandestino (cl4n.destin0) - Codex rules

This file extends `~/.codex/AGENTS.md`. Read `docs/PRODUCT_REQUIREMENTS.md` and `docs/architecture/ADR-001-architecture.md` before implementing anything.

## Role
- You (Codex, gpt-5.6-sol) are the ONLY code-writing agent. Claude Opus orchestrates and has architectural authority. Claude Sonnet only does research.
- Implement exactly what the brief says. If the brief conflicts with the ADR, or the ADR looks wrong for the task, stop and report the conflict. Do not choose on your own.
- Never run `git commit`, `git push` or any history-rewriting git command. Leave changes in the working tree.

## Deployment gate
- Never push to GitHub, deploy to Vercel or Railway, create deployments, touch production environments or domains, or expose the app publicly. You may write deployment config files and env templates only.
- Never connect to a remote or production database. Use only the local PostgreSQL described in the ADR.
- Never commit or write real secrets. `.env.example` holds placeholders and documented local dev values only.

## Testing
- Automated engineering tests are mandatory and are not QA. After every task, run the relevant tests plus typecheck, lint and build when they apply. Report the exact commands, the pass/fail counts and any failure output. Never call a task done while tests are failing or skipped without saying so explicitly.
- Never claim "QA passed", "production approved", "user acceptance passed" or "ready for production". Engineering ends at READY FOR OWNER REVIEW.

## Reservation integrity
- The system must never overbook. Any path that could allocate more seats than capacity, partially allocate a party, or allocate twice for one idempotency key is a critical defect, not an edge case.
- The database is authoritative. Never trust client-provided event IDs, capacity, availability, price, timestamps or statuses. Use DB time, stored in UTC.
- Test concurrent paths against a real PostgreSQL, not mocks, and never against PGlite.
- Follow the lock order defined in the ADR.

## Environment
- The dev machine runs Windows 11 with no Docker and no WSL. Scripts must work under npm on Windows: no bash-only syntax in package.json scripts.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
