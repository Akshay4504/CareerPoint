// Browser check of the invite-link and private-profile-share flows against a running dev server that logs mail to dev.log.
//   BASE_URL=http://localhost:3000 SERVER_LOG=dev.log node e2e/access-flow.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const LOG = process.env.SERVER_LOG ?? "dev.log";
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@careerpoint.local", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe-Admin-123" };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const stamp = Date.now();
let n = 0;
const ctx = () => b.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `10.5.${(stamp >> 4) & 255}.${++n + 20}` } });
const code = async (email) => {
  await new Promise((r) => setTimeout(r, 1500));
  const log = readFileSync(LOG, "utf8");
  const re = new RegExp(`to=${email.toLowerCase().replace(/[.+]/g, "\\$&")}[\\s\\S]*?verification code: (\\d{6})`, "g");
  let m, last;
  while ((m = re.exec(log))) last = m[1];
  return last;
};
let failed = 0;
const ok = (name, v) => {
  if (!v) failed++;
  console.log(v ? "PASS" : "FAIL", name);
};
const A = { email: `memberA.${stamp}@example.com`, name: `Member Alpha ${stamp}` };
const B = { email: `guestB.${stamp}@example.com`, name: `Guest Bravo ${stamp}` };
const PW = "Sup3r-Secret-Pass";
const register = async (p, u, next) => {
  await p.goto(`/register?email=${encodeURIComponent(u.email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  await p.fill("#name", u.name);
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((x) => !x.pathname.startsWith("/register"), { timeout: 20000 }), p.click("button[type=submit]")]);
};

try {
  const ca = await ctx();
  const pa = await ca.newPage();
  await register(pa, A);
  await pa.goto("/communities/revit");
  await pa.waitForTimeout(1200);
  ok("non-member sees no post form and no instant Join", (await pa.locator("text=Request to join").count()) > 0 && (await pa.locator("#title").count()) === 0);
  await pa.click("button:has-text('Request to join')");
  await pa.waitForSelector("text=waiting for a moderator", { timeout: 20000 });
  ok("request is pending, not joined", true);

  const cad = await ctx();
  const pad = await cad.newPage();
  await pad.goto("/login");
  await pad.fill("#email", ADMIN.email);
  await pad.fill("#password", ADMIN.password);
  await Promise.all([pad.waitForURL((u) => !u.pathname.startsWith("/login")), pad.click("button[type=submit]")]);
  await pad.goto("/admin/reports");
  await pad.waitForTimeout(1000);
  await pad.locator("li", { hasText: A.name }).locator("button:has-text('Approve')").click();
  await pad.waitForTimeout(1500);
  await pa.goto("/communities/revit");
  await pa.waitForTimeout(1000);
  ok("approved member can post", (await pa.locator("#title").count()) > 0);

  await pa.click("button:has-text('Create invite link')");
  await pa.waitForSelector("input[aria-label='Share link']");
  const invite = await pa.inputValue("input[aria-label='Share link']");
  ok("invite link created with share channels", invite.includes("/communities/join/") && (await pa.locator("a:has-text('WhatsApp')").count()) > 0);

  const cb = await ctx();
  const pb = await cb.newPage();
  await pb.goto(invite);
  await pb.waitForTimeout(1000);
  ok("invite asks for email before anything else", (await pb.locator("#ev-email").count()) === 1 && (await pb.locator("button:has-text('Join Revit')").count()) === 0);
  await pb.fill("#ev-email", B.email);
  await pb.click("button:has-text('Send code')");
  await pb.waitForSelector("#ev-code");
  await pb.fill("#ev-code", "000000");
  await pb.click("button:has-text('Verify')");
  await pb.waitForSelector("text=wrong or has expired");
  ok("wrong code rejected", true);
  const c1 = await code(B.email);
  ok("code was emailed", !!c1);
  await pb.fill("#ev-code", c1);
  await pb.click("button:has-text('Verify')");
  await pb.waitForSelector("text=Email verified", { timeout: 15000 });
  ok("correct code verifies the email", true);
  await register(pb, B, new URL(invite).pathname);
  await pb.waitForSelector("button:has-text('Join Revit')", { timeout: 15000 });
  await pb.click("button:has-text('Join Revit')");
  await pb.waitForURL("**/communities/revit", { timeout: 20000 });
  await pb.waitForSelector("button:has-text('Leave')", { timeout: 15000 }).catch(() => {});
  ok("joined through the invite after verification", (await pb.locator("button:has-text('Leave')").count()) > 0);

  await pa.goto("/profile");
  await pa.waitForTimeout(1200);
  ok("private profile offers checkpoint links", (await pa.locator("text=Your profile is").count()) > 0 && (await pa.locator("button:has-text('Create share link')").count()) > 0);
  await pa.click("button:has-text('Create share link')");
  await pa.waitForSelector("input[aria-label='Share link']");
  const share = await pa.inputValue("input[aria-label='Share link']");
  ok("share link + WhatsApp/Email channels", share.includes("/shared/") && (await pa.locator("a:has-text('WhatsApp')").count()) > 0 && (await pa.locator("a:has-text('Email')").count()) > 0);

  const cc = await ctx();
  const pc = await cc.newPage();
  await pc.goto(share);
  await pc.waitForTimeout(1000);
  ok("private profile is hidden behind the email checkpoint", (await pc.locator("#ev-email").count()) === 1 && !(await pc.textContent("body")).includes("BIM software"));
  const viewer = `viewer.${stamp}@example.com`;
  await pc.fill("#ev-email", viewer);
  await pc.click("button:has-text('Send code')");
  await pc.waitForSelector("#ev-code");
  await pc.fill("#ev-code", await code(viewer));
  await pc.click("button:has-text('Verify')");
  await pc.waitForSelector("text=This profile is private and was shared with you", { timeout: 15000 });
  ok("verified viewer sees the shared private profile", (await pc.textContent("main")).includes(A.name));
  await pa.goto("/profile");
  await pa.waitForTimeout(1200);
  ok("owner can see who opened the link", (await pa.textContent("main")).includes(viewer));
} catch (e) {
  failed++;
  console.log("ERR", String(e).slice(0, 500));
}
await b.close();
process.exit(failed ? 1 : 0);
