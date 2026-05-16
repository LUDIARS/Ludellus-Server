// Drizzle ORM スキーマ。 src/schemas/profiles.sql と同等の構造。
// PG migration は Phase 2 で drizzle-kit で生成する。

import {
  pgTable, text, integer, jsonb, timestamp, bigserial,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  childId: text("child_id").primaryKey(),
  parentUserId: text("parent_user_id").notNull(),
  displayName: text("display_name").notNull(),
  color: text("color").notNull().default("#ff7a3a"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  parentIdx: index("idx_profiles_parent").on(t.parentUserId),
}));

export const scores = pgTable("scores", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  childId: text("child_id").notNull().references(() => profiles.childId, { onDelete: "cascade" }),
  gameId: text("game_id").notNull(),
  mode: text("mode").notNull(),
  best: integer("best").notNull().default(0),
  total: integer("total").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastPlayed: timestamp("last_played", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("uq_scores_child_game_mode").on(t.childId, t.gameId, t.mode),
}));

export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  childId: text("child_id").notNull().references(() => profiles.childId, { onDelete: "cascade" }),
  baseGameId: text("base_game_id").notNull(),
  parentBranchId: text("parent_branch_id"),
  mode: text("mode").notNull(),
  generationKind: text("generation_kind").notNull(),
  appliedDeltas: text("applied_deltas").array().notNull().default([]),
  curriculumUnits: text("curriculum_units").array().notNull().default([]),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  childIdx: index("idx_branches_child").on(t.childId),
  parentIdx: index("idx_branches_parent").on(t.parentBranchId),
}));
