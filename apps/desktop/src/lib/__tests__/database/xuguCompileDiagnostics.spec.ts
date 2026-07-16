import { describe, expect, it } from "vitest";
import { parseXuguCompileDiagnostics, xuguCompileDiagnosticsResult, xuguSystemErrorLogSql } from "@/lib/database/xuguCompileDiagnostics";

describe("Xugu compile diagnostics", () => {
  it("extracts nested error codes and source locations", () => {
    expect(parseXuguCompileDiagnostics("[E19212] 代码编译错误 [E19182 L3 C33] 编译 SQL 过程中出错")).toEqual([
      { code: "E19182", line: 3, column: 33, message: "编译 SQL 过程中出错" },
      { code: "E19212", line: undefined, column: undefined, message: "代码编译错误" },
    ]);
  });

  it("builds a positioned result table for a Compile tab", () => {
    const result = xuguCompileDiagnosticsResult("[E19132] 语法错误 [E19260 L1 C122] 期待符号: ;");
    expect(result).toMatchObject({ columns: ["Error", "Code", "Line", "Column"], execution_error: true });
    expect(result?.rows).toContainEqual(["[E19260 L1 C122] 期待符号: ;", "E19260", 1, 122]);
  });

  it("builds the optional privileged system-error-log query safely", () => {
    expect(xuguSystemErrorLogSql("SYS'DBA", 500)).toContain("WHERE USER = 'SYS''DBA'");
    expect(xuguSystemErrorLogSql("SYSDBA", 500)).toContain("LIMIT 100");
  });
});
