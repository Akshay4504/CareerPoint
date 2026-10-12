// AI provider layer: Anthropic Messages API over fetch, with timeout, retry + backoff, model fallback and token accounting.
// Credentials and model names come from the environment and are only ever read server-side.
//   ANTHROPIC_API_KEY        required to enable AI (otherwise AI features stay off)
//   AI_MODEL                 primary model (default claude-haiku-4-5-20251001)
//   AI_FALLBACK_MODEL        tried when the primary keeps failing (optional)
//   AI_TIMEOUT_MS            per-attempt timeout (default 20000)
//   AI_MAX_RETRIES           retries per model for transient errors (default 2)
//   AI_MAX_OUTPUT_TOKENS     hard cap per response (default 700) - part of cost protection
//   AI_MAX_INPUT_CHARS       hard cap on prompt size (default 9000)

export type AiResult = { text: string; inputTokens?: number; outputTokens?: number; model?: string };
export type AiProvider = { name: string; model: string; complete: (system: string, user: string) => Promise<string | AiResult> };

export type AiErrorKind = "limit" | "unavailable" | "rejected" | "empty";
export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export const AI_SYSTEM_PROMPT = [
  "You are a careful editing assistant for BIM (Building Information Modelling) professionals' resumes.",
  "Use ONLY the facts present in the user's input. Never add employers, job titles, dates, numbers, tools, skills, certifications, responsibilities or outcomes that are not in the input.",
  "If a detail would make the text stronger but is missing, do not invent it: instead end with a line starting 'Missing:' listing what the user could add.",
  "Write in plain, specific, professional language. No superlatives. Return only the requested text.",
].join(" ");

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
export const aiLimits = () => ({
  timeoutMs: num(process.env.AI_TIMEOUT_MS, 20_000),
  retries: Math.max(0, Math.min(4, num(process.env.AI_MAX_RETRIES, 2))),
  maxOutputTokens: Math.max(100, Math.min(2000, num(process.env.AI_MAX_OUTPUT_TOKENS, 700))),
  maxInputChars: num(process.env.AI_MAX_INPUT_CHARS, 9000),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const transient = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

type Attempt = (model: string) => Promise<AiResult>;

/** Retries transient failures with exponential backoff (+jitter), then falls through to the next model. Exported for tests. */
export async function completeResilient(models: string[], attempt: Attempt, opts: { retries: number; baseDelayMs?: number } = { retries: 2 }): Promise<AiResult> {
  let last: unknown;
  for (const model of models) {
    for (let i = 0; i <= opts.retries; i++) {
      try {
        return await attempt(model);
      } catch (e) {
        last = e;
        if (e instanceof AiError && (e.kind === "rejected" || e.kind === "empty")) break; // retrying the same request cannot help; try the next model
        if (i < opts.retries) await sleep((opts.baseDelayMs ?? 400) * 2 ** i + Math.random() * 100);
      }
    }
  }
  if (last instanceof AiError) throw last;
  throw new AiError("unavailable", "The AI service is temporarily unavailable. Please try again in a few minutes.");
}

export function getProvider(fetchImpl: typeof fetch = fetch, baseDelayMs?: number): AiProvider | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL ?? "claude-haiku-4-5-20251001";
  const fallback = process.env.AI_FALLBACK_MODEL && process.env.AI_FALLBACK_MODEL !== model ? process.env.AI_FALLBACK_MODEL : null;
  const limits = aiLimits();
  return {
    name: "anthropic",
    model,
    complete: (system, user) =>
      completeResilient(
        fallback ? [model, fallback] : [model],
        async (m) => {
          let res: Response;
          try {
            res = await fetchImpl("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: m, max_tokens: limits.maxOutputTokens, temperature: 0.2, system, messages: [{ role: "user", content: user.slice(0, limits.maxInputChars) }] }),
              signal: AbortSignal.timeout(limits.timeoutMs),
            });
          } catch {
            throw new AiError("unavailable", "The AI service did not respond in time.");
          }
          if (!res.ok) throw new AiError(transient(res.status) ? "unavailable" : "rejected", `AI provider error ${res.status}`);
          const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
          const text = (data.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("")
            .trim();
          if (!text) throw new AiError("empty", "The AI returned an empty answer.");
          return { text, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens, model: m };
        },
        { retries: limits.retries, baseDelayMs },
      ),
  };
}
