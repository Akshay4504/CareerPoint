// Canonical BIM / AEC vocabulary. Used by the resume parser, scorer, matcher and forms.
// Each entry: canonical name + aliases matched case-insensitively on word boundaries.

export type TaxonomyEntry = { name: string; aliases?: string[]; category?: string };

export const BIM_SOFTWARE: TaxonomyEntry[] = [
  { name: "Revit", aliases: ["autodesk revit", "revit mep", "revit architecture", "revit structure"], category: "Authoring" },
  { name: "Navisworks", aliases: ["navis works", "navisworks manage"], category: "Coordination" },
  { name: "AutoCAD", aliases: ["auto cad", "autocad mep", "autocad architecture"], category: "CAD" },
  { name: "ArchiCAD", aliases: ["archicad", "graphisoft archicad"], category: "Authoring" },
  { name: "Tekla Structures", aliases: ["tekla"], category: "Structural" },
  { name: "Dynamo", aliases: ["dynamo bim", "dynamo for revit"], category: "Automation" },
  { name: "Grasshopper", aliases: ["rhino grasshopper"], category: "Automation" },
  { name: "Rhino", aliases: ["rhinoceros", "rhino 3d"], category: "Modeling" },
  { name: "SketchUp", aliases: ["sketch up"], category: "Modeling" },
  { name: "Solibri", aliases: ["solibri model checker", "solibri office"], category: "Model checking" },
  { name: "BIM 360", aliases: ["bim360"], category: "CDE" },
  { name: "Autodesk Construction Cloud", aliases: ["acc", "autodesk docs", "autodesk build"], category: "CDE" },
  { name: "Trimble Connect", category: "CDE" },
  { name: "ProjectWise", aliases: ["bentley projectwise"], category: "CDE" },
  { name: "Bentley OpenBuildings", aliases: ["openbuildings designer", "openbuildings"], category: "Authoring" },
  { name: "MicroStation", aliases: ["microstation connect"], category: "CAD" },
  { name: "OpenRoads", aliases: ["openroads designer"], category: "Infrastructure" },
  { name: "Civil 3D", aliases: ["civil3d", "autodesk civil 3d"], category: "Infrastructure" },
  { name: "InfraWorks", category: "Infrastructure" },
  { name: "Synchro", aliases: ["synchro 4d", "synchro pro"], category: "4D/5D" },
  { name: "Primavera", aliases: ["primavera p6", "oracle primavera"], category: "4D/5D" },
  { name: "MS Project", aliases: ["microsoft project"], category: "4D/5D" },
  { name: "Cost X", aliases: ["costx"], category: "4D/5D" },
  { name: "Autodesk Forge", aliases: ["forge viewer", "aps", "autodesk platform services"], category: "Development" },
  { name: "Lumion", category: "Visualization" },
  { name: "Enscape", category: "Visualization" },
  { name: "Twinmotion", category: "Visualization" },
  { name: "3ds Max", aliases: ["3dsmax", "3d studio max"], category: "Visualization" },
  { name: "Unreal Engine", category: "Visualization" },
  { name: "Python", category: "Automation" },
  { name: "C#", aliases: ["c sharp", "csharp"], category: "Automation" },
  { name: "Power BI", aliases: ["powerbi"], category: "Data" },
  { name: "Bluebeam", aliases: ["bluebeam revu"], category: "Documentation" },
  { name: "Procore", category: "CDE" },
  { name: "Aconex", category: "CDE" },
  { name: "BIMcollab", aliases: ["bim collab"], category: "Issue management" },
  { name: "Allplan", category: "Authoring" },
  { name: "Vectorworks", category: "Authoring" },
  { name: "Plant 3D", aliases: ["autodesk plant 3d"], category: "Plant" },
  { name: "Cadmatic", category: "Plant" },
  { name: "ReCap", aliases: ["autodesk recap"], category: "Reality capture" },
  { name: "Cyclone", aliases: ["leica cyclone"], category: "Reality capture" },
];

