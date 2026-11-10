import { prisma } from "@/lib/prisma";
import { claimCacheLease } from "./workstation-cache-store";
import { waitForHistory } from "@/lib/workstation/shared-requests";

/** One SEC rate gate shared by company fundamentals and historical shares. */
export async function secJson(url: string, parent: AbortSignal, cacheSeconds?: number): Promise<unknown> {
  return secRead(url, parent, "json", cacheSeconds);
}
export async function secText(url: string, parent: AbortSignal): Promise<string> {
  return await secRead(url, parent, "text") as string;
}
async function secRead(url: string, parent: AbortSignal, format: "json" | "text", cacheSeconds?: number): Promise<unknown> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(45_000)]);
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const cooldown = await prisma.workstationCandleLease.findUnique({ where: { key: "rate:sec:cooldown" } });
    if (cooldown && cooldown.expiresAt > new Date()) throw new Error("SEC requests are cooling down. Retry shortly.");
    while (!(await claimCacheLease("rate:sec", 500))) await waitForHistory(525, signal);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        ...(cacheSeconds ? { next: { revalidate: cacheSeconds } } : { cache: "no-store" as const }),
        headers: { "User-Agent": process.env.SEC_USER_AGENT?.trim() || "TradeJournal/1.0 (https://github.com/d0ofus/trade-journal)", Accept: format === "json" ? "application/json" : "text/html,application/xml,text/xml" },
      });
      if (response.status === 429 || response.status === 403) {
        const header = response.headers.get("retry-after");
        const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 60;
        const expiresAt = new Date(Date.now() + Math.max(60, Number.isFinite(seconds) ? seconds : 60) * 1000);
        await prisma.workstationCandleLease.upsert({ where: { key: "rate:sec:cooldown" }, create: { key: "rate:sec:cooldown", token: "cooldown", expiresAt }, update: { expiresAt } });
        throw new SecRequestError("SEC is temporarily limiting requests. Retry shortly.", false);
      }
      if (!response.ok) throw new SecRequestError(`SEC data unavailable (${response.status}).`, response.status >= 500, response.status);
      if (format === "json") return await response.json();
      const reader = response.body?.getReader(); if (!reader) return "";
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 8_000_000) throw new SecRequestError("SEC document exceeds the supported size.", false, 413); chunks.push(next.value); }
      } finally { await reader.cancel(); }
      return Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === 2 || error instanceof SecRequestError && !error.retryable) throw error;
      await waitForHistory(500 * 2 ** attempt, signal);
    }
  }
  throw new Error("SEC data unavailable.");
}
export class SecRequestError extends Error { constructor(message: string, readonly retryable: boolean, readonly status?: number) { super(message); } }
