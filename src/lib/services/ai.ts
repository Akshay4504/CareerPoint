import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AI_SYSTEM_PROMPT, AiError, type AiProvider } from "@/lib/ai/provider";
import { assertBudget, recordUsage } from "@/lib/ai/usage";
import { log } from "@/lib/log";
import { isBlocked, validateAiOutput, type AiFlag } from "@/lib/ai/guard";
import { loadJobScoreProfile, profileToContent, saveResumeVersion } from "./profile";
import { scoreJobMatch } from "@/lib/scoring/job";
import type { ResumeContent } from "@/lib/resume/types";

/**
 * AI is assistive only. Every request becomes a PENDING AiSuggestion; NOTHING changes until the owner approves,
 * and outputs that introduce facts the user did not provide cannot be approved at all.
 */

/**
 * ai: needs a configured model. advice: returns text only (never edits data). validate: output is checked against the user's own facts
 * and cannot be approved while it contains invented figures, tools, skills or certifications. fallback: has a deterministic answer
 * built from real data, used when AI is off, over budget or failing.
 */
export const AI_KINDS = {
  "rewrite-summary": { label: "Rewrite summary", applies: true, validate: true, fallback: false },
  "improve-bullet": { label: "Improve bullet", applies: true, validate: true, fallback: false },
  "achievement-from-facts": { label: "Write achievement from facts", applies: true, validate: true, fallback: false },
  "explain-missing": { label: "Explain missing skills", applies: false, validate: false, fallback: true },
  "job-recommendations": { label: "Job-specific recommendations", applies: false, validate: false, fallback: true },
  "career-recommendations": { label: "Career recommendations", applies: false, validate: false, fallback: true },
  "interview-questions": { label: "Interview questions", applies: false, validate: false, fallback: true },
  "cover-letter": { label: "Cover letter draft", applies: false, validate: true, fallback: false },
  "portfolio-description": { label: "Portfolio project description", applies: false, validate: true, fallback: false },
} as const;
export type AiKind = keyof typeof AI_KINDS;

export type RequestInput = {
  kind: AiKind;
  /** The user-supplied text to work from (summary, bullet, or free-text facts). */
  text?: string;
  /** For job-based kinds. */
  jobId?: string;
  /** Where an approved suggestion should land. */
  target?: { type: "profile.summary" } | { type: "resume.summary"; resumeId: string } | { type: "resume.bullet"; resumeId: string; experienceIndex: number; original: string } | { type: "resume.experience-bullet-add"; resumeId: string; experienceIndex: number };
};

async function allowedTermsFor(profileId: string) {
  const p = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profileId }, include: { softwareSkills: true, skills: { include: { skill: true } }, certifications: true, experiences: { orderBy: { startDate: "desc" }, take: 8 }, projects: { take: 8 } } });
  return { software: p.softwareSkills.map((s) => s.software), skills: p.skills.map((s) => s.skill.name), certs: p.certifications.map((c) => c.name), profile: p };
}

