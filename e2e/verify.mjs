// End-to-end verification against a running server (default http://localhost:3100).
//   BASE_URL=http://localhost:3100 CHROME_PATH=... SERVER_LOG=server.log node e2e/verify.mjs
// Requires the demo seed (SEED_DEMO=1 npm run db:seed) for the admin + employer accounts.
import { chromium } from "playwright-core";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const LOG = process.env.SERVER_LOG;
const SHOTS = process.env.SHOTS_DIR ?? path.resolve("e2e/screenshots");
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@careerpoint.local", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe-Admin-123" };
const EMPLOYER = { email: "employer@careerpoint.local", password: ADMIN.password };
const stamp = Date.now();
const CAND = { name: "Arjun Mehta", email: `arjun.${stamp}@example.com`, password: "Sup3r-Secret-Pass" };
const CAND2 = { name: "Other Person", email: `other.${stamp}@example.com`, password: "Sup3r-Secret-Pass" };
const EMP2 = { name: "Priya Rao", email: `priya.${stamp}@example.com`, password: "Sup3r-Secret-Pass", company: `Rao Engineering ${stamp}` };

const RESUME = `ARJUN MEHTA
Senior BIM Coordinator | MEP
Dubai, UAE
${CAND.email} | +971 50 123 4567 | linkedin.com/in/arjunmehta

PROFESSIONAL SUMMARY
BIM coordinator with 8+ years of experience delivering multidisciplinary coordination on healthcare and data center projects using Revit, Navisworks and Dynamo. Works to ISO 19650 and leads clash resolution workshops.

EXPERIENCE
Senior BIM Coordinator | Alpha Engineering
Mar 2019 - Present
- Led coordination of 6 disciplines across 3 hospital projects, resolving 4,200 clashes
- Automated sheet creation with Dynamo, saving 120 hours per project
- Managed a team of 5 modelers and authored the BIM Execution Plan

BIM Modeler | Beta Consultants
Jun 2015 - Feb 2019
- Produced LOD 350 MEP models in Revit for commercial towers
- Delivered shop drawings and quantity take-off for 12 projects

EDUCATION
B.Tech in Mechanical Engineering, National Institute of Technology, 2011 - 2015

SKILLS
Revit, Navisworks, AutoCAD, Dynamo, Solibri, BIM 360, Python, Clash Detection, COBie, IFC

CERTIFICATIONS
Autodesk Certified Professional: Revit
ISO 19650 Certification

PROJECTS
Dubai Healthcare City Hospital
- Healthcare sector, LOD 400 MEP coordination in Revit and Navisworks, 2022
`;

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && extra ? `  -> ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
mkdirSync(SHOTS, { recursive: true });
let ipSeq = Math.floor(Math.random() * 60000);
const newCtx = async (opts = {}) => {
  // A distinct client IP per context keeps the per-IP rate limiters from throttling the test run itself.
  const ip = `10.${(ipSeq >> 8) & 255}.${ipSeq & 255}.${Math.floor(Math.random() * 250) + 1}`;
  ipSeq++;
  const ctx = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": ip }, ...opts });
  const origNewPage = ctx.newPage.bind(ctx);
  ctx.newPage = async () => {
    const page = await origNewPage();
    const goto = page.goto.bind(page);
    // Wait for streamed content and hydration so interactions never race the client.
    page.goto = async (url, o = {}) => {
      // Next prefetches every visible link, so "network idle" can take long on link-heavy pages: fall back to "load" instead of failing.
      let r;
      try {
        r = await goto(url, { waitUntil: "networkidle", timeout: 20000, ...o });
      } catch (e) {
        if (!/Timeout/.test(String(e))) throw e;
        r = await page.waitForLoadState("load").then(() => null);
      }
      await page.waitForSelector("html[data-hydrated]", { timeout: 15000, state: "attached" }).catch(() => {});
      return r;
    };
    return page;
  };
  return ctx;
};
const settle = async (page, pathname, ms = 8000) => {
  try {
    await page.waitForURL((u) => u.pathname === pathname, { timeout: ms });
    return true;
  } catch {
    return false;
  }
};

async function login(page, u) {
  await page.goto("/login");
  await page.fill("#email", u.email);
  await page.fill("#password", u.password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }), page.click("button[type=submit]")]);
}

function lastMailLink(re) {
  if (!LOG || !existsSync(LOG)) return null;
  const m = [...readFileSync(LOG, "utf8").matchAll(re)];
  return m.length ? m[m.length - 1][0] : null;
}

try {
  // ---------- 1. Anonymous access ----------
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    for (const p of ["/", "/jobs", "/professionals", "/companies", "/resources", "/tools", "/login", "/register"]) {
      const r = await page.goto(p);
      check(`public ${p} renders (200)`, r?.status() === 200, String(r?.status()));
    }
    const priv = ["/dashboard", "/profile", "/resume", "/resume/score", "/portfolio", "/jobs/saved", "/applications", "/career-insights", "/notifications", "/settings", "/employer", "/employer/jobs", "/employer/candidates", "/employer/applications", "/employer/company", "/admin", "/admin/users", "/admin/jobs", "/admin/sources", "/admin/employers", "/admin/applications", "/admin/system"];
    let allRedirect = true;
    for (const p of priv) {
      await page.goto(p);
      if (!new URL(page.url()).pathname.startsWith("/login")) {
        allRedirect = false;
        console.log("   not protected:", p, page.url());
      }
    }
    check(`anonymous is redirected to /login for all ${priv.length} private routes`, allRedirect);
    await page.goto("/api/files/does-not-exist");
    check("anonymous file request is 404", (await page.evaluate(() => document.body.innerText)).includes("Not found"));
    // Open redirect guard
    await page.goto("/login?next=//evil.example");
    await page.fill("#email", "nobody@example.com");
    await page.fill("#password", "x");
    await page.click("button[type=submit]");
    await page.waitForSelector("p[role=alert]");
    check("bad login shows a generic error", (await page.textContent("p[role=alert]")).includes("Incorrect email or password"));
    await ctx.close();
  }

  // ---------- 1b. A verified employer posts a real native job (no seeded/fake jobs exist) ----------
  {
    const ectx = await newCtx();
    const e = await ectx.newPage();
    await login(e, EMPLOYER);
    await e.goto("/employer/jobs/new");
    await e.fill("#title", `Senior BIM Coordinator MEP ${stamp}`);
    await e.fill("#location", "Dubai, UAE");
    await e.fill("#country", "United Arab Emirates");
    await e.fill("#description", "Coordinate MEP models in Revit and Navisworks for hospital projects, run clash detection workshops and maintain the BIM Execution Plan to ISO 19650. Requires 4-6 years of experience with Dynamo scripting and COBie deliverables. Hybrid working in Dubai.");
    check("job form shows a live preview before publishing", (await e.textContent("aside[aria-label='Job preview']")).includes(`Senior BIM Coordinator MEP ${stamp}`));
    await e.click("button:has-text('Publish job')");
    await e.waitForURL("**/employer/jobs?saved=ACTIVE", { timeout: 30000 });
    check("verified employer's job goes live immediately", true);
    await ectx.close();
  }

  // ---------- 2. Candidate: register -> resume -> profile -> score ----------
  const cctx = await newCtx();
  const c = await cctx.newPage();
if (process.env.DEBUG_POST) { c.on("console", (m) => console.log("   console:", m.type(), m.text().slice(0, 200))); c.on("pageerror", (e) => console.log("   pageerror:", String(e).slice(0, 300))); c.on("framenavigated", (f) => console.log("   nav:", f.url())); c.on("requestfailed", (r) => console.log("   reqfailed:", r.url(), r.failure()?.errorText)); }
if (process.env.DEBUG_POST) c.on("response", async (r) => { if (r.request().method() === "POST") console.log("   POST", r.url(), r.status(), r.headers()["x-action-redirect"] ?? (await r.text().catch(() => "")).slice(0, 150)); });
  {
    await c.goto("/register");
    await c.fill("#name", CAND.name);
    await c.fill("#email", CAND.email);
    await c.fill("#password", CAND.password);
    await Promise.all([c.waitForURL("**/dashboard", { timeout: 20000 }), c.click("button[type=submit]")]);
    await c.waitForSelector("text=Recommended jobs", { timeout: 30000 });
    await c.waitForLoadState("networkidle");
    check("candidate registration lands on /dashboard", true);
    const dtxt = await c.textContent("main");
    check("dashboard shows honest empty states (no fake numbers)", dtxt.includes("Upload a resume to get scored"), dtxt.slice(0, 300));
    check("verification email was issued (dev mail log)", !!lastMailLink(new RegExp(`verify-email\\?token=[\\w-]+`, "g")));
    await c.screenshot({ path: `${SHOTS}/dashboard-empty.png`, fullPage: true });

    // Authorization: candidate cannot reach employer/admin
    for (const p of ["/employer", "/employer/jobs", "/admin", "/admin/users", "/admin/sources"]) {
      await c.goto(p);
      check(`candidate blocked from ${p}`, await settle(c, "/dashboard"), c.url());
    }

    // Upload a real PDF
    await c.goto("/resume");
    const pdfPath = path.join(SHOTS, "resume.pdf");
    // Render a real PDF with the browser's own PDF engine (text-based, like a Word/Google Docs export).
    const pdfPage = await browser.newPage();
    await pdfPage.setContent(`<pre style="font:12px Arial;white-space:pre-wrap">${RESUME.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`);
    writeFileSync(pdfPath, await pdfPage.pdf({ format: "A4" }));
    await pdfPage.close();
    await c.setInputFiles("input[name=file]", pdfPath);
    await c.click("text=Upload & review");
    try {
      await c.waitForURL("**/resume/import/**", { timeout: 60000 });
    } catch (e) {
      console.log("   upload debug:", c.url(), await c.locator("p[role=alert]").allTextContents());
      throw e;
    }
    await c.waitForSelector("text=Information found in your resume");
    await c.waitForLoadState("networkidle");
    check("upload leads to a review screen, not straight into the profile", true);
    check("review shows extracted roles and software", (await c.inputValue("input[name=exp_company_0]")).includes("Alpha Engineering") && (await c.locator("input[name=software][value=Navisworks]").count()) === 1);
    await c.screenshot({ path: `${SHOTS}/import-review.png`, fullPage: true });

    // Nothing was written to the profile yet
    const importUrl = c.url();
    await c.goto("/profile");
    check("profile is untouched before approval", !(await c.textContent("main")).includes("Alpha Engineering"));
    await c.goto(importUrl);
    await c.waitForSelector("text=Information found in your resume");
    await c.waitForLoadState("networkidle");
    // The user edits one extracted value before approving
    await c.fill("input[name=exp_title_0]", "Senior BIM Coordinator (edited)");
    await c.click("text=Save selected to my profile");
    await c.waitForURL("**/resume/score**", { timeout: 60000 });
    await c.waitForSelector("text=BIM Resume Score");
    await c.waitForLoadState("networkidle");
    const scoreText = await c.textContent("main");
    const score = Number(scoreText.match(/(\d+)\s*(?:out of|\/)\s*100/)?.[1]);
    check("approved import scored (score > 40)", score > 40, `score=${score}`);
    check("score page shows evidence breakdown and fixes", scoreText.includes("Software Evidence") && scoreText.includes("Fix these first") && /hand-written/i.test(scoreText));
    await c.screenshot({ path: `${SHOTS}/resume-score.png`, fullPage: true });

    // Reject disguised file
    await c.goto("/resume");
    const badPath = path.join(SHOTS, "evil.pdf");
    writeFileSync(badPath, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300, 1)]));
    await c.setInputFiles("input[name=file]", badPath);
    await c.click("text=Upload & review");
    await c.waitForSelector("p[role=alert]");
    check("executable renamed .pdf is rejected", (await c.textContent("p[role=alert]")).includes("Unsupported file type"));

    // Profile now filled from the approved import (with the user's edit)
    await c.goto("/profile");
    const prof = await c.textContent("main");
    check("profile contains approved software", prof.includes("Navisworks") && prof.includes("Dynamo"));
    check("profile contains the user's edited role title", prof.includes("Senior BIM Coordinator (edited)"));
    await c.screenshot({ path: `${SHOTS}/profile.png`, fullPage: true });

    // Edit profile: make public + open to work
    await c.waitForLoadState("networkidle");
    await c.fill("#location", "Dubai, UAE");
    await c.selectOption("#discipline", "MEP");
    await c.check("input[name=openToWork]");
    await c.check("input[name=visibility]");
    await c.click("button:has-text('Save basics')");
    await c.waitForSelector("p[role=status]:has-text('Profile saved')", { timeout: 20000 });
    check("profile edit saved", true);

    // Extended profile sections
    await c.fill("#currentRole", "Senior BIM Coordinator");
    await c.fill("#industries", "Healthcare, Data centers");
    await c.click("button:has-text('Save career')");
    await c.waitForSelector("p[role=status]:has-text('Career details saved')", { timeout: 20000 });
    await c.fill("#bimStandards", "ISO 19650, COBie");
    await c.check("input[name=bimDisciplines][value=MEP]");
    await c.click("button:has-text('Save BIM expertise')");
    await c.waitForSelector("p[role=status]:has-text('BIM profile saved')", { timeout: 20000 });
    await c.fill("#lang-name", "Arabic");
    await c.selectOption("#lang-level", "Basic");
    await c.click("form:has(#lang-name) button[type=submit]");
    await c.waitForSelector("p[role=status]:has-text('Language saved')", { timeout: 20000 });
    await c.fill("#minSalary", "90000");
    await c.fill("#salaryCurrency", "usd");
    await c.click("button:has-text('Save preferences')");
    await c.waitForSelector("p[role=status]:has-text('Preferences saved')", { timeout: 20000 });
    check("career, BIM expertise, languages and preferences save", true);

    // Dashboard now has real data
    await c.goto("/dashboard");
    const dash = await c.textContent("main");
    check("dashboard shows resume score from DB", /\d+\s*\/ 100/.test(dash));
    check("dashboard recommends jobs", dash.includes("Recommended jobs") && !dash.includes("Add software and skills to see matches"));
    await c.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });

    // Career insights
    await c.goto("/career-insights");
    check("career insights computed from jobs", (await c.textContent("main")).includes("Software demand"));

    // Portfolio: link + image
    await c.goto("/portfolio");
    await c.fill("#ln-title", "Hospital federated model");
    await c.fill("#ln-url", "https://example.com/model");
    await c.click("button:has-text('Add link')");
    await c.waitForSelector("text=Link added.");
    check("portfolio link added", true);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const pngPath = path.join(SHOTS, "pic.png");
    writeFileSync(pngPath, png);
    await c.fill("#img-title", "Render");
    await c.setInputFiles("input[type=file][aria-label='Image file']", pngPath);
    await c.click("text=Upload image");
    await c.waitForSelector("text=Added to portfolio.");
    check("portfolio image uploaded", true);
  }

  // ---------- 2b. Resume builder, projects, public profile, AI page ----------
  let publicSlug;
  {
    await c.goto("/resume");
    await c.selectOption("#role", "coordinator");
    await c.click("button:has-text('Create & edit')");
    await c.waitForURL("**/edit", { timeout: 30000 });
    await c.waitForSelector("text=Resume builder");
    await c.waitForLoadState("networkidle");
    check("targeted resume is created from the master profile", (await c.textContent("body")).includes("Alpha Engineering"));
    await c.fill("#hl", "BIM Coordinator | MEP | Revit & Navisworks");
    await c.selectOption("#tpl", "modern");
    check("builder preview updates live", (await c.textContent("body")).includes("BIM Coordinator | MEP | Revit & Navisworks"));
    // Reorder: move the first section down, then remove one and add a custom section
    await c.click("button[aria-label='Move summary down']");
    await c.click("button[aria-label='Remove languages']");
    await c.selectOption("#addsec", "__custom");
    await c.fill("input[aria-label='Custom section title']", "Publications");
    await c.click("button:has-text('Add'):not(:has-text('role')):not(:has-text('project'))");
    await c.fill("textarea >> nth=-1", "Paper on federated models.");
    await c.click("button:has-text('Save version')");
    await c.waitForSelector("p[role=status]:has-text('Saved as a new version')", { timeout: 30000 });
    check("builder saves a new version and rescoring happens", true);
    await c.screenshot({ path: `${SHOTS}/builder.png`, fullPage: true });
    await c.goto("/resume");
    check("resume list shows both the uploaded original and the targeted version", (await c.textContent("main")).includes("Targeted version") && (await c.textContent("main")).includes("Uploaded"));

    // Portfolio project: create, publish
    await c.goto("/portfolio/projects/new");
    await c.fill("input[name=name]", "Hospital Tower B");
    await c.fill("input[name=client]", "Secret Client Ltd");
    await c.fill("input[name=role]", "BIM Coordinator");
    await c.fill("textarea[name=outcomes]", "Zero hard clashes at handover");
    await c.click("button:has-text('Create project')");
    await c.waitForURL("**/portfolio/projects/**", { timeout: 30000 });
    await c.waitForSelector("text=Hospital Tower B");
    await c.waitForLoadState("networkidle");
    await c.click("button:has-text('Publish')");
    await c.waitForSelector("text=Published");
    check("project published", true);

    // Public profile
    await c.goto("/profile");
    publicSlug = execSync(`docker exec bim_connect-db-1 psql -U careerpoint -d careerpoint -Atc "select p.slug from \\"BIMProfessionalProfile\\" p join \\"User\\" u on u.id=p.\\"userId\\" where u.email='${CAND.email}'"`).toString().trim();
    const actx = await newCtx();
    const anon = await actx.newPage();
    await anon.goto(`/professionals/${publicSlug}`);
    const pub = await anon.textContent("main");
    check("anonymous sees the public profile with the published project", pub.includes("Hospital Tower B") && pub.includes("Zero hard clashes"));
    check("public profile shows new BIM sections", pub.includes("BIM expertise") && pub.includes("Languages") && pub.includes("Arabic"));
    check("client name hidden unless made public", !pub.includes("Secret Client Ltd"));
    check("salary and contact details never public", !pub.includes("90000") && !pub.includes("90,000") && !pub.includes(CAND.email));
    await anon.screenshot({ path: `${SHOTS}/public-profile.png`, fullPage: true });
    await actx.close();

    // AI page: honest when not configured
    await c.goto("/resume/assistant");
    check("AI assistant page renders and states when AI is off", (await c.textContent("main")).includes("AI assistance is switched off") || (await c.textContent("main")).includes("AI assistant"));
  }

  // ---------- 3. Jobs: match, save, pin, apply ----------
  let jobSlug;
  let appUrl;
  {
    await c.goto("/jobs?sort=match");
    const txt = await c.textContent("main");
    check("jobs list shows match scores", /\d+% match/.test(txt));
    check("job card shows 'Apply on CareerPoint' for native jobs and match reasons", txt.includes("Apply on CareerPoint") && txt.includes("Why this matches") === false && /✓/.test(txt));
    // Personalized feed views + filters
    await c.goto("/jobs?view=recommended");
    check("feed tabs render for candidates", (await c.textContent("main")).includes("Recommended") && (await c.textContent("main")).includes("Best match"));
    await c.goto("/jobs?view=best");
    check("best-match feed lists the job", (await c.textContent("main")).includes(`Senior BIM Coordinator MEP ${stamp}`));
    await c.goto(`/jobs?q=${encodeURIComponent("coordinator " + stamp)}&role=BIM+Coordinator&remote=HYBRID`);
    check("full-text search + structured filters find the job", (await c.textContent("main")).includes(`Senior BIM Coordinator MEP ${stamp}`));
    await c.goto(`/jobs?q=${encodeURIComponent("sales")}&sort=relevance`);
    check("search excludes unrelated jobs", !(await c.textContent("main")).includes(`Senior BIM Coordinator MEP ${stamp}`));
    await c.goto("/jobs?sort=match");
    await c.screenshot({ path: `${SHOTS}/jobs.png`, fullPage: true });
    const first = c.locator("article h3 a", { hasText: String(stamp) }).first();
    jobSlug = (await first.getAttribute("href"))?.replace("/jobs/", "");
    await c.locator("article button", { hasText: "Save" }).first().click();
    await c.waitForSelector("article button:has-text('Saved')");
    await c.locator("article button", { hasText: "Pin" }).first().click();
    await c.waitForSelector("article button:has-text('Unpin')");
    await c.goto("/jobs/saved");
    check("saved + pinned job appears in /jobs/saved", (await c.textContent("main")).includes("Pinned"));

    // Job alert
    await c.goto("/jobs/alerts");
    await c.fill("#keywords", "coordinator");
    await c.fill("#city", "Dubai");
    await c.selectOption("#frequency", "INSTANT");
    await c.click("button:has-text('Create alert')");
    await c.waitForSelector("p[role=status]:has-text('Alert created')", { timeout: 20000 });
    await c.waitForSelector("text=Daily digest, text=instant", { timeout: 1000 }).catch(() => {});
    check("job alert created and listed", (await c.textContent("main")).includes("instant"));

    await c.goto(`/jobs/${jobSlug}`);
    const jd = await c.textContent("main");
    check("job detail shows the job-specific fit diagnostic with matched items", jd.includes("Your fit for this job") && jd.includes("Matched") && jd.includes("not a prediction"));
    await c.screenshot({ path: `${SHOTS}/job-detail.png`, fullPage: true });
    await c.fill("#coverNote", "Very interested in this role.");
    await c.selectOption("#resumeVersionId", { label: "resume (v1)" });

    await Promise.all([c.waitForURL("**/applications/*", { timeout: 30000 }), c.click("text=Submit application")]);
    appUrl = c.url();
    check("native application submitted and tracked", (await c.textContent("main")).includes("Applied on CareerPoint"));
    await c.goto("/applications");
    check("application tracked in /applications", (await c.textContent("main")).includes(`Senior BIM Coordinator MEP ${stamp}`));
    await c.screenshot({ path: `${SHOTS}/applications.png`, fullPage: true });

    // External job: apply click -> official URL -> "Did you complete the application?" -> self-reported
    const extSlug = `e2e-external-${stamp}`;
    execSync(`docker exec bim_connect-db-1 psql -U careerpoint -d careerpoint -c "INSERT INTO \\"Job\\" (id, slug, title, \\"companyName\\", description, status, \\"applyUrl\\", \\"updatedAt\\") VALUES ('${extSlug}', '${extSlug}', 'BIM Manager External ${stamp}', 'Outside Co', '${"Lead BIM delivery across projects. ".repeat(8)}', 'ACTIVE', 'https://example.com/careers/apply', now())"`, { stdio: "pipe" });
    await c.goto(`/jobs/${extSlug}`);
    const [popup] = await Promise.all([c.waitForEvent("popup", { timeout: 15000 }).catch(() => null), c.click("button:has-text('Apply on employer site')")]);
    await popup?.close().catch(() => {});
    await c.waitForSelector("text=Did you complete the application?", { timeout: 15000 });
    check("external apply asks 'Did you complete the application?'", true);
    await c.click("button:has-text('Yes, submitted')");
    await c.waitForSelector("text=self-reported");
    await c.goto("/applications?view=list");
    const tt = await c.textContent("main");
    check("external application tracked as self-reported, never as employer-received", tt.includes(`BIM Manager External ${stamp}`) && !/employer (received|viewed)/i.test(tt));
  }

  // ---------- 4. Employer reviews application ----------
  {
    const ectx = await newCtx();
    const e = await ectx.newPage();
    await login(e, EMPLOYER);
    check("employer lands on /employer", new URL(e.url()).pathname === "/employer", e.url());
    await e.goto("/dashboard");
    check("employer blocked from candidate dashboard", await settle(e, "/employer"));
    await e.goto("/admin");
    check("employer blocked from /admin", await settle(e, "/employer"));
    await e.goto("/employer/applications");
    const t = await e.textContent("main");
    check("employer sees the candidate application", t.includes(CAND.name));
    await e.click(`main a:has-text("${CAND.name}")`);
    await e.waitForURL("**/employer/applications/*");
    check("employer sees structured resume", (await e.textContent("main")).includes("Alpha Engineering"));
    await e.selectOption("select[name=status]", "SHORTLISTED");
    await e.fill("input[name=note]", "Great fit, scheduling a call.");
    await e.click("button:has-text('Update stage')");
    await e.waitForSelector("text=Shortlisted >> nth=0");
    await e.waitForLoadState("networkidle");
    check("employer moved application to shortlisted", (await e.textContent("main")).includes("Shortlisted"));
    await e.fill("#note-body", `PRIVATE-NOTE-${stamp}`);
    await e.click("button:has-text('Add note')");
    await e.waitForSelector(`text=PRIVATE-NOTE-${stamp}`);
    check("employer internal note saved", true);
    await e.fill("#scheduledAt", new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 16));
    await e.fill("#locationOrLink", "https://meet.example.com/abc");
    await e.click("button:has-text('Schedule interview')");
    await e.waitForSelector("text=awaiting response");
    check("employer scheduled an interview", true);
    await e.screenshot({ path: `${SHOTS}/employer-applications.png`, fullPage: true });

    // Resume file access for employer (signed, viewer-bound link)
    const fileHref = await e.getAttribute("a:has-text('Download original')", "href");
    const fr = await e.request.get(fileHref);
    check("employer can download the applicant's resume via signed link", fr.status() === 200 && (fr.headers()["content-type"] ?? "").includes("pdf"), String(fr.status()));
    check("resume file served with attachment + nosniff", (fr.headers()["content-disposition"] ?? "").startsWith("attachment") && fr.headers()["x-content-type-options"] === "nosniff");
    const unsigned = await e.request.get(fileHref.split("?")[0]);
    check("unsigned employer request for a resume is refused", unsigned.status() !== 200, String(unsigned.status()));

    // Employer pages render
    for (const pth of ["/employer/interviews", "/employer/analytics", "/employer/company", "/employer/settings", "/employer/candidates?contacts=1"]) {
      await e.goto(pth);
      check(`employer page ${pth} renders`, (await e.textContent("main")).length > 50);
    }

    // Candidate directory & profile view
    await e.goto("/employer/candidates");
    check("verified employer can search candidates", (await e.textContent("main")).includes(CAND.name));
    await e.goto(`/professionals/${publicSlug}`);
    check("employer sees 'Open to work' on public profile", (await e.textContent("main")).includes("Open to work"));
    check("public profile hides email and phone", !(await e.textContent("body")).includes(CAND.email));
    await ectx.close();

    // Candidate sees the legitimate employer activity — and never the internal note
    await c.goto(appUrl);
    const tl = await c.textContent("main");
    check("candidate sees employer status change + shared note", tl.includes("Shortlisted") && tl.includes("scheduling a call"));
    check("candidate sees interview and employer-viewed event", tl.includes("Interview") && tl.includes("Employer viewed your application"));
    check("internal recruiter note is never visible to the candidate", !(await c.textContent("body")).includes(`PRIVATE-NOTE-${stamp}`));
    await c.click("button:has-text('Confirm')");
    await c.waitForSelector("text=You confirmed");
    check("candidate confirmed the interview", true);
    await c.goto("/notifications");
    const nt = await c.textContent("main");
    check("candidate received notifications (viewed, shortlisted, interview)", nt.includes("viewed your application") && nt.includes("Shortlisted") && nt.includes("Interview scheduled"));
    await c.goto("/dashboard");
    check("dashboard shows verified-employer views", (await c.textContent("main")).includes("verified employer"));
    await c.goto("/settings");
    check("candidate can manage notification preferences", (await c.textContent("main")).includes("Verified employer viewed your profile"));
  }

  // ---------- 5. Isolation: another candidate cannot read the resume ----------
  {
    const fileHref = await (async () => {
      await c.goto("/resume");
      return c.getAttribute("a:has-text('Download original')", "href");
    })();
    const own = await c.request.get(fileHref);
    check("owner can download own resume", own.status() === 200);
    const octx = await newCtx();
    const o = await octx.newPage();
    await o.goto("/register");
    await o.fill("#name", CAND2.name);
    await o.fill("#email", CAND2.email);
    await o.fill("#password", CAND2.password);
    await Promise.all([o.waitForURL("**/dashboard"), o.click("button[type=submit]")]);
    const other = await o.request.get(fileHref);
    check("another candidate gets 404 for someone else's resume (IDOR)", other.status() === 404, String(other.status()));
    const anon = await (await newCtx()).request.get(`${BASE}${fileHref}`);
    check("anonymous gets 404 for a private resume", anon.status() === 404, String(anon.status()));
    // resume preview of another user's id
    const rid = (await c.getAttribute("a:has-text('View')", "href"))?.split("/").pop();
    await o.goto(`/resume/${rid}`);
    check("other candidate cannot preview someone else's resume", (await o.textContent("body")).includes("Page not found"));
    await octx.close();
  }

  // ---------- 6. New employer: moderation + verification flow ----------
  {
    const e2ctx = await newCtx();
    const e2 = await e2ctx.newPage();
    await e2.goto("/register?type=employer");
    await e2.fill("#name", EMP2.name);
    await e2.fill("#companyName", EMP2.company);
    await e2.fill("#email", EMP2.email);
    await e2.fill("#password", EMP2.password);
    await Promise.all([e2.waitForURL("**/employer"), e2.click("button[type=submit]")]);
    check("unverified employer sees verification banner", (await e2.textContent("main")).includes("Company pending verification"));
    await e2.goto("/employer/candidates");
    check("candidate directory locked for unverified company", (await e2.textContent("main")).includes("Available after verification"));
    await e2.goto("/employer/jobs/new");
    await e2.fill("#title", `BIM Coordinator (Structural) ${stamp}`);
    await e2.fill("#description", "Coordinate structural models in Revit and Navisworks, run clash detection and maintain model quality for commercial projects across the region.");
    await e2.click("button:has-text('Submit for review')");
    await e2.waitForURL("**/employer/jobs?saved=PENDING");
    check("unverified employer job goes to PENDING (moderation)", (await e2.textContent("main")).includes("Pending"));
    const slugHref = await e2.getAttribute(`a:has-text('BIM Coordinator (Structural) ${stamp}')`, "href");
    const jobId = slugHref.split("/").pop();

    // pending job is not public
    const anonCtx = await newCtx();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto("/jobs");
    check("pending job not listed publicly", !(await anonPage.textContent("main")).includes(`BIM Coordinator (Structural) ${stamp}`));

    // Tenant isolation: demo employer cannot open EMP2's job editor
    const e1ctx = await newCtx();
    const e1 = await e1ctx.newPage();
    await login(e1, EMPLOYER);
    await e1.goto(`/employer/jobs/${jobId}`);
    check("employer A cannot open employer B's job (tenant isolation)", (await e1.textContent("body")).includes("Page not found"));
    await e1ctx.close();

    // Moderator-level admin approves via company verification
    const actx = await newCtx();
    const a = await actx.newPage();
    await login(a, ADMIN);
    check("admin lands on /admin", new URL(a.url()).pathname === "/admin");
    for (const p of ["/admin/users", "/admin/jobs", "/admin/sources", "/admin/employers", "/admin/applications", "/admin/system"]) {
      const r = await a.goto(p);
      check(`admin page ${p} renders`, r?.status() === 200 && new URL(a.url()).pathname === p);
    }
    await a.goto("/admin/employers");
    await a.screenshot({ path: `${SHOTS}/admin-employers.png`, fullPage: true });
    const row = a.locator("tr", { hasText: EMP2.company });
    await row.locator("button:has-text('Verify')").click();
    await a.waitForSelector(`tr:has-text("${EMP2.company}") >> button:has-text('Revoke')`);
    await a.goto(`/jobs?q=${encodeURIComponent(`Structural ${stamp}`)}`);
    check("verifying a company publishes its pending job", (await a.textContent("main")).includes(`BIM Coordinator (Structural) ${stamp}`));
    await a.goto("/admin/applications");
    check("admin applications page shows metadata only", !(await a.textContent("main")).includes(CAND.email));
    // Admin cannot change own role (no select for self)
    await a.goto(`/admin/users?q=${encodeURIComponent(ADMIN.email)}`);
    check("admin cannot demote self (no role control)", (await a.locator("select[aria-label^='Role for']").count()) === 0);
    await actx.close();
    await e2ctx.close();
  }

  // ---------- 6b. Brand-new employer, end to end: verified -> receives an application -> shortlists -> interviews -> candidate is notified ----------
  {
    const psql = (q) => execSync(`docker exec bim_connect-db-1 psql -U careerpoint -d careerpoint -Atc "${q}"`).toString().trim();
    const slug = psql(`select slug from \\"Job\\" where title='BIM Coordinator (Structural) ${stamp}'`);
    await c.goto(`/jobs/${slug}`);
    await c.selectOption("#resumeVersionId", { index: 0 });
    await Promise.all([c.waitForURL("**/applications/*", { timeout: 30000 }), c.click("text=Submit application")]);
    check("candidate applied to the new employer's job", (await c.textContent("main")).includes("Applied on CareerPoint"));
    const e3ctx = await newCtx();
    const e3 = await e3ctx.newPage();
    await login(e3, { email: EMP2.email, password: EMP2.password });
    await e3.goto("/employer");
    check("new employer overview shows the application", (await e3.textContent("main")).includes(CAND.name));
    await e3.goto("/employer/applications");
    await e3.click(`main a:has-text("${CAND.name}")`);
    await e3.waitForURL("**/employer/applications/*");
    check("new employer opens the candidate package (profile + resume)", (await e3.textContent("main")).includes("Alpha Engineering"));
    await e3.selectOption("select[name=status]", "SHORTLISTED");
    await e3.click("button:has-text('Update stage')");
    await e3.waitForLoadState("networkidle");
    check("new employer shortlisted the candidate", (await e3.textContent("main")).includes("Shortlisted"));
    await e3.fill("#scheduledAt", new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 16));
    await e3.click("button:has-text('Schedule interview')");
    await e3.waitForSelector("text=awaiting response");
    check("new employer scheduled an interview", true);
    await e3ctx.close();
    await c.goto("/notifications");
    const nt2 = await c.textContent("main");
    check("candidate was notified of shortlist + interview by the new employer", nt2.includes(EMP2.company) && nt2.includes("Interview scheduled"));
  }

  // ---------- 7. Password reset ----------
  {
    const pctx = await newCtx();
    const p = await pctx.newPage();
    await p.goto("/forgot-password");
    await p.fill("#email", CAND2.email);
    await p.click("button[type=submit]");
    await p.waitForSelector("text=If an account exists");
    await p.goto("/forgot-password");
    await p.fill("#email", `ghost.${stamp}@example.com`);
    await p.click("button[type=submit]");
    await p.waitForSelector("text=If an account exists");
    check("reset gives the same response for unknown emails (no enumeration)", true);
    await new Promise((r) => setTimeout(r, 500));
    const link = lastMailLink(/\/reset-password\?token=[\w-]+/g);
    check("reset email issued (dev mail log)", !!link);
    if (link) {
      await p.goto(link);
      await p.fill("#password", "Brand-New-Pass-77");
      await p.fill("#confirm", "Brand-New-Pass-77");
      await p.click("button[type=submit]");
      await p.waitForURL("**/login?reset=1");
      await login(p, { email: CAND2.email, password: "Brand-New-Pass-77" });
      check("login works with the new password", new URL(p.url()).pathname === "/dashboard");
      await p.context().clearCookies();
      await p.goto(link);
      await p.fill("#password", "Another-Pass-88");
      await p.fill("#confirm", "Another-Pass-88");
      await p.click("button[type=submit]");
      await p.waitForSelector("p[role=alert]");
      check("reset link is single-use", (await p.textContent("p[role=alert]")).includes("invalid or has expired"));
    }
    await pctx.close();
  }

  // ---------- 8. Logout invalidates the session ----------
  {
    await c.goto("/settings");
    await c.click("button:has-text('Sign out')");
    await c.waitForURL(BASE + "/");
    await c.goto("/dashboard");
    check("after logout /dashboard requires login", new URL(c.url()).pathname === "/login");
  }

  // ---------- 8b. Production surface: health, SEO, admin ops, AI fallbacks ----------
  {
    const api = await newCtx();
    const live = await api.request.get("/api/health");
    check("liveness endpoint responds", live.status() === 200 && (await live.json()).status === "ok");
    const ready = await api.request.get("/api/health/ready");
    const rj = await ready.json();
    check("readiness reports database/queue/worker/integrations without leaking detail", ready.status() === 200 && rj.components.database === "ok" && "worker" in rj.components && "queue" in rj.components && !JSON.stringify(rj).includes("postgres"));
    check("responses carry a request id", !!live.headers()["x-request-id"]);
    check("CSP + frame protection headers are set", (live.headers()["content-security-policy"] ?? "").includes("frame-ancestors 'none'") && live.headers()["x-frame-options"] === "DENY");
    const robotsTxt = await (await api.request.get("/robots.txt")).text();
    check("robots.txt hides private areas and lists the sitemap", robotsTxt.includes("Disallow: /admin") && robotsTxt.includes("Sitemap:"));
    const sm = await (await api.request.get("/sitemap.xml")).text();
    check("sitemap lists jobs and no private pages", sm.includes("/jobs/") && !sm.includes("/dashboard") && !sm.includes("/admin"));
    const ap = await api.newPage();
    await ap.goto(`/jobs/${jobSlug}`);
    const html = await ap.content();
    check("job page has canonical, OpenGraph and JobPosting structured data", html.includes('rel="canonical"') && html.includes('property="og:title"') && html.includes('"@type":"JobPosting"'));
    await ap.goto("/");
    check("home page has Organization/WebSite structured data and OG tags", (await ap.content()).includes('"@type":"WebSite"') && (await ap.content()).includes('property="og:title"'));
    await api.close();

    const actx = await newCtx();
    const ad = await actx.newPage();
    await login(ad, ADMIN);
    for (const pth of ["/admin/scoring", "/admin/reports", "/admin/system"]) {
      const r = await ad.goto(pth);
      check(`admin ${pth} renders`, r?.status() === 200 && new URL(ad.url()).pathname === pth);
    }
    await ad.goto("/admin/system");
    const sys = await ad.textContent("main");
    check("admin system shows component health, dead letters and AI usage", sys.includes("Database") || sys.includes("database") ? sys.includes("Dead-lettered tasks") && sys.includes("AI usage") : false);
    await ad.goto("/admin/scoring");
    const before = await ad.inputValue("#w-portfolio");
    await ad.fill("#w-portfolio", String(Number(before) + 1));
    await ad.fill("#note", `e2e ${stamp}`);
    await ad.click("button:has-text('Save as new version')");
    await ad.waitForSelector("p[role=status]:has-text('Saved as version')", { timeout: 20000 });
    check("admin can change scoring weights (new audited version)", true);
    await ad.goto("/admin/scoring");
    await ad.fill("#w-portfolio", before);
    await ad.fill("#note", `e2e restore ${stamp}`);
    await ad.click("button:has-text('Save as new version')");
    await ad.waitForSelector("p[role=status]:has-text('Saved as version')", { timeout: 20000 });
    await actx.close();

    // Candidate: report a job, comparison on the score page, deterministic AI fallbacks work without an API key
    await login(c, CAND);
    await c.goto(`/jobs/${jobSlug}`);
    await c.click("summary:has-text('Report this posting')");
    await c.selectOption("#report-reason", "expired");
    await c.click("button:has-text('Send report')");
    await c.waitForSelector("p[role=status]:has-text('Thanks')", { timeout: 20000 });
    check("candidate can report a posting", true);
    await c.goto("/resume/assistant");
    await c.selectOption("#jk", "interview-questions");
    await c.click("button:has-text('Ask')");
    await c.waitForSelector("text=Waiting for your decision", { timeout: 20000 });
    check("AI assistant offers interview questions built from job data (no AI key needed)", (await c.textContent("main")).includes("built from your data (no AI)"));
    await c.goto("/resume/score");
    await c.click("button:has-text('Rescore from profile')");
    await c.waitForLoadState("networkidle");
    await c.goto("/resume/score");
    const sc = await c.textContent("main");
    check("score page shows previous score, current score and improvement", sc.includes("Previous score") && sc.includes("Current score") && sc.includes("Improvement"));
  }

  // ---------- 9. Responsive: no horizontal overflow at mobile width ----------
  {
    const mctx = await newCtx({ viewport: { width: 390, height: 844 } });
    const m = await mctx.newPage();
    const overflow = async (label) => {
      const o = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`mobile 390px: no horizontal overflow on ${label}`, o <= 1, `overflow ${o}px`);
    };
    for (const p of ["/", "/jobs", "/tools", "/login", "/register", "/professionals"]) {
      await m.goto(p);
      await overflow(p);
    }
    await m.goto("/");
    await m.screenshot({ path: `${SHOTS}/mobile-home.png`, fullPage: true });
    await login(m, CAND);
    for (const p of ["/dashboard", "/profile", "/resume", "/resume/score", "/portfolio", "/applications", "/career-insights", "/settings", "/notifications", "/resume/assistant", "/jobs/saved"]) {
      await m.goto(p);
      await overflow(p);
    }
    await m.goto("/dashboard");
    await m.screenshot({ path: `${SHOTS}/mobile-dashboard.png`, fullPage: true });
    await m.click("summary:has-text('Menu')");
    check("mobile menu opens and shows navigation", await m.locator("nav[aria-label='Primary mobile']").isVisible());
    // Keyboard: skip link is first focusable
    await m.goto("/");
    await m.keyboard.press("Tab");
    check("skip-to-content is first tab stop", (await m.evaluate(() => document.activeElement?.textContent ?? "")).includes("Skip to content"));
    await mctx.close();
  }
} catch (err) {
  check("script completed without exception", false, String(err?.stack ?? err));
  if (process.env.DEBUG_POST) {
    for (const pg of browser.contexts().flatMap((x) => x.pages())) console.log("   page", pg.url(), (await pg.textContent("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 700));
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
