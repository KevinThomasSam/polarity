# Phase 2: discussions, positions, arguments, and mind changes

## Existing baseline and scope

`001_initial.sql` already has mutable current `positions` and basic `arguments`. `src/app/api/discussions/[id]/position/route.ts` currently overwrites a position with no history. `src/lib/db.ts` applies versioned SQL through PGlite; the SQL below is PostgreSQL 14+ and PGlite compatible. This document plans Phase 2; only migration/build step 1 is implemented with this amendment.

## Exact migration: `002_discussion_integrity.sql`

```sql
CREATE TABLE position_changes (
  id uuid PRIMARY KEY,
  discussion_id uuid NOT NULL REFERENCES discussions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_position text,
  to_position text NOT NULL,
  reason text,
  triggering_argument_id uuid REFERENCES arguments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT position_changes_from_position_check
    CHECK (from_position IS NULL OR from_position IN ('FOR', 'AGAINST', 'UNDECIDED')),
  CONSTRAINT position_changes_to_position_check
    CHECK (to_position IN ('FOR', 'AGAINST', 'UNDECIDED')),
  CONSTRAINT position_changes_reason_length_check
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500)
);
CREATE INDEX position_changes_discussion_created_idx ON position_changes (discussion_id, created_at DESC);
CREATE INDEX position_changes_argument_user_idx ON position_changes (triggering_argument_id, user_id) WHERE triggering_argument_id IS NOT NULL;
CREATE INDEX position_changes_user_created_idx ON position_changes (user_id, created_at DESC);

ALTER TABLE arguments
  ADD COLUMN depth smallint NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN edited_at timestamptz,
  ADD CONSTRAINT arguments_depth_check CHECK (depth BETWEEN 0 AND 3),
  ADD CONSTRAINT arguments_body_length_check CHECK (char_length(body) BETWEEN 1 AND 2000);
CREATE INDEX arguments_discussion_active_created_idx ON arguments (discussion_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX arguments_parent_active_created_idx ON arguments (parent_id, created_at ASC) WHERE deleted_at IS NULL;

CREATE TABLE argument_reactions (
  argument_id uuid NOT NULL REFERENCES arguments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (argument_id, user_id, kind),
  CONSTRAINT argument_reactions_kind_check CHECK (kind IN ('WELL_REASONED', 'FAIR_POINT'))
);
CREATE INDEX argument_reactions_argument_kind_idx ON argument_reactions (argument_id, kind);
```

`position_changes` is append-only: the application exposes no update/delete route and the production database role should get only `SELECT` and `INSERT` permissions. Its three references use `ON DELETE RESTRICT`; users, discussions, and arguments must be soft-deleted or anonymized, never hard-deleted, once referenced by a change event.

## Positions and mind-change events

### Transactional write flow

`POST /api/discussions/:discussionId/position` accepts:

```ts
z.object({
  stance: z.enum(["FOR", "AGAINST", "UNDECIDED"]),
  reason: z.string().trim().min(1).max(500).optional(),
  triggeringArgumentId: z.string().uuid().optional(),
})
```

It returns `401` without `currentUser()`, `404` for a missing discussion, `400` for schema failure, and `422` for credit-rule failures. Every successful first/change write performs these steps in one transaction:

1. Acquire `SELECT pg_advisory_xact_lock(hashtextextended($discussionId::text || ':' || $userId::text, 0))`. This keys the lock by discussion/user, so concurrent first-position requests serialize. PGlite runs one connection and cannot reproduce a true concurrent race; tests will instead prove the second logic path reads the first position and logs it as `from_position`.
2. Read the current position after the lock. If it equals requested `stance`, return `{ changed: false, stance }`; do not alter `changed_at` and do not log an event.
3. If a credit is supplied, load the argument and return `422` unless it is active, belongs to the discussion, is not authored by the current user, and has a valid stance:
   - for `FOR`/`AGAINST`, `argument.stance = to_position`;
   - for `UNDECIDED`, `argument.stance = from_position`.
4. A first position (`from_position IS NULL`) cannot credit an argument; return `422` if one is supplied.
5. Upsert the current projection and append `position_changes` with the prior stance in the same transaction.

