import * as api from "@/lib/backend/api";
import type { DatabaseType, QueryResult } from "@/types/database";
import type { RoutineParameter, RoutineParameterMode } from "@/lib/table/routineExecutionSql";

export type RoutineKind = "PROCEDURE" | "FUNCTION";

export interface LoadRoutineParametersOptions {
  connectionId: string;
  database: string;
  databaseType?: DatabaseType;
  schema?: string;
  routineName: string;
  routineKind?: RoutineKind;
}

export async function loadRoutineParameters(options: LoadRoutineParametersOptions): Promise<RoutineParameter[]> {
  const sql = routineParametersQuery(options);
  if (!sql) return [];
  const result = await api.executeQuery(options.connectionId, options.database, sql, options.schema, undefined, {
    maxRows: 200,
    pageSize: 200,
  });
  return routineParametersFromResult(result, options.databaseType);
}

export function supportsRoutineParameterMetadata(databaseType?: DatabaseType): boolean {
  return (
    databaseType === "postgres" ||
    databaseType === "mysql" ||
    databaseType === "doris" ||
    databaseType === "starrocks" ||
    databaseType === "sqlserver" ||
    databaseType === "oracle" ||
    databaseType === "dameng" ||
    databaseType === "oceanbase-oracle" ||
    databaseType === "xugu" ||
    databaseType === "databend"
  );
}

export function routineParametersQuery(options: Pick<LoadRoutineParametersOptions, "database" | "databaseType" | "schema" | "routineName" | "routineKind">): string | null {
  if (!supportsRoutineParameterMetadata(options.databaseType)) return null;
  const effectiveSchema = options.schema || (options.databaseType === "postgres" ? "public" : "") || (options.databaseType === "mysql" || options.databaseType === "doris" || options.databaseType === "starrocks" ? options.database : "");
  const schema = quoteSqlLiteral(effectiveSchema);
  const name = quoteSqlLiteral(options.routineName);
  if (options.databaseType === "postgres") {
    return `
SELECT
  NULLIF(arg.name, '') AS name,
  arg.data_type,
  CASE arg.mode
    WHEN 'i' THEN 'IN'
    WHEN 'o' THEN 'OUT'
    WHEN 'b' THEN 'INOUT'
    WHEN 'v' THEN 'IN'
    WHEN 't' THEN 'OUT'
    ELSE 'IN'
  END AS mode,
  arg.ordinal,
  CASE
    WHEN COALESCE(arg.mode, 'i') IN ('i', 'b', 'v') AND p.pronargdefaults > 0 AND arg.input_ordinal > p.pronargs - p.pronargdefaults THEN TRUE
    ELSE FALSE
  END AS has_default
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL (
  SELECT
    gs.ordinal AS ordinal,
    p.proargnames[gs.ordinal] AS name,
    CASE
      WHEN p.proallargtypes IS NULL THEN p.proargtypes[gs.ordinal - 1]
      ELSE p.proallargtypes[gs.ordinal]
    END::regtype::text AS data_type,
    COALESCE(p.proargmodes[gs.ordinal], 'i') AS mode,
    COUNT(*) FILTER (WHERE COALESCE(p.proargmodes[gs.ordinal], 'i') IN ('i', 'b', 'v')) OVER (ORDER BY gs.ordinal) AS input_ordinal
  FROM generate_series(1, COALESCE(array_length(p.proallargtypes, 1), p.pronargs)) AS gs(ordinal)
) arg
WHERE p.prokind = 'p'
  AND n.nspname = ${schema}
  AND p.proname = ${name}
ORDER BY arg.ordinal;`.trim();
  }
  if (options.databaseType === "mysql" || options.databaseType === "doris" || options.databaseType === "starrocks") {
    return `
SELECT
  PARAMETER_NAME AS name,
  DTD_IDENTIFIER AS data_type,
  COALESCE(PARAMETER_MODE, 'IN') AS mode,
  ORDINAL_POSITION AS ordinal,
  FALSE AS has_default
FROM information_schema.PARAMETERS
WHERE SPECIFIC_SCHEMA = ${schema}
  AND SPECIFIC_NAME = ${name}
  AND ORDINAL_POSITION > 0
ORDER BY ORDINAL_POSITION;`.trim();
  }
  if (options.databaseType === "databend") {
    return `
SELECT arguments
FROM system.procedures
WHERE name = ${name}
ORDER BY procedure_id
LIMIT 1;`.trim();
  }
  if (options.databaseType === "sqlserver") {
    return `
SELECT
  p.name AS name,
  TYPE_NAME(p.user_type_id) AS data_type,
  CASE WHEN p.is_output = 1 THEN 'OUT' ELSE 'IN' END AS mode,
  p.parameter_id AS ordinal,
  p.has_default_value AS has_default
FROM sys.parameters p
JOIN sys.objects o ON o.object_id = p.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE o.type IN ('P', 'PC')
  AND s.name = ${schema}
  AND o.name = ${name}
ORDER BY p.parameter_id;`.trim();
  }
  if (options.databaseType === "xugu") {
    const routineKindFilter = options.routineKind === "FUNCTION" ? "AND p.RET_TYPE IS NOT NULL" : options.routineKind === "PROCEDURE" ? "AND p.RET_TYPE IS NULL" : "";
    return `
SELECT TO_CHAR(p.DEFINE) AS routine_source
FROM ALL_PROCEDURES p
JOIN ALL_SCHEMAS s ON s.DB_ID = p.DB_ID AND s.SCHEMA_ID = p.SCHEMA_ID
WHERE UPPER(s.SCHEMA_NAME) = UPPER(${schema})
  AND UPPER(p.PROC_NAME) = UPPER(${name})
  ${routineKindFilter}
ORDER BY p.PROC_ID;`.trim();
  }
  if (options.databaseType === "oracle" || options.databaseType === "dameng" || options.databaseType === "oceanbase-oracle") {
    return `
SELECT
  ARGUMENT_NAME AS name,
  DATA_TYPE AS data_type,
  IN_OUT AS mode,
  POSITION AS ordinal,
  DEFAULTED AS has_default
FROM ALL_ARGUMENTS
WHERE OWNER = UPPER(${schema})
  AND OBJECT_NAME = UPPER(${name})
  AND POSITION > 0
ORDER BY SEQUENCE;`.trim();
  }
  return null;
}

