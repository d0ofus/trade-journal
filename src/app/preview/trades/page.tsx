import { notFound } from "next/navigation";
import { WorkstationPreview } from "@/components/workstation/preview-client";
export const dynamic = "force-dynamic";
export default async function PreviewTrades({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development" || process.env.TRADES_WORKSTATION_PREVIEW !== "1") notFound();
  const params = await searchParams;
  return <WorkstationPreview initialId={typeof params.groupKey === "string" ? params.groupKey : undefined} />;
}