/** Everything the candidate has actually stated, as plain text. Generated drafts may only use facts found here. */
function candidateFacts(p: Awaited<ReturnType<typeof allowedTermsFor>>) {
  const pr = p.profile;
  return [
    `Name: ${pr.headline ?? ""}`,
    pr.summary ? `Summary: ${pr.summary}` : "",
    pr.yearsExperience != null ? `Years of experience: ${pr.yearsExperience}` : "",
    `Tools: ${p.software.join(", ")}`,
    `Skills: ${p.skills.join(", ")}`,
    `Certifications: ${p.certs.join(", ")}`,
    ...pr.experiences.map((e) => `Role: ${e.title} at ${e.company}. ${e.description ?? ""}`),
    ...pr.projects.map((x) => `Project: ${x.name}. ${[x.role, x.sector, x.lod, x.outcomes].filter(Boolean).join(" ")}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function deterministicAdvice(kind: AiKind, ctx: { diag?: ReturnType<typeof scoreJobMatch>; jobTitle?: string; software?: string[]; skills?: string[]; unlock?: { name: string; jobs: number }[]; gaps?: string[] }): string | null {
  const d = ctx.diag;
  if (kind === "explain-missing" && d) {
    if (!d.missing.length) return `You already cover everything this posting lists (${d.matched.slice(0, 8).join(", ") || "no specific requirements were listed"}). Make sure each one appears in a bullet that shows it in use, not only in a skills list.`;
    return [`These items appear in the posting but not on your profile: ${d.missing.join(", ")}.`, "Why it matters: employers screen for the tools and standards they list first, so gaps here lower your match.", "Honest next steps: if you have real experience, add it to a role or project with what you did. If not, a short course or a small practice model is a legitimate way to start. Only claim what you can discuss in an interview."].join("\n\n");
  }
  if (kind === "job-recommendations" && d) {
    return [`Emphasise what already matches: ${d.matched.slice(0, 8).join(", ") || "nothing specific matched yet"}.`, d.missing.length ? `Close these honestly if you can: ${d.missing.join(", ")}.` : "No listed requirement is missing.", "Put the most relevant project first and make sure each matched tool appears inside a bullet that shows how you used it."].join("\n\n");
  }
  if (kind === "interview-questions" && ctx.jobTitle) {
    const sw = ctx.software?.slice(0, 3) ?? [];
    const sk = ctx.skills?.slice(0, 3) ?? [];
    const qs = [
      `Walk us through a recent project where you worked as ${ctx.jobTitle}. What was your specific contribution?`,
      ...sw.map((s) => `How have you used ${s} on a live project, and what went wrong that you had to fix?`),
      ...sk.map((s) => `Describe a situation where ${s} made a measurable difference to a project.`),
      "How do you handle a disagreement with another discipline over model ownership or a clash resolution?",
      "How do you check the quality of a model before it is shared?",
      "What would you want to learn in your first six months here?",
    ];
    return qs.slice(0, 8).map((q, i) => `${i + 1}. ${q}`).join("\n");
  }
  if (kind === "career-recommendations") {
    const lines = [ctx.unlock?.length ? `Highest leverage: ${ctx.unlock.map((u) => `${u.name} (${u.jobs} job${u.jobs === 1 ? "" : "s"} would move within one skill of a full match)`).join("; ")}.` : "", ctx.gaps?.length ? `Frequently requested and missing from your profile: ${ctx.gaps.join(", ")}.` : ""].filter(Boolean);
    return lines.length ? lines.join("\n\n") : "Your profile already covers the most requested tools and skills in the jobs we track. Keep your best projects and achievements current.";
  }
  return null;
}

export async function requestSuggestion(userId: string, provider: AiProvider | null, input: RequestInput) {
  const profile = await db.bIMProfessionalProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Profile not found");
  const ctxTerms = await allowedTermsFor(profile.id);
  const { software, skills, certs } = ctxTerms;
  const allowed = [...software, ...skills, ...certs];
  const text = (input.text ?? "").trim().slice(0, 4000);
  const meta = AI_KINDS[input.kind];
  if (!meta) throw new Error("Unknown AI action");

  let source = text;
  let userPrompt: string;
  let original: string | null = text || null;
  let fallbackText: string | null = null;

  switch (input.kind) {
    case "rewrite-summary": {
      if (!text) throw new Error("Provide the summary to rewrite.");
      source = `${text}\nTools you list: ${software.join(", ")}\nYears: ${profile.yearsExperience ?? "not stated"}`;
      userPrompt = `Rewrite this professional summary to be clearer and more specific. Facts you may use besides the text: tools listed: ${software.join(", ") || "none"}; years of experience: ${profile.yearsExperience ?? "not stated"}.\n\nSUMMARY:\n${text}`;
      break;
    }
    case "improve-bullet": {
      if (!text) throw new Error("Provide the bullet to improve.");
      userPrompt = `Improve this resume bullet: start with a strong action verb and be specific, using only what it states.\n\nBULLET:\n${text}`;
      break;
    }
    case "achievement-from-facts": {
      if (!text) throw new Error("Describe what you did and any real numbers.");
      userPrompt = `Turn these facts into one resume achievement bullet. Use only these facts.\n\nFACTS:\n${text}`;
      break;
    }
    case "portfolio-description": {
      if (!text) throw new Error("Describe the project: your role, the scope, tools and outcomes.");
      userPrompt = `Write a concise portfolio description (80-130 words) of this BIM project in first person. Use only these facts and do not add numbers, tools or outcomes that are not listed.\n\nFACTS:\n${text}`;
      break;
    }
    case "career-recommendations": {
      const { computeInsights } = await import("./insights");
      const ins = await computeInsights(profile.id);
      const gaps = ins.software.filter((s) => !s.have).slice(0, 4).map((s) => `${s.name} (${s.jobs} jobs)`).concat(ins.skills.filter((s) => !s.have).slice(0, 3).map((s) => `${s.name} (${s.jobs} jobs)`));
      source = `Market data (real, from ${ins.poolSize} active jobs, scope ${ins.scope}):\nMissing and demanded: ${gaps.join(", ") || "none"}\nOne skill away: ${ins.unlockList.map((u) => `${u.name} (${u.jobs})`).join(", ") || "none"}\nYour tools: ${software.join(", ")}\nYour skills: ${skills.join(", ")}`;
      original = null;
      fallbackText = deterministicAdvice("career-recommendations", { unlock: ins.unlockList, gaps });
      userPrompt = `Give 3-5 short, honest career recommendations based ONLY on this data. Do not suggest claiming anything the candidate lacks.\n\n${source}`;
      break;
    }
    case "explain-missing":
    case "job-recommendations":
    case "interview-questions":
    case "cover-letter": {
      if (!input.jobId) throw new Error("Select a job.");
      const job = await db.job.findFirst({ where: { id: input.jobId, status: "ACTIVE" } });
      if (!job) throw new Error("Job not found.");
      const diag = scoreJobMatch(await loadJobScoreProfile(profile.id), job);
      const jobText = `Job: ${job.title} at ${job.companyName}\nRequired tools: ${job.software.join(", ") || "not listed"}\nRequired skills: ${job.skills.join(", ") || "not listed"}\n${job.description.slice(0, 1500)}`;
      original = null;
      if (input.kind === "cover-letter") {
        // Only the candidate's own facts count as "source": the job text may be referenced but cannot supply claims.
        source = `${candidateFacts(ctxTerms)}\n${text}\nApplying for: ${job.title} at ${job.companyName}`;
        original = text || null;
        userPrompt = `Write a short, specific cover letter (max 180 words) for this candidate applying to this job. Use ONLY the candidate facts below. Do not claim any experience, tool, certification or number that is not in the candidate facts. If the job asks for something the candidate lacks, do not mention it.\n\nCANDIDATE FACTS:\n${source}\n\nJOB:\n${jobText}`;
      } else {
        source = `Matched: ${diag.matched.join(", ") || "none"}\nMissing: ${diag.missing.join(", ") || "none"}\n${jobText}`;
        fallbackText = deterministicAdvice(input.kind, { diag, jobTitle: job.title, software: job.software, skills: job.skills });
        userPrompt =
          input.kind === "explain-missing"
            ? `For this job, explain in 2-4 short sentences why each MISSING item matters and what honest, concrete steps a candidate could take to learn or evidence it. Do not suggest the candidate claim it.\n\n${source}`
            : input.kind === "interview-questions"
              ? `Write 8 realistic interview questions for this job (mix technical BIM, coordination and behavioural). Questions only, numbered, no answers.\n\n${source}`
              : `Give up to 5 short recommendations for tailoring this candidate's resume for this job. Only suggest emphasising things listed as MATCHED, and suggest honest ways to close MISSING items. Never suggest adding anything the candidate does not have.\n\n${source}`;
      }
      break;
    }
    default:
      throw new Error("Unknown AI action");
  }

  // ---- call the model (budgeted, retried, falling back to deterministic advice where one exists) ----
  let output: string | null = null;
  let model: string | null = provider?.model ?? null;
  const t0 = performance.now();
  let aiError: AiError | null = null;
  if (provider) {
    try {
      await assertBudget(userId);
      const r = await provider.complete(AI_SYSTEM_PROMPT, userPrompt);
      const res = typeof r === "string" ? { text: r } : r;
      output = res.text;
      model = ("model" in res && res.model) || provider.model;
      await recordUsage({ userId, kind: input.kind, model, inputTokens: "inputTokens" in res ? res.inputTokens : undefined, outputTokens: "outputTokens" in res ? res.outputTokens : undefined, status: "ok", durationMs: Math.round(performance.now() - t0) });
    } catch (e) {
      aiError = e instanceof AiError ? e : new AiError("unavailable", "The AI service is temporarily unavailable. Please try again in a few minutes.");
      if (aiError.kind !== "limit") await recordUsage({ userId, kind: input.kind, model, status: "error", error: aiError.message, durationMs: Math.round(performance.now() - t0) });
      log.warn("ai.request_failed", { userId, kind: input.kind, errorCategory: aiError.kind === "limit" ? "rate_limit" : "external", err: aiError });
    }
  }
  if (output == null) {
    if (meta.fallback && fallbackText) {
      output = fallbackText;
      model = "deterministic";
      await recordUsage({ userId, kind: input.kind, model, status: "fallback" });
    } else if (aiError) throw aiError;
    else throw new AiError("unavailable", "AI assistance is not configured on this server.");
  }

  // Draft kinds are checked against the user's own facts; advice built from data legitimately mentions missing items.
  const flags: AiFlag[] = meta.validate && model !== "deterministic" ? validateAiOutput(source, output, allowed) : [];
  return db.aiSuggestion.create({
    data: {
      userId,
      kind: input.kind,
      targetType: input.target?.type ?? "advice",
      targetId: input.target && "resumeId" in input.target ? input.target.resumeId : null,
      input: { text: source, target: input.target ?? null, jobId: input.jobId ?? null } as unknown as Prisma.InputJsonValue,
      original,
      output,
      flags: flags as unknown as Prisma.InputJsonValue,
      model,
    },
  });
}

