import type { QueryResult } from "@/types/database";

export interface XuguCompileDiagnostic {
  code: string;
  line?: number;
  column?: number;
  message: string;
}

const XUGU_ERROR_RE = /\[E(\d+)(?:\s+L(\d+))?(?:\s+C(\d+))?\]\s*([^\[]*)/gi;

/**
 * Extracts Xugu's nested compiler diagnostics, for example
 * `[E19212] 编译错误 [E19182 L3 C33] 编译 SQL 过程中出错`.
 */
export function parseXuguCompileDiagnostics(value: string): XuguCompileDiagnostic[] {
  const diagnostics: XuguCompileDiagnostic[] = [];
  for (const match of value.matchAll(XUGU_ERROR_RE)) {
    const code = `E${match[1]}`;
    const line = positiveNumber(match[2]);
    const column = positiveNumber(match[3]);
    const message = (match[4] || "").replace(/\s+/g, " ").trim() || "XuguDB compilation error";
    const diagnostic = { code, line, column, message };
    if (!diagnostics.some((item) => item.code === diagnostic.code && item.line === diagnostic.line && item.column === diagnostic.column && item.message === diagnostic.message)) {
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics.sort((left, right) => Number(Boolean(right.line || right.column)) - Number(Boolean(left.line || left.column)));
}

/** Turns a Xugu compiler error into the tabular result shown beneath a Compile tab. */
export function xuguCompileDiagnosticsResult(value: string): QueryResult | null {
  const diagnostics = parseXuguCompileDiagnostics(value);
  if (diagnostics.length === 0) return null;
  return {
    columns: ["Error", "Code", "Line", "Column"],
    execution_error: true,
    rows: diagnostics.map((diagnostic) => [
      diagnosticLabel(diagnostic),
      diagnostic.code,
      diagnostic.line ?? null,
      diagnostic.column ?? null,
    ]),
    affected_rows: 0,
    execution_time_ms: 0,
  };
}

/**
 * The decompiled DBeaver plugin uses SYS_ERROR_LOG for privileged system
 * schemas. Callers must treat this as optional because ordinary schemas may
 * not have SELECT permission on the system log table.
 */
export function xuguSystemErrorLogSql(username: string, limit = 20): string {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  return `SELECT ERR_NO, ERR_CODE, EX_TIME, ERR_STR, SQL_STR\nFROM SYS_ERROR_LOG\nWHERE USER = ${quoteXuguString(username)}\nORDER BY EX_TIME DESC\nLIMIT ${safeLimit}`;
}

function diagnosticLabel(diagnostic: XuguCompileDiagnostic): string {
  const position = diagnostic.line ? ` L${diagnostic.line}${diagnostic.column ? ` C${diagnostic.column}` : ""}` : "";
  return `[${diagnostic.code}${position}] ${diagnostic.message}`;
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function quoteXuguString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
