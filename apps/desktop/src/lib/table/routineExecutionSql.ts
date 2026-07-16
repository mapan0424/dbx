import type { DatabaseType } from "@/types/database";
import { isSchemaAware } from "@/lib/database/databaseCapabilities";
import { quoteTableIdentifier } from "@/lib/table/tableSelectSql";

export interface BuildRoutineExecutionSqlOptions {
  databaseType?: DatabaseType;
  schema?: string;
  /** Optional package qualifier for a public package routine. */
  packageName?: string;
  routineName: string;
  routineKind?: RoutineKind;
}

export type RoutineKind = "PROCEDURE" | "FUNCTION";

export type TriggerAction = "ENABLE" | "DISABLE" | "RECOMPILE";

export type RoutineParameterMode = "IN" | "OUT" | "INOUT" | "RETURN" | "UNKNOWN";

export interface RoutineParameter {
  name: string;
  dataType: string;
  mode: RoutineParameterMode;
  ordinal: number;
  hasDefault?: boolean;
  defaultValue?: string | null;
}

export interface RoutineParameterValue extends RoutineParameter {
  value: string;
  useNull?: boolean;
  useDefault?: boolean;
}

export function qualifiedRoutineName(options: BuildRoutineExecutionSqlOptions): string {
  const { databaseType, schema, packageName, routineName } = options;
  if (databaseType === "databend") return routineName;
  const parts = isSchemaAware(databaseType) && schema ? [quoteTableIdentifier(databaseType, schema)] : [];
  if (packageName) parts.push(quoteTableIdentifier(databaseType, packageName));
  parts.push(quoteTableIdentifier(databaseType, routineName));
  return parts.join(".");
}

export function buildProcedureExecutionSql(options: BuildRoutineExecutionSqlOptions): string {
  return buildProcedureExecutionSqlFromValues({ ...options, parameters: [] });
}

export function buildRoutineExecutionSql(options: BuildRoutineExecutionSqlOptions): string {
  return buildRoutineExecutionSqlFromValues({ ...options, parameters: [] });
}

/** Generates the vendor DDL used to recompile a stored procedure or function. */
export function buildRoutineCompileSql(options: BuildRoutineExecutionSqlOptions & { routineKind: RoutineKind }): string | null {
  if (options.databaseType !== "xugu" && options.databaseType !== "oracle" && options.databaseType !== "dameng" && options.databaseType !== "oceanbase-oracle") return null;
  return `ALTER ${options.routineKind} ${qualifiedRoutineName(options)} RECOMPILE;`;
}

/** Generates Xugu's package recompilation statement. */
export function buildXuguPackageCompileSql(options: Omit<BuildRoutineExecutionSqlOptions, "packageName" | "routineName"> & { packageName: string }): string | null {
  if (options.databaseType !== "xugu") return null;
  return `ALTER PACKAGE ${qualifiedRoutineName({
    databaseType: options.databaseType,
    schema: options.schema,
    routineName: options.packageName,
  })} RECOMPILE;`;
}

/** Generates Xugu's DDL for recompiling a user-defined type. Current servers require RECOMPILE. */
export function buildXuguTypeCompileSql(options: Omit<BuildRoutineExecutionSqlOptions, "packageName" | "routineName"> & { typeName: string }): string | null {
  if (options.databaseType !== "xugu") return null;
  return `ALTER TYPE ${qualifiedRoutineName({
    databaseType: options.databaseType,
    schema: options.schema,
    routineName: options.typeName,
  })} RECOMPILE;`;
}

/** Generates Xugu's DDL for changing a trigger's enabled state or recompiling it. */
export function buildTriggerActionSql(options: {
  databaseType?: DatabaseType;
  schema?: string;
  triggerName: string;
  action: TriggerAction;
}): string | null {
  if (options.databaseType !== "xugu") return null;
  return `ALTER TRIGGER ${qualifiedRoutineName({
    databaseType: options.databaseType,
    schema: options.schema,
    routineName: options.triggerName,
  })} ${options.action};`;
}

export function buildProcedureExecutionSqlFromValues(options: BuildRoutineExecutionSqlOptions & { parameters: RoutineParameterValue[] }): string {
  return buildRoutineExecutionSqlFromValues({ ...options, routineKind: "PROCEDURE" });
}

export function buildRoutineExecutionSqlFromValues(options: BuildRoutineExecutionSqlOptions & { parameters: RoutineParameterValue[] }): string {
  const routine = qualifiedRoutineName(options);
  const sortedParameters = [...options.parameters].sort((a, b) => a.ordinal - b.ordinal);
  const values = sortedParameters.filter((parameter) => shouldIncludeParameter(parameter));
  const useNamedArguments = shouldUseNamedArguments(options.databaseType, sortedParameters);
  if (options.routineKind === "FUNCTION") {
    const args = values.map((parameter) => routineArgumentSql(options.databaseType, parameter, useNamedArguments)).join(", ");
    if (options.databaseType === "oracle" || options.databaseType === "dameng" || options.databaseType === "oceanbase-oracle" || options.databaseType === "xugu") {
      return `SELECT ${routine}(${args}) AS result FROM DUAL;`;
    }
    return `SELECT ${routine}(${args}) AS result;`;
  }
  if (options.databaseType === "sqlserver") {
    const args = values.map((parameter) => `${sqlServerParameterName(parameter.name)} = ${routineParameterSqlValue(options.databaseType, parameter)}`).join(", ");
    return args ? `EXEC ${routine} ${args};` : `EXEC ${routine};`;
  }
  if (options.databaseType === "xugu") {
    return buildXuguProcedureExecutionSql(options, sortedParameters, useNamedArguments);
  }
  if (options.databaseType === "oracle" || options.databaseType === "dameng" || options.databaseType === "oceanbase-oracle") {
    return `BEGIN\n  ${routine}(${values.map((parameter) => routineArgumentSql(options.databaseType, parameter, useNamedArguments)).join(", ")});\nEND;`;
  }
  if (options.databaseType === "databend") {
    return `CALL PROCEDURE ${routine}(${values.map((parameter) => routineArgumentSql(options.databaseType, parameter, useNamedArguments)).join(", ")});`;
  }
  return `CALL ${routine}(${values.map((parameter) => routineArgumentSql(options.databaseType, parameter, useNamedArguments)).join(", ")});`;
}

