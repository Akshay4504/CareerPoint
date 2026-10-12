// Minimal robots.txt support. We only ever fetch what robots.txt permits for our user agent.

export const BOT_NAME = "CareerPointBot";
export const USER_AGENT = `${BOT_NAME}/1.0 (+https://careerpoint.example/bot; job aggregation, honours robots.txt)`;

type Rule = { allow: boolean; path: string };

export type RobotsPolicy = { rules: Rule[]; crawlDelayMs: number | null };

/** Parses the group that applies to us (our own token first, otherwise `*`). */
export function parseRobots(text: string): RobotsPolicy {
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow") cur.rules.push({ allow: true, path: val });
    else if (key === "disallow") cur.rules.push({ allow: false, path: val });
    else if (key === "crawl-delay" && Number.isFinite(Number(val))) cur.delay = Number(val) * 1000;
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== "*" && BOT_NAME.toLowerCase().includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  const g = ours ?? star;
  return { rules: g?.rules ?? [], crawlDelayMs: g?.delay ?? null };
}

const matches = (rulePath: string, path: string) => {
  if (!rulePath) return false;
  const re = new RegExp("^" + rulePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return re.test(path);
};

/** Longest matching rule wins; Allow beats Disallow on ties; empty Disallow allows everything. */
export function isAllowed(policy: RobotsPolicy, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of policy.rules) {
    if (!r.path) continue;
    if (matches(r.path, pathAndQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}
