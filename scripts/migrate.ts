import { PGlite } from "@electric-sql/pglite";
import path from "path";
import { runMigrations } from "../src/lib/db";

async function main() {
  const client = new PGlite(path.join(process.cwd(), ".polarity-data"));
  await client.waitReady;
  await runMigrations(client);
  await client.close();
  console.log("Migrations applied.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
