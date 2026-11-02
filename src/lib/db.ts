import { PGlite } from "@electric-sql/pglite";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { readdir, readFile } from "fs/promises";
import path from "path";

const dataPath = path.join(process.cwd(), ".polarity-data");
const migrationPath = path.join(process.cwd(), "migrations");
const globalDb = globalThis as unknown as { polarityDb?: Promise<PGlite> };

export async function runMigrations(client: PGlite) {
  await client.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  await client.query("SELECT pg_advisory_lock($1)", [918273645]);
  try {
    const applied = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const names = new Set(applied.rows.map((row) => row.name));
    const files = (await readdir(migrationPath)).filter((name) => name.endsWith(".sql")).sort();
    const usersTable = await client.query<{ table_name: string | null }>("SELECT to_regclass('public.users') AS table_name");
    if (names.size === 0 && usersTable.rows[0].table_name) {
      const initial = files.find((name) => name === "001_initial.sql");
      if (initial) {
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [initial]);
        names.add(initial);
      }
    }
    for (const name of files) {
      if (names.has(name)) continue;
      await client.exec("BEGIN");
      try {
        await client.exec(await readFile(path.join(migrationPath, name), "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        await client.exec("COMMIT");
      } catch (error) {
        await client.exec("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [918273645]);
  }
}

async function seedDevelopmentData(client: PGlite) {
  if (process.env.NODE_ENV === "production") return;
  const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users");
  if (count.rows[0].count !== "0") return;
  const password = hashPassword("welcome123");
  await client.exec(`INSERT INTO users (id,username,display_name,password_hash,bio) VALUES
    ('00000000-0000-4000-8000-000000000001','maya','Maya Chen','${password}','Technologist interested in equitable futures.'),
    ('00000000-0000-4000-8000-000000000002','omar','Omar Williams','${password}','Urbanist and public-space enthusiast.'),
    ('00000000-0000-4000-8000-000000000003','kevin','Kevin Thomas','${password}','Building better conversations.');
    INSERT INTO posts (id,author_id,body,community) VALUES
    ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','We keep treating AI adoption as a productivity story. It is also a distribution story — who gets the gains, and who gets a say in the transition?','technology'),
    ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','The best public spaces aren’t optimized for moving people through them. They’re optimized for making people want to stay.','city-lab');
    INSERT INTO communities (id,slug,name,description,owner_id) VALUES ('20000000-0000-4000-8000-000000000001','technology','Technology','Tools, systems, and their impact.','00000000-0000-4000-8000-000000000001');
    INSERT INTO discussions (id,author_id,topic) VALUES ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Will AI create more jobs than it eliminates?');`);
}

async function bootstrap() {
  const client = new PGlite(dataPath);
  await client.waitReady;
  await runMigrations(client);
  await seedDevelopmentData(client);
  return client;
}

export function db() { if (!globalDb.polarityDb) globalDb.polarityDb = bootstrap(); return globalDb.polarityDb; }
export function id() { return crypto.randomUUID(); }
export function hashPassword(value: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`; }
export function checkPassword(value: string, stored: string) { const [salt, hash] = stored.split(":"); return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(value, salt, 64)); }
