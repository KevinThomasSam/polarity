import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().optional(),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
});

const parsed = environmentSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
}

if (parsed.data.NODE_ENV === "production" && !parsed.data.NEXT_PUBLIC_APP_URL) {
  throw new Error("Invalid environment configuration: NEXT_PUBLIC_APP_URL is required in production.");
}

/**
 * DATABASE_URL is validated when supplied but is not consumed yet: Polarity
 * still uses local PGlite until the managed PostgreSQL adapter launch blocker is completed.
 */
export const env = parsed.data;
