import {
  BIM_CERTIFICATIONS,
  BIM_SKILLS,
  BIM_SOFTWARE,
  findTaxonomyMatches,
  inferDiscipline,
} from "@/lib/taxonomy";
import { emptyResume, type ResumeContent, type ResumeEducation, type ResumeExperience, type ResumeProject } from "./types";

// Deterministic, dependency-free resume parser. No LLM: the same text always yields the same structure.

const SECTION_ALIASES: Record<string, string[]> = {
  summary: ["summary", "profile", "professional summary", "about", "about me", "objective", "career objective"],
  experience: ["experience", "work experience", "professional experience", "employment", "employment history", "work history", "career history"],
  education: ["education", "academic background", "qualifications", "academics", "education and training"],
  skills: ["skills", "technical skills", "core skills", "key skills", "competencies", "core competencies", "software", "software skills", "tools"],
  certifications: ["certifications", "certificates", "licenses", "licences", "certifications and licenses", "accreditations"],
  languages: ["languages", "language skills", "languages spoken"],
  projects: ["projects", "key projects", "selected projects", "project experience", "notable projects", "project highlights"],
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_TOKEN = `(?:${MONTH_RE}\\.?\\s+\\d{4}|\\d{1,2}[/-]\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|present|current|now|ongoing|till date)`, "i");

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[•●▪◦■►➢]/g, "•")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sectionKey(line: string): string | null {
  const cleaned = line.replace(/[:\-–_]+$/g, "").replace(/^[#\s]+/, "").trim().toLowerCase();
  if (!cleaned || cleaned.length > 40) return null;
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(cleaned)) return key;
  }
  return null;
}

export function splitSections(text: string): { header: string[]; sections: Record<string, string[]> } {
  const header: string[] = [];
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const key = sectionKey(line.trim());
    if (key) {
      current = key;
      sections[key] ??= [];
      continue;
    }
    if (current) sections[current].push(line);
    else header.push(line);
  }
  return { header, sections };
}

export function parseDate(token: string): string | null {
  const t = token.trim().toLowerCase().replace(/\./g, "");
  if (/^(present|current|now|ongoing|till date)$/.test(t)) return null;
  let m = t.match(new RegExp(`^(${MONTH_RE})\\s+(\\d{4})$`, "i"));
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    return `${m[2]}-${String(mon).padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01`;
  return null;
}

function isCurrentToken(token: string) {
  return /^(present|current|now|ongoing|till date)$/i.test(token.trim());
}

export function extractContact(text: string) {
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  const phone = text.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/g)?.find((p) => p.replace(/\D/g, "").length >= 9 && p.replace(/\D/g, "").length <= 15 && !new RegExp(`^${DATE_TOKEN}$`).test(p.trim()));
  const links = Array.from(text.matchAll(/(?:https?:\/\/|www\.)[^\s)>,]+|(?:linkedin\.com|github\.com|behance\.net)\/[^\s)>,]+/gi)).map((m) => m[0].replace(/[.;]+$/, ""));
  return { email, phone: phone?.trim(), links: Array.from(new Set(links)) };
}

