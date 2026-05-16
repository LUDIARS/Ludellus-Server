// 子供プロファイル DB。 PG が有効なら Drizzle、 無ければ in-memory。

import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb, isPostgresEnabled } from "./client.js";
import { profiles as profilesTable } from "./schema.js";

export interface ChildProfile {
  childId: string;
  parentUserId: string;
  displayName: string;
  color: string;
  createdAt: string;
}

const memoryStore = new Map<string, ChildProfile>();

export async function listProfilesForUser(parentUserId: string): Promise<ChildProfile[]> {
  if (isPostgresEnabled()) {
    const db = getDb()!;
    const rows = await db.select().from(profilesTable).where(eq(profilesTable.parentUserId, parentUserId));
    return rows.map(rowToProfile);
  }
  return [...memoryStore.values()].filter(p => p.parentUserId === parentUserId);
}

export async function getProfile(parentUserId: string, childId: string): Promise<ChildProfile | null> {
  if (isPostgresEnabled()) {
    const db = getDb()!;
    const rows = await db.select().from(profilesTable)
      .where(and(eq(profilesTable.childId, childId), eq(profilesTable.parentUserId, parentUserId)))
      .limit(1);
    return rows[0] ? rowToProfile(rows[0]) : null;
  }
  const p = memoryStore.get(childId);
  return p && p.parentUserId === parentUserId ? p : null;
}

export async function createProfile(parentUserId: string, input: { displayName: string; color?: string }): Promise<ChildProfile> {
  const childId = `child_${randomUUID()}`;
  const color = input.color ?? "#ff7a3a";
  const createdAt = new Date();

  if (isPostgresEnabled()) {
    const db = getDb()!;
    const [row] = await db.insert(profilesTable).values({
      childId, parentUserId, displayName: input.displayName, color, createdAt,
    }).returning();
    return rowToProfile(row);
  }
  const profile: ChildProfile = {
    childId, parentUserId, displayName: input.displayName, color,
    createdAt: createdAt.toISOString(),
  };
  memoryStore.set(childId, profile);
  return profile;
}

export async function ensureChildOwnership(parentUserId: string, childId: string): Promise<boolean> {
  if (isPostgresEnabled()) {
    return (await getProfile(parentUserId, childId)) !== null;
  }
  const p = memoryStore.get(childId);
  return !!p && p.parentUserId === parentUserId;
}

function rowToProfile(row: typeof profilesTable.$inferSelect): ChildProfile {
  return {
    childId: row.childId,
    parentUserId: row.parentUserId,
    displayName: row.displayName,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
  };
}
