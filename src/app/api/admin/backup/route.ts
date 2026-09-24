import { requireApiSession } from "@/lib/server/api-auth";
import { databaseBackup } from "@/lib/server/database-backup";
import { NextResponse } from "next/server";
export async function GET() {
  const authError = await requireApiSession(); if (authError) return authError;
  const response = await databaseBackup();
  const text = await response.text();
  if (Buffer.byteLength(text) > 4_000_000) return NextResponse.json({ error: "The database backup exceeds the buffered download limit. Use Complete database + images backup for bounded direct downloads." }, { status: 413 });
  return new NextResponse(text, { status: response.status, headers: response.headers });
}
