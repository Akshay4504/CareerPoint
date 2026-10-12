/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return null;
  return next;
}
