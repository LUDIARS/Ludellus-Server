// 子供プロファイル DB スタブ。 Phase 1 は in-memory、 Phase 2 で Drizzle + Postgres に移行。
// schemas/profiles.sql に予定 schema を記載済。

import { randomUUID } from "node:crypto";

export interface ChildProfile {
  childId: string;
  parentUserId: string;
  displayName: string;
  color: string;
  createdAt: string;
}

const store = new Map<string, ChildProfile>();

export async function listProfilesForUser(parentUserId: string): Promise<ChildProfile[]> {
  return [...store.values()].filter(p => p.parentUserId === parentUserId);
}

export async function getProfile(parentUserId: string, childId: string): Promise<ChildProfile | null> {
  const p = store.get(childId);
  if (!p || p.parentUserId !== parentUserId) return null;
  return p;
}

export async function createProfile(
  parentUserId: string,
  input: { displayName: string; color?: string },
): Promise<ChildProfile> {
  const profile: ChildProfile = {
    childId: `child_${randomUUID()}`,
    parentUserId,
    displayName: input.displayName,
    color: input.color ?? "#ff7a3a",
    createdAt: new Date().toISOString(),
  };
  store.set(profile.childId, profile);
  return profile;
}

export async function ensureChildOwnership(parentUserId: string, childId: string): Promise<boolean> {
  const p = store.get(childId);
  return !!p && p.parentUserId === parentUserId;
}
