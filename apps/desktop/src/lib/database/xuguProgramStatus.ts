import type { QueryResult } from "@/types/database";

export interface XuguProgramStatus {
  valid?: boolean;
  allOk?: boolean;
}

/** Builds a dictionary query for a Xugu package or user-defined type's validity. */
export function xuguProgramStatusSql(schema: string, name: string, objectType: "PACKAGE" | "TYPE"): string {
  const object = objectType === "PACKAGE" ? "ALL_PACKAGES p" : "ALL_TYPES p";
  const nameColumn = objectType === "PACKAGE" ? "p.PACK_NAME" : "p.TYPE_NAME";
  const allOk = objectType === "PACKAGE" ? "p.ALL_OK" : "NULL AS ALL_OK";
  return `
SELECT p.VALID, ${allOk}
FROM ${object}
JOIN ALL_SCHEMAS s ON s.DB_ID = p.DB_ID AND s.SCHEMA_ID = p.SCHEMA_ID
WHERE UPPER(s.SCHEMA_NAME) = UPPER(${quoteSqlLiteral(schema)})
  AND UPPER(${nameColumn}) = UPPER(${quoteSqlLiteral(name)})`.trim();
}

export function parseXuguProgramStatus(result: QueryResult): XuguProgramStatus | null {
  if (!result.rows[0]) return null;
  const validIndex = result.columns.findIndex((column) => column.toUpperCase() === "VALID");
  const allOkIndex = result.columns.findIndex((column) => column.toUpperCase() === "ALL_OK");
  const valid = asBoolean(result.rows[0][validIndex >= 0 ? validIndex : 0]);
  const allOk = asBoolean(result.rows[0][allOkIndex >= 0 ? allOkIndex : 1]);
  return valid == null && allOk == null ? null : { valid: valid ?? undefined, allOk: allOk ?? undefined };
}

export function xuguProgramStatusLabel(name: string, status: XuguProgramStatus | null): string {
  if (!status) return name;
  if (status.valid === false) return `${name} · INVALID`;
  if (status.allOk === false) return `${name} · MEMBER INVALID`;
  return name;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["1", "T", "TRUE", "Y", "YES"].includes(normalized)) return true;
  if (["0", "F", "FALSE", "N", "NO"].includes(normalized)) return false;
  return null;
}
