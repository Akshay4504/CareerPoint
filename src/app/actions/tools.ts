"use server";

import { getScoringConfig } from "@/lib/scoring/store";
import { clientInfo } from "@/lib/auth/session";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { parseResumeText } from "@/lib/resume/parse";
import { scoreResume, type ResumeScoreResult } from "@/lib/resume/score";

export type ToolState = { error?: string; result?: ResumeScoreResult; software?: string[]; skills?: string[] } | undefined;

/** Public, stateless: nothing is stored. */
export async function scoreTextAction(_prev: ToolState, fd: FormData): Promise<ToolState> {
  const { ip } = await clientInfo();
  if (!(await rateLimitShared(`tool-score:${ip}`, 20, 3600_000)).ok) return { error: "Rate limit reached. Try again in an hour or create a free account." };
  const text = String(fd.get("text") ?? "");
  if (text.trim().length < 150) return { error: "Paste at least a few paragraphs of resume text." };
  if (text.length > 30_000) return { error: "That's too long. Paste up to 30,000 characters." };
  const content = parseResumeText(text);
  return { result: scoreResume(content, (await getScoringConfig()).config), software: content.software, skills: content.skills };
}