function buildXuguProcedureExecutionSql(options: BuildRoutineExecutionSqlOptions, sortedParameters: RoutineParameterValue[], useNamedArguments: boolean): string {
  const routine = qualifiedRoutineName(options);
  const outputParameters = sortedParameters.filter((parameter) => parameter.mode === "OUT" || parameter.mode === "INOUT");
  if (!outputParameters.length) {
    const args = sortedParameters
      .filter((parameter) => shouldIncludeParameter(parameter))
      .map((parameter) => routineArgumentSql(options.databaseType, parameter, useNamedArguments))
      .join(", ");
    return `EXEC ${routine}(${args});`;
  }

  const outputVariables = new Map<RoutineParameterValue, string>();
  const declarations = outputParameters.map((parameter) => {
    const variable = `dbx_${safeRoutineVariableName(parameter.name, parameter.ordinal)}`;
    outputVariables.set(parameter, variable);
    const initialValue = parameter.mode === "INOUT" ? ` := ${routineParameterSqlValue(options.databaseType, parameter)}` : "";
    return `  ${variable} ${parameter.dataType || "VARCHAR(4000)"}${initialValue};`;
  });
  const args = sortedParameters
    .filter((parameter) => parameter.mode !== "RETURN")
    .map((parameter) => {
      const outputVariable = outputVariables.get(parameter);
      if (outputVariable) return outputVariable;
      return routineArgumentSql(options.databaseType, parameter, false);
    })
    .join(", ");
  return `DECLARE\n${declarations.join("\n")}\nBEGIN\n  EXEC ${routine}(${args});\nEND;`;
}

function safeRoutineVariableName(name: string, ordinal: number): string {
  const normalized = name.replace(/[^A-Za-z0-9_$#]/g, "_").replace(/^\d/, "arg_");
  return normalized || `arg_${ordinal}`;
}

export function shouldIncludeParameter(parameter: RoutineParameterValue): boolean {
  if (parameter.useDefault && parameter.hasDefault) return false;
  return acceptsRoutineInput(parameter);
}

export function acceptsRoutineInput(parameter: Pick<RoutineParameterValue, "mode">): boolean {
  return parameter.mode === "IN" || parameter.mode === "INOUT" || parameter.mode === "UNKNOWN";
}

export function routineParameterSqlValue(databaseType: DatabaseType | undefined, parameter: RoutineParameterValue): string {
  if (parameter.useNull) return "NULL";
  const raw = parameter.value;
  if (raw.trim() === "") return "NULL";
  if (looksLikeNumericType(parameter.dataType)) return raw.trim();
  if (looksLikeBooleanType(parameter.dataType)) return normalizeBooleanLiteral(raw, databaseType);
  return quoteSqlString(raw);
}

function sqlServerParameterName(name: string): string {
  return name.startsWith("@") ? name : `@${name}`;
}

function routineArgumentSql(databaseType: DatabaseType | undefined, parameter: RoutineParameterValue, useNamedArguments: boolean): string {
  const value = routineParameterSqlValue(databaseType, parameter);
  if (!useNamedArguments) return value;
  return `${quoteTableIdentifier(databaseType, parameter.name)} => ${value}`;
}

function shouldUseNamedArguments(databaseType: DatabaseType | undefined, sortedParameters: RoutineParameterValue[]): boolean {
  if (databaseType !== "postgres" && databaseType !== "oracle" && databaseType !== "dameng" && databaseType !== "oceanbase-oracle" && databaseType !== "xugu") {
    return false;
  }
  let omittedDefault = false;
  for (const parameter of sortedParameters) {
    if (parameter.useDefault && parameter.hasDefault && acceptsRoutineInput(parameter)) {
      omittedDefault = true;
      continue;
    }
    if (omittedDefault && shouldIncludeParameter(parameter)) return sortedParameters.every((item) => !!item.name);
  }
  return false;
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function looksLikeNumericType(dataType: string): boolean {
  return /\b(bigint|int|integer|smallint|tinyint|serial|number|numeric|decimal|dec|float|double|real|money)\b/i.test(dataType);
}

function looksLikeBooleanType(dataType: string): boolean {
  return /\b(bool|boolean|bit)\b/i.test(dataType);
}

function normalizeBooleanLiteral(value: string, databaseType: DatabaseType | undefined): string {
  const normalized = value.trim().toLowerCase();
  const truthy = normalized === "true" || normalized === "t" || normalized === "yes" || normalized === "y" || normalized === "1";
  const falsy = normalized === "false" || normalized === "f" || normalized === "no" || normalized === "n" || normalized === "0";
  if (!truthy && !falsy) return quoteSqlString(value);
  if (databaseType === "sqlserver") return truthy ? "1" : "0";
  return truthy ? "TRUE" : "FALSE";
}
