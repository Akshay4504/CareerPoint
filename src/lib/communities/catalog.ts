import type { CommunityCategory } from "@prisma/client";

// The fixed set of communities. This is structure, not content: it describes how BIM professionals identify themselves.
// Discussions inside them are written only by real members. Adding a community = adding a row here (synced idempotently).

type Def = { slug: string; name: string; description: string };

export const CATEGORY_LABEL: Record<CommunityCategory, { title: string; blurb: string }> = {
  DISCIPLINE: { title: "By discipline", blurb: "Talk shop with people who model and coordinate the same trades you do." },
  TECHNOLOGY: { title: "By technology", blurb: "Tools, workflows, scripts and troubleshooting for the software you use every day." },
  REGION: { title: "By region", blurb: "Standards, hiring, regulations and meet-ups where you work." },
  LEVEL: { title: "By career level", blurb: "Questions and advice that fit where you are in your BIM career." },
};

const d = (slug: string, name: string, description: string): Def => ({ slug, name, description });

export const CATALOG: Record<CommunityCategory, Def[]> = {
  DISCIPLINE: [
    d("architecture", "Architecture", "Architectural modelling, documentation, design coordination and drawing production."),
    d("structure", "Structure", "Structural modelling, analysis hand-offs, rebar detailing and steel/concrete coordination."),
    d("mechanical", "Mechanical", "HVAC, ductwork and plant: modelling standards, clashes and equipment data."),
    d("electrical", "Electrical", "Power, lighting, containment and low-current systems in BIM."),
    d("plumbing", "Plumbing", "Plumbing, drainage and fire-protection modelling and coordination."),
    d("infrastructure", "Infrastructure", "Roads, rail, utilities and large-scale infrastructure BIM."),
    d("civil-3d", "Civil 3D", "Corridors, surfaces, pipe networks and civil design workflows."),
    d("landscape", "Landscape", "Landscape and external works modelling and coordination."),
    d("interior-design", "Interior Design", "Interior fit-out, FF&E data and interior documentation in BIM."),
  ],
  TECHNOLOGY: [
    d("revit", "Revit", "Families, worksets, views, performance and everyday Revit problem solving."),
    d("navisworks", "Navisworks", "Federated models, clash detection, timeliner and review workflows."),
    d("acc", "ACC", "Autodesk Construction Cloud: Docs, Build, Model Coordination and CDE practice."),
    d("bim-360", "BIM 360", "BIM 360 projects, migration to ACC and legacy workflow questions."),
    d("dynamo", "Dynamo", "Visual scripting graphs, packages and automation for Revit."),
    d("grasshopper", "Grasshopper", "Parametric design with Grasshopper and Rhino.Inside.Revit."),
    d("tekla", "Tekla", "Tekla Structures modelling, detailing and fabrication workflows."),
    d("synchro", "Synchro", "4D scheduling and construction sequencing with Synchro."),
    d("solibri", "Solibri", "Model checking, rulesets, issue management and quality assurance."),
    d("bentley", "Bentley", "MicroStation, OpenRoads, OpenBuildings and ProjectWise."),
  ],
  REGION: [
    d("uae", "UAE BIM Community", "BIM practice, standards, projects and hiring in the United Arab Emirates."),
    d("saudi-arabia", "Saudi BIM Community", "BIM practice, giga-projects and hiring in Saudi Arabia."),
    d("india", "India BIM Community", "BIM practice, standards and careers across India."),
    d("uk", "UK BIM Community", "ISO 19650, UK Framework and BIM practice in the United Kingdom."),
    d("usa", "USA BIM Community", "BIM practice, VDC and careers across the United States."),
    d("qatar", "Qatar BIM Community", "BIM practice, standards and projects in Qatar."),
  ],
  LEVEL: [
    d("students", "BIM Students", "Learning BIM: first models, study paths, internships and first jobs."),
    d("modelers", "BIM Modelers", "Modelling craft, speed, standards and growing beyond production."),
    d("coordinators", "BIM Coordinators", "Clash resolution, meetings, model quality and multi-discipline coordination."),
    d("managers", "BIM Managers", "BIM execution plans, standards, teams, CDEs and delivery management."),
    d("consultants", "BIM Consultants", "Consulting practice: audits, implementation, training and independent work."),
  ],
};

export const CATEGORY_ORDER: CommunityCategory[] = ["DISCIPLINE", "TECHNOLOGY", "REGION", "LEVEL"];
export const ALL_COMMUNITIES = CATEGORY_ORDER.flatMap((c) => CATALOG[c].map((x, i) => ({ ...x, category: c, sortOrder: i })));