/** Approve or reject. Approving may carry the user's own edit of the suggestion, which is re-validated. */
export async function decideSuggestion(userId: string, id: string, decision: "approve" | "reject", editedOutput?: string) {
  const s = await db.aiSuggestion.findFirst({ where: { id, userId, status: "PENDING" } });
  if (!s) throw new Error("Suggestion not found or already decided");
  if (decision === "reject") {
    await db.aiSuggestion.update({ where: { id }, data: { status: "REJECTED", decidedAt: new Date() } });
    return { applied: false };
  }

  const kind = s.kind as AiKind;
  const applies = AI_KINDS[kind]?.applies ?? false;
  const validate = AI_KINDS[kind]?.validate ?? false;
  let finalText = s.output;
  if (validate && s.model !== "deterministic") {
    const profile = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { userId } });
    const { software, skills, certs } = await allowedTermsFor(profile.id);
    finalText = (editedOutput ?? s.output).trim();
    const source = (s.input as { text?: string }).text ?? "";
    // The user may edit, but whatever is saved must still contain only facts they provided.
    const flags = validateAiOutput(source, finalText, [...software, ...skills, ...certs]);
    if (isBlocked(flags)) throw new Error(`Cannot approve: ${flags.filter((f) => f.severity === "block").map((f) => f.message).join(" ")}`);
  }

  const target = (s.input as { target?: RequestInput["target"] | null }).target;
  if (applies && target) await applyTarget(userId, target, finalText);
  await db.aiSuggestion.update({ where: { id }, data: { status: "APPROVED", decidedAt: new Date(), output: finalText } });
  return { applied: applies && !!target };
}

