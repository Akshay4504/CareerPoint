import type { ApplicationStatus } from "@prisma/client";

// Application lifecycle. Pure rules: who may move an application where, and how its history is presented.
//
// Honesty rules baked in:
//  - NATIVE applications (employer is on CareerPoint) are moved by the employer; the platform has real evidence.
//  - EXTERNAL applications are tracked by the candidate. Every stage after "applied" is SELF-REPORTED and is labelled
//    as such. CareerPoint never claims an external employer received, viewed or processed anything.

export const STAGE_ORDER: ApplicationStatus[] = ["DISCOVERED", "SAVED", "PINNED", "APPLYING", "APPLIED", "RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"];

export const STAGE_LABEL: Record<ApplicationStatus, string> = {
  DISCOVERED: "Discovered",
  SAVED: "Saved",
  PINNED: "Pinned",
  APPLYING: "Applying",
  APPLIED: "Applied",
  RECRUITER_REVIEW: "Recruiter review",
  SHORTLISTED: "Shortlisted",
  ASSESSMENT: "Assessment",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
};

/** Stages that exist as real Application rows. DISCOVERED/SAVED/PINNED are derived from interactions. */
export const APPLICATION_STAGES: ApplicationStatus[] = ["APPLYING", "APPLIED", "RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"];
export const PRE_APPLICATION_STAGES: ApplicationStatus[] = ["DISCOVERED", "SAVED", "PINNED"];
export const OPEN_STAGES: ApplicationStatus[] = ["APPLYING", "APPLIED", "RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER"];
export const CLOSED_STAGES: ApplicationStatus[] = ["ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"];
/** Stages after submission in which an employer has (or is claimed by the candidate to have) engaged. */
export const ENGAGED_STAGES: ApplicationStatus[] = ["RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER", "ACCEPTED"];

export const isOpen = (s: ApplicationStatus) => OPEN_STAGES.includes(s);
export const isTerminal = (s: ApplicationStatus) => CLOSED_STAGES.includes(s);

export type Actor = "CANDIDATE" | "EMPLOYER" | "SYSTEM";

