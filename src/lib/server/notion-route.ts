import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "./api-auth";
import { NotionError } from "./notion-client";
import { WorkstationError } from "./trade-workstation";
export async function notionRouteAuth(request: NextRequest, mutation = false) {
  const auth = await requireApiSession(); if (auth) return auth;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is disabled." }, { status: 404 });
  if (mutation && (request.headers.get("origin") !== request.nextUrl.origin || request.headers.get("sec-fetch-site") === "cross-site"))
    return NextResponse.json({ error: "A same-origin request is required." }, { status: 403 });
  return null;
}
export function notionRouteError(error: unknown) {
  const known = error instanceof NotionError || error instanceof WorkstationError;
  return NextResponse.json({ error: known ? error.message : "Notion integration is unavailable. Check its migration and server configuration.", retryAt: error instanceof NotionError ? error.retryAt?.toISOString() : undefined },
    { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
