import { NextRequest, NextResponse } from "next/server";
import { readTemplateLayout } from "@/lib/server/notion-template-sync";
import { notionRouteAuth, notionRouteError } from "@/lib/server/notion-route";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const error = await notionRouteAuth(request); if (error) return error;
  try { return NextResponse.json(await readTemplateLayout(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return notionRouteError(error); }
}
export async function POST(request: NextRequest) {
  const error = await notionRouteAuth(request, true); if (error) return error;
  try { return NextResponse.json(await readTemplateLayout(true), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return notionRouteError(error); }
}
