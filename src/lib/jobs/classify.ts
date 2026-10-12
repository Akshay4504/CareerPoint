import { BIM_SKILLS, BIM_SOFTWARE, findTaxonomyMatches } from "@/lib/taxonomy";

// Deterministic BIM relevance classification with transparent rules.
// Every point in bimRelevanceScore is listed in `evidence`, and the rule constants are exported so they can be
// reviewed, tested and tuned in one place.

export const BIM_ACCEPT_THRESHOLD = 40; // below this a posting is not a BIM job and is rejected at ingestion
export const BIM_CORE_THRESHOLD = 65; // at or above this the posting is a "core" BIM role

export const RULES = {
  titleSpecificRole: 50,
  titleBimTermOnly: 35,
  perCoreTool: 4,
  maxTools: 20,
  perStandardTerm: 3,
  maxTerms: 15,
  repeatedBimMentions: 5, // "BIM" appears 3+ times in the description
  perResponsibilityLine: 2,
  maxResponsibility: 10,
  mentionOnlyCap: 20, // no BIM in the title and <= 1 distinct tool/term
  nonBimFunctionCap: 25, // sales/marketing/recruiting/etc. without BIM in the title
  itArchitectCap: 15, // "Solution/Software/Cloud Architect" is not a building architect
  toolListCap: 25, // 5+ tools named but no BIM work described (e.g. a product's integration list)
} as const;

type RoleRule = { role: string; re: RegExp };

// Order matters: the first match wins, so specific roles come before generic ones.
export const ROLE_RULES: RoleRule[] = [
  { role: "BIM Structural Engineer", re: /\b(?:bim\b.*\bstructural\b.*\bengineer|structural\b.*\bbim\b.*\bengineer|bim engineer\b.*\bstructural|structural revit engineer)\b/i },
  { role: "BIM Mechanical Engineer", re: /\b(?:bim\b.*\b(?:mechanical|hvac)\b.*\bengineer|(?:mechanical|hvac)\b.*\bbim\b.*\bengineer|bim engineer\b.*\b(?:mechanical|hvac))\b/i },
  { role: "BIM Electrical Engineer", re: /\b(?:bim\b.*\belectrical\b.*\bengineer|electrical\b.*\bbim\b.*\bengineer|bim engineer\b.*\belectrical)\b/i },
  { role: "BIM Plumbing Engineer", re: /\b(?:bim\b.*\b(?:plumbing|piping|public health)\b.*\bengineer|(?:plumbing|piping)\b.*\bbim\b.*\bengineer|bim engineer\b.*\bplumbing)\b/i },
  { role: "BIM MEP Engineer", re: /\b(?:bim\b.*\bmep\b.*\bengineer|\bmep\b.*\b(?:bim|revit)\b.*\bengineer|bim engineer\b.*\bmep|revit\b.*\bmep\b.*\bengineer)\b/i },
  { role: "BIM Architect", re: /\b(?:bim architect|architect\b.*\bbim\b|bim\b.*\barchitect|revit architect)\b/i },
  { role: "BIM Manager", re: /\b(?:bim manager|head of bim|bim director|director\b.*\bbim\b|bim\b.*\bmanager|virtual design (?:and|&) construction manager|vdc manager)\b/i },
  { role: "BIM Lead", re: /\b(?:bim lead|lead bim|bim team lead|principal bim|senior bim lead|bim\b.*\blead\b)\b/i },
  { role: "Information Manager", re: /\b(?:information manager|bim information|information management (?:lead|specialist|coordinator)|iso ?19650 (?:lead|manager))\b/i },
  { role: "BIM Coordinator", re: /\b(?:bim coordinator|bim\b.*\bcoordinat\w*|coordinator\b.*\bbim\b|model coordinator|revit coordinator|clash coordinat\w*)\b/i },
  { role: "VDC Coordinator", re: /\bvdc\b.*\bcoordinator\b|\bvirtual design\b.*\bcoordinator\b/i },
  { role: "VDC Engineer", re: /\bvdc\b.*\b(?:engineer|technician|specialist|modeler|modeller)\b|\bvirtual design (?:and|&) construction\b.*\bengineer\b|\bvdc\b/i },
  { role: "Civil 3D BIM", re: /\bcivil ?3d\b/i },
  { role: "Navisworks Specialist", re: /\bnavisworks\b.*\b(?:specialist|expert|coordinator|technician)\b|\b(?:specialist|expert)\b.*\bnavisworks\b/i },
  { role: "Revit Specialist", re: /\brevit\b.*\b(?:specialist|expert|developer|consultant|automation|manager|lead|engineer)\b/i },
  { role: "Revit Modeler", re: /\brevit\b.*\b(?:model?l?er|technician|drafter|draughtsperson|operator|designer)\b/i },
  { role: "Digital Engineering", re: /\b(?:digital engineer\w*|digital delivery|digital construction|digital design|computational design(?:er)? )\b/i },
  { role: "BIM Engineer", re: /\bbim\b.*\bengineer\b|\bengineer\b.*\bbim\b/i },
  { role: "BIM Modeler", re: /\bbim\b.*\b(?:model?l?er|technician|drafter|draughtsperson|operator|designer|detailer)\b|\b(?:model?l?er|technician|detailer)\b.*\bbim\b/i },
  { role: "BIM Consultant", re: /\bbim\b.*\b(?:consultant|specialist|analyst|advisor|implementation|support|administrator|champion|developer)\b|\b(?:consultant|specialist|analyst)\b.*\bbim\b/i },
];

