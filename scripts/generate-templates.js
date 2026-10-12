const fs = require('fs');
const path = require('path');

const roles = [
  {
    roleName: 'BIM Manager',
    description: 'Oversees the entire BIM process, sets standards, and manages teams.',
    keywords: ['leadership', 'BIM standards', 'EIR', 'BEP', 'coordination', 'strategy', 'implementation', 'training', 'RFP', 'ROI', 'ISO 19650', 'digital delivery', 'BIM protocols', 'team management'],
    skills: ['Revit', 'Navisworks Manage', 'BIM 360', 'Solibri', 'AutoCAD', 'Dynamo', 'PowerBI', 'Synchro', 'Dalux'],
    verbs: ['Developed', 'Led', 'Managed', 'Implemented', 'Spearheaded', 'Directed', 'Orchestrated', 'Established', 'Guided', 'Supervised'],
    tasks: ['BIM Execution Plans (BEP)', 'organization-wide BIM standards', 'multi-disciplinary clash detection workflows', 'training programs for architectural and engineering staff', 'digital delivery strategies', 'software deployment and upgrades', 'quality assurance protocols for models', 'Employer Information Requirements (EIR)', 'level of development (LOD) matrices', 'BIM coordination meetings', 'subcontractor BIM requirements', 'project lifecycle data management'],
    outcomes: ['reducing project rework by 20%.', 'improving coordination efficiency by 30%.', 'ensuring ISO 19650 compliance.', 'delivering projects ahead of schedule.', 'resulting in $500k savings in clash resolutions.', 'enhancing cross-team collaboration.', 'standardizing outputs across 50+ projects.', 'winning 3 new major contracts.', 'streamlining the digital handover process.', 'increasing model accuracy by 40%.']
  },
  {
    roleName: 'BIM Coordinator',
    description: 'Coordinates models from different disciplines and resolves clashes.',
    keywords: ['clash detection', 'coordination', 'Navisworks', 'multidisciplinary', 'federated models', 'clash reports', 'subcontractor coordination', 'constructability', 'issue tracking', 'RFI'],
    skills: ['Navisworks', 'Revit', 'BIM Track', 'Revizto', 'Procore', 'Dalux', 'AutoCAD MEP', 'Solibri'],
    verbs: ['Coordinated', 'Performed', 'Facilitated', 'Managed', 'Generated', 'Resolved', 'Reviewed', 'Maintained', 'Identified', 'Tracked'],
    tasks: ['clash detection and resolution meetings', 'federated models for constructability reviews', 'weekly clash reports for subcontractors', 'BIM track issues', 'multi-disciplinary coordination workflows', '4D scheduling simulations', 'RFI responses using 3D model data', 'subcontractor model submissions', 'design vs construction model comparisons', 'spatial coordination for MEP systems'],
    outcomes: ['resolving over 1,000 clashes before construction.', 'preventing costly on-site delays.', 'ensuring zero clashes in MEP systems.', 'improving model accuracy by 40%.', 'streamlining communication between trades.', 'reducing RFI count by 25%.', 'keeping the project on schedule.', 'optimizing spatial arrangements for maintenance.', 'facilitating a smoother installation process.', 'achieving 100% compliance with client standards.']
  },
  {
    roleName: 'Revit Modeler',
    description: 'Creates accurate 3D models and construction documentation.',
    keywords: ['modeling', 'drafting', 'families', 'detailing', 'LOD 400', 'BIM content', 'schedules', 'parametric', 'shop drawings', 'as-builts'],
    skills: ['Revit Architecture', 'Revit MEP', 'Revit Structure', 'AutoCAD', 'Dynamo', 'Enscape', 'Navisworks Simulate'],
    verbs: ['Created', 'Developed', 'Produced', 'Modeled', 'Drafted', 'Maintained', 'Extracted', 'Updated', 'Generated', 'Revised'],
    tasks: ['high LOD 3D models for commercial projects', 'custom parametric Revit families', 'accurate construction documentation', 'detailed shop drawings for fabrication', 'material takeoffs and schedules', 'as-built models from point cloud data', 'design iterations based on markup', 'BIM content libraries', 'structural detailing and rebar modeling', 'architectural visualization renders'],
    outcomes: ['meeting tight submission deadlines.', 'improving drafting efficiency by 20%.', 'ensuring high-quality deliverables.', 'facilitating accurate cost estimation.', 'standardizing company family libraries.', 'reducing drafting errors.', 'providing clear instructions for fabricators.', 'enhancing design visualization.', 'supporting successful client presentations.', 'enabling seamless model handover.']
  },
  {
    roleName: 'VDC Engineer',
    description: 'Applies Virtual Design and Construction technologies to improve project delivery.',
    keywords: ['4D', '5D', 'constructability', 'point clouds', 'laser scanning', 'drone surveys', 'VDC', 'preconstruction', 'site logistics', 'estimation'],
    skills: ['Synchro', 'Fuzor', 'Assemble', 'Navisworks', 'ReCap', 'Revit', 'Primavera P6', 'Pix4D'],
    verbs: ['Utilized', 'Executed', 'Integrated', 'Developed', 'Analyzed', 'Conducted', 'Supported', 'Created', 'Simulated', 'Visualized'],
    tasks: ['4D construction sequencing models', '5D cost estimation takeoffs', 'laser scanning and point cloud processing', 'constructability analysis', 'drone survey data integration', 'site logistics planning in 3D', 'VDC implementation for preconstruction', 'AR/VR walk-throughs', 'quantity extraction for bidding', 'virtual mockups for complex assemblies'],
    outcomes: ['optimizing the construction schedule by 2 weeks.', 'identifying major logistical conflicts early.', 'providing accurate quantities for estimating.', 'enhancing client understanding of the build process.', 'improving site safety through virtual planning.', 'reducing material waste.', 'winning project bids through advanced visualization.', 'ensuring precise as-built verification.', 'facilitating better subcontractor planning.', 'driving prefabrication strategies.']
  },
  {
    roleName: 'BIM Technician',
    description: 'Supports the BIM team with drafting, basic modeling, and document control.',
    keywords: ['drafting', '2D/3D', 'document control', 'CAD to BIM', 'markups', 'quality check', 'model maintenance', 'plot styles', 'CDE'],
    skills: ['AutoCAD', 'Revit', 'Bluebeam', 'BIM 360 Docs', 'Excel', 'MicroStation'],
    verbs: ['Drafted', 'Converted', 'Updated', 'Assisted', 'Maintained', 'Organized', 'Processed', 'Prepared', 'Exported', 'Reviewed'],
    tasks: ['2D CAD details into 3D Revit models', 'redline markups from engineers', 'project drawing sets and sheets', 'BIM 360 document control workflows', 'clash detection reports formatting', 'model maintenance and purging', 'IFC and DWG exports', 'PDF plotting and distribution', 'basic architectural modeling', 'information management in the CDE'],
    outcomes: ['ensuring timely delivery of drawing sets.', 'maintaining an organized Common Data Environment.', 'supporting the modeling team efficiently.', 'reducing backlog of markup revisions.', 'improving accuracy of exported files.', 'streamlining the document approval process.', 'maintaining model health and performance.', 'facilitating communication with external consultants.', 'ensuring adherence to CAD/BIM standards.', 'preventing outdated information usage on site.']
  }
];

function generateBullets(role, count) {
  const bullets = new Set();
  while (bullets.size < count) {
    const verb = role.verbs[Math.floor(Math.random() * role.verbs.length)];
    const task = role.tasks[Math.floor(Math.random() * role.tasks.length)];
    const outcome = role.outcomes[Math.floor(Math.random() * role.outcomes.length)];
    bullets.add(`${verb} ${task}, ${outcome}`);
  }
  return Array.from(bullets);
}

const templates = roles.map(role => ({
  roleName: role.roleName,
  description: role.description,
  keywords: role.keywords,
  skills: role.skills,
  bulletTemplates: generateBullets(role, 65), // Generate 65 unique bullets per role
  formatRules: { emphasis: role.roleName.split(' ')[0].toLowerCase() }
}));

const outputPath = path.join(__dirname, '..', 'prisma', 'templates.json');
fs.writeFileSync(outputPath, JSON.stringify(templates, null, 2));
console.log('Generated templates to prisma/templates.json');
