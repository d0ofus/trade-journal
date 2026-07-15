import { Prisma } from "@prisma/client";
import { BACKUP_TABLES, type BackupTableKey } from "@/lib/server/backup-contract";
import {
  validateBackupRestoreDryRun,
  type BackupRestoreDryRunIssue,
  type BackupRestoreDryRunResult,
} from "@/lib/server/backup-restore-validator";

type JsonRecord = Record<string, unknown>;

export type BackupRestorePlanIssue = BackupRestoreDryRunIssue;

export type BackupRestorePlanTable = {
  key: BackupTableKey;
  prismaModel: string;
  delegateName: string;
  rowCount: number;
  rows: JsonRecord[];
  strippedFields: string[];
};

export type BackupRestorePlan = {
  ok: true;
  validation: BackupRestoreDryRunResult;
  tableCount: number;
  totalRows: number;
  strippedFieldCount: number;
  dateFieldCount: number;
  warnings: BackupRestorePlanIssue[];
  tables: BackupRestorePlanTable[];
};

export class BackupRestorePlanError extends Error {
  readonly issues: BackupRestorePlanIssue[];
  readonly validation: BackupRestoreDryRunResult;

  constructor(message: string, issues: BackupRestorePlanIssue[], validation: BackupRestoreDryRunResult) {
    super(message);
    this.name = "BackupRestorePlanError";
    this.issues = issues;
    this.validation = validation;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function tableRows(payload: JsonRecord, key: BackupTableKey) {
  const rows = payload[key];
  return Array.isArray(rows) ? rows : [];
}

function delegateName(prismaModel: string) {
  return `${prismaModel.slice(0, 1).toLowerCase()}${prismaModel.slice(1)}`;
}

const MODEL_BY_NAME = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

function issue(code: string, message: string, path?: string): BackupRestorePlanIssue {
  return { code, message, path };
}

function normalizeScalarValue(value: unknown, field: { name: string; type: string; isList: boolean }, path: string) {
  const errors: BackupRestorePlanIssue[] = [];
  let dateFieldCount = 0;

  if (value === undefined) return { value, errors, dateFieldCount };
  if (value === null) return { value: null, errors, dateFieldCount };

  if (field.isList) {
    if (!Array.isArray(value)) {
      errors.push(issue("INVALID_RESTORE_FIELD_TYPE", `${path} must be an array.`, path));
    }
    return { value, errors, dateFieldCount };
  }

  if (field.type === "DateTime") {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        errors.push(issue("INVALID_RESTORE_DATE", `${path} must be a valid DateTime.`, path));
      }
      dateFieldCount += 1;
      return { value, errors, dateFieldCount };
    }

    if (typeof value !== "string") {
      errors.push(issue("INVALID_RESTORE_DATE", `${path} must be an ISO DateTime string.`, path));
      return { value, errors, dateFieldCount };
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      errors.push(issue("INVALID_RESTORE_DATE", `${path} must be a valid ISO DateTime string.`, path));
      return { value, errors, dateFieldCount };
    }

    dateFieldCount += 1;
    return { value: parsed, errors, dateFieldCount };
  }

  if (field.type === "Int" && (!Number.isInteger(value) || typeof value !== "number")) {
    errors.push(issue("INVALID_RESTORE_FIELD_TYPE", `${path} must be an integer.`, path));
  }
  if (field.type === "Float" && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(issue("INVALID_RESTORE_FIELD_TYPE", `${path} must be a finite number.`, path));
  }
  if (field.type === "Boolean" && typeof value !== "boolean") {
    errors.push(issue("INVALID_RESTORE_FIELD_TYPE", `${path} must be a boolean.`, path));
  }
  if (field.type === "String" && typeof value !== "string") {
    errors.push(issue("INVALID_RESTORE_FIELD_TYPE", `${path} must be a string.`, path));
  }

  return { value, errors, dateFieldCount };
}

