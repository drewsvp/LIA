-- auth-schema.sql
-- Better Auth provider tables (better-auth 1.6.x core + magic-link plugin,
-- which needs no tables beyond "verification"). Auth infrastructure, applied
-- idempotently by `npm run db:apply-auth-schema` — NOT a numbered migration;
-- migrations/0001_initial_schema.sql remains untouched.
--
-- Written by hand because the @better-auth/cli generator is blocked by the
-- package firewall (its pinned better-auth 1.4.x has a critical CVE). Shape
-- matches the 1.6.x default Kysely/Postgres schema: camelCase columns, text
-- ids. The application never reads these tables except through
-- server/dal/auth-provider.ts, and users.auth_subject stores "user".id.
--
-- No RLS here: Better Auth is the only writer/reader and its queries run
-- outside withDbContext.

create table if not exists "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create table if not exists "session" (
  "id" text not null primary key,
  "expiresAt" timestamp not null,
  "token" text not null unique,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create index if not exists "session_userId_idx" on "session" ("userId");

create table if not exists "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  "scope" text,
  "password" text,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create index if not exists "account_userId_idx" on "account" ("userId");

create table if not exists "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamp not null,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create index if not exists "verification_identifier_idx" on "verification" ("identifier");