function guessName(header: string[], email?: string): string | undefined {
  for (const raw of header.slice(0, 6)) {
    const line = raw.trim();
    if (!line || line.length > 50) continue;
    if (/[@\d|/\\:]/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (words.every((w) => /^[A-Za-z'.-]+$/.test(w)) && !/resume|curriculum|vitae|cv/i.test(line)) {
      return words.map((w) => (w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");
    }
  }
  if (email) {
    const local = email.split("@")[0].replace(/[0-9]+/g, "").split(/[._-]/).filter(Boolean);
    if (local.length >= 2) return local.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  return undefined;
}

const TITLE_RE = /\b(bim|revit|vdc|architect|engineer|coordinator|manager|modeller|modeler|technician|designer|drafter|draftsman|detailer|specialist|consultant|lead|director|analyst|developer|intern|trainee|associate)\b/i;

function guessHeadline(header: string[], name?: string): string | undefined {
  for (const raw of header.slice(0, 10)) {
    const line = raw.trim();
    if (!line || line === name || line.length > 80 || /@|https?:|\d{5,}/.test(line)) continue;
    if (TITLE_RE.test(line) && line.split(/\s+/).length <= 10) return line;
  }
  return undefined;
}

function parseExperience(allLines: string[]): ResumeExperience[] {
  const lines = allLines.map((l) => l.trim()).filter(Boolean);
  const isBulletLine = (l: string) => /^[•\-*]\s*/.test(l);
  const isDateLine = (l: string) => !isBulletLine(l) && l.length < 120 && RANGE_RE.test(l);
  // A header line is a date line, or a short non-bullet line followed within two lines by a date line.
  const isHeader = (i: number) => {
    const l = lines[i];
    if (isBulletLine(l)) return false;
    if (isDateLine(l)) return true;
    if (l.length > 100) return false;
    return (i + 1 < lines.length && isDateLine(lines[i + 1])) || (i + 2 < lines.length && !isBulletLine(lines[i + 1]) && lines[i + 1].length <= 100 && isDateLine(lines[i + 2]));
  };

  const out: ResumeExperience[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isHeader(i)) {
      i++;
      continue;
    }
    const head: string[] = [];
    while (i < lines.length && !isDateLine(lines[i])) head.push(lines[i++]);
    if (i >= lines.length) break;
    const dateLine = lines[i++];
    const m = dateLine.match(RANGE_RE)!;
    const rest = dateLine.replace(RANGE_RE, "").replace(/[|,()–—-]+\s*$/g, "").replace(/^[|,()–—-]+\s*/g, "").trim();
    if (rest) head.push(rest);
    const parts = head.join(" | ").split(/\s+(?:\||@|at|—|–|-)\s+|\s*\|\s*|,\s(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
    let title = parts[0] ?? "";
    let company = parts[1] ?? "";
    if (!TITLE_RE.test(title) && TITLE_RE.test(company)) [title, company] = [company, title];
    const endCurrent = isCurrentToken(m[2]);
    const exp: ResumeExperience = {
      title: title || "Role",
      company: company || "Company not specified",
      startDate: parseDate(m[1]) ?? undefined,
      endDate: endCurrent ? undefined : (parseDate(m[2]) ?? undefined),
      current: endCurrent,
    };
    const desc: string[] = [];
    while (i < lines.length && !isHeader(i)) {
      const l = lines[i++];
      if (!exp.location && !isBulletLine(l) && /^[A-Z][A-Za-z .'-]+,\s?[A-Z][A-Za-z .'-]+$/.test(l)) exp.location = l;
      else desc.push(l.replace(/^[•\-*]\s*/, "• "));
    }
    exp.description = desc.join("\n").trim() || undefined;
    out.push(exp);
  }
  return out;
}

function parseEducation(lines: string[]): ResumeEducation[] {
  const out: ResumeEducation[] = [];
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (block.length) blocks.push(block);
      block = [];
      continue;
    }
    block.push(line);
  }
  if (block.length) blocks.push(block);
  for (const b of blocks) {
    const joined = b.join(" | ");
    const years = Array.from(joined.matchAll(/\b(19|20)\d{2}\b/g)).map((m) => Number(m[0]));
    const degree = joined.match(/\b(b\.?\s?(?:arch|eng|tech|sc|a)\.?|m\.?\s?(?:arch|eng|tech|sc|a)\.?|bachelor[^|,]*|master[^|,]*|diploma[^|,]*|ph\.?d\.?|b\.?e\.?|m\.?e\.?)\b/i)?.[0];
    const school = b.find((l) => /(university|institute|college|school|academy|polytechnic)/i.test(l));
    if (!school && !degree) continue;
    out.push({
      school: (school ?? b[0]).replace(/\b(19|20)\d{2}\b.*$/, "").replace(/[|,–—-]+\s*$/g, "").trim() || b[0],
      degree: degree?.trim(),
      field: joined.match(/\bin\s+([A-Za-z &/]+?)(?:\s*[|,(]|$)/i)?.[1]?.trim(),
      startYear: years.length > 1 ? Math.min(...years) : undefined,
      endYear: years.length ? Math.max(...years) : undefined,
    });
  }
  return out;
}

function parseProjects(lines: string[], globalSoftware: string[]): ResumeProject[] {
  const out: ResumeProject[] = [];
  let cur: ResumeProject | null = null;
  let desc: string[] = [];
  const flush = () => {
    if (cur) {
      const d = desc.join("\n").trim();
      cur.description = d || undefined;
      const sw = findTaxonomyMatches(`${cur.name} ${d}`, BIM_SOFTWARE).filter((s) => globalSoftware.includes(s));
      cur.software = sw;
      cur.lod = d.match(/\bLOD\s?[1-5]00\b/i)?.[0].toUpperCase().replace(/LOD(?=\d)/, "LOD ");
      const y = d.match(/\b(19|20)\d{2}\b/)?.[0];
      cur.year = y ? Number(y) : undefined;
      out.push(cur);
    }
    cur = null;
    desc = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[•\-*]/.test(line) && cur) desc.push(line.replace(/^[•\-*]\s*/, "• "));
    else if (!/^[•\-*]/.test(line) && line.length < 90 && (!cur || desc.length > 0)) {
      flush();
      cur = { name: line.replace(/[:\-–]+$/, "").trim() };
    } else if (cur) desc.push(line);
  }
  flush();
  return out;
}

const LEVEL_RE = /\b(native|fluent|proficient|professional|advanced|intermediate|conversational|basic|beginner|elementary|bilingual|mother tongue)\b/i;

export function parseLanguages(lines: string[]) {
  const out: { name: string; level?: string }[] = [];
  for (const part of lines.join("\n").split(/[\n,;|•]/)) {
    const t = part.trim();
    if (!t) continue;
    const level = t.match(LEVEL_RE)?.[0];
    const name = t.replace(/\(.*?\)/g, "").replace(LEVEL_RE, "").replace(/[-–:]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^[A-Za-z][A-Za-z ]{1,25}$/.test(name) && !out.some((l) => l.name.toLowerCase() === name.toLowerCase())) out.push({ name: name[0].toUpperCase() + name.slice(1), level: level?.toLowerCase() });
  }
  return out.slice(0, 10);
}

export function estimateYears(experiences: ResumeExperience[], now = new Date()): number | undefined {
  const spans: [number, number][] = [];
  for (const e of experiences) {
    if (!e.startDate) continue;
    const [sy, sm] = e.startDate.split("-").map(Number);
    const start = sy * 12 + (sm - 1);
    let end: number;
    if (e.current || !e.endDate) end = now.getFullYear() * 12 + now.getMonth();
    else {
      const [ey, em] = e.endDate.split("-").map(Number);
      end = ey * 12 + (em - 1);
    }
    if (end >= start) spans.push([start, end]);
  }
  if (!spans.length) return undefined;
  spans.sort((a, b) => a[0] - b[0]);
  // Merge overlapping spans so concurrent jobs are not double counted.
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s] as [number, number]);
  }
  const months = merged.reduce((n, [a, b]) => n + (b - a), 0);
  return Math.floor(months / 12);
}

function splitList(lines: string[]): string[] {
  return lines
    .join("\n")
    .split(/[\n,;•|]/)
    .map((s) => s.replace(/^[-*:\s]+|\s+$/g, "").replace(/^[A-Za-z ]{3,25}:\s*/, ""))
    .filter((s) => s.length > 1 && s.length < 60);
}

export function parseResumeText(rawText: string): ResumeContent {
  const text = normalizeText(rawText);
  const out = emptyResume();
  const { header, sections } = splitSections(text);

  const contact = extractContact(header.join("\n") || text.slice(0, 600));
  out.email = contact.email;
  out.phone = contact.phone;
  out.links = contact.links;
  out.name = guessName(header, contact.email);
  out.headline = guessHeadline(header, out.name);

  out.summary = sections.summary?.join(" ").replace(/\s+/g, " ").trim() || undefined;
  out.experiences = parseExperience(sections.experience ?? []);
  out.educations = parseEducation(sections.education ?? []);

  // Software / skills / certs: scan the whole document against the taxonomy, so unlabelled sections still count.
  out.software = findTaxonomyMatches(text, BIM_SOFTWARE);
  out.skills = findTaxonomyMatches(text, BIM_SKILLS);
  const certText = [...(sections.certifications ?? [])].join("\n");
  const certs = new Set(findTaxonomyMatches(certText || text, BIM_CERTIFICATIONS));
  for (const line of splitList(sections.certifications ?? [])) {
    if (/certif|license|licen|accredit|professional|autodesk|iso|rics|leed|pmp/i.test(line)) certs.add(line);
  }
  out.certifications = Array.from(certs).slice(0, 20);

  out.languages = parseLanguages(sections.languages ?? []);
  out.projects = parseProjects(sections.projects ?? [], out.software);
  out.yearsExperience = estimateYears(out.experiences);
  const disc = inferDiscipline(`${out.headline ?? ""} ${out.experiences.map((e) => e.title).join(" ")} ${out.summary ?? ""}`);
  out.discipline = disc ?? undefined;
  const loc = header.map((l) => l.trim()).find((l) => /^[A-Z][A-Za-z .'-]+,\s?[A-Z][A-Za-z .'-]+$/.test(l));
  out.location = loc;
  return out;
}
