// Memoria への学習活動通知。 失敗してもサーバ全体は落とさず log で済ます。
// 認証は process memory only の per-user / per-project token を想定 ([[feedback_secret_per_user_memory_only]])。

export interface MemoriaActivityPayload {
  userId: string;
  childId: string;
  kind: string;       // "ludellus.session" 等
  gameId: string;
  mode: string;
  score: number;
  total: number;
  unitTags?: string[];
  durationMs?: number;
  startedAt?: string;
  endedAt?: string;
  // 勝敗 (任意)。 score/total からも導けるが、 学習 POI 完了の通知では明示する。
  result?: "win" | "lose";
}

export async function notifyMemoria(payload: MemoriaActivityPayload): Promise<void> {
  const base = process.env.MEMORIA_BASE_URL;
  const token = process.env.MEMORIA_SERVICE_TOKEN;
  if (!base || !token) return; // 未設定なら何もしない

  const res = await fetch(`${base}/api/activities`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`memoria notify HTTP ${res.status}`);
  }
}
