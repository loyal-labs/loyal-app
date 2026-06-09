# Database

Neon PostgreSQL integration using Drizzle ORM.

## Overview

| File                                | Purpose                          |
| ----------------------------------- | -------------------------------- |
| `src/lib/core/database.ts`          | Database connection singleton    |
| `../packages/db-core/src/schema.ts` | Shared Drizzle table definitions |
| `drizzle.config.ts`                 | Migration configuration          |

## Ownership and Boundaries

- `@loyal-labs/db-core`: shared Drizzle definitions and exported table types.
- `@loyal-labs/db-adapter-neon`: shared `createNeonDb()` adapter factory and Neon DB types.
- `src/lib/core/database.ts`: app-local `getDatabase()` wrapper; owns `serverEnv` resolution and singleton lifecycle.
- App code must import schema from `@loyal-labs/db-core/schema`.

The app now uses three separate database surfaces. Do not treat them as interchangeable.

| Database surface                     | Connection/config owner        | Schema/entrypoint                                                                           | What belongs there                                                                                                                                                                        |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Neon database                    | App and admin runtimes         | `src/lib/core/database.ts`; shared table definitions in `../packages/db-core/src/schema.ts` | Product data: users, Telegram communities, messages, summaries, encrypted bot threads/messages, wallet auth, app smart-account records, sponsorship analytics, admin-readable app state   |
| Yield Neon database (`loyal_yield`)  | Yield optimization server code | `../frontend/src/lib/yield-optimization/yield-neon-client.server.ts`                        | Yield control-plane data: route policies, managed vaults, vault/reserve snapshots, rebalance decisions, confirmed user yield positions, immutable confirmed deposit and withdrawal events |
| Kamino Timescale database (`kamino`) | Kamino market-data readers     | `../frontend/src/lib/kamino/timescale-reserve-client.server.ts`                             | Read-only reserve telemetry: Kamino reserve updates and latest reserve rows used for earn forecasts and safe/no-fee target selection                                                      |

### App Neon

Use App Neon for app-owned product state. New app tables should be defined in `../packages/db-core/src/schema.ts`, queried through `getDatabase()`, and migrated with the app Drizzle commands.

Typical rows include Telegram account state, community activity, stored messages, and generated summaries. This database also stores app wallet authentication, smart-account provisioning records, sponsorship analytics, and other product-plane audit rows.

### Yield Neon

Use Yield Neon for optimizer state that belongs to the `loyal_yield` schema. This database is shared with yield orchestration and should be accessed through server-only yield modules. Mainnet and devnet data live on separate long-lived Neon branches; each deployment points `NEON_DATABASE_URL` at the intended branch instead of filtering rows by a `cluster` column.

The shared optimizer tables include `route_policies` for detected or app-confirmed policy metadata and `managed_vaults` for active vault metadata tied to a smart-account settings PDA. Snapshot tables such as `vault_position_snapshots`, `vault_position_snapshot_positions`, and `vault_reserve_positions_current` are optimizer read models. `rebalance_decisions` stores optimizer decisions and execution status. App-confirmed user Earn positions are represented by `user_yield_positions`, keyed by `settings + vault_index + initial_reserve`; `user_yield_position_deposits`, keyed by `deposit_signature`; and `user_yield_position_withdrawals`, keyed by `withdrawal_signature`.

Confirmed yield deposits and withdrawals should be written only after the chain transaction is confirmed. The write flow should upsert policy and vault metadata, insert the immutable event idempotently, then update the aggregate position only when the event is new. Partial withdrawals decrement `principal_amount_raw`; full withdrawals close the aggregate position and mark the policy/vault inactive.

The Loyal web Earn UI reads active position state through `GET /api/smart-accounts/yield-optimization/position`. That route resolves the configured Solana environment to choose chain-specific constants, then looks up the active `user_yield_positions` row in the deployment's Yield Neon branch for the authenticated wallet, smart-account settings PDA, vault index `1`, and canonical Kamino USDC reserve.

### Kamino Timescale

