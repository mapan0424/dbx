import type { QueryResult } from "@/types/database";

export type XuguSchedulerJob = {
  id: string;
  name: string;
  owner: string;
  type: string;
  action: string;
  argumentCount: number;
  beginAt: string;
  endAt: string;
  repeatInterval: string;
  lastRunAt: string;
  state: string;
  enabled: boolean;
  autoDrop: boolean;
  comments: string;
  raw: Record<string, unknown>;
};

export type XuguSchedulerJobCreateInput = {
  name: string;
  type: "stored_procedure" | "plsql_block";
  action: string;
  argumentCount?: number;
  /** SQL expressions passed to DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE, one per position. */
  argumentValues?: string[];
  startDate?: string;
  repeatInterval?: string;
  endDate?: string;
  enabled?: boolean;
  autoDrop?: boolean;
  comments?: string;
};

export function xuguSchedulerJobListSql(database: string): string {
  return `SELECT j.JOB_ID, j.USER_ID, u.USER_NAME AS OWNER, j.JOB_NAME, j.JOB_TYPE,
       TO_CHAR(j.JOB_ACTION) AS JOB_ACTION, j.JOB_PARAM_NUM, j.BEGIN_T, j.END_T,
       j.REPET_INTERVAL, j.TRIG_EVENTS, j.LAST_RUN_T, j.STATE, j.ENABLE,
       j.AUTO_DROP, j.IS_SYS, j.COMMENTS
FROM ALL_JOBS j
LEFT JOIN ALL_USERS u ON u.DB_ID = j.DB_ID AND u.USER_ID = j.USER_ID
WHERE j.DB_ID = (SELECT d.DB_ID FROM ALL_DATABASES d WHERE UPPER(d.DB_NAME) = UPPER(${quoteXuguString(database)}))
ORDER BY j.JOB_NAME`;
}

export function xuguSchedulerNextRunSql(database: string, name: string): string {
  return `SELECT DBMS_SCHEDULER.JOB_NEXT_RUNTIME(j.JOB_NAME, j.LAST_RUN_T) AS NEXT_RUN_T
FROM ALL_JOBS j
WHERE j.DB_ID = (SELECT d.DB_ID FROM ALL_DATABASES d WHERE UPPER(d.DB_NAME) = UPPER(${quoteXuguString(database)}))
  AND UPPER(j.JOB_NAME) = UPPER(${quoteXuguString(name)})`;
}

export function xuguCreateSchedulerJobSql(input: XuguSchedulerJobCreateInput): string {
  const name = input.name.trim();
  const action = input.action.trim();
  const argumentCount = Math.max(0, Math.min(100, Math.trunc(input.argumentCount ?? 0)));
  const startDate = xuguDateExpression(input.startDate || "SYSDATE");
  const repeatInterval = nullableXuguString(input.repeatInterval);
  const endDate = xuguDateExpression(input.endDate || "");
  const enabled = input.enabled ? "TRUE" : "FALSE";
  const autoDrop = (input.autoDrop ?? true) ? "TRUE" : "FALSE";
  const comments = nullableXuguString(input.comments);

  const statements = [
    "BEGIN",
    "  DBMS_SCHEDULER.CREATE_JOB(",
    `    ${quoteXuguString(name)},`,
    `    ${quoteXuguString(input.type)},`,
    `    ${quoteXuguString(action)},`,
    `    ${argumentCount},`,
    `    ${startDate},`,
    `    ${repeatInterval},`,
    `    ${endDate},`,
    "    'DEFAULT_JOB_CLASS',",
    `    ${enabled},`,
    `    ${autoDrop},`,
    `    ${comments}`,
    "  );",
  ];

  for (const [index, value] of (input.argumentValues || []).entries()) {
    const expression = value.trim();
    if (!expression) continue;
    statements.push(`  DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE(${quoteXuguString(name)}, ${index + 1}, ${expression});`);
  }

  statements.push("END;");
  return statements.join("\n");
}

export function xuguEnableSchedulerJobSql(name: string): string {
  return xuguSchedulerCall("ENABLE", quoteXuguString(name));
}

export function xuguDisableSchedulerJobSql(name: string): string {
  return xuguSchedulerCall("DISABLE", `${quoteXuguString(name)}, FALSE`);
}

export function xuguRunSchedulerJobSql(name: string, useCurrentSession = true): string {
  return xuguSchedulerCall("RUN_JOB", `${quoteXuguString(name)}, ${useCurrentSession ? "TRUE" : "FALSE"}`);
}

export function xuguDropSchedulerJobSql(name: string): string {
  return xuguSchedulerCall("DROP_JOB", `${quoteXuguString(name)}, FALSE`);
}

export function parseXuguSchedulerJobs(result: QueryResult): XuguSchedulerJob[] {
  return result.rows.map((row) => {
    const raw = rowToObject(result.columns, row);
    return {
      id: valueAt(raw, "JOB_ID") || valueAt(raw, "JOB_NAME"),
      name: valueAt(raw, "JOB_NAME"),
      owner: valueAt(raw, "OWNER"),
      type: valueAt(raw, "JOB_TYPE"),
      action: valueAt(raw, "JOB_ACTION"),
      argumentCount: Number(valueAt(raw, "JOB_PARAM_NUM")) || 0,
      beginAt: valueAt(raw, "BEGIN_T"),
      endAt: valueAt(raw, "END_T"),
      repeatInterval: valueAt(raw, "REPET_INTERVAL"),
      lastRunAt: valueAt(raw, "LAST_RUN_T"),
      state: valueAt(raw, "STATE"),
      enabled: xuguBoolean(valueAt(raw, "ENABLE")),
      autoDrop: xuguBoolean(valueAt(raw, "AUTO_DROP")),
      comments: valueAt(raw, "COMMENTS"),
      raw,
    };
  });
}

export function queryResultToObjects(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => rowToObject(result.columns, row));
}

export function quoteXuguString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function xuguSchedulerCall(name: string, args: string): string {
  return `BEGIN\n  DBMS_SCHEDULER.${name}(${args});\nEND;`;
}

function nullableXuguString(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? quoteXuguString(trimmed) : "NULL";
}

function xuguDateExpression(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "NULL";
  if (/^(SYSDATE|SYSTIMESTAMP|CURRENT_TIMESTAMP)$/i.test(trimmed)) return trimmed.toUpperCase();
  return quoteXuguString(trimmed);
}

function xuguBoolean(value: string): boolean {
  return /^(1|T|TRUE|Y|YES)$/i.test(value.trim());
}

function rowToObject(columns: string[], row: QueryResult["rows"][number]): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  columns.forEach((column, index) => {
    object[column] = row[index] ?? null;
  });
  return object;
}

function valueAt(row: Record<string, unknown>, column: string): string {
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === column.toLowerCase());
  const value = key ? row[key] : undefined;
  return value == null ? "" : String(value);
}
