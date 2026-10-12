// Notification event catalogue. Pure data: used by the notifier, the preferences UI and the tests.

export type EventDef = { key: string; label: string; description: string; audience: "candidate" | "employer"; defaultInApp: boolean; defaultEmail: boolean };

export const EVENTS: EventDef[] = [
  // Candidate
  { key: "application.viewed", label: "Employer viewed your application", description: "Only for applications made on CareerPoint, where we can see it happened.", audience: "candidate", defaultInApp: true, defaultEmail: false },
  { key: "application.shortlisted", label: "You were shortlisted", description: "A CareerPoint employer shortlisted your application.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "application.review", label: "Application moved to review", description: "A CareerPoint employer started reviewing your application.", audience: "candidate", defaultInApp: true, defaultEmail: false },
  { key: "application.assessment", label: "Assessment stage", description: "A CareerPoint employer moved you to an assessment.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "application.interview_stage", label: "Interview stage", description: "A CareerPoint employer moved you to the interview stage.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "application.rejected", label: "Application not progressed", description: "A CareerPoint employer closed your application.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "interview.scheduled", label: "Interview scheduled", description: "An interview was scheduled or changed.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "offer.received", label: "Offer received", description: "A CareerPoint employer made you an offer.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "profile.viewed", label: "Verified employer viewed your profile", description: "First-party views on CareerPoint only. We do not track anything on other sites.", audience: "candidate", defaultInApp: true, defaultEmail: false },
  { key: "contact.request", label: "Employer contact request", description: "A verified employer wants to contact you. Your email stays private until you accept.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "job.match", label: "New matching job", description: "A newly discovered job is a strong match for your profile.", audience: "candidate", defaultInApp: true, defaultEmail: false },
  { key: "job.expiring", label: "Saved job expiring", description: "A job you saved is closing soon or was taken down.", audience: "candidate", defaultInApp: true, defaultEmail: false },
  { key: "resume.score_improved", label: "Resume score improved", description: "A new resume version scored higher.", audience: "candidate", defaultInApp: true, defaultEmail: false },
  { key: "message.received", label: "New message", description: "Messages about an application.", audience: "candidate", defaultInApp: true, defaultEmail: true },
  { key: "community.reply", label: "Reply in a community", description: "Someone replied to a post you wrote in a BIM community.", audience: "candidate", defaultInApp: true, defaultEmail: false },
  // Employer
  { key: "application.submitted", label: "New application", description: "A candidate applied to one of your jobs.", audience: "employer", defaultInApp: true, defaultEmail: true },
  { key: "interview.response", label: "Interview response", description: "A candidate confirmed or declined an interview.", audience: "employer", defaultInApp: true, defaultEmail: true },
  { key: "contact.response", label: "Contact request answered", description: "A candidate answered your contact request.", audience: "employer", defaultInApp: true, defaultEmail: true },
  { key: "offer.response", label: "Offer answered", description: "A candidate accepted an offer.", audience: "employer", defaultInApp: true, defaultEmail: true },
  { key: "application.withdrawn", label: "Application withdrawn", description: "A candidate withdrew their application.", audience: "employer", defaultInApp: true, defaultEmail: false },
  { key: "message.received.employer", label: "New candidate message", description: "A candidate replied about an application.", audience: "employer", defaultInApp: true, defaultEmail: true },
  { key: "community.reply.employer", label: "Reply in a community", description: "Someone replied to a post you wrote in a BIM community.", audience: "employer", defaultInApp: true, defaultEmail: false },
];

const BY_KEY = new Map(EVENTS.map((e) => [e.key, e]));
export const eventDef = (key: string) => BY_KEY.get(key);
export const eventsFor = (audience: "candidate" | "employer") => EVENTS.filter((e) => e.audience === audience);

export type ResolvedPref = { event: string; inApp: boolean; email: boolean };

/** Merge stored preference rows over catalogue defaults. Unknown events default to in-app only. */
export function resolvePrefs(stored: { event: string; inApp: boolean; email: boolean }[], event: string): ResolvedPref {
  const row = stored.find((s) => s.event === event);
  if (row) return row;
  const d = BY_KEY.get(event);
  return { event, inApp: d?.defaultInApp ?? true, email: d?.defaultEmail ?? false };
}
