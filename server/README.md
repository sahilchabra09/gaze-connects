# GazeCore Backend

A type-safe, production-ready backend built with **Elysia**, **Drizzle ORM**, **Better Auth**, and **TypeBox** validation.

## 🏗️ Architecture

```
backend/
├── src/
│   ├── db/
│   │   ├── index.ts       # Database connection & exports
│   │   └── schema.ts      # Drizzle table definitions
│   ├── lib/
│   │   ├── auth.ts        # Better Auth configuration
│   │   ├── logger.ts      # Shared structured logger
│   │   └── schemas.ts     # Request/response validation schemas
│   └── index.ts           # Elysia server entry point
├── drizzle/               # Auto-generated migrations
├── .env                   # Environment variables
└── drizzle.config.ts      # Drizzle configuration
```

## ✨ Key Features

### 🔐 Authentication
- **Email/Password** signup & signin
- **Google OAuth** with refresh token support
- **Better Auth** with Drizzle adapter for database integration
- Session management with email verification

### 📊 Database
- **Drizzle ORM** with PostgreSQL
- **TypeBox schemas** for automatic validation
- **Relations** for efficient joins (experimental feature enabled for 2-3x performance)
- Auto-generated migrations

### ✅ Validation & Documentation
- **TypeBox** for type-safe request/response validation
- **Swagger/OpenAPI** docs at `/docs`
- **Route grouping** for auth and user endpoints

## 🚀 Quick Start

### Prerequisites
- Bun runtime
- PostgreSQL (Neon recommended)

### Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Fill in your secrets
BETTER_AUTH_SECRET=your_secret_key
DATABASE_URL=postgresql://...
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

### Installation & Running

```bash
# Install dependencies
bun install

# Push schema to database
bun run db:push

# Start development server
bun src/index.ts

# Alternative: watch mode
bun run dev
```

## 📝 API Routes

### Swagger Docs

OpenAPI docs are available at `/docs`. Auth routes are grouped under `Auth`, and app routes are grouped under `Users`.

### Authentication Routes

```
GET|POST /api/auth/get-session
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
POST /api/auth/sign-in/social
GET|POST /api/auth/callback/:id
GET /api/auth/verify-email
POST /api/auth/request-password-reset
POST /api/auth/reset-password
POST /api/auth/change-password
POST /api/auth/change-email
POST /api/auth/update-session
POST /api/auth/update-user
POST /api/auth/revoke-session
POST /api/auth/revoke-sessions
POST /api/auth/delete-user
GET /api/auth/delete-user/callback
```

## 🗄️ Database Models

All tables are type-safe with Drizzle ORM:

- **user** - User accounts with email, name, image
- **session** - User sessions with token & expiry
- **account** - OAuth accounts with refresh tokens
- **verification** - Email verification tokens

## 🔧 Available Commands

```bash
# Development
bun src/index.ts              # Run server
bun run dev                   # Run with watch mode
bun run typecheck             # TypeScript check

# Database
bun run db:push              # Sync schema to DB
bun run db:studio            # Open Drizzle Studio
bun run db:generate          # Generate migrations

# Production
bun run build                # Build for production
bun run start                # Run production build
```

## 🛠️ Adding New Routes with Validation

Example: Adding a new route with TypeBox validation

```typescript
import { Elysia } from "elysia";
import { authSchemas } from "./lib/schemas";

new Elysia()
  .post(
    "/api/users/profile",
    async ({ body }) => {
      // body is automatically validated against schema
      return { user: body };
    },
    {
      body: authSchemas.user,
      response: authSchemas.authResponse,
    }
  )
```

## 🔗 Frontend Integration

Connect your Vite frontend using **Eden Treaty** for end-to-end type safety:

```typescript
import { treaty } from "@elysiajs/eden";
import type { App } from "../backend/src/index";

const app = treaty<App>("http://localhost:8000");

// Fully typed API calls with autocomplete
const { data, error } = await app.api.auth.signin.post({
  email: "user@example.com",
  password: "password123",
});
```

## 📚 Documentation

- [Elysia Docs](https://elysiajs.com)
- [Drizzle Docs](https://orm.drizzle.team)
- [Better Auth Docs](https://www.better-auth.com)
- [TypeBox Docs](https://github.com/sinclairzx81/typebox)

## 🚢 Production Deployment

1. **Set environment variables** on your hosting platform
2. **Build the project**: `bun run build`
3. **Run migrations**: `bun run db:push`
4. **Start server**: `bun run start`

## 📄 License

MIT
