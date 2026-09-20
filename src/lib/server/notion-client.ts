import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/prisma";
import type { TemplateBlock } from "@/lib/workstation/template-layout";

export type JsonObject = Record<string, unknown>;
export type RemoteBlock = JsonObject & { id: string; type: string; has_children?: boolean; archived?: boolean; in_trash?: boolean; parent?: JsonObject };
type Results<T> = { results: T[]; has_more: boolean; next_cursor: string | null };
const budget = new AsyncLocalStorage<{ deadline: number }>();
export const withNotionBudget = <T>(operation: () => Promise<T>) => budget.getStore() ? operation() : budget.run({ deadline: Date.now() + 65_000 }, operation);
export class NotionError extends Error {
  constructor(message: string, public status = 503, public retryAt?: Date, public uncertain = false) { super(message); }
}
export const jsonHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
export function notionConfigured() { return !!process.env.NOTION_TOKEN; }
export function requireNotionPublishing() {
  if (process.env.NOTION_PUBLISH_ENABLED !== "1") throw new NotionError("Notion publishing is disabled until permissions and live validation are complete.", 503);
  if (!notionConfigured()) throw new NotionError("The server's Notion connection is not configured.", 503);
  if (process.env.E2E_DEMO_ONLY_WRITES === "1") throw new NotionError("Live Notion publishing is prohibited in browser test mode.", 403);
}
async function reserveRequest() {
  const rows = await prisma.$queryRaw<{ nextAt: Date }[]>`
    INSERT INTO "NotionRequestGate" ("key", "nextAt", "updatedAt") VALUES ('notion', (NOW() AT TIME ZONE 'UTC') + INTERVAL '400 milliseconds', (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET "nextAt" = GREATEST("NotionRequestGate"."nextAt", (NOW() AT TIME ZONE 'UTC')) + INTERVAL '400 milliseconds', "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    RETURNING "nextAt"`;
  const delay = rows[0].nextAt.getTime() - Date.now() - 400;
  if (delay > 8000) throw new NotionError("Notion is cooling down. Resume after the indicated time.", 429, rows[0].nextAt);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
}
export async function notionRequest<T = JsonObject>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (budget.getStore() && budget.getStore()!.deadline - Date.now() < 15_000) throw new NotionError("This bounded step paused safely. Resume to continue from saved progress.", 429, new Date(Date.now() + 1000));
  if (!notionConfigured()) throw new NotionError("The server's Notion connection is not configured.");
  if (!/^\/(users|data_sources|pages|blocks|file_uploads)(\/|\?|$)/.test(path)) throw new Error("Invalid Notion API path");
  const mutation = method !== "GET" && !/\/query$/.test(path);
  if (mutation) requireNotionPublishing();
  const form = body instanceof FormData;
  const encoded = body === undefined || form ? body as FormData | undefined : JSON.stringify(body);
  if (typeof encoded === "string" && Buffer.byteLength(encoded) > 480_000) throw new NotionError("This Notion operation exceeds the request size limit. Split the section into smaller sections.", 422);
  await reserveRequest();
  let response: Response;
  try {
    response = await fetch(`https://api.notion.com/v1${path}`, { method, body: encoded, cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": "2026-03-11", ...form ? {} : { "Content-Type": "application/json" } },
      signal: AbortSignal.timeout(12_000),
    });
  } catch { throw new NotionError("Notion did not confirm the request. Check saved progress before retrying.", 503, undefined, mutation); }
  if (!response.ok) {
    if (response.status === 429 || response.status === 529) {
      const raw = Number(response.headers.get("retry-after"));
      const retryAt = new Date(Date.now() + (Number.isFinite(raw) && raw > 0 ? raw : 60) * 1000 + 500);
      await prisma.$executeRaw`UPDATE "NotionRequestGate" SET "nextAt" = GREATEST("nextAt", (${retryAt}::timestamptz AT TIME ZONE 'UTC')), "updatedAt" = (NOW() AT TIME ZONE 'UTC') WHERE "key" = 'notion'`;
      throw new NotionError("Notion has requested a cooldown. Your publication can be resumed.", 429, retryAt);
    }
    const message = response.status === 401 ? "Notion authentication failed. Renew the server connection token."
      : response.status === 403 || response.status === 404 ? "Notion access is missing, the destination was removed, or the workspace block limit was reached."
      : response.status === 400 ? "Notion rejected the mapped content or property types. Refresh the preview and check the database schema."
      : "Notion is unavailable. Saved progress is retained.";
    throw new NotionError(message, response.status >= 500 ? 503 : response.status, undefined, mutation && response.status >= 500);
  }
  try { return await response.json() as T; }
  catch { throw new NotionError("Notion returned an unreadable response. Reconcile the operation before retrying.", 503, undefined, mutation); }
}
export async function notionChildren(id: string): Promise<RemoteBlock[]> {
  const results: RemoteBlock[] = [], cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Results<RemoteBlock> = await notionRequest(`/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!Array.isArray(page.results)) throw new NotionError("Notion returned invalid block data.");
    results.push(...page.results);
    if (results.length > 2000) throw new NotionError("This Notion page is too large to synchronize safely.", 422);
    if (page.has_more && !page.next_cursor) throw new NotionError("Notion returned an incomplete pagination cursor.");
    cursor = page.has_more ? page.next_cursor : null;
    if (cursor && cursors.has(cursor)) throw new NotionError("Notion pagination did not advance.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return results;
}
export function remoteText(block: RemoteBlock): string {
  const value = block[block.type] as { rich_text?: { plain_text?: string; text?: { content?: string } }[] } | undefined;
  return value?.rich_text?.map(part => part.plain_text ?? part.text?.content ?? "").join("") ?? "";
}
export async function notionTree(id: string): Promise<TemplateBlock[]> {
  let count = 0;
  async function read(parent: string, depth: number): Promise<TemplateBlock[]> {
    if (depth > 15) throw new NotionError("The Notion template nesting is too deep.", 422);
    const children = await notionChildren(parent), result: TemplateBlock[] = [];
    for (const block of children) {
      if (++count > 1000) throw new NotionError("The Notion template exceeds 1,000 blocks.", 422);
      if (block.archived || block.in_trash) continue;
      result.push({ id: block.id, type: block.type, text: remoteText(block), children: block.has_children ? await read(block.id, depth + 1) : [] });
    }
    return result;
  }
  return read(id, 0);
}
