-- Phase 2 で Drizzle + Postgres に移行する際の schema 案。
-- 個人データ最小化: 子供本人の生年月日や住所等は持たない。 親 user_id (Cernere sub) と
-- 表示名 (うに / コーラル / 等のニックネーム) + 色のみ。

CREATE TABLE IF NOT EXISTS profiles (
  child_id        TEXT PRIMARY KEY,
  parent_user_id  TEXT NOT NULL,          -- Cernere sub
  display_name    TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#ff7a3a',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_parent ON profiles(parent_user_id);

CREATE TABLE IF NOT EXISTS scores (
  id              BIGSERIAL PRIMARY KEY,
  child_id        TEXT NOT NULL REFERENCES profiles(child_id) ON DELETE CASCADE,
  game_id         TEXT NOT NULL,
  mode            TEXT NOT NULL,
  best            INT NOT NULL DEFAULT 0,
  total           INT NOT NULL DEFAULT 0,
  attempts        INT NOT NULL DEFAULT 0,
  last_played     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, game_id, mode)
);

CREATE TABLE IF NOT EXISTS branches (
  id                 TEXT PRIMARY KEY,
  child_id           TEXT NOT NULL REFERENCES profiles(child_id) ON DELETE CASCADE,
  base_game_id       TEXT NOT NULL,
  parent_branch_id   TEXT REFERENCES branches(id) ON DELETE SET NULL,
  mode               TEXT NOT NULL,
  generation_kind    TEXT NOT NULL,         -- 'main' | 'rule' | 'api'
  applied_deltas     TEXT[] NOT NULL DEFAULT '{}',
  curriculum_units   TEXT[] NOT NULL DEFAULT '{}',
  payload            JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_branches_child ON branches(child_id);
CREATE INDEX IF NOT EXISTS idx_branches_parent ON branches(parent_branch_id);