async function applyTarget(userId: string, target: NonNullable<RequestInput["target"]>, text: string) {
  if (target.type === "profile.summary") {
    await db.bIMProfessionalProfile.update({ where: { userId }, data: { summary: text.slice(0, 2000) } });
    return;
  }
  const resume = await db.resume.findFirst({ where: { id: target.resumeId, profile: { userId } } });
  if (!resume?.currentVersionId) throw new Error("Resume not found");
  const v = await db.resumeVersion.findUniqueOrThrow({ where: { id: resume.currentVersionId } });
  const content = structuredClone(v.content) as unknown as ResumeContent;
  if (target.type === "resume.summary") content.summary = text.slice(0, 2000);
  else {
    const exp = content.experiences[target.experienceIndex];
    if (!exp) throw new Error("Role not found");
    const lines = (exp.description ?? "").split("\n");
    if (target.type === "resume.bullet") {
      const i = lines.findIndex((l) => l.replace(/^[•\-*]\s*/, "").trim() === target.original.replace(/^[•\-*]\s*/, "").trim());
      if (i < 0) throw new Error("The original bullet changed; request a new suggestion.");
      lines[i] = `• ${text.replace(/^[•\-*]\s*/, "")}`;
    } else lines.push(`• ${text.replace(/^[•\-*]\s*/, "")}`);
    exp.description = lines.filter((l) => l.trim()).join("\n");
  }
  // New version: the previous version (and any original upload) stays untouched.
  await saveResumeVersion(resume.id, content, "ai-approved", undefined, { label: "AI suggestion approved by you" });
}

export { profileToContent };
