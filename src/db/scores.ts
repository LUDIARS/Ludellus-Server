// スコア DB スタブ。 in-memory + last-write-wins (lastPlayed が新しい方を best として保持)。

export interface ScoreEntry {
  gameId: string;
  mode: string;
  best: number;
  total: number;
  attempts: number;
  lastPlayed: string;
}

// childId → (gameId#mode → ScoreEntry)
const store = new Map<string, Map<string, ScoreEntry>>();

function key(gameId: string, mode: string): string {
  return `${gameId}#${mode}`;
}

export async function listScores(childId: string): Promise<ScoreEntry[]> {
  const sub = store.get(childId);
  return sub ? [...sub.values()] : [];
}

export async function recordScore(childId: string, input: {
  gameId: string;
  mode: string;
  score: number;
  total: number;
}): Promise<ScoreEntry> {
  let sub = store.get(childId);
  if (!sub) {
    sub = new Map();
    store.set(childId, sub);
  }
  const k = key(input.gameId, input.mode);
  const prev = sub.get(k);
  const updatedBest = !prev || input.score > prev.best;
  const entry: ScoreEntry = {
    gameId: input.gameId,
    mode: input.mode,
    best: updatedBest ? input.score : prev!.best,
    total: updatedBest ? input.total : prev!.total,
    attempts: (prev?.attempts ?? 0) + 1,
    lastPlayed: new Date().toISOString(),
  };
  sub.set(k, entry);
  return entry;
}