export const BIM_SKILLS: TaxonomyEntry[] = [
  { name: "Clash Detection", aliases: ["clash coordination", "clash resolution", "clash analysis"], category: "Coordination" },
  { name: "BIM Coordination", aliases: ["model coordination", "multidisciplinary coordination", "mep coordination"], category: "Coordination" },
  { name: "BIM Management", aliases: ["bim manager"], category: "Management" },
  { name: "BIM Execution Plan", aliases: ["bep", "bim execution planning"], category: "Management" },
  { name: "ISO 19650", aliases: ["iso19650", "iso-19650"], category: "Standards" },
  { name: "COBie", category: "Standards" },
  { name: "IFC", aliases: ["industry foundation classes", "ifc4", "ifc2x3"], category: "Standards" },
  { name: "openBIM", aliases: ["open bim"], category: "Standards" },
  { name: "LOD", aliases: ["level of development", "level of detail", "lod 300", "lod 350", "lod 400"], category: "Standards" },
  { name: "Common Data Environment", aliases: ["cde"], category: "Management" },
  { name: "Quantity Takeoff", aliases: ["quantity take-off", "qto", "5d bim", "5d"], category: "Cost" },
  { name: "4D Simulation", aliases: ["4d bim", "4d planning", "construction sequencing", "4d"], category: "Planning" },
  { name: "Scan to BIM", aliases: ["scan-to-bim", "point cloud", "laser scanning"], category: "Reality capture" },
  { name: "Digital Twin", aliases: ["digital twins"], category: "Data" },
  { name: "Parametric Design", aliases: ["computational design", "generative design"], category: "Automation" },
  { name: "Family Creation", aliases: ["revit families", "parametric families", "family editor"], category: "Authoring" },
  { name: "MEP Modeling", aliases: ["mep design", "mechanical modeling", "electrical modeling", "plumbing modeling"], category: "Discipline" },
  { name: "Structural Modeling", aliases: ["structural bim", "rebar detailing", "steel detailing"], category: "Discipline" },
  { name: "Architectural Modeling", aliases: ["architectural bim"], category: "Discipline" },
  { name: "Shop Drawings", aliases: ["fabrication drawings", "spool drawings"], category: "Documentation" },
  { name: "BIM Standards", aliases: ["bim protocol", "bim guidelines"], category: "Management" },
  { name: "Model Auditing", aliases: ["model checking", "model validation", "qa/qc", "bim qa"], category: "Quality" },
  { name: "Visual Programming", aliases: ["scripting"], category: "Automation" },
  { name: "Construction Documentation", aliases: ["construction drawings"], category: "Documentation" },
  { name: "Facility Management", aliases: ["fm handover", "asset information model"], category: "Operations" },
  { name: "Sustainability Analysis", aliases: ["energy analysis", "leed", "breeam"], category: "Analysis" },
  { name: "Project Management", aliases: ["pmp", "stakeholder management"], category: "Management" },
  { name: "Team Leadership", aliases: ["team lead", "mentoring"], category: "Management" },
];

export const BIM_CERTIFICATIONS: TaxonomyEntry[] = [
  { name: "Autodesk Certified Professional: Revit", aliases: ["acp revit", "autodesk certified professional revit", "revit certified professional"] },
  { name: "Autodesk Certified User: Revit", aliases: ["acu revit"] },
  { name: "BRE BIM Level 2 Certification", aliases: ["bre bim", "bre global bim"] },
  { name: "ISO 19650 Certification", aliases: ["iso 19650 certified", "iso 19650 certificate", "bsi iso 19650"] },
  { name: "buildingSMART Professional Certification", aliases: ["buildingsmart professional", "buildingsmart certified"] },
  { name: "Autodesk Certified Professional: Navisworks", aliases: ["acp navisworks"] },
  { name: "PMP", aliases: ["project management professional"] },
  { name: "LEED Accredited Professional", aliases: ["leed ap", "leed green associate"] },
  { name: "RICS", aliases: ["rics chartered"] },
  { name: "Chartered Engineer", aliases: ["ceng", "pe license", "professional engineer"] },
  { name: "Associate Digital Construction Professional", aliases: ["adcp"] },
  { name: "Certified BIM Manager", aliases: ["cbm"] },
];

