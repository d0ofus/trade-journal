import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionOrBearerSecret } from "@/lib/server/api-auth";
import { marketCacheStatus, queueCandlePreparation, retryCandlePreparation, runCandlePreparation } from "@/lib/server/workstation-cache-jobs";
import { cacheEnabled, preparationEnabled } from "@/lib/server/workstation-cache-store";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const auth = await requireApiSessionOrBearerSecret(req); if (auth) return auth;
  try { return NextResponse.json(await marketCacheStatus(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Market cache status is unavailable. Check the cache migration and database connection." }, { status: 503 }); }
}
export async function POST(req: NextRequest) {
  const auth = await requireApiSessionOrBearerSecret(req); if (auth) return auth;
  const origin = req.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== (req.headers.get("host") ?? req.nextUrl.host)) throw new Error(); } catch { return NextResponse.json({ error: "Cross-origin changes are not allowed." }, { status: 403 }); } }
  const body = await req.json().catch(() => null);
  if (!["plan", "run", "retry", "pilot"].includes(body?.action)) return NextResponse.json({ error: "Use plan, run, retry or pilot." }, { status: 400 });
  if (!cacheEnabled() || (body.action !== "pilot" && !preparationEnabled())) return NextResponse.json({ error: "Enable the cache; background preparation must be enabled for backlog actions." }, { status: 409 });
  try {
    const result = body.action === "pilot" ? { ...await queueCandlePreparation(true), ...await runCandlePreparation(200_000, true) } : body.action === "plan" ? await queueCandlePreparation() : body.action === "retry" ? await retryCandlePreparation() : await runCandlePreparation();
    return NextResponse.json({ result, ...await marketCacheStatus() });
  } catch { return NextResponse.json({ error: "Preparation paused. Existing candles and imported records are preserved; inspect status and retry." }, { status: 503 }); }
}
