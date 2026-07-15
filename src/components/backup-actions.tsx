"use client";

import { CheckCircle2, Download, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type BackupVerifyResult = {
  ok?: boolean;
  sha256?: string;
  totalRows?: number;
  tableCount?: number;
  strippedFieldCount?: number;
  warnings?: unknown[];
  errors?: unknown[];
  error?: string;
  audit?: {
    id?: string;
    exportedAt?: string;
    verifiedAt?: string;
    payloadBytes?: number;
    totalRows?: number;
    tableCount?: number;
    strippedFieldCount?: number;
    warningCount?: number;
    errorCount?: number;
  };
};

type BackupActionState = {
  status: "idle" | "verified" | "error";
  message: string;
  exportedAt: string | null;
  verifiedAt: string | null;
  sha256: string | null;
  payloadBytes: number;
  totalRows: number | null;
  tableCount: number | null;
  strippedFieldCount: number | null;
  warningCount: number;
  errorCount: number;
};

const idleState: BackupActionState = {
  status: "idle",
  message: "Not verified",
  exportedAt: null,
  verifiedAt: null,
  sha256: null,
  payloadBytes: 0,
  totalRows: null,
  tableCount: null,
  strippedFieldCount: null,
  warningCount: 0,
  errorCount: 0,
};
const verifiedStateStorageKey = "trade-journal.backup.verifiedState";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function downloadBackup(text: string, exportedAt: unknown) {
  const date = typeof exportedAt === "string" && !Number.isNaN(new Date(exportedAt).getTime()) ? exportedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `trade-journal-backup-${date}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function parseJsonObject(text: string) {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function errorMessageFromResponse(prefix: string, status: number, text: string, payload: Record<string, unknown> | null) {
  const payloadError = typeof payload?.error === "string" ? payload.error.trim() : "";
  const plainText = text.trim();
  return payloadError || plainText || `${prefix} failed with ${status}.`;
}

function storedVerifiedState() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(verifiedStateStorageKey);
    if (!raw) return null;
    window.sessionStorage.removeItem(verifiedStateStorageKey);
    const parsed = JSON.parse(raw) as Partial<BackupActionState>;
    if (parsed.status !== "verified") return null;
    return {
      ...idleState,
      ...parsed,
      status: "verified" as const,
      message: parsed.message || "Verified and recorded",
      payloadBytes: typeof parsed.payloadBytes === "number" ? parsed.payloadBytes : 0,
      warningCount: typeof parsed.warningCount === "number" ? parsed.warningCount : 0,
      errorCount: typeof parsed.errorCount === "number" ? parsed.errorCount : 0,
    };
  } catch {
    return null;
  }
}

function persistVerifiedState(state: BackupActionState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(verifiedStateStorageKey, JSON.stringify(state));
  } catch {
    // Session storage is best-effort; the server freshness panel remains authoritative.
  }
}

function scheduleSettingsRefresh(router: ReturnType<typeof useRouter>, auditId?: string) {
  if (typeof window === "undefined") {
    router.refresh();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("backupVerified", auditId || String(Date.now()));
  router.refresh();
  window.setTimeout(() => {
    window.location.assign(`${url.pathname}${url.search}`);
  }, 100);
}

function ResultTile({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 break-all font-mono text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function BackupActions() {
  const router = useRouter();
  const [state, setState] = useState<BackupActionState>(idleState);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const restored = storedVerifiedState();
    if (restored) setState(restored);
  }, []);

  async function handleDownloadAndVerify() {
    setLoading(true);
    setState({ ...idleState, message: "Verifying..." });
    try {
      const backupResponse = await fetch("/api/admin/backup", { cache: "no-store" });
      const backupText = await backupResponse.text();
      const payload = parseJsonObject(backupText);
      if (!backupResponse.ok) {
        throw new Error(errorMessageFromResponse("Backup export", backupResponse.status, backupText, payload));
      }
      if (!payload) {
        throw new Error("Backup export returned invalid JSON.");
      }
      const verifyResponse = await fetch("/api/admin/backup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: backupText,
      });
      const verifyText = await verifyResponse.text();
      const verifyPayload = parseJsonObject(verifyText) as BackupVerifyResult | null;

      if (!verifyResponse.ok || !verifyPayload?.ok) {
        throw new Error(errorMessageFromResponse("Backup verification", verifyResponse.status, verifyText, verifyPayload));
      }

      const nextState: BackupActionState = {
        status: "verified",
        message: "Verified and recorded",
        exportedAt: verifyPayload.audit?.exportedAt ?? (typeof payload.exportedAt === "string" ? payload.exportedAt : null),
        verifiedAt: verifyPayload.audit?.verifiedAt ?? new Date().toISOString(),
        sha256: verifyPayload.sha256 ?? null,
        payloadBytes: verifyPayload.audit?.payloadBytes ?? new Blob([backupText]).size,
        totalRows: verifyPayload.audit?.totalRows ?? verifyPayload.totalRows ?? null,
        tableCount: verifyPayload.audit?.tableCount ?? verifyPayload.tableCount ?? null,
        strippedFieldCount: verifyPayload.audit?.strippedFieldCount ?? verifyPayload.strippedFieldCount ?? null,
        warningCount: verifyPayload.audit?.warningCount ?? (Array.isArray(verifyPayload.warnings) ? verifyPayload.warnings.length : 0),
        errorCount: verifyPayload.audit?.errorCount ?? (Array.isArray(verifyPayload.errors) ? verifyPayload.errors.length : 0),
      };
      setState(nextState);
      persistVerifiedState(nextState);
      scheduleSettingsRefresh(router, verifyPayload.audit?.id);
      downloadBackup(backupText, payload.exportedAt);
    } catch (error) {
      setState({
        ...idleState,
        status: "error",
        message: error instanceof Error ? error.message : "Backup verification failed.",
        verifiedAt: new Date().toISOString(),
        errorCount: 1,
      });
    } finally {
      setLoading(false);
    }
  }

  const StatusIcon = loading ? Loader2 : state.status === "verified" ? CheckCircle2 : state.status === "error" ? XCircle : ShieldCheck;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4" data-testid="backup-actions">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon className={`h-4 w-4 ${loading ? "animate-spin text-sky-700" : state.status === "verified" ? "text-emerald-700" : state.status === "error" ? "text-red-700" : "text-slate-500"}`} />
          <div>
            <p className="text-sm font-semibold text-slate-950">Verified Backup</p>
            <p className={`text-xs ${state.status === "error" ? "text-red-700" : "text-slate-600"}`} data-testid="backup-verify-status">
              {state.message}
            </p>
          </div>
        </div>
        <Button type="button" size="sm" onClick={handleDownloadAndVerify} disabled={loading} data-testid="backup-action-download-verify">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Download & Verify
        </Button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResultTile label="SHA-256" value={state.sha256 ?? "-"} testId="backup-verify-sha256" />
        <ResultTile label="Payload Size" value={formatBytes(state.payloadBytes)} testId="backup-verify-payload-bytes" />
        <ResultTile label="Rows" value={state.totalRows?.toLocaleString() ?? "-"} testId="backup-verify-total-rows" />
        <ResultTile label="Tables" value={state.tableCount?.toLocaleString() ?? "-"} testId="backup-verify-table-count" />
        <ResultTile label="Exported At" value={formatDateTime(state.exportedAt)} testId="backup-exported-at" />
        <ResultTile label="Verified At" value={formatDateTime(state.verifiedAt)} testId="backup-verified-at" />
        <ResultTile label="Stripped Fields" value={state.strippedFieldCount?.toLocaleString() ?? "-"} testId="backup-verify-stripped-fields" />
        <ResultTile label="Warnings / Errors" value={`${state.warningCount.toLocaleString()} / ${state.errorCount.toLocaleString()}`} testId="backup-verify-issues" />
      </div>
    </div>
  );
}