const TITLE_BIM_TERM = /\b(bim|revit|navisworks|vdc|virtual design|digital engineering|information manager|building information|civil ?3d|tekla|solibri|openbim|iso ?19650)\b/i;
const IT_ARCHITECT = /\b(solutions?|software|cloud|enterprise|data|security|systems?|network|technical|platform|application|integration|infrastructure|devops)\s+(architect|engineer)\b|\bsolutions? (consultant|engineer)\b|\bpre-?sales\b/i;
const NON_BIM_FUNCTION = /\b(sales|marketing|recruit\w*|account (?:executive|manager)|customer (?:success|support)|business development|talent|hr\b|payroll|finance|accountant|data scientist|devops|full[- ]?stack|frontend|backend|qa engineer|support engineer)\b/i;

/** Core BIM tools. AutoCAD / Python / Power BI alone are too generic to prove BIM work, so they are excluded here. */
export const CORE_TOOLS = ["Revit", "Navisworks", "Civil 3D", "Tekla Structures", "Solibri", "Dynamo", "Autodesk Construction Cloud", "BIM 360", "Synchro", "Bentley OpenBuildings", "ProjectWise", "ArchiCAD", "Trimble Connect", "BIMcollab", "Allplan", "Vectorworks", "Grasshopper"];

const STANDARD_TERMS: [string, RegExp][] = [
  ["ISO 19650", /\biso[- ]?19650\b/i],
  ["IFC", /\bifc ?(?:2x3|4)?\b/i],
  ["COBie", /\bcobie\b/i],
  ["LOD", /\blod ?\d{3}\b|\blevel of (?:development|detail)\b/i],
  ["BIM Execution Plan", /\b(?:bim execution plan|\bbep\b|\beir\b|\bmidp\b|\btidp\b)\b/i],
  ["CDE", /\b(?:common data environment|\bcde\b)\b/i],
  ["Clash Detection", /\bclash(?:es)?\b/i],
  ["Federated Models", /\bfederated model/i],
  ["Scan to BIM", /\bscan[- ]to[- ]bim\b|\bpoint cloud/i],
  ["4D/5D BIM", /\b4d\b|\b5d\b/i],
  ["Digital Twin", /\bdigital twin/i],
  ["openBIM", /\bopen ?bim\b/i],
];

const DISCIPLINE_RULES: [string, RegExp][] = [
  ["Architecture", /\barchitect\w*|\bfa[cç]ade\b/i],
  ["Structural", /\bstructur\w*|\brebar\b|\bsteel detail\w*|\bconcrete\b/i],
  ["Mechanical", /\bmechanical|\bhvac\b|\bventilation\b/i],
  ["Electrical", /\belectrical|\blighting\b|\bpower distribution\b/i],
  ["Plumbing", /\bplumbing|\bpiping\b|\bpublic health\b|\bfire (?:protection|fighting)\b/i],
  ["Civil", /\bcivil\b|\bcivil ?3d\b|\bearthworks\b|\bgrading\b/i],
  ["Infrastructure", /\binfrastructure|\brail(?:way)?\b|\bhighway|\bbridge|\btunnel|\butilities\b|\bairport\b/i],
  ["Landscape", /\blandscape\b/i],
  ["Interior", /\binterior(?:s)?\b/i],
  ["MEP", /\bmep\b|\bm&e\b|\bbuilding services\b/i],
];

/** Maps a detailed discipline to the platform-wide discipline used by profiles and filters. */
export function platformDiscipline(d: string | undefined): string | undefined {
  if (!d) return undefined;
  if (["Mechanical", "Electrical", "Plumbing", "MEP"].includes(d)) return "MEP";
  if (["Civil", "Infrastructure"].includes(d)) return "Civil / Infrastructure";
  if (["Architecture", "Landscape", "Interior"].includes(d)) return "Architecture";
  return d;
}

export type Classification = {
  bimRelevanceScore: number;
  tier: "core" | "related" | "excluded";
  accepted: boolean;
  bimRole?: string;
  tools: string[];
  coreTools: string[];
  standards: string[];
  skills: string[];
  disciplines: string[];
  primaryDiscipline?: string;
  evidence: string[];
};

