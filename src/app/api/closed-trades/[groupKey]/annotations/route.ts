import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lockClosedTradeForReview } from "@/lib/server/closed-trade-review-lock";
import { rejectE2eNonDemoClosedTrade } from "@/lib/server/e2e-demo-write-guard";

type Params = Promise<{ groupKey: string }>;

const pointSchema = z.object({
  time: z.number().finite(),
  price: z.number().finite(),
});

const annotationScopeSchema = z.enum(["TRADE", "SYMBOL", "GLOBAL_SYMBOL"]);
const annotationPointsSchema = z.array(pointSchema).max(4);
const annotationStyleSchema = z.record(z.string(), z.unknown());

const annotationSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  panelId: z.string().max(80).nullable().optional(),
  symbol: z.string().min(1).max(20).transform((value) => value.trim().toUpperCase()),
  timeframe: z.string().max(12).nullable().optional(),
  scope: annotationScopeSchema.optional().default("TRADE"),
  type: z.string().min(1).max(40),
  points: annotationPointsSchema.optional().default([]),
  price: z.number().finite().nullable().optional(),
  text: z.string().max(500).nullable().optional(),
  style: annotationStyleSchema.optional().default({}),
});

const annotationsPayloadSchema = z.object({
  annotations: z.array(annotationSchema).max(500),
  version: z.number().int().positive().optional(),
});

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseJsonWithSchema<T>(value: string, schema: z.ZodType<T>, fallback: T) {
  const parsed = parseJson<unknown>(value, fallback);
  const result = schema.safeParse(parsed);
  return result.success ? result.data : fallback;
}

function sanitizeAnnotationScope(value: string) {
  const parsed = annotationScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : "TRADE";
}

function sanitizeAnnotationType(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 40) : "text";
}

function sanitizeAnnotationSymbol(value: string) {
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed.slice(0, 20) : "UNKNOWN";
}