/** What an employer may do with a NATIVE application (CareerPoint-integrated employer). */
const EMPLOYER_MOVES: Partial<Record<ApplicationStatus, ApplicationStatus[]>> = {
  APPLIED: ["RECRUITER_REVIEW", "SHORTLISTED", "REJECTED"],
  RECRUITER_REVIEW: ["SHORTLISTED", "ASSESSMENT", "INTERVIEW", "REJECTED"],
  SHORTLISTED: ["RECRUITER_REVIEW", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"],
  ASSESSMENT: ["SHORTLISTED", "INTERVIEW", "REJECTED"],
  INTERVIEW: ["SHORTLISTED", "ASSESSMENT", "OFFER", "REJECTED"],
  OFFER: ["INTERVIEW", "REJECTED"], // rescinding an offer is a rejection; acceptance belongs to the candidate
};

/** What a candidate may do with a NATIVE application: only withdraw, or answer an offer. */
const CANDIDATE_NATIVE_MOVES: Partial<Record<ApplicationStatus, ApplicationStatus[]>> = {
  APPLIED: ["WITHDRAWN"],
  RECRUITER_REVIEW: ["WITHDRAWN"],
  SHORTLISTED: ["WITHDRAWN"],
  ASSESSMENT: ["WITHDRAWN"],
  INTERVIEW: ["WITHDRAWN"],
  OFFER: ["ACCEPTED", "WITHDRAWN"],
};

const FORWARD: ApplicationStatus[] = ["APPLIED", "RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER", "ACCEPTED"];

/** What a candidate may self-report for an EXTERNAL application: forward through the funnel, or close it. */
function candidateExternalMoves(from: ApplicationStatus): ApplicationStatus[] {
  if (from === "APPLYING") return ["APPLIED", "WITHDRAWN"];
  const i = FORWARD.indexOf(from);
  if (i < 0 || isTerminal(from)) return [];
  return [...FORWARD.slice(i + 1), "REJECTED", "WITHDRAWN"];
}

export function allowedMoves(app: { status: ApplicationStatus; external: boolean }, actor: Actor): ApplicationStatus[] {
  if (isTerminal(app.status) || actor === "SYSTEM") return [];
  if (actor === "EMPLOYER") return app.external ? [] : (EMPLOYER_MOVES[app.status] ?? []);
  return app.external ? candidateExternalMoves(app.status) : (CANDIDATE_NATIVE_MOVES[app.status] ?? []);
}

export const canMove = (app: { status: ApplicationStatus; external: boolean }, actor: Actor, to: ApplicationStatus) => allowedMoves(app, actor).includes(to);

/** Whether a transition is a candidate's own claim about an external employer (must be shown as self-reported). */
export const isSelfReported = (app: { external: boolean }, actor: Actor, to: ApplicationStatus) => app.external && actor === "CANDIDATE" && to !== "APPLYING";

/** Notification event produced by an employer's move on a native application. */
export const EMPLOYER_MOVE_EVENT: Partial<Record<ApplicationStatus, string>> = {
  RECRUITER_REVIEW: "application.review",
  SHORTLISTED: "application.shortlisted",
  ASSESSMENT: "application.assessment",
  INTERVIEW: "application.interview_stage",
  OFFER: "offer.received",
  REJECTED: "application.rejected",
};

// ---------------------------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------------------------

export type Evidence = "platform" | "employer" | "self-reported";
export type TimelineEntry = { key: string; at: Date; label: string; detail?: string; evidence: Evidence; tone: "neutral" | "ok" | "bad" | "accent" };

type InteractionIn = { id: string; type: string; createdAt: Date; meta?: unknown };
type EventIn = { id: string; type: string; createdAt: Date; actorRole: string | null; fromStatus: ApplicationStatus | null; toStatus: ApplicationStatus | null; note: string | null; visibleToCandidate: boolean };
type InterviewIn = { id: string; scheduledAt: Date; status: string; mode: string; candidateResponse: string | null; respondedAt: Date | null; createdAt: Date };

const POSITIVE: ApplicationStatus[] = ["SHORTLISTED", "INTERVIEW", "OFFER", "ACCEPTED"];

/**
 * Candidate-facing timeline. It contains ONLY things that actually happened and were recorded:
 * job views, saves/pins, apply clicks, status events and interviews. Internal events are excluded.
 * External-employer progress is always labelled "self-reported".
 */
export function buildTimeline(input: { external: boolean; interactions: InteractionIn[]; events: EventIn[]; interviews?: InterviewIn[] }): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const firstOf = (t: string) => input.interactions.filter((i) => i.type === t).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  const viewed = firstOf("VIEWED");
  if (viewed) out.push({ key: `i:${viewed.id}`, at: viewed.createdAt, label: "Job discovered", evidence: "platform", tone: "neutral" });
  const saved = firstOf("SAVED");
  if (saved) out.push({ key: `i:${saved.id}`, at: saved.createdAt, label: "Saved", evidence: "platform", tone: "neutral" });
  const pinned = firstOf("PINNED");
  if (pinned) out.push({ key: `i:${pinned.id}`, at: pinned.createdAt, label: "Pinned", evidence: "platform", tone: "neutral" });
  for (const c of input.interactions.filter((i) => i.type === "APPLY_CLICK")) out.push({ key: `i:${c.id}`, at: c.createdAt, label: "Application started", detail: "You opened the employer's application page.", evidence: "platform", tone: "accent" });

  for (const e of input.events) {
    if (!e.visibleToCandidate) continue; // internal recruiter activity never reaches the candidate
    const self = e.actorRole === "CANDIDATE";
    const evidence: Evidence = input.external ? "self-reported" : self ? "platform" : "employer";
    const to = e.toStatus;
    switch (e.type) {
      case "apply_click":
        break; // represented by the interaction
      case "applied":
        out.push({ key: `e:${e.id}`, at: e.createdAt, label: "Applied on CareerPoint", detail: "Your application was delivered to the employer on CareerPoint.", evidence: "platform", tone: "ok" });
        break;
      case "candidate_confirmed_submission":
        out.push({ key: `e:${e.id}`, at: e.createdAt, label: "Applied", detail: "You told us you submitted the application on the employer's site. We can't verify receipt.", evidence: "self-reported", tone: "ok" });
        break;
      case "recruiter_viewed":
        out.push({ key: `e:${e.id}`, at: e.createdAt, label: "Employer viewed your application", evidence: "employer", tone: "accent" });
        break;
      case "status_changed":
        if (to) out.push({ key: `e:${e.id}`, at: e.createdAt, label: STAGE_LABEL[to], detail: e.note ?? undefined, evidence, tone: to === "REJECTED" ? "bad" : POSITIVE.includes(to) ? "ok" : "neutral" });
        break;
      case "withdrawn":
        out.push({ key: `e:${e.id}`, at: e.createdAt, label: "Withdrawn", evidence: "platform", tone: "neutral" });
        break;
      case "expired":
        out.push({ key: `e:${e.id}`, at: e.createdAt, label: "Expired", detail: e.note ?? "The application was never marked as submitted.", evidence: "platform", tone: "neutral" });
        break;
      default:
        break;
    }
  }

  for (const iv of input.interviews ?? []) {
    out.push({ key: `iv:${iv.id}`, at: iv.createdAt, label: iv.status === "CANCELLED" ? "Interview cancelled" : "Interview scheduled", detail: `${iv.mode.toLowerCase()} · ${iv.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, evidence: "employer", tone: iv.status === "CANCELLED" ? "bad" : "ok" });
    if (iv.candidateResponse && iv.respondedAt) out.push({ key: `ivr:${iv.id}`, at: iv.respondedAt, label: iv.candidateResponse === "ACCEPTED" ? "You confirmed the interview" : "You declined the interview", evidence: "platform", tone: iv.candidateResponse === "ACCEPTED" ? "ok" : "neutral" });
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
}

/** Kanban columns for the candidate tracker. Pre-application stages come from saved/pinned jobs. */
export const KANBAN_COLUMNS: { key: string; label: string; statuses: ApplicationStatus[] }[] = [
  { key: "saved", label: "Saved & pinned", statuses: ["SAVED", "PINNED"] },
  { key: "applying", label: "Applying", statuses: ["APPLYING"] },
  { key: "applied", label: "Applied", statuses: ["APPLIED", "RECRUITER_REVIEW"] },
  { key: "shortlisted", label: "Shortlisted", statuses: ["SHORTLISTED", "ASSESSMENT"] },
  { key: "interview", label: "Interview", statuses: ["INTERVIEW"] },
  { key: "offer", label: "Offer", statuses: ["OFFER", "ACCEPTED"] },
  { key: "closed", label: "Closed", statuses: ["REJECTED", "WITHDRAWN", "EXPIRED"] },
];

/** Native = applied for inside CareerPoint to an employer on the platform. Everything else is an external application. */
export const isNativeJob = (j: { companyId?: string | null; applyUrl?: string | null }) => !!j.companyId && !j.applyUrl;