export function routineParametersFromResult(result: QueryResult, databaseType?: DatabaseType): RoutineParameter[] {
  if (databaseType === "databend") return databendRoutineParametersFromResult(result);
  if (databaseType === "xugu") return xuguRoutineParametersFromResult(result);
  return result.rows
    .map((row, index) => ({
      name: String(row[0] || `arg${index + 1}`),
      dataType: String(row[1] || ""),
      mode: normalizeParameterMode(row[2]),
      ordinal: Number(row[3] || index + 1),
      hasDefault: normalizeBoolean(row[4]),
    }))
    .filter((parameter) => parameter.mode !== "RETURN");
}

function xuguRoutineParametersFromResult(result: QueryResult): RoutineParameter[] {
  const sourceIndex = result.columns.findIndex((column) => column.toLowerCase() === "routine_source");
  const source = String(result.rows[0]?.[sourceIndex >= 0 ? sourceIndex : 0] || "");
  return xuguRoutineParametersFromSource(source);
}

/** Parses a procedure/function declaration from a Xugu package specification or standalone source. */
export function xuguRoutineParametersFromSource(source: string): RoutineParameter[] {
  const declaration = source.match(/\b(?:create\s+(?:or\s+replace\s+)?)?(?:procedure|function)\s+(?:"?[\w$#]+"?\.)?"?[\w$#]+"?\s*\(/i);
  if (!declaration) return [];
  const openIndex = (declaration.index ?? source.indexOf(declaration[0])) + declaration[0].lastIndexOf("(");
  const closeIndex = closingParenthesisIndex(source, openIndex);
  if (closeIndex < 0) return [];

  return splitTopLevelComma(source.slice(openIndex + 1, closeIndex))
    .map((definition, index) => xuguRoutineParameter(definition, index + 1))
    .filter((parameter): parameter is RoutineParameter => parameter !== null);
}

function xuguRoutineParameter(definition: string, ordinal: number): RoutineParameter | null {
  const withoutDefault = definition
    .trim()
    .replace(/\s+(?:default\b|:=).*/i, "")
    .trim();
  if (!withoutDefault) return null;
  const match = withoutDefault.match(/^"?([^"\s]+)"?\s+(?:(IN\s+OUT|INOUT|IN|OUT)\s+)?(.+)$/i);
  if (!match) return null;
  return {
    name: match[1],
    dataType: match[3].trim(),
    mode: normalizeParameterMode(match[2]),
    ordinal,
    hasDefault: /\s+(?:default\b|:=)/i.test(definition),
  };
}

function databendRoutineParametersFromResult(result: QueryResult): RoutineParameter[] {
  const argumentsIndex = result.columns.findIndex((column) => column.toLowerCase() === "arguments");
  const signature = String(result.rows[0]?.[argumentsIndex >= 0 ? argumentsIndex : 0] || "");
  const inputTypes = databendInputTypesFromArguments(signature);
  return inputTypes.map((dataType, index) => ({
    name: `arg${index + 1}`,
    dataType,
    mode: "IN",
    ordinal: index + 1,
    hasDefault: false,
  }));
}

function databendInputTypesFromArguments(signature: string): string[] {
  const openIndex = signature.indexOf("(");
  if (openIndex < 0) return [];
  let depth = 0;
  for (let index = openIndex; index < signature.length; index += 1) {
    const char = signature[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return splitTopLevelComma(signature.slice(openIndex + 1, index)).filter(Boolean);
      }
    }
  }
  return [];
}

function splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function closingParenthesisIndex(value: string, openIndex: number): number {
  let depth = 0;
  let quoted = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizeParameterMode(value: unknown): RoutineParameterMode {
  const mode = String(value || "IN")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (mode === "IN") return "IN";
  if (mode === "OUT") return "OUT";
  if (mode === "INOUT" || mode === "IN/OUT") return "INOUT";
  if (mode === "RETURN") return "RETURN";
  return "UNKNOWN";
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value || "").toLowerCase();
  return text === "true" || text === "yes" || text === "y" || text === "1";
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
