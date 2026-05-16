// DB クライアント。 LUDELLUS_PG_URL が設定されていれば Postgres + Drizzle、 無ければ in-memory に
// フォールバック (現状の profiles.ts / scores.ts / branches.ts と同じ振る舞い)。

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

let db: NodePgDatabase<typeof schema> | null = null;
let pool: pg.Pool | null = null;

export function isPostgresEnabled(): boolean {
  return !!process.env.LUDELLUS_PG_URL;
}

export function getDb(): NodePgDatabase<typeof schema> | null {
  if (db) return db;
  const url = process.env.LUDELLUS_PG_URL;
  if (!url) return null;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