export function classifyJob(input: { title: string; description: string; responsibilities?: string; requirements?: string }): Classification {
  const title = input.title;
  const body = [input.description, input.responsibilities, input.requirements].filter(Boolean).join("\n");
  const all = `${title}\n${body}`;
  const evidence: string[] = [];
  let score = 0;

  const role = ROLE_RULES.find((r) => r.re.test(title));
  const titleHasBim = TITLE_BIM_TERM.test(title);
  if (role) {
    score += RULES.titleSpecificRole;
    evidence.push(`+${RULES.titleSpecificRole} title is a recognised BIM role: ${role.role}`);
  } else if (titleHasBim) {
    score += RULES.titleBimTermOnly;
    evidence.push(`+${RULES.titleBimTermOnly} title contains a BIM term`);
  } else evidence.push("+0 title is not a BIM role");

  const tools = findTaxonomyMatches(all, BIM_SOFTWARE);
  const coreTools = tools.filter((t) => CORE_TOOLS.includes(t));
  const toolPts = Math.min(coreTools.length * RULES.perCoreTool, RULES.maxTools);
  if (toolPts) {
    score += toolPts;
    evidence.push(`+${toolPts} ${coreTools.length} core BIM tool(s): ${coreTools.slice(0, 6).join(", ")}`);
  }

  const standards = STANDARD_TERMS.filter(([, re]) => re.test(all)).map(([n]) => n);
  const termPts = Math.min(standards.length * RULES.perStandardTerm, RULES.maxTerms);
  if (termPts) {
    score += termPts;
    evidence.push(`+${termPts} ${standards.length} BIM standard/process term(s): ${standards.slice(0, 6).join(", ")}`);
  }

  const bimMentions = (body.match(/\bbim\b|\bbuilding information model/gi) ?? []).length;
  if (bimMentions >= 3) {
    score += RULES.repeatedBimMentions;
    evidence.push(`+${RULES.repeatedBimMentions} BIM is mentioned ${bimMentions} times in the description`);
  }

  const respLines = body.split("\n").filter((l) => /\b(coordinat\w*|model(?:l)?ing|modell?ed|clash\w*|audit\w*|federat\w*|issue|publish\w*|manage|produce|develop|maintain)\b/i.test(l) && (/\bbim\b|\brevit\b|\bnavisworks\b|\bmodels?\b/i.test(l)));
  const respPts = Math.min(respLines.length * RULES.perResponsibilityLine, RULES.maxResponsibility);
  if (respPts) {
    score += respPts;
    evidence.push(`+${respPts} ${respLines.length} responsibility line(s) describe BIM work`);
  }

  const distinctSignals = new Set([...coreTools, ...standards]).size;
  if (!titleHasBim && distinctSignals <= 1) {
    const capped = Math.min(score, RULES.mentionOnlyCap);
    if (capped < score) evidence.push(`cap ${RULES.mentionOnlyCap}: BIM is only mentioned in passing (no BIM in title, ${distinctSignals} distinct BIM signal)`);
    score = capped;
  }
  if (!titleHasBim && NON_BIM_FUNCTION.test(title)) {
    const capped = Math.min(score, RULES.nonBimFunctionCap);
    if (capped < score) evidence.push(`cap ${RULES.nonBimFunctionCap}: non-BIM function in title`);
    score = capped;
  }
  if (!titleHasBim && IT_ARCHITECT.test(title)) {
    const capped = Math.min(score, RULES.itArchitectCap);
    if (capped < score) evidence.push(`cap ${RULES.itArchitectCap}: IT/software "architect"/"engineer" role, not a building design role`);
    score = capped;
  }
  if (!titleHasBim && coreTools.length >= 5 && respLines.length < 2) {
    const capped = Math.min(score, RULES.toolListCap);
    if (capped < score) evidence.push(`cap ${RULES.toolListCap}: ${coreTools.length} tools listed but no BIM responsibilities described`);
    score = capped;
  }
  score = Math.max(0, Math.min(100, score));

  const disciplines = DISCIPLINE_RULES.filter(([, re]) => re.test(title)).map(([n]) => n);
  if (!disciplines.length) for (const [n, re] of DISCIPLINE_RULES) if (re.test(body.slice(0, 1500))) disciplines.push(n);
  // Prefer a specific trade over the generic MEP umbrella for the primary discipline.
  const primary = disciplines.find((d) => d !== "MEP") ?? disciplines[0];

  const skills = findTaxonomyMatches(all, BIM_SKILLS);
  const tier = score >= BIM_CORE_THRESHOLD ? "core" : score >= BIM_ACCEPT_THRESHOLD ? "related" : "excluded";
  return { bimRelevanceScore: score, tier, accepted: score >= BIM_ACCEPT_THRESHOLD, bimRole: role?.role, tools, coreTools, standards, skills, disciplines, primaryDiscipline: primary, evidence };
}
