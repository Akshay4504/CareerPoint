import "server-only";
import { spawn } from "node:child_process";

// PDF text extraction runs in a short-lived child process, not in the web server:
//  - the bundled pdf.js mutates global state in whatever process loads it, which was observed to break later
//    server-action redirects in the Next.js server;
//  - untrusted PDFs get a hard time limit and memory isolation, and the child gets no environment secrets.
const CHILD_SCRIPT = `
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  try {
    const out = await pdfParse(Buffer.concat(chunks));
    process.stdout.write(out.text);
  } catch (e) {
    process.stderr.write(String(e && e.message || e));
    process.exit(2);
  }
});
`;

// Referenced so the bundler's file tracing includes pdf-parse in production builds (the child resolves it from cwd).
export const _traceDeps = () => import("pdf-parse/lib/pdf-parse.js");

function extractPdf(buf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=256", "-e", CHILD_SCRIPT], { cwd: process.cwd(), env: {} as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    let size = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("PDF extraction timed out"));
    }, 20_000);
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 5_000_000) child.kill("SIGKILL");
      else out.push(c);
    });
    child.stderr.on("data", (c: Buffer) => (err += c.toString().slice(0, 500)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(`PDF extraction failed (${code}): ${err}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(buf);
  });
}

/** Extract plain text from a validated resume buffer. */
export async function extractText(buf: Buffer, mime: string): Promise<string> {
  if (mime === "text/plain") return buf.toString("utf8");
  if (mime === "application/pdf") return extractPdf(buf);
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value;
  }
  throw new Error("Unsupported resume format");
}
