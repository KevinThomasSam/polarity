import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "fs/promises";
import path from "path";

const state = vi.hoisted(() => ({ db: null as PGlite | null, user: null as null | { id: string; username: string; display_name: string }, token: "", id: 0 }));
vi.mock("@/lib/db", () => ({
  db: async () => state.db,
  id: () => `00000000-0000-4000-8000-${String(++state.id).padStart(12, "0")}`,
  checkPassword: (value: string) => value === "secret123",
  hashPassword: () => "hash",
}));
vi.mock("@/lib/auth", () => ({ currentUser: async () => state.user }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined }) }));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as createPost } from "@/app/api/posts/route";

const alice = "00000000-0000-4000-8000-000000000201";
const bob = "00000000-0000-4000-8000-000000000202";

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.waitReady;
  await state.db.exec(await readFile(path.join(process.cwd(), "migrations", "001_initial.sql"), "utf8"));
  await state.db.query("INSERT INTO users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$8)", [alice, "alice", "Alice", "hash", bob, "bob", "Bob", "hash"]);
});
afterAll(async () => { await state.db?.close(); });

describe("route-handler authorization and sessions", () => {
  it("rejects an unauthenticated mutation", async () => {
    state.user = null;
    const response = await createPost(new Request("http://test/api/posts", { method: "POST", body: JSON.stringify({ body: "No session" }) }));
    expect(response.status).toBe(401);
  });

  it("login sets an HTTP-only session cookie", async () => {
    const response = await login(new Request("http://test/api/auth/login", { method: "POST", body: JSON.stringify({ username: "alice", password: "secret123" }) }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("polarity_session=");
    expect(cookie).toMatch(/HttpOnly/i);
    state.token = cookie.match(/polarity_session=([^;]+)/)?.[1] ?? "";
    const session = await state.db?.query("SELECT id FROM sessions WHERE id=$1", [state.token]);
    expect(session?.rows).toHaveLength(1);
  });

  it("logout invalidates the current session", async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/Expires=Thu, 01 Jan 1970/i);
    const session = await state.db?.query("SELECT id FROM sessions WHERE id=$1", [state.token]);
    expect(session?.rows).toHaveLength(0);
  });

  it("does not allow a client to create a post as another user", async () => {
    state.user = { id: alice, username: "alice", display_name: "Alice" };
    const response = await createPost(new Request("http://test/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: "Authored by Alice", authorId: bob }) }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    const row = await state.db?.query<{ author_id: string }>("SELECT author_id FROM posts WHERE id=$1", [payload.id]);
    expect(row?.rows[0].author_id).toBe(alice);
  });
});
