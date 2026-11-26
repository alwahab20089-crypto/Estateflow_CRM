# EstateFlow CRM

A modern CRM for real estate professionals: leads, contacts, property listings, deals, tasks, follow-ups, automation and team performance in one place.

## Edition

EstateFlow is a **self-hosted** CRM. You deploy it with Docker Compose on your own infrastructure. There is no hosted SaaS edition, no subscriptions and no payment provider.

An install has one organization, created by first-run setup. What it may do (member, lead, property and deal limits; analytics, CSV export, automations, advanced notifications) comes from a **signed license key** that the owner pastes in Settings. Keys are verified offline; no license server is involved. See `docs/SELF_HOSTED.md`.

## Target customers

Independent agents, property dealers, agencies, property consultants, and small-to-medium real estate teams.

## Technology stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form, Zod, Recharts, Lucide Icons
- **Backend:** Node.js, Express, TypeScript, MongoDB, Mongoose, JWT + refresh tokens, Zod, argon2
- **Quality:** Git, ESLint, Prettier, Vitest, Supertest

## Architecture overview

A **modular monolith** in an npm-workspaces monorepo:

- `apps/api` - Express API, organized by business module
- `apps/web` - React SPA, organized by feature
- `packages/shared` - Zod schemas, enums, and types shared by both apps
- `packages/config` - shared TypeScript/ESLint configuration

See `docs/SYSTEM_ARCHITECTURE.md`.

## Prerequisites

- Node.js 20+
- npm 10+
- Git
- Docker and Docker Compose

MongoDB 7 is provided through Docker Compose, including the replica-set configuration the application needs for transactions.

## Documentation

All design documents live in `docs/`:

1. `PRODUCT_REQUIREMENTS.md`
2. `SYSTEM_ARCHITECTURE.md`
3. `DATABASE_SCHEMA.md`
4. `API_SPECIFICATION.md`
5. `MULTI_TENANCY.md`
6. `AUTHENTICATION_AND_SECURITY.md`
7. `BUSINESS_RULES.md`
8. `ANALYTICS_METRICS.md`
9. `SELF_HOSTED.md`
10. `DEVELOPMENT_ROADMAP.md`

## Development phases

See `docs/DEVELOPMENT_ROADMAP.md` for the status of each phase.

## Configuring the project

### 1. Clone the repository

```bash
git clone https://github.com/alwahab20089-crypto/Estateflow_CRM.git
cd Estateflow_CRM
```

### 2. Start MongoDB

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

The MongoDB container uses a persistent Docker volume and initializes the `rs0` replica set through its health check.

### 3. Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Application environment | `development` |
| `PORT` | API server port | `4000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/estateflow` |
| `JWT_ACCESS_SECRET` | Secret used to sign access tokens | Required |
| `JWT_REFRESH_SECRET` | Secret used to sign refresh tokens | Required |
| `JWT_ACCESS_EXPIRES_IN` | Access-token expiration | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh-token expiration | `7d` |
| `FRONTEND_URL` | Allowed frontend browser origin(s), comma separated | `http://localhost:5173` |
| `COOKIE_DOMAIN` | Cookie domain; leave empty in development | Empty |
| `LOG_LEVEL` | Logging level | `info` |
| `TRUST_PROXY` | Number of trusted reverse proxies | `0` |
| `AUTH_RATE_LIMIT_MAX` | Authentication rate limit | `20` |
| `LOGIN_FAILURE_LIMIT_MAX` | Login failure limit | `5` |
| `STORAGE_DRIVER` | File-storage driver | `local` |
| `UPLOAD_DIR` | Local upload directory | `uploads` |
| `EMAIL_PROVIDER` | `disabled`, `log` or `memory` | `disabled` |
| `LICENSE_PUBLIC_KEY` | Vendor's Ed25519 public key (PEM). Needed to activate a license | Empty |
| `LICENSE_GRACE_DAYS` | Days an install keeps working after its license ends | `14` |

Reminder and automation worker settings (`REMINDER_*`, `AUTOMATION_*`) are described in `docs/AUTHENTICATION_AND_SECURITY.md`.

Generate two different secrets of at least 32 characters for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Never commit `.env` files.

### 4. Install dependencies

```bash
npm install
```

### 5. Start development

```bash
npm run dev
```

The API runs on port `4000` and the frontend on `5173`, unless configured otherwise.

### 6. First run

Open the web app and create the owner account (registration works once; it closes after the first user). Then, as the owner, paste your license key on the License settings page (Phase 10b web).

## Issuing license keys (vendor)

```bash
cd apps/api
npm run license -- keygen --out ../../license-keys
npm run license -- issue --private-key ../../license-keys/license-private.pem --licensee "Customer" --edition PROFESSIONAL --days 365
```

Keep `license-private.pem` out of git and off customer machines. Put `license-public.pem` into `LICENSE_PUBLIC_KEY`.

## Docker MongoDB configuration

- MongoDB 7, replica set `rs0`, port `27017`, persistent volume `mongo-data`, health check that initializes the replica set.

```bash
docker compose -f docker/docker-compose.dev.yml down        # stop
docker compose -f docker/docker-compose.dev.yml down -v     # stop and DELETE local data
```

A production Docker Compose setup (web, api, mongo) is planned for Phase 10c.