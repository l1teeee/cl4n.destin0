# Clandestino

Clandestino is a private dining reservation platform built as one Next.js application with a
PostgreSQL source of truth. This milestone contains only the project and infrastructure wiring.

## Prerequisites

- Node.js 24 or newer
- npm
- Windows, macOS, or Linux on a platform supported by `embedded-postgres`

No Docker, WSL, global PostgreSQL installation, or administrator access is required for the local
database.

## Local setup

PowerShell:

```powershell
npm install
Copy-Item .env.example .env.local
npm run db:start
npm run db:migrate
npm run dev
```

Bash:

```bash
npm install
cp .env.example .env.local
npm run db:start
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The health endpoint is available at
`http://localhost:3000/api/health`.

The local PostgreSQL 18 server listens only on `127.0.0.1:54329`. Its data lives under `.local/`.
Start and stop it with:

```text
npm run db:start
npm run db:status
npm run db:stop
```

## Scripts

| Command                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `npm run dev`          | Run plain `next dev`                                         |
| `npm run build`        | Create a production build locally                            |
| `npm run start`        | Run a completed Next.js build                                |
| `npm run lint`         | Run ESLint                                                   |
| `npm run format`       | Format supported files with Prettier                         |
| `npm run format:check` | Check formatting without changing files                      |
| `npm run typecheck`    | Run TypeScript without emitting files                        |
| `npm run test`         | Run unit and integration tests serially                      |
| `npm run test:agent`   | Run tests in the agent sandbox only                          |
| `npm run db:start`     | Initialize if needed and start local PostgreSQL              |
| `npm run db:stop`      | Stop local PostgreSQL with a fast shutdown                   |
| `npm run db:status`    | Show local PostgreSQL status, port, and data directory       |
| `npm run db:generate`  | Generate Drizzle migrations from the schema                  |
| `npm run db:migrate`   | Apply Drizzle migrations explicitly                          |
| `npm run check`        | Run typecheck, lint, format check, tests, and build in order |

## Secrets and deployment

Nothing is deployed by this repository setup. This repository is public. Never commit `.env.local`,
database credentials, Sentry tokens, Turnstile production keys, or any other secret. Keep
`.env.example` limited to documented placeholders and safe local development values.
