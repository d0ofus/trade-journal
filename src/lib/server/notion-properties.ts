import type { Trade, TradeDocument } from "@/lib/workstation/types";
import { Prisma } from "@prisma/client";
import { notionProperties } from "@/lib/workstation/notion-template";
import { richPlain } from "@/lib/workstation/rich-text";
import { executionTimeResolved } from "@/lib/workstation/execution-time-provenance";
import { notionRequest, type JsonObject } from "./notion-client";
import { notionRichText } from "./notion-format";

export type RemoteProperty = { id: string; name: string; type: string; relation?: { data_source_id?: string; database_id?: string }; select?: { options: { name: string }[] }; multi_select?: { options: { name: string }[] } };
export type PropertyPlan = { values: Record<string, JsonObject>; display: { name: string; value: string }[]; errors: string[]; schemaHashInput: unknown };
export const requiredRelations = ["Type of Review", "Type of Trade", "Chart Pattern", "Confluences", "Characteristics", "News Impact"];
export const publishedPrice = (price: number) => new Prisma.Decimal(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
export const propertySchemaSignature = (properties: RemoteProperty[]) => properties.map(p => ({ id: p.id, name: p.name, type: p.type, relation: p.relation, select: p.select, multi_select: p.multi_select })).sort((a, b) => a.id.localeCompare(b.id));
export async function planNotionProperties(trade: Trade, doc: TradeDocument, schema: Record<string, RemoteProperty>): Promise<PropertyPlan> {
  const values: Record<string, JsonObject> = {}, display: { name: string; value: string }[] = [], errors: string[] = [];
  const properties = Object.values(schema), byName = new Map(properties.map(p => [p.name, p]));
  const title = properties.find(p => p.type === "title");
  if (!title) errors.push("The Notion database has no title property.");
  else { values[title.id] = { title: notionRichText(trade.symbol) }; display.push({ name: title.name, value: trade.symbol }); }
  for (const name of requiredRelations) if (!byName.has(name) || byName.get(name)?.type !== "relation") errors.push(`Grant the connection access to the related database for ${name}.`);
  function set(name: string, type: string, value: unknown) {
    const property = byName.get(name);
    if (!property || property.type !== type) { errors.push(`${name} must exist as a Notion ${type} property.`); return; }
    values[property.id] = { [type]: value }; display.push({ name, value: value === null ? "Empty" : typeof value === "object" ? JSON.stringify(value) : String(value) });
  }
  set("Entry", "number", publishedPrice(trade.entry)); set("Exit", "number", publishedPrice(trade.exit));
  for (const [name, price] of [["Entry", trade.entry], ["Exit", trade.exit]] as const) {
    const item = display.find(item => item.name === name);
    if (item) item.value = publishedPrice(price).toFixed(2);
  }
  set("S/L", "number", doc.review.notion?.properties.plannedStop ?? null);
  const executions = [...trade.executions].sort((a, b) => a.time - b.time);
  if (!executions.length || executions.some(e => !executionTimeResolved(e) || ["pending", "stale", "unresolved"].includes(e.provenance?.interpretationStatus ?? ""))) errors.push("Resolve the execution timestamps before publishing Entry Date.");
  else set("Entry Date", "date", { start: new Date(executions[0].time * 1000).toISOString().replace(/Z$/, ""), end: new Date(executions.at(-1)!.time * 1000).toISOString().replace(/Z$/, ""), time_zone: "UTC" });
  // Notion date time_zone is applied to timezone-free wall time, not to a UTC ISO
  // string. Explicitly derive New York wall time while preserving each instant.
  const date = byName.get("Entry Date");
  if (date && values[date.id] && executions.length) {
    const wall = (time: number) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(time * 1000)).map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    };
    values[date.id] = { date: { start: wall(executions[0].time), end: wall(executions.at(-1)!.time), time_zone: "America/New_York" } };
    const item = display.find(item => item.name === "Entry Date"); if (item) item.value = `${wall(executions[0].time)} → ${wall(executions.at(-1)!.time)} America/New_York`;
  }
  for (const p of notionProperties) {
    if (p.kind === "date" || p.kind === "formula") continue;
    const value = p.kind === "takeaways" ? richPlain(doc.review.takeaway) : doc.review.notion?.properties[p.key];
    // Access to every required relation must be verified even for an untouched
    // review. An unset value is checked, but must not clear a Notion property.
    if (value === undefined && p.kind !== "relation") continue;
    if (p.kind === "relation") {
      const property = byName.get(p.label), names = Array.isArray(value) ? value : [];
      if (!property?.relation?.data_source_id) { if (property) errors.push(`${p.label} does not expose an accessible related data source.`); continue; }
      try {
        const target = await notionRequest<{ properties: Record<string, RemoteProperty> }>(`/data_sources/${property.relation.data_source_id}`);
        const title = Object.values(target.properties).find(p => p.type === "title");
        if (!title) { errors.push(`Cannot resolve the title field for ${p.label}.`); continue; }
        if (value === undefined) continue;
        const ids: { id: string }[] = [], matches = new Map<string, string[]>();
        if (names.length) {
          let cursor: string | null = null, count = 0; const cursors = new Set<string>();
          do {
            const result: { results: { id: string; properties: Record<string, { title?: { plain_text?: string; text?: { content: string } }[] }> }[]; has_more: boolean; next_cursor: string | null } = await notionRequest(`/data_sources/${property.relation.data_source_id}/query`, "POST", { filter: { or: names.map(name => ({ property: title.id, title: { equals: name } })) }, page_size: 100, ...cursor ? { start_cursor: cursor } : {} });
            for (const page of result.results) {
              const text = Object.values(page.properties).find(property => property.title)?.title?.map(part => part.plain_text ?? part.text?.content ?? "").join("").trim().toLowerCase() ?? "";
              matches.set(text, [...matches.get(text) ?? [], page.id]);
            }
            if (result.has_more && !result.next_cursor) throw new Error("Relation query returned an incomplete pagination cursor");
            count += result.results.length; cursor = result.has_more ? result.next_cursor : null;
            if (count > 1000 || cursor && cursors.has(cursor)) throw new Error("Relation query exceeded safe pagination limits");
            if (cursor) cursors.add(cursor);
          } while (cursor);
        }
        for (const name of names) {
          const found = matches.get(name.trim().toLowerCase()) ?? [];
          if (found.length !== 1) errors.push(`${p.label}: “${name}” must match exactly one related Notion page.`);
          else ids.push({ id: found[0] });
        }
        values[property.id] = { relation: ids }; display.push({ name: p.label, value: names.join(", ") || "Empty" });
      } catch { errors.push(`Grant access to the related database for ${p.label}.`); }
    } else if (p.kind === "multi" || p.kind === "select") {
      const property = byName.get(p.label), type = p.kind === "multi" ? "multi_select" : "select";
      const choices = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
      const allowed = property?.[type]?.options.map(o => o.name) ?? [];
      if (choices.some(name => !allowed.includes(name))) { errors.push(`${p.label} contains a choice not defined in Notion. Add it in Notion before publishing.`); continue; }
      set(p.label, type, type === "multi_select" ? choices.map(name => ({ name })) : choices.length ? { name: choices[0] } : null);
    } else if (p.kind === "checkbox") set(p.label, "checkbox", value === true);
    else if (p.kind === "number") set(p.label, "number", value);
    else set(p.label, "rich_text", notionRichText(richPlain(String(value ?? ""))));
  }
  return { values, display, errors: [...new Set(errors)], schemaHashInput: propertySchemaSignature(properties) };
}
