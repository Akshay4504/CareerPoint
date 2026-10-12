import { db } from "@/lib/db";
import { AiError } from "./provider";

// Cost protection. Independent brakes, all configurable:
//   AI_USER_DAILY_LIMIT     requests per user per rolling 24h (default 30)
//   AI_DAILY_TOKEN_BUDGET   total tokens across all users per rolling 24h (default 400000; 0 disables the global cap)
//   AI_MAX_OUTPUT_TOKENS / AI_MAX_INPUT_CHARS (see provider.ts) bound the cost of a single call.

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
export const usageLimits = () => ({ perUserDaily: num(process.env.AI_USER_DAILY_LIMIT, 30), dailyTokenBudget: num(process.env.AI_DAILY_TOKEN_BUDGET, 400_000) });

export async function assertBudget(userId: string, now = new Date()) {
  const since = new Date(now.getTime() - 86400_000);
  const lim = usageLimits();
  const mine = await db.aiUsage.count({ where: { userId, createdAt: { gte: since }, status: "ok" } });
  if (mine >= lim.perUserDaily) throw new AiError("limit", `You have reached today's AI limit (${lim.perUserDaily} requests). It resets on a rolling 24-hour basis.`);
  if (lim.dailyTokenBudget > 0) {
    const t = await db.aiUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } });
    if ((t._sum.inputTokens ?? 0) + (t._sum.outputTokens ?? 0) >= lim.dailyTokenBudget) throw new AiError("limit", "AI assistance is paused for today to keep costs under control. Everything else keeps working; please try again tomorrow.");
  }
}

export const recordUsage = (row: { userId: string; kind: string; model?: string | null; inputTokens?: number; outputTokens?: number; status: "ok" | "error" | "fallback"; error?: string; durationMs?: number }) =>
  db.aiUsage.create({ data: { ...row, error: row.error?.slice(0, 300) } }).catch(() => null);

export async function usageSummary(days = 7) {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.aiUsage.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true, _sum: { inputTokens: true, outputTokens: true } });
  return { days, rows, limits: usageLimits() };
}
