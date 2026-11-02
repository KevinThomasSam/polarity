import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "fs/promises";
import path from "path";
import { checkPassword, hashPassword } from "../src/lib/db";

let db: PGlite;
const alice = "00000000-0000-4000-8000-000000000101";
const bob = "00000000-0000-4000-8000-000000000102";
const post = "10000000-0000-4000-8000-000000000101";
const discussion = "30000000-0000-4000-8000-000000000101";

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(await readFile(path.join(process.cwd(), "migrations", "001_initial.sql"), "utf8"));
});
afterAll(async () => { await db.close(); });

describe("social persistence integration", () => {
  it("registers and verifies a password-backed login", async () => {
    const hash = hashPassword("correct-horse-battery-staple");
    await db.query("INSERT INTO users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)", [alice, "alice", "Alice", hash]);
    const result = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE username=$1", ["alice"]);
    expect(checkPassword("correct-horse-battery-staple", result.rows[0].password_hash)).toBe(true);
    expect(checkPassword("wrong-password", result.rows[0].password_hash)).toBe(false);
  });

  it("creates a post and persists it", async () => {
    await db.query("INSERT INTO posts(id,author_id,body) VALUES($1,$2,$3)", [post, alice, "A real persisted post."]);
    const result = await db.query<{ body: string }>("SELECT body FROM posts WHERE id=$1", [post]);
    expect(result.rows[0].body).toBe("A real persisted post.");
  });

  it("toggles one unique like", async () => {
    await db.query("INSERT INTO likes(user_id,post_id) VALUES($1,$2)", [alice, post]);
    await expect(db.query("INSERT INTO likes(user_id,post_id) VALUES($1,$2)", [alice, post])).rejects.toThrow();
    await db.query("DELETE FROM likes WHERE user_id=$1 AND post_id=$2", [alice, post]);
    const result = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM likes WHERE post_id=$1", [post]);
    expect(result.rows[0].count).toBe(0);
  });

  it("creates one follow relationship", async () => {
    await db.query("INSERT INTO users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)", [bob, "bob", "Bob", hashPassword("password123")]);
    await db.query("INSERT INTO follows(follower_id,following_id) VALUES($1,$2)", [alice, bob]);
    const result = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM follows WHERE following_id=$1", [bob]);
    expect(result.rows[0].count).toBe(1);
  });

  it("sets and changes a discussion position", async () => {
    await db.query("INSERT INTO discussions(id,author_id,topic) VALUES($1,$2,$3)", [discussion, alice, "Should evidence change minds?"]);
    await db.query("INSERT INTO positions(discussion_id,user_id,stance) VALUES($1,$2,$3)", [discussion, bob, "FOR"]);
    await db.query("INSERT INTO positions(discussion_id,user_id,stance,changed_at) VALUES($1,$2,$3,now()) ON CONFLICT(discussion_id,user_id) DO UPDATE SET stance=excluded.stance,changed_at=now()", [discussion, bob, "AGAINST"]);
    const result = await db.query<{ stance: string }>("SELECT stance FROM positions WHERE discussion_id=$1 AND user_id=$2", [discussion, bob]);
    expect(result.rows[0].stance).toBe("AGAINST");
  });
});
