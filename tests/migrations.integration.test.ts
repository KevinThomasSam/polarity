import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "fs/promises";
import path from "path";
import { runMigrations } from "../src/lib/db";

const migrationDirectory = path.join(process.cwd(), "migrations");

const ids = {
  author: "00000000-0000-0000-0000-000000000001",
  participant: "00000000-0000-0000-0000-000000000002",
  discussion: "00000000-0000-0000-0000-000000000010",
  argument: "00000000-0000-0000-0000-000000000020",
  change: "00000000-0000-0000-0000-000000000030",
};

async function createMigratedDatabase() {
  const database = new PGlite();
  await database.waitReady;
  await runMigrations(database);
  return database;
}

async function insertDiscussionFixtures(database: PGlite) {
  await database.query(
    "INSERT INTO users(id, username, display_name, password_hash) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
    [ids.author, "author", "Author", "hash", ids.participant, "participant", "Participant", "hash"],
  );
  await database.query(
    "INSERT INTO discussions(id, author_id, topic) VALUES ($1, $2, $3)",
    [ids.discussion, ids.author, "Should Polarity record mind changes?"],
  );
  await database.query(
    "INSERT INTO arguments(id, discussion_id, author_id, stance, body) VALUES ($1, $2, $3, $4, $5)",
    [ids.argument, ids.discussion, ids.author, "FOR", "It creates accountable intellectual history."],
  );
}

describe("discussion integrity migration", () => {
  it("applies 001 and 002 to a fresh isolated in-memory PGlite database", async () => {
    const database = await createMigratedDatabase();
    try {
      const applied = await database.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY name",
      );
      expect(applied.rows.map((row) => row.name)).toEqual([
        "001_initial.sql",
        "002_discussion_integrity.sql",
      ]);
      const tables = await database.query<{ name: string | null }>(
        "SELECT to_regclass('public.position_changes') AS name",
      );
      expect(tables.rows[0].name).toBe("position_changes");
    } finally {
      await database.close();
    }
  });

  it("baselines a legacy 001 schema and applies only 002", async () => {
    const database = new PGlite();
    await database.waitReady;
    try {
      await database.exec(await readFile(path.join(migrationDirectory, "001_initial.sql"), "utf8"));
      await runMigrations(database);

      const applied = await database.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY name",
      );
      expect(applied.rows.map((row) => row.name)).toEqual([
        "001_initial.sql",
        "002_discussion_integrity.sql",
      ]);
      const columns = await database.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'arguments' AND column_name = 'edited_at'",
      );
      expect(columns.rows).toHaveLength(1);
    } finally {
      await database.close();
    }
  });

  it("enforces position-change and argument checks", async () => {
    const database = await createMigratedDatabase();
    try {
      await insertDiscussionFixtures(database);

      await expect(
        database.query(
          "INSERT INTO position_changes(id, discussion_id, user_id, to_position, reason) VALUES ($1, $2, $3, $4, $5)",
          [ids.change, ids.discussion, ids.participant, "FOR", "r".repeat(501)],
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          "INSERT INTO arguments(id, discussion_id, author_id, stance, body) VALUES ($1, $2, $3, $4, $5)",
          ["00000000-0000-0000-0000-000000000021", ids.discussion, ids.author, "FOR", "b".repeat(2001)],
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          "INSERT INTO arguments(id, discussion_id, author_id, stance, body, depth) VALUES ($1, $2, $3, $4, $5, $6)",
          ["00000000-0000-0000-0000-000000000022", ids.discussion, ids.author, "FOR", "Too deep", 4],
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          "INSERT INTO arguments(id, discussion_id, author_id, stance, body) VALUES ($1, $2, $3, $4, $5)",
          ["00000000-0000-0000-0000-000000000023", ids.discussion, ids.author, "UNDECIDED", "Invalid stance"],
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          "INSERT INTO argument_reactions(argument_id, user_id, kind) VALUES ($1, $2, $3)",
          [ids.argument, ids.participant, "AGREE"],
        ),
      ).rejects.toThrow();
    } finally {
      await database.close();
    }
  });

  it("allows one of each reaction kind but rejects a duplicate kind", async () => {
    const database = await createMigratedDatabase();
    try {
      await insertDiscussionFixtures(database);
      await database.query(
        "INSERT INTO argument_reactions(argument_id, user_id, kind) VALUES ($1, $2, $3)",
        [ids.argument, ids.participant, "WELL_REASONED"],
      );
      await expect(
        database.query(
          "INSERT INTO argument_reactions(argument_id, user_id, kind) VALUES ($1, $2, $3)",
          [ids.argument, ids.participant, "WELL_REASONED"],
        ),
      ).rejects.toThrow();
      await database.query(
        "INSERT INTO argument_reactions(argument_id, user_id, kind) VALUES ($1, $2, $3)",
        [ids.argument, ids.participant, "FAIR_POINT"],
      );

      const reactions = await database.query<{ kind: string }>(
        "SELECT kind FROM argument_reactions WHERE argument_id = $1 ORDER BY kind",
        [ids.argument],
      );
      expect(reactions.rows.map((row) => row.kind)).toEqual(["FAIR_POINT", "WELL_REASONED"]);
    } finally {
      await database.close();
    }
  });

  it("prevents hard deletion of users, discussions, and arguments referenced by position changes", async () => {
    const database = await createMigratedDatabase();
    try {
      await insertDiscussionFixtures(database);
      await database.query(
        "INSERT INTO position_changes(id, discussion_id, user_id, from_position, to_position, triggering_argument_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [ids.change, ids.discussion, ids.participant, "AGAINST", "FOR", ids.argument],
      );

      await expect(database.query("DELETE FROM users WHERE id = $1", [ids.participant])).rejects.toThrow();
      await expect(database.query("DELETE FROM discussions WHERE id = $1", [ids.discussion])).rejects.toThrow();
      await expect(database.query("DELETE FROM arguments WHERE id = $1", [ids.argument])).rejects.toThrow();
    } finally {
      await database.close();
    }
  });
});
