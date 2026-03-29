import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema";

const currentDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(currentDir, "../../.env"), override: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
	throw new Error("DATABASE_URL is not set. Ensure server/.env is present and readable.");
}

const client = postgres(databaseUrl);

export const db = drizzle(client, { schema });
export * from "./schema";
