import "server-only";
import { db } from "@/lib/db";
import { activeJobWhere } from "./jobs";

// The active-job sample is shared by every user and changes slowly: cache it briefly instead of re-reading 3,000 rows per dashboard view.
type PoolRow = { id: string; discipline: string | null; software: string[]; skills: string[] };
let poolCache: { at: number; rows: PoolRow[] } | null = null;
const POOL_TTL_MS = 5 * 60_000;
async function activePool(): Promise<PoolRow[]> {
  if (poolCache && Date.now() - poolCache.at < POOL_TTL_MS) return poolCache.rows;
  const rows = await db.job.findMany({ where: activeJobWhere(), select: { id: true, discipline: true, software: true, skills: true }, orderBy: { postedAt: "desc" }, take: 3000 });
  poolCache = { at: Date.now(), rows };
  return rows;
}
export const resetInsightsCache = () => (poolCache = null);

export type DemandRow = { name: string; jobs: number; have: boolean };

/** Market demand derived from real active jobs in the user's discipline (all jobs if the discipline is unset or thin). */
export async function computeInsights(profileId: string) {
  const p = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profileId }, include: { skills: { include: { skill: true } }, softwareSkills: true } });
  const haveSw = new Set(p.softwareSkills.map((s) => s.software.toLowerCase()));
  const haveSk = new Set(p.skills.map((s) => s.skill.name.toLowerCase()));

  const all = await activePool();
  const inDiscipline = p.discipline ? all.filter((j) => j.discipline === p.discipline) : [];
  const pool = inDiscipline.length >= 5 ? inDiscipline : all;

  const count = (pick: (j: (typeof all)[number]) => string[], have: Set<string>) => {
    const m = new Map<string, number>();
    for (const j of pool) for (const x of pick(j)) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, jobs]): DemandRow => ({ name, jobs, have: have.has(name.toLowerCase()) }));
  };
  const software = count((j) => j.software, haveSw);
  const skills = count((j) => j.skills, haveSk);

  // Jobs you are exactly one tool/skill away from.
  let oneAway = 0;
  const unlock = new Map<string, number>();
  for (const j of pool) {
    const missing = [...j.software.filter((s) => !haveSw.has(s.toLowerCase())), ...j.skills.filter((s) => !haveSk.has(s.toLowerCase()))];
    if (missing.length === 1 && j.software.length + j.skills.length >= 2) {
      oneAway++;
      unlock.set(missing[0], (unlock.get(missing[0]) ?? 0) + 1);
    }
  }
  const unlockList = [...unlock.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, jobs]) => ({ name, jobs }));

  return { poolSize: pool.length, scope: pool === all ? "all BIM jobs" : `${p.discipline} jobs`, software, skills, oneAway, unlockList, totalActive: all.length };
}
