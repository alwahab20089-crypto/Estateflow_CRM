# EstateFlow CRM

A modern CRM for real estate professionals: leads, contacts, property listings, tasks, follow-ups, and team performance in one place.

## Edition

EstateFlow is a **self-hosted** CRM. You deploy it with Docker Compose on your own infrastructure. There is no hosted SaaS edition, no subscriptions and no payment provider.

## Target customers

Independent agents, property dealers, agencies, property consultants, and small-to-medium real estate teams.

## Technology stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form, Zod, Recharts, Lucide Icons
- **Backend:** Node.js, Express, TypeScript, MongoDB, Mongoose, JWT + refresh tokens, Zod
- **Quality:** Git, ESLint, Prettier, Vitest, Supertest

## Architecture overview

A **modular monolith** in an npm-workspaces monorepo:

- `apps/api` - Express API, organized by business module
- `apps/web` - React SPA, organized by feature
- `packages/shared` - Zod schemas, enums, and types shared by both apps
- `packages/config` - shared TypeScript/ESLint configuration

See `docs/SYSTEM_ARCHITECTURE.md` for the system architecture.

## Prerequisites

- Node.js 20+
- npm 10+
- Git
- Docker
- Docker Compose

MongoDB 7 is provided through Docker Compose, including replica-set configuration required by the application.

## Documentation

All design documents live in `docs/`:

1. `PRODUCT_REQUIREMENTS.md`
2. `SYSTEM_ARCHITECTURE.md`
3. `DATABASE_SCHEMA.md`
4. `API_SPECIFICATION.md`
5. `MULTI_TENANCY.md`
6. `AUTHENTICATION_AND_SECURITY.md`
7. `BUSINESS_RULES.md`
8. `DEVELOPMENT_ROADMAP.md`

## Development phases

See `docs/DEVELOPMENT_ROADMAP.md`. Phase 1 (planning and architecture) is complete when these documents are reviewed and committed.

## Configuring the project

### 1. Clone the repository

```bash
git clone https://github.com/alwahab20089-crypto/Estateflow_CRM.git
cd Estateflow_CRM
```

### 2. Start MongoDB

Start the MongoDB replica set using Docker Compose:

```bash
docker compose up -d mongo
```

The MongoDB container uses a persistent Docker volume and initializes the `rs0` replica set through its health check.

### 3. Configure environment variables

Copy the environment template:

```bash
cp apps/api/.env.example apps/api/.env
```

Configure the environment variables in `apps/api/.env`:

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Application environment | `development` |
| `PORT` | API server port | `4000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/estateflow` |
| `JWT_ACCESS_SECRET` | Secret used to sign access tokens | Required |
| `JWT_REFRESH_SECRET` | Secret used to sign refresh tokens | Required |
| `JWT_ACCESS_EXPIRES_IN` | Access-token expiration | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh-token expiration | `7d` |
| `FRONTEND_URL` | Allowed frontend browser origin | `http://localhost:5173` |
| `COOKIE_DOMAIN` | Cookie domain; leave empty in development | Empty |
| `LOG_LEVEL` | Logging level | `info` |
| `TRUST_PROXY` | Number of trusted reverse proxies | `0` |
| `AUTH_RATE_LIMIT_MAX` | Authentication rate limit | `20` |
| `LOGIN_FAILURE_LIMIT_MAX` | Login failure limit | `5` |
| `STORAGE_DRIVER` | File-storage driver | `local` |
| `UPLOAD_DIR` | Local upload directory | `uploads` |

Generate two different secure secrets of at least 32 characters for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Never commit `.env` files.

### 4. Install dependencies

From the repository root:

```bash
npm install
```

### 5. Start development

```bash
npm run dev
```

The API runs on port `4000` and the frontend on port `5173`, unless configured otherwise.

## Docker MongoDB configuration

The MongoDB service uses:

- MongoDB 7
- Replica set `rs0`
- Port `27017`
- Persistent volume `mongo-data`
- Health check that initializes the replica set
- Data persistence across container restarts

To stop MongoDB:

```bash
docker compose down
```

To stop MongoDB and remove its persisted database volume (**this permanently deletes local MongoDB data**):

```bash
docker compose down -v
```

Never commit `.env` files. Secrets are always supplied through environment variables.