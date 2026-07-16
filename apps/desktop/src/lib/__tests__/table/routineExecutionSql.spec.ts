import { describe, expect, it } from "vitest";
import { buildProcedureExecutionSqlFromValues, buildRoutineCompileSql, buildRoutineExecutionSqlFromValues, buildTriggerActionSql, buildXuguPackageCompileSql, buildXuguTypeCompileSql } from "@/lib/table/routineExecutionSql";
import { routineParametersFromResult, routineParametersQuery, supportsRoutineParameterMetadata, xuguRoutineParametersFromSource } from "@/lib/table/routineParameters";

describe("Xugu procedure execution", () => {
  it("uses Xugu EXEC syntax for procedure calls", () => {
    expect(
      buildProcedureExecutionSqlFromValues({
        databaseType: "xugu",
        schema: "APP",
        routineName: "SYNC_ORDERS",
        parameters: [
          { name: "p_batch_id", dataType: "INTEGER", mode: "IN", ordinal: 1, value: "42" },
          { name: "p_dry_run", dataType: "BOOLEAN", mode: "IN", ordinal: 2, value: "true" },
        ],
      }),
    ).toBe('EXEC "APP"."SYNC_ORDERS"(42, TRUE);');
  });

  it("loads parameter metadata from ALL_PROCEDURES and parses procedure declarations", () => {
    expect(supportsRoutineParameterMetadata("xugu")).toBe(true);
    expect(
      routineParametersQuery({
        database: "XUGU",
        databaseType: "xugu",
        schema: "APP",
        routineName: "SYNC_ORDERS",
      }),
    ).toContain("FROM ALL_PROCEDURES");
    expect(
      routineParametersFromResult(
        {
          columns: ["routine_source"],
          rows: [["CREATE OR REPLACE PROCEDURE APP.SYNC_ORDERS(p_batch_id IN INTEGER, p_note VARCHAR(100) DEFAULT 'new') AS BEGIN NULL; END;"]],
          column_types: ["CLOB"],
          affected_rows: 0,
          execution_time_ms: 0,
          truncated: false,
        },
        "xugu",
      ),
    ).toEqual([
      { name: "p_batch_id", dataType: "INTEGER", mode: "IN", ordinal: 1, hasDefault: false },
      { name: "p_note", dataType: "VARCHAR(100)", mode: "IN", ordinal: 2, hasDefault: true },
    ]);
  });

  it("parses function declarations and generates a query returning the result", () => {
    expect(
      routineParametersFromResult(
        {
          columns: ["routine_source"],
          rows: [["CREATE OR REPLACE FUNCTION APP.ADD_ONE(p_value IN INTEGER) RETURN INTEGER AS BEGIN RETURN p_value + 1; END;"]],
          column_types: ["CLOB"],
          affected_rows: 0,
          execution_time_ms: 0,
          truncated: false,
        },
        "xugu",
      ),
    ).toEqual([{ name: "p_value", dataType: "INTEGER", mode: "IN", ordinal: 1, hasDefault: false }]);
    expect(
      buildRoutineExecutionSqlFromValues({
        databaseType: "xugu",
        schema: "APP",
        routineName: "ADD_ONE",
        routineKind: "FUNCTION",
        parameters: [{ name: "p_value", dataType: "INTEGER", mode: "IN", ordinal: 1, value: "42" }],
      }),
    ).toBe('SELECT "APP"."ADD_ONE"(42) AS result FROM DUAL;');
  });

  it("executes a public package member using parameters parsed from its specification", () => {
    const parameters = xuguRoutineParametersFromSource("FUNCTION ADD_ONE(p_value IN INTEGER, p_note VARCHAR(20) DEFAULT 'new') RETURN INTEGER");
    expect(parameters).toEqual([
      { name: "p_value", dataType: "INTEGER", mode: "IN", ordinal: 1, hasDefault: false },
      { name: "p_note", dataType: "VARCHAR(20)", mode: "IN", ordinal: 2, hasDefault: true },
    ]);
    expect(
      buildRoutineExecutionSqlFromValues({
        databaseType: "xugu",
        schema: "APP",
        packageName: "PAYROLL",
        routineName: "ADD_ONE",
        routineKind: "FUNCTION",
        parameters: [{ ...parameters[0], value: "42" }, { ...parameters[1], value: "", useDefault: true }],
      }),
    ).toBe('SELECT "APP"."PAYROLL"."ADD_ONE"(42) AS result FROM DUAL;');
  });

  it("uses Xugu ALTER ... RECOMPILE for procedure and function compilation", () => {
    expect(buildRoutineCompileSql({ databaseType: "xugu", schema: "APP", routineName: "SYNC_ORDERS", routineKind: "PROCEDURE" })).toBe('ALTER PROCEDURE "APP"."SYNC_ORDERS" RECOMPILE;');
    expect(buildRoutineCompileSql({ databaseType: "xugu", schema: "APP", routineName: "ADD_ONE", routineKind: "FUNCTION" })).toBe('ALTER FUNCTION "APP"."ADD_ONE" RECOMPILE;');
  });

  it("uses Xugu ALTER PACKAGE ... RECOMPILE for package compilation", () => {
    expect(buildXuguPackageCompileSql({ databaseType: "xugu", schema: "APP", packageName: "PAYROLL" })).toBe('ALTER PACKAGE "APP"."PAYROLL" RECOMPILE;');
    expect(buildXuguPackageCompileSql({ databaseType: "postgres", schema: "APP", packageName: "PAYROLL" })).toBeNull();
    expect(buildXuguTypeCompileSql({ databaseType: "xugu", schema: "APP", typeName: "ADDRESS_T" })).toBe('ALTER TYPE "APP"."ADDRESS_T" RECOMPILE;');
    expect(buildXuguTypeCompileSql({ databaseType: "postgres", schema: "APP", typeName: "ADDRESS_T" })).toBeNull();
  });

  it("generates Xugu trigger state and compile statements", () => {
    expect(buildTriggerActionSql({ databaseType: "xugu", schema: "APP", triggerName: "AUDIT_ORDERS", action: "ENABLE" })).toBe('ALTER TRIGGER "APP"."AUDIT_ORDERS" ENABLE;');
    expect(buildTriggerActionSql({ databaseType: "xugu", schema: "APP", triggerName: "AUDIT_ORDERS", action: "DISABLE" })).toBe('ALTER TRIGGER "APP"."AUDIT_ORDERS" DISABLE;');
    expect(buildTriggerActionSql({ databaseType: "xugu", schema: "APP", triggerName: "AUDIT_ORDERS", action: "RECOMPILE" })).toBe('ALTER TRIGGER "APP"."AUDIT_ORDERS" RECOMPILE;');
    expect(buildTriggerActionSql({ databaseType: "postgres", schema: "APP", triggerName: "AUDIT_ORDERS", action: "ENABLE" })).toBeNull();
  });
});
