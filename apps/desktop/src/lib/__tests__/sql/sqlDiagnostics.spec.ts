import { describe, expect, it } from "vitest";
import { parseSqlErrorLocation } from "@/lib/sql/sqlDiagnostics";

describe("SQL diagnostics", () => {
  it("reads Xugu E-code line and column positions", () => {
    expect(parseSqlErrorLocation("[E19212] 编译错误 [E19182 L3 C33] 编译 SQL 过程中出错")).toEqual({ line: 2, column: 32 });
  });
});
