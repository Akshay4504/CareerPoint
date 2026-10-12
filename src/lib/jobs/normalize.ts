import { SECTORS } from "@/lib/taxonomy";

// Pure text helpers used by connectors and the pipeline. Deterministic, no I/O.

export function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/li|\/div|\/h\d|\/tr)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Decodes entity-escaped HTML (as some ATS APIs return) and strips it. */
export function htmlToText(s: string): string {
  const decoded = /&lt;\/?[a-z]/i.test(s) ? s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : s;
  return stripHtml(decoded);
}

const RESP_HEAD = /^(?:key\s+)?(responsibilities|what you(?:'|’)ll do|what you will do|the role|your role|duties|day[- ]to[- ]day|about the role|role overview)\b[:\s]*$/i;
const REQ_HEAD = /^(?:minimum\s+|basic\s+|preferred\s+)?(requirements|qualifications|what you(?:'|’)ll bring|what we(?:'|’)re looking for|who you are|skills(?: and experience)?|experience|you have|about you)\b[:\s]*$/i;
const OTHER_HEAD = /^(benefits|what we offer|about us|about the company|why join|perks|compensation|equal opportunity|how to apply|salary)\b[:\s]*$/i;

/** Splits a plain-text description into responsibilities / requirements by their headings when present. */
export function splitSections(text: string): { responsibilities?: string; requirements?: string } {
  const lines = text.split("\n");
  let cur: "resp" | "req" | "other" | null = null;
  const out = { resp: [] as string[], req: [] as string[] };
  for (const raw of lines) {
    const l = raw.trim();
    const head = l.replace(/[:：]$/, "");
    if (l.length < 60 && RESP_HEAD.test(head)) cur = "resp";
    else if (l.length < 60 && REQ_HEAD.test(head)) cur = "req";
    else if (l.length < 60 && OTHER_HEAD.test(head)) cur = "other";
    else if (cur === "resp") out.resp.push(l);
    else if (cur === "req") out.req.push(l);
  }
  const clean = (a: string[]) => a.filter(Boolean).join("\n").trim() || undefined;
  return { responsibilities: clean(out.resp), requirements: clean(out.req) };
}

const COUNTRIES: Record<string, string> = {
  "united states": "United States", usa: "United States", us: "United States", "u.s.": "United States", "united kingdom": "United Kingdom", uk: "United Kingdom", "u.k.": "United Kingdom", england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom",
  india: "India", canada: "Canada", australia: "Australia", germany: "Germany", france: "France", spain: "Spain", italy: "Italy", netherlands: "Netherlands", ireland: "Ireland", "united arab emirates": "United Arab Emirates", uae: "United Arab Emirates",
  "saudi arabia": "Saudi Arabia", qatar: "Qatar", singapore: "Singapore", "hong kong": "Hong Kong", china: "China", japan: "Japan", "south africa": "South Africa", "new zealand": "New Zealand", poland: "Poland", portugal: "Portugal", sweden: "Sweden", norway: "Norway", denmark: "Denmark", finland: "Finland", switzerland: "Switzerland", belgium: "Belgium", austria: "Austria", brazil: "Brazil", mexico: "Mexico", malaysia: "Malaysia", philippines: "Philippines", egypt: "Egypt", kuwait: "Kuwait", oman: "Oman", bahrain: "Bahrain", turkey: "Turkey", romania: "Romania", "czech republic": "Czech Republic",
};
const US_STATES = new Set(["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"]);
const CA_PROV = new Set(["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE"]);

export function detectRemoteType(...texts: Array<string | undefined>): "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN" {
  const t = texts.filter(Boolean).join(" \n ").toLowerCase();
  if (/\bhybrid\b/.test(t)) return "HYBRID";
  if (/\b(fully remote|100% remote|remote[- ]first|remote(?: position| role| work)?|work from home|wfh|anywhere)\b/.test(t) && !/\bnot remote\b|\bno remote\b|\bon-?site only\b/.test(t)) return "REMOTE";
  if (/\bon-?site\b|\bin[- ]office\b|\boffice[- ]based\b/.test(t)) return "ONSITE";
  return "UNKNOWN";
}

/** "Bengaluru, Karnataka, India" → { city, country }. Unknown parts stay undefined — never guessed. */
export function parseLocation(raw?: string): { location?: string; city?: string; country?: string } {
  if (!raw) return {};
  const location = raw.replace(/\s+/g, " ").trim().replace(/^remote\s*[-–,:]?\s*/i, "").trim() || raw.trim();
  const parts = location.split(/[,|/;]| - /).map((p) => p.trim()).filter(Boolean);
  let country: string | undefined;
  for (const p of [...parts].reverse()) {
    const c = COUNTRIES[p.toLowerCase().replace(/\.$/, "")];
    if (c) {
      country = c;
      break;
    }
  }
  if (!country && parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (US_STATES.has(last.toUpperCase())) country = "United States";
    else if (CA_PROV.has(last.toUpperCase())) country = "Canada";
  }
  const first = parts[0];
  const city = first && !COUNTRIES[first.toLowerCase()] && !/^remote$/i.test(first) && first.length <= 60 ? first : undefined;
  return { location: raw.trim(), city, country };
}

/** Years of experience asked for. "3-5 years" → 3..5, "5+ years" → 5.., "minimum 7 years" → 7. */
export function parseExperience(text: string): { min?: number; max?: number } {
  const range = text.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i);
  if (range && Number(range[1]) <= Number(range[2])) return { min: Number(range[1]), max: Number(range[2]) };
  const plus = text.match(/(?:minimum(?: of)?|at least|min\.?)?\s*(\d{1,2})\s*\+\s*(?:years?|yrs?)/i) ?? text.match(/(?:minimum(?: of)?|at least)\s*(\d{1,2})\s*(?:years?|yrs?)/i);
  if (plus && Number(plus[1]) <= 40) return { min: Number(plus[1]) };
  const plain = text.match(/(\d{1,2})\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?(?:relevant\s+|professional\s+|hands[- ]on\s+)?experience/i);
  if (plain && Number(plain[1]) <= 40) return { min: Number(plain[1]) };
  return {};
}

const CURRENCY_SYMBOLS: Record<string, string> = { "$": "USD", "£": "GBP", "€": "EUR", "₹": "INR", "A$": "AUD", "C$": "CAD", "S$": "SGD", AED: "AED" };

function num(s: string, k?: string) {
  const n = Number(s.replace(/[, ]/g, ""));
  return k?.toLowerCase() === "k" ? n * 1000 : n;
}

/** Parses an explicit salary range from text. Only returns values that are stated; hourly figures are ignored. */
export function parseSalary(text: string): { min?: number; max?: number; currency?: string } {
  const re = /(A\$|C\$|S\$|[$£€₹]|USD|GBP|EUR|INR|AED|CAD|AUD)\s?(\d{1,3}(?:[, ]\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?\s*(?:-|–|—|to)\s*(?:(?:A\$|C\$|S\$|[$£€₹]|USD|GBP|EUR|INR|AED|CAD|AUD)\s?)?(\d{1,3}(?:[, ]\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?/;
  const m = text.match(re);
  if (!m) return {};
  const cur = CURRENCY_SYMBOLS[m[1]] ?? m[1];
  const ctx = text.slice(Math.max(0, (m.index ?? 0) - 25), (m.index ?? 0) + m[0].length + 30).toLowerCase();
  if (/\b(per hour|\/hr|hourly|an hour|per day|daily)\b/.test(ctx)) return {};
  let min = num(m[2], m[3] ?? m[5]);
  let max = num(m[4], m[5] ?? m[3]);
  if (min > max) [min, max] = [max, min];
  if (min < 1000 && !/k/i.test(`${m[3] ?? ""}${m[5] ?? ""}`)) return {}; // too small to be a yearly figure
  return { min: Math.round(min), max: Math.round(max), currency: cur };
}

export function detectEmploymentType(...texts: Array<string | undefined>): string | undefined {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "Internship";
  if (/\bfreelance\b/.test(t)) return "Freelance";
  if (/\b(contract|contractor|fixed[- ]term|temporary)\b/.test(t)) return "Contract";
  if (/\bpart[- ]time\b/.test(t)) return "Part-time";
  if (/\bfull[- ]time\b|\bpermanent\b|\bregular\b/.test(t)) return "Full-time";
  return undefined;
}

export function detectIndustry(text: string): string | undefined {
  const t = text.toLowerCase();
  const map: [string, RegExp][] = [
    ["Healthcare", /\b(health ?care|hospital|clinic|medical)\b/],
    ["Data centers", /\bdata cent(?:er|re)s?\b/],
    ["Transport", /\b(airport|rail(?:way)?|metro|highway|road|transport(?:ation)?|bridge|tunnel)\b/],
    ["Energy", /\b(energy|power|solar|wind|oil|gas|renewable|utilities)\b/],
    ["Water", /\b(water|wastewater)\b/],
    ["Education", /\b(education|school|universit(?:y|ies)|campus)\b/],
    ["Residential", /\b(residential|housing|apartment)\b/],
    ["Industrial", /\b(industrial|factory|manufacturing|plant)\b/],
    ["Commercial", /\b(commercial|office|retail|hospitality)\b/],
    ["Mixed-use", /\bmixed[- ]use\b/],
  ];
  for (const [name, re] of map) if (re.test(t) && (SECTORS as readonly string[]).includes(name)) return name;
  return undefined;
}

const TRACKING = /^(utm_[a-z]+|gh_src|gh_jid|lever-source|lever-origin|source|ref|referrer|src|trk|trackingId|fbclid|gclid|mc_[a-z]+)$/i;

/** Canonical form of a job URL: lowercase host, no fragment, tracking params removed, params sorted, no trailing slash. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k) || k.toLowerCase() === "gh_jid").sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

const COMPANY_SUFFIX = /\b(inc|incorporated|llc|llp|ltd|limited|plc|gmbh|ag|sa|s\.a\.|bv|b\.v\.|pty|pvt|private|corp|corporation|co|company|group|holdings|the|international|intl|global|services|solutions|technologies|technology|consulting|consultants|engineering|engineers)\b\.?/g;

export function normalizeCompany(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(COMPANY_SUFFIX, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const TITLE_NOISE = /\b(m\/f\/d|f\/m\/d|m\/f|\(m\/w\/d\)|urgent|immediate(?:ly)?|hiring|remote|hybrid|onsite|on-site|full[- ]time|part[- ]time|contract|permanent|new)\b/g;

export function normalizeTitle(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(?\b[mwfdx]\/[mwfdx](?:\/[mwfdx])?\b\)?/g, " ").replace(/[()]/g, " ").replace(/\bsr\.?\b/g, "senior").replace(/\bjr\.?\b/g, "junior").replace(/\bmodell?er\b/g, "modeler").replace(TITLE_NOISE, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Word-shingle set used for description similarity. */
export function shingles(text: string, k = 4): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const out = new Set<string>();
  if (words.length < k) {
    out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i <= words.length - k; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const wb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  return jaccard(wa, wb);
}
