/* Register a job source and queue its first run.
 *   npm run source:add -- GREENHOUSE planradar "PlanRadar"
 *   npm run source:add -- LEVER doxel "Doxel"
 *   npm run source:add -- ASHBY speckle "Speckle"
 *   npm run source:add -- RSS https://example.com/jobs.rss "Example feed"
 *   npm run source:add -- CAREER_PAGE https://example.com/jobs-sitemap.xml "Example Co"   (schema.org JobPosting pages)
 */
import { PrismaClient, type SourceType } from "@prisma/client";
import { DEFAULT_RELIABILITY } from "../src/lib/jobs/connectors";
import { QUEUES, enqueue } from "../src/lib/queue/queue";

const db = new PrismaClient();
const [type, value, name] = process.argv.slice(2);
const TYPES = ["GREENHOUSE", "LEVER", "ASHBY", "RSS", "JSON", "CAREER_PAGE"];

async function main() {
  if (!TYPES.includes(type) || !value || !name) throw new Error(`usage: source:add -- <${TYPES.join("|")}> <board|slug|url> "<name>"`);
  let url: string | null = null;
  let config: Record<string, unknown> = {};
  if (type === "GREENHOUSE" || type === "ASHBY") config = { board: value, company: name };
  else if (type === "LEVER") config = { company: value, display: name };
  else if (type === "CAREER_PAGE") config = { company: name, sitemaps: [value] };
  else url = value;
  const existing = await db.jobSource.findFirst({ where: { type: type as SourceType, name } });
  const s = existing ?? (await db.jobSource.create({ data: { name, type: type as SourceType, url, config: config as never, reliability: DEFAULT_RELIABILITY[type] ?? 70 } }));
  await enqueue(QUEUES.health, { sourceId: s.id }, { dedupeKey: `health:${s.id}` });
  await enqueue(QUEUES.discover, { sourceId: s.id }, { dedupeKey: `discover:${s.id}`, maxAttempts: 3 });
  console.log(`${existing ? "Existing" : "Added"} source ${s.id} (${type} ${value}); discovery queued. Run \`npm run worker\`.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => db.$disconnect());
