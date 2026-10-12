// Structured resume content stored in ResumeVersion.content (JSON).

export type ResumeExperience = {
  title: string;
  company: string;
  location?: string;
  startDate?: string; // YYYY-MM
  endDate?: string; // YYYY-MM
  current?: boolean;
  description?: string; // bullets separated by newlines
};

export type ResumeEducation = {
  school: string;
  degree?: string;
  field?: string;
  startYear?: number;
  endYear?: number;
};

export type ResumeProject = {
  name: string;
  role?: string;
  sector?: string;
  lod?: string;
  software?: string[];
  year?: number;
  description?: string;
  scale?: string;
  outcomes?: string;
};

export type ResumeLanguage = { name: string; level?: string };

export type CustomSection = { id: string; title: string; body: string };

export const SECTION_KEYS = ["summary", "experience", "software", "skills", "projects", "portfolio", "certifications", "education", "languages"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const TEMPLATES = [
  { id: "classic", label: "Classic", note: "Single column, serif headings. Safest for ATS." },
  { id: "compact", label: "Compact", note: "Dense single column for long careers." },
  { id: "modern", label: "Modern", note: "Sans-serif with accent rules." },
] as const;

export type Layout = {
  template: string;
  /** Display order. Built-in keys plus `custom:<id>` for custom sections. Sections not listed are hidden. */
  order: string[];
};

export type PortfolioRef = { id: string; title: string; description?: string; url?: string };

export type ResumeContent = {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  headline?: string;
  summary?: string;
  yearsExperience?: number;
  discipline?: string;
  software: string[];
  skills: string[];
  certifications: string[];
  experiences: ResumeExperience[];
  educations: ResumeEducation[];
  projects: ResumeProject[];
  links: string[];
  languages?: ResumeLanguage[];
  customSections?: CustomSection[];
  portfolio?: PortfolioRef[];
  layout?: Layout;
};

export function emptyResume(): ResumeContent {
  return { software: [], skills: [], certifications: [], experiences: [], educations: [], projects: [], links: [], languages: [] };
}

export const DEFAULT_ORDER: string[] = ["summary", "experience", "software", "skills", "projects", "portfolio", "certifications", "education", "languages"];

export function layoutOf(c: ResumeContent): Layout {
  return c.layout ?? { template: "classic", order: DEFAULT_ORDER };
}
