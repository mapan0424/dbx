import { describe, expect, it } from "vitest";
import { parseXuguProgramStatus, xuguProgramStatusLabel, xuguProgramStatusSql } from "@/lib/database/xuguProgramStatus";

describe("Xugu package/type status", () => {
  it("queries the public package/type dictionary views", () => {
    expect(xuguProgramStatusSql("APP", "PAYROLL", "PACKAGE")).toContain("FROM ALL_PACKAGES p");
    expect(xuguProgramStatusSql("APP", "PAYROLL", "PACKAGE")).toContain("p.ALL_OK");
    expect(xuguProgramStatusSql("APP", "ADDRESS_T", "TYPE")).toContain("FROM ALL_TYPES p");
  });

  it("parses validity and provides an actionable label", () => {
    const status = parseXuguProgramStatus({
      columns: ["VALID", "ALL_OK"],
      column_types: ["BOOLEAN", "BOOLEAN"],
      rows: [[false, true]],
      affected_rows: 0,
      execution_time_ms: 0,
      truncated: false,
    });
    expect(status).toEqual({ valid: false, allOk: true });
    expect(xuguProgramStatusLabel("PAYROLL", status)).toBe("PAYROLL · INVALID");
    expect(xuguProgramStatusLabel("PAYROLL", { valid: true, allOk: false })).toBe("PAYROLL · MEMBER INVALID");
  });
});