Use Kamino Timescale as a read-only market-data source. It answers questions such as "which safe/no-fee reserve currently has the best APY?" or "what APY range should the UI forecast?" It must not store app users, smart-account settings, policies, vaults, or deposit confirmations.

### Cross-Database Rules

Do not join across these databases in SQL from app code. Keep each database behind its owning server module and combine results in typed application code only when a feature needs both product state and market or yield state.

Do not duplicate ownership. If a row describes app identity or product state, use App Neon. If it describes optimizer policy, vault, or position state, use Yield Neon. If it describes Kamino reserve telemetry, read it from Timescale.

## Usage

```typescript
import { getDatabase } from "@/lib/core/database";

const db = getDatabase();
const users = await db.select().from(usersTable);
```

## Schema Management

Define tables in `../packages/db-core/src/schema.ts`:

```typescript
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

App code should import schema from the shared entrypoint:

```typescript
import { users } from "@loyal-labs/db-core/schema";
```

## Migration Commands

Run from `/app` (migrations remain app-owned while schema lives in `../packages/db-core/src/schema.ts`):

| Command           | Description                             |
| ----------------- | --------------------------------------- |
| `bun db:generate` | Generate migrations from schema changes |
| `bun db:migrate`  | Apply migrations to database            |
| `bun db:studio`   | Open Drizzle Studio GUI                 |

## Workspace Notes

- Run installs from repository root: `bun install`.
- If Drizzle type identity conflicts appear (for example duplicate `drizzle-orm` types), remove app-local `node_modules` and reinstall from root.
- Keep migration commands app-scoped: `cd app && bun db:generate` and `cd app && bun db:migrate`.

## Environment

Requires `DATABASE_URL` in `.env.local`:

```env
DATABASE_URL=postgresql://user:password@ep-xxx.aws.neon.tech/dbname?sslmode=require
```

See [Environment Variables](./environment-vars.md) for full setup.

## Schema Patterns

### Typed JSONB Columns

Use `.$type<T>()` for type-safe JSONB columns:

```typescript
// Array of objects
topics: jsonb("topics")
  .$type<{ title: string; content: string; sources: string[] }[]>()
  .notNull();

// Discriminated union (for encrypted content)
encryptedContent: jsonb("encrypted_content")
  .$type<EncryptedMessageContent>()
  .notNull();
```

### Relations Setup

Define relations separately from tables for type-safe eager loading:

```typescript
export const usersRelations = relations(users, ({ one, many }) => ({
  messages: many(messages),
  botThreads: many(botThreads),
  businessConnection: one(businessConnections),
}));

// Usage with type-safe `with:`
const user = await db.query.users.findFirst({
  where: eq(users.telegramId, telegramId),
  with: { botThreads: true },
});
```

### Type Exports

Always export both select and insert types:

```typescript
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
```

### Index Strategies

| Index Type        | Use Case                               | Example                                          |
| ----------------- | -------------------------------------- | ------------------------------------------------ |
| `uniqueIndex`     | Prevent duplicates, enforce uniqueness | `uniqueIndex().on(table.telegramId)`             |
| Composite `index` | Optimize multi-column queries          | `index().on(table.communityId, table.createdAt)` |
| Filter `index`    | Optimize status/flag filtering         | `index().on(table.isActive)`                     |

## Tables Reference

| Table                          | Purpose                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `admins`                       | Global admin whitelist for privileged community actions (activate/deactivate/settings)                  |
| `users`                        | Telegram users who interact with the bot                                                                |
| `communities`                  | Telegram communities tracked by the bot lifecycle; may be pre-activation/inactive                       |
| `communityMembers`             | Many-to-many: users ↔ communities                                                                       |
| `messages`                     | Chat messages from tracked communities                                                                  |
| `summaries`                    | AI-generated daily chat summaries with topics                                                           |
| `businessConnections`          | Telegram Business bot connections to user accounts                                                      |
| `botThreads`                   | Bot conversation sessions (supports Telegram threaded messages)                                         |
| `botMessages`                  | Individual encrypted messages within bot threads                                                        |
| `telegramHelperMessageCleanup` | Queue of helper/community bot messages scheduled for delayed deletion (idempotent by chat + message id) |
