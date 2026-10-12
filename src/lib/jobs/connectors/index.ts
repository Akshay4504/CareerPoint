import type { SourceType } from "@prisma/client";
import type { JobSourceConnector } from "../types";
import { ashbyConnector } from "./ashby";
import { careerPageConnector } from "./career-page";
import { jsonFeedConnector, rssConnector } from "./feeds";
import { greenhouseConnector } from "./greenhouse";
import { leverConnector } from "./lever";

const REGISTRY: Partial<Record<SourceType, JobSourceConnector>> = {
  GREENHOUSE: greenhouseConnector,
  LEVER: leverConnector,
  ASHBY: ashbyConnector,
  RSS: rssConnector,
  JSON: jsonFeedConnector,
  CAREER_PAGE: careerPageConnector,
};

export function getConnector(type: SourceType): JobSourceConnector {
  const c = REGISTRY[type];
  if (!c) throw new Error(`No connector for source type ${type}`);
  return c;
}

export const CONNECTOR_TYPES = Object.keys(REGISTRY) as SourceType[];

/** Default reliability per kind of source: official > ATS > feeds. Admins can override per source. */
export const DEFAULT_RELIABILITY: Record<string, number> = { CAREER_PAGE: 95, GREENHOUSE: 90, LEVER: 90, ASHBY: 90, RSS: 65, JSON: 65, MANUAL: 50 };

export { greenhouseConnector, leverConnector, ashbyConnector, rssConnector, jsonFeedConnector, careerPageConnector };