function sanitizeAnnotationPrice(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function serializeAnnotation(annotation: {
  id: string;
  closedTradeGroupKey: string;
  panelId: string | null;
  symbol: string;
  timeframe: string | null;
  scope: string;
  type: string;
  pointsJson: string;
  price: number | null;
  text: string | null;
  styleJson: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: annotation.id,
    groupKey: annotation.closedTradeGroupKey,
    panelId: annotation.panelId,
    symbol: sanitizeAnnotationSymbol(annotation.symbol),
    timeframe: annotation.timeframe,
    scope: sanitizeAnnotationScope(annotation.scope),
    type: sanitizeAnnotationType(annotation.type),
    points: parseJsonWithSchema(annotation.pointsJson, annotationPointsSchema, []),
    price: sanitizeAnnotationPrice(annotation.price),
    text: annotation.text,
    style: parseJsonWithSchema(annotation.styleJson, annotationStyleSchema, {}),
    createdAt: annotation.createdAt.toISOString(),
    updatedAt: annotation.updatedAt.toISOString(),
  };
}

type AnnotationRow = Parameters<typeof serializeAnnotation>[0];

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function GET(_req: NextRequest, props: { params: Params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupKey } = await props.params;
  const decodedGroupKey = decodeURIComponent(groupKey);
  const annotations = await prisma.closedTradeAnnotation.findMany({
    where: { closedTradeGroupKey: decodedGroupKey },
    orderBy: { createdAt: "asc" },
  });
  const state = await prisma.closedTradeAnnotationState.findUnique({
    where: { closedTradeGroupKey: decodedGroupKey },
    select: { version: true, updatedAt: true },
  });

  return NextResponse.json({
    annotations: annotations.map(serializeAnnotation),
    version: state?.version ?? 1,
    updatedAt: state?.updatedAt.toISOString() ?? null,
  });
}

export async function PUT(req: NextRequest, props: { params: Params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupKey } = await props.params;
  const decodedGroupKey = decodeURIComponent(groupKey);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = annotationsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const closedTrade = await prisma.closedTrade.findUnique({
    where: { groupKey: decodedGroupKey },
    select: { groupKey: true, isStale: true, account: { select: { ibkrAccount: true } } },
  });
  if (!closedTrade) return NextResponse.json({ error: "Closed trade not found." }, { status: 404 });
  const demoWriteError = rejectE2eNonDemoClosedTrade(closedTrade.account.ibkrAccount);
  if (demoWriteError) return demoWriteError;
  if (closedTrade.isStale) return NextResponse.json({ error: "Cannot edit a stale closed trade." }, { status: 409 });

  const currentState = await prisma.closedTradeAnnotationState.findUnique({
    where: { closedTradeGroupKey: decodedGroupKey },
    select: { version: true },
  });

  const expectedVersion = parsed.data.version;

  if (currentState && !expectedVersion) {
    return NextResponse.json({ error: "Drawing version is required.", currentVersion: currentState.version }, { status: 409 });
  }
  if (!currentState && (expectedVersion ?? 1) !== 1) {
    return NextResponse.json({ error: "Drawings changed in another tab.", currentVersion: 1 }, { status: 409 });
  }

  let result:
    | { stale: true }
    | { missing: true }
    | { conflict: true; currentVersion: number }
    | {
        conflict: false;
        annotations: AnnotationRow[];
        state: { version: number; updatedAt: Date };
      };

  try {
    result = await prisma.$transaction(
      async (tx) => {
        const lockedClosedTrade = await lockClosedTradeForReview(tx, decodedGroupKey);
        if (!lockedClosedTrade) return { missing: true as const };
        if (lockedClosedTrade.isStale) return { stale: true as const };

        let nextState;
        if (currentState) {
          const claimed = await tx.closedTradeAnnotationState.updateMany({
            where: { closedTradeGroupKey: decodedGroupKey, version: expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (claimed.count === 0) {
            return { conflict: true as const, currentVersion: currentState.version };
          }
          nextState = await tx.closedTradeAnnotationState.findUniqueOrThrow({
            where: { closedTradeGroupKey: decodedGroupKey },
          });
        } else {
          nextState = await tx.closedTradeAnnotationState.create({
            data: { closedTradeGroupKey: decodedGroupKey, version: 2 },
          });
        }

        await tx.closedTradeAnnotation.deleteMany({
          where: { closedTradeGroupKey: decodedGroupKey },
        });

        if (parsed.data.annotations.length > 0) {
          await tx.closedTradeAnnotation.createMany({
            data: parsed.data.annotations.map((annotation) => ({
              id: annotation.id,
              closedTradeGroupKey: decodedGroupKey,
              panelId: annotation.panelId ?? null,
              symbol: annotation.symbol,
              timeframe: annotation.timeframe ?? null,
              scope: annotation.scope,
              type: annotation.type,
              pointsJson: JSON.stringify(annotation.points),
              price: annotation.price ?? null,
              text: annotation.text ?? null,
              styleJson: JSON.stringify(annotation.style),
            })),
          });
        }

        return {
          conflict: false as const,
          annotations: await tx.closedTradeAnnotation.findMany({
            where: { closedTradeGroupKey: decodedGroupKey },
            orderBy: { createdAt: "asc" },
          }),
          state: nextState,
        };
      },
      { maxWait: 10000, timeout: 20000 },
    );
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const current = await prisma.closedTradeAnnotationState.findUnique({
      where: { closedTradeGroupKey: decodedGroupKey },
      select: { version: true },
    });
    return NextResponse.json({ error: "Drawings changed in another tab.", currentVersion: current?.version ?? 1 }, { status: 409 });
  }

  if ("missing" in result) {
    return NextResponse.json({ error: "Closed trade not found." }, { status: 404 });
  }

  if ("stale" in result) {
    return NextResponse.json({ error: "Cannot edit a stale closed trade." }, { status: 409 });
  }

  if (result.conflict) {
    const current = await prisma.closedTradeAnnotationState.findUnique({
      where: { closedTradeGroupKey: decodedGroupKey },
      select: { version: true },
    });
    return NextResponse.json(
      { error: "Drawings changed in another tab.", currentVersion: current?.version ?? result.currentVersion },
      { status: 409 },
    );
  }

  const { annotations, state } = result;
  return NextResponse.json({ annotations: annotations.map(serializeAnnotation), version: state.version, updatedAt: state.updatedAt.toISOString() });
}