Current projection/event SQL:

```sql
INSERT INTO positions (discussion_id, user_id, stance, changed_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (discussion_id, user_id)
DO UPDATE SET stance = EXCLUDED.stance, changed_at = now();

INSERT INTO position_changes
  (id, discussion_id, user_id, from_position, to_position, reason, triggering_argument_id)
VALUES ($4, $1, $2, $5, $3, $6, $7);
```

### UI and counts

`PositionSelector` disables during the write, preserves prior UI state on an error, and shows an empty state of “No positions yet — be the first to choose a side.” `MindChangeDialog` is offered only for an actual changed stance and supplies the optional reason/eligible-argument picker.

Argument mind-change score is computed on read, not stored: the source is append-only and computed values avoid cache invalidation for retractions, moderation, and flip-flops. It counts a credited argument once per changing user, excludes first positions and the argument author, and returns no public score for a soft-deleted argument.

```sql
SELECT count(DISTINCT pc.user_id)::int AS minds_changed
FROM position_changes pc
JOIN arguments a ON a.id = pc.triggering_argument_id
WHERE pc.triggering_argument_id = $1
  AND pc.from_position IS NOT NULL
  AND pc.user_id <> a.author_id
  AND a.deleted_at IS NULL;
```

## Arguments and rebuttals

`POST /api/discussions/:discussionId/arguments` validates:

```ts
z.object({
  stance: z.enum(["FOR", "AGAINST"]),
  body: z.string().trim().min(1).max(2000),
  parentId: z.string().uuid().optional(),
})
```

`stance` matches the existing `arguments.stance` column; no `side` field exists. Root arguments receive depth 0. Rebuttals derive depth from an active, same-discussion parent, maximum depth 3; depth 4 returns `422`. The service ignores any client author/depth/discussion values.

`PATCH /api/arguments/:argumentId` is author-only and sets `edited_at = now()`. It returns `409 { error: "Arguments with reactions or credited mind changes can no longer be edited." }` if either exists:

```sql
SELECT EXISTS (SELECT 1 FROM argument_reactions WHERE argument_id = $1)
    OR EXISTS (SELECT 1 FROM position_changes WHERE triggering_argument_id = $1) AS locked;
```

The author may then delete or reply, but may not edit. `DELETE /api/arguments/:argumentId` is an author-only soft delete (`deleted_at`, `deleted_by`), preserving the rebuttal tree and audit history. It hides body/reactions/public persuasion score; credited events stay intact.

UI: `ArgumentComposer`, `ArgumentTree`, and `DeletedArgument` must have loading skeletons, FOR/AGAINST empty states, inline validation errors, and an edit-locked explanation.

## Quality reactions

The only argument reactions are `WELL_REASONED` and `FAIR_POINT`; generic likes never apply to arguments. `POST /api/arguments/:argumentId/reactions` validates:

```ts
z.object({ kind: z.enum(["WELL_REASONED", "FAIR_POINT"]) })
```

It requires login (`401`), active argument (`404`/`409`), and rejects its author with `403`. It toggles only the requested kind. The composite primary key allows one of each kind per user/argument and rejects duplicate same-kind reactions.

```sql
SELECT
  count(*) FILTER (WHERE kind = 'WELL_REASONED')::int AS well_reasoned_count,
  count(*) FILTER (WHERE kind = 'FAIR_POINT')::int AS fair_point_count
FROM argument_reactions WHERE argument_id = $1;
```

`ArgumentReactions` has two accessible toggles, disables them for the author, and rolls back optimistic state on failure.

## Discussions and featured card

`POST /api/discussions` requires login and validates `z.object({ topic: z.string().trim().min(10).max(280) })`; it persists the authenticated `author_id` and returns `201`. The existing `discussions` table already has all required creation fields.

The featured endpoint selects the newest target first, then calculates independent counts—no fan-out join and no aggregate-before-limit:

```sql
WITH featured AS (
  SELECT id, topic, created_at
  FROM discussions
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  f.id, f.topic, f.created_at,
  (SELECT count(*)::int FROM positions p WHERE p.discussion_id = f.id) AS participant_count,
  (SELECT count(*)::int FROM arguments a WHERE a.discussion_id = f.id AND a.deleted_at IS NULL) AS argument_count,
  (SELECT count(DISTINCT pc.user_id)::int FROM position_changes pc WHERE pc.discussion_id = f.id AND pc.from_position IS NOT NULL) AS mind_change_count,
  (SELECT count(*)::int FROM positions p WHERE p.discussion_id = f.id AND p.stance = 'FOR') AS for_count,
  (SELECT count(*)::int FROM positions p WHERE p.discussion_id = f.id AND p.stance = 'AGAINST') AS against_count,
  (SELECT count(*)::int FROM positions p WHERE p.discussion_id = f.id AND p.stance = 'UNDECIDED') AS undecided_count
FROM featured f;
```

`GET /api/discussions/featured` checks the viewer’s own `positions` row. If absent, return only:

```ts
{ discussion: { id, topic, createdAt, participantCount, argumentCount, mindChangeCount, positionSplit: null } }
```

If present, return:

```ts
{ discussion: { id, topic, createdAt, participantCount, argumentCount, mindChangeCount, positionSplit: { forCount, againstCount, undecidedCount, viewerStance } } }
```

`FeaturedDiscussionCard` has loading, empty (“No discussions yet. Start the first one.”), error/retry, and result states. It never uses literal counts, percentages, or “live/trending” labels.

## Post likes

Keep `likes` only for ordinary posts. They are lightweight acknowledgement and must not influence argument quality, featured selection, mind-change counts, reputation, or moderation. Rename it to `post_likes` only in a later migration after current routes are changed.

## Abuse and edge cases

- Reject self-crediting explicitly before insert; reject same-discussion/stage mismatch, inactive arguments, wrong stance, and any first-position credit with `422`.
- Same-position writes are no-ops; rate-limit position writes to curb flip-flopping.
- `DISTINCT user_id` prevents repeated credits inflating one argument, but not sockpuppets; rate limits and future account-trust weighting are required.
- Database uniqueness stops duplicate reaction clicks. Author reaction is rejected server-side.
- Soft-delete/anonymize referenced users/discussions/arguments; `RESTRICT` protects historical change events from hard deletion.

## Test plan

All tests remain isolated `new PGlite()` instances and never call `db()` or `.polarity-data`.

Database tests: fresh and baselined-legacy 002 application; invalid reason/body/depth/stance/kind checks; duplicate same-kind reaction rejected while other kind works; RESTRICT blocks hard deletion of referenced user/discussion/argument; first/change/no-op events; deleted-argument score exclusion; and the deterministic second-position logic path. The last proves the service sees the first row and records it as `from_position`; it cannot prove real parallelism because PGlite uses one connection.

Route tests must provide a `401` and impersonation case for every mutation: discussion creation, position write, argument creation/edit/delete, and reactions. Include 422 cases for first-position credit, self-credit, wrong discussion, deleted argument, wrong stance, and depth four; include 409 edit lock after either reaction or credited change.

## Build order

1. **Current step:** add/apply/test `002_discussion_integrity.sql` only.
2. Implement transaction-capable position service with advisory transaction lock and history tests.
3. Implement discussion creation/featured endpoint/card with viewer-gated split.
4. Implement argument create/read/tree/soft-delete/edit-lock behavior.
5. Implement quality reactions and derived mind-change display.
6. **Launch blocker:** add rate limiting for position writes, argument creation, and reactions.
7. **Launch blocker:** add managed PostgreSQL adapter using `DATABASE_URL` before any public launch.
8. Run migration, tests, lint, build, and browser flow checks.

## Risks and recommendation

1. **High:** the current application still directly constructs PGlite despite `.env.example` mentioning `DATABASE_URL`; the managed Postgres adapter is a launch blocker.
2. **High:** append-only application rules need production database-role permissions for enforcement against direct SQL clients.
3. **Medium:** audit legacy argument bodies before adding the 2000-character check in a non-development database.
4. **Medium:** argument parent/discussion consistency remains a service invariant, not a declarative foreign key.

Build step 1 first: it creates the durable integrity model required before the current overwrite-only position route can be safely replaced.
