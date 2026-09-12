import { notFound } from "next/navigation";
import { WorkstationPreview } from "@/components/workstation/preview-client";
import { normalizeWorkstationFilters } from "@/lib/workstation/trade-filters";
export const dynamic = "force-dynamic";
export default async function PreviewTrades({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development" || process.env.TRADES_WORKSTATION_PREVIEW !== "1") notFound();
  const params = await searchParams;
  return <WorkstationPreview timing={params.scenario === "execution-timing"} interpreted={params.interpretation !== "original"} diagnostic={params.scenario === "execution-mismatch"} initialId={typeof params.groupKey === "string" ? params.groupKey : undefined} filters={normalizeWorkstationFilters(params)} />;
}