function sanitizeRestoreRow(tableKey: BackupTableKey, prismaModel: string, row: JsonRecord, rowIndex: number) {
  const model = MODEL_BY_NAME.get(prismaModel);
  if (!model) {
    return {
      row: {},
      strippedFields: [],
      errors: [issue("UNKNOWN_RESTORE_MODEL", `Backup table ${tableKey} references unknown Prisma model ${prismaModel}.`, tableKey)],
      dateFieldCount: 0,
    };
  }

  const scalarFields = model.fields.filter((field) => field.kind === "scalar" || field.kind === "enum");
  const scalarFieldNames = new Set(scalarFields.map((field) => field.name));
  const nextRow: JsonRecord = {};
  const strippedFields = Object.keys(row).filter((fieldName) => !scalarFieldNames.has(fieldName));
  const errors: BackupRestorePlanIssue[] = [];
  let dateFieldCount = 0;

  for (const field of scalarFields) {
    const value = row[field.name];
    if (value === undefined) {
      const requiredWithoutDefault = field.isRequired && !field.hasDefaultValue && !field.isUpdatedAt;
      if (requiredWithoutDefault) {
        errors.push(
          issue(
            "MISSING_REQUIRED_RESTORE_FIELD",
            `${tableKey}.${field.name} is required for Prisma restore.`,
            `${tableKey}.${rowIndex}.${field.name}`,
          ),
        );
      }
      continue;
    }

    const normalized = normalizeScalarValue(value, field, `${tableKey}.${rowIndex}.${field.name}`);
    errors.push(...normalized.errors);
    dateFieldCount += normalized.dateFieldCount;
    nextRow[field.name] = normalized.value;
  }

  return { row: nextRow, strippedFields, errors, dateFieldCount };
}

export function buildBackupRestorePlan(payload: unknown): BackupRestorePlan {
  const validation = validateBackupRestoreDryRun(payload);
  if (!isRecord(payload) || !validation.ok || !validation.tableManifest) {
    throw new BackupRestorePlanError("Backup payload is not safe to prepare for restore.", validation.errors, validation);
  }

  const errors: BackupRestorePlanIssue[] = [];
  const warnings = [...validation.warnings];
  const tables: BackupRestorePlanTable[] = [];
  let totalRows = 0;
  let strippedFieldCount = 0;
  let dateFieldCount = 0;

  for (const key of validation.tableManifest.importOrder) {
    const contract = BACKUP_TABLES.find((table) => table.key === key);
    if (!contract) {
      errors.push(issue("UNKNOWN_BACKUP_TABLE", `Backup import order references unknown table ${key}.`, `manifest.tables.importOrder.${key}`));
      continue;
    }

    const rows: JsonRecord[] = [];
    const strippedFields = new Set<string>();

    tableRows(payload, key).forEach((row, rowIndex) => {
      if (!isRecord(row)) {
        errors.push(issue("INVALID_TABLE_ROW", `${key} row ${rowIndex} is not an object.`, `${key}.${rowIndex}`));
        return;
      }

      const sanitized = sanitizeRestoreRow(key, contract.prismaModel, row, rowIndex);
      rows.push(sanitized.row);
      for (const field of sanitized.strippedFields) strippedFields.add(field);
      errors.push(...sanitized.errors);
      strippedFieldCount += sanitized.strippedFields.length;
      dateFieldCount += sanitized.dateFieldCount;
    });

    totalRows += rows.length;
    tables.push({
      key,
      prismaModel: contract.prismaModel,
      delegateName: delegateName(contract.prismaModel),
      rowCount: rows.length,
      rows,
      strippedFields: [...strippedFields].sort((left, right) => left.localeCompare(right)),
    });
  }

  if (errors.length > 0) {
    throw new BackupRestorePlanError("Backup payload cannot be converted into Prisma restore rows.", errors, validation);
  }

  return {
    ok: true,
    validation,
    tableCount: tables.length,
    totalRows,
    strippedFieldCount,
    dateFieldCount,
    warnings,
    tables,
  };
}

export function summarizeBackupRestorePlan(plan: BackupRestorePlan) {
  return {
    ok: true,
    tableCount: plan.tableCount,
    totalRows: plan.totalRows,
    strippedFieldCount: plan.strippedFieldCount,
    dateFieldCount: plan.dateFieldCount,
    warnings: plan.warnings,
    tables: plan.tables.map((table) => ({
      key: table.key,
      prismaModel: table.prismaModel,
      delegateName: table.delegateName,
      rowCount: table.rowCount,
      strippedFields: table.strippedFields,
    })),
  };
}