export const DISCIPLINES = [
  "Architecture",
  "Structural",
  "MEP",
  "Civil / Infrastructure",
  "Coordination",
  "BIM Management",
  "Construction / VDC",
  "Facilities / Operations",
  "Computational Design",
] as const;

export const DISCIPLINE_HINTS: Record<string, string[]> = {
  Architecture: ["architect", "architectural", "interior", "facade", "façade"],
  Structural: ["structural", "structure", "rebar", "steel", "tekla", "concrete"],
  MEP: ["mep", "mechanical", "electrical", "plumbing", "hvac", "fire protection"],
  "Civil / Infrastructure": ["civil", "infrastructure", "road", "bridge", "rail", "highway", "utilities"],
  Coordination: ["coordinator", "coordination", "clash"],
  "BIM Management": ["bim manager", "bim lead", "head of bim", "information manager", "bim director"],
  "Construction / VDC": ["vdc", "construction", "4d", "5d", "site", "contractor"],
  "Facilities / Operations": ["facility", "facilities", "asset", "digital twin", "cobie", "operations"],
  "Computational Design": ["computational", "parametric", "dynamo", "grasshopper", "automation", "developer"],
};

export const SENIORITY = ["Intern", "Junior", "Mid", "Senior", "Lead", "Manager", "Director"] as const;
export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Freelance", "Internship"] as const;
export const REMOTE_PREFS = ["On-site", "Hybrid", "Remote"] as const;
export const SECTORS = ["Commercial", "Residential", "Healthcare", "Education", "Industrial", "Data centers", "Transport", "Energy", "Water", "Mixed-use", "Other"] as const;
export const LOD_LEVELS = ["LOD 100", "LOD 200", "LOD 300", "LOD 350", "LOD 400", "LOD 500"] as const;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const reCache = new Map<string, RegExp>();
function termRegex(term: string): RegExp {
  let re = reCache.get(term);
  if (!re) {
    // Word-ish boundaries that also work for terms ending in symbols such as "C#".
    re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, "i");
    reCache.set(term, re);
  }
  return re;
}

export function findTaxonomyMatches(text: string, entries: TaxonomyEntry[]): string[] {
  const found: string[] = [];
  for (const entry of entries) {
    const terms = [entry.name, ...(entry.aliases ?? [])];
    if (terms.some((t) => termRegex(t).test(text))) found.push(entry.name);
  }
  return found;
}

export function canonicalize(name: string, entries: TaxonomyEntry[]): string {
  const n = name.trim();
  for (const e of entries) {
    if ([e.name, ...(e.aliases ?? [])].some((t) => t.toLowerCase() === n.toLowerCase())) return e.name;
  }
  return n;
}

export const softwareNames = BIM_SOFTWARE.map((s) => s.name);
export const skillNames = BIM_SKILLS.map((s) => s.name);

// Cross-cutting disciplines are down-weighted so a specific trade (MEP, Structural...) wins when present.
const DISCIPLINE_WEIGHT: Record<string, number> = { Coordination: 0.3, "BIM Management": 0.5, "Construction / VDC": 0.5, "Computational Design": 0.8 };

export function inferDiscipline(text: string): string | null {
  const t = text.toLowerCase();
  let best: string | null = null;
  let bestScore = 0;
  for (const [d, hints] of Object.entries(DISCIPLINE_HINTS)) {
    const score = hints.reduce((n, h) => n + (t.includes(h) ? 1 : 0), 0) * (DISCIPLINE_WEIGHT[d] ?? 1);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function inferSeniority(title: string, years?: number | null): string | null {
  const t = title.toLowerCase();
  if (/\b(intern|trainee|graduate)\b/.test(t)) return "Intern";
  if (/\b(director|head of|vp)\b/.test(t)) return "Director";
  if (/\b(manager)\b/.test(t)) return "Manager";
  if (/\b(lead|principal|staff)\b/.test(t)) return "Lead";
  if (/\b(senior|sr\.?)\b/.test(t)) return "Senior";
  if (/\b(junior|jr\.?|assistant|associate)\b/.test(t)) return "Junior";
  if (years != null) {
    if (years < 2) return "Junior";
    if (years < 5) return "Mid";
    if (years < 9) return "Senior";
    return "Lead";
  }
  return null;
}
