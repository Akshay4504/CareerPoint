// Test fixtures shaped exactly like the public ATS APIs return (field names verified against live responses).
// They exist only inside the test suite; nothing here is ever shown in the product.

export const BIM_COORDINATOR_HTML = `<h2>The Role</h2><p>We are looking for a <strong>BIM Coordinator</strong> to join our healthcare team in Bengaluru.</p>
<h3>Responsibilities</h3><ul><li>Coordinate multidisciplinary Revit and Navisworks models and run weekly clash detection workshops</li><li>Maintain the BIM Execution Plan and work to ISO 19650 and COBie requirements</li><li>Audit models and publish federated models to the common data environment (Autodesk Construction Cloud)</li></ul>
<h3>Requirements</h3><ul><li>3-5 years of experience in BIM coordination</li><li>Strong Revit, Navisworks, Dynamo skills</li><li>Knowledge of IFC and LOD specifications</li></ul>
<p>Salary: INR 1,800,000 - 2,400,000 per year. Hybrid working.</p>`;

export const GENERIC_ARCHITECT_HTML = `<p>We are an architecture practice seeking an Architect to design residential projects. You will develop concept designs, prepare planning packages and coordinate with consultants. Our teams use BIM on some projects. Experience with design software is helpful. Great benefits and a friendly studio culture in London.</p><p>Responsibilities include site visits, client meetings and producing drawings.</p>`;

export const SALES_HTML = `<p>Account Executive selling construction software to BIM managers and contractors. Revit, Navisworks, Autodesk Construction Cloud, Procore and Bluebeam integrations are part of our product. You will own a quota and manage the sales pipeline.</p>`;

export const SOLUTION_ARCHITECT_HTML = `<p>Solution Architect pre-sales role. Our platform integrates with Revit, Navisworks, Rhino, BIM 360, Autodesk Construction Cloud, Civil 3D and Power BI. You will demo the product to customers and design integrations.</p>`;

export const greenhouseJob = (id: number, title: string, html: string, location = "Bengaluru, Karnataka, India", company = "Acme Engineering Ltd") => ({
  id,
  internal_job_id: id * 10,
  title,
  absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}?gh_jid=${id}&utm_source=x`,
  location: { name: location },
  company_name: company,
  first_published: "2026-09-28T10:00:00-04:00",
  updated_at: "2026-09-30T10:00:00-04:00",
  content: html.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), // Greenhouse returns entity-escaped HTML
});

export const greenhouseBoard = (jobs: ReturnType<typeof greenhouseJob>[]) => ({ jobs, meta: { total: jobs.length } });

export const leverPosting = (id: string, text: string, plain: string, location = "Bengaluru") => ({
  id,
  text,
  hostedUrl: `https://jobs.lever.co/acme/${id}`,
  applyUrl: `https://jobs.lever.co/acme/${id}/apply`,
  createdAt: Date.parse("2026-09-29T08:00:00Z"),
  country: "IN",
  workplaceType: "hybrid",
  categories: { location, commitment: "Full-time", team: "BIM", allLocations: [location] },
  descriptionPlain: plain,
  description: `<div>${plain}</div>`,
  lists: [{ text: "Requirements", content: "<li>3-5 years of experience</li><li>Revit and Navisworks</li>" }],
  additionalPlain: "Equal opportunity employer.",
});

export const ashbyBoard = (jobs: object[]) => ({ apiVersion: "1", jobs });
export const ashbyJob = (id: string, title: string, html: string) => ({
  id, title, isListed: true, isRemote: false, workplaceType: "Hybrid", employmentType: "FullTime", location: "London, UK",
  jobUrl: `https://jobs.ashbyhq.com/acme/${id}`, applyUrl: `https://jobs.ashbyhq.com/acme/${id}/application`, descriptionHtml: html, publishedAt: "2026-09-27T09:00:00.000+00:00",
  address: { postalAddress: { addressLocality: "London", addressRegion: "", addressCountry: "United Kingdom" } },
  compensation: { compensationTierSummary: "£55,000 - £70,000", scrapeableCompensationSalarySummary: "£55K - £70K" },
});

export const RSS_FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Jobs</title>
<item><title><![CDATA[BIM Modeler at Beta Consultants]]></title><link>https://beta.example/jobs/55</link><guid>beta-55</guid><description><![CDATA[<p>Produce LOD 350 Revit models for commercial towers in Manchester. Coordinate with Navisworks. 2+ years experience required in BIM modelling and Revit families.</p>]]></description><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Barista at Cafe</title><link>https://cafe.example/1</link><guid>cafe-1</guid><description>Make coffee all day long, friendly team and flexible hours for everyone.</description></item>
</channel></rss>`;

export const JSONLD_PAGE = (title: string, desc: string) => `<html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "JobPosting", title, description: desc, datePosted: "2026-09-26", validThrough: "2026-12-31T00:00:00Z",
  employmentType: "FULL_TIME", hiringOrganization: { "@type": "Organization", name: "Gamma Infrastructure" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Dubai", addressCountry: "United Arab Emirates" } },
  baseSalary: { "@type": "MonetaryAmount", currency: "AED", value: { "@type": "QuantitativeValue", minValue: 240000, maxValue: 300000, unitText: "YEAR" } },
})}</script></head><body>job</body></html>`;

export const SITEMAP = `<?xml version="1.0"?><urlset><url><loc>https://gamma.example/jobs/1</loc></url><url><loc>https://gamma.example/jobs/2</loc></url><url><loc>https://gamma.example/about</loc></url></urlset>`;
