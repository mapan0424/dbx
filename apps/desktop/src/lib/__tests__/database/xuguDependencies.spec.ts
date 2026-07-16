import { describe, expect, it } from "vitest";
import { xuguObjectDependenciesSql } from "@/lib/database/xuguDependencies";

describe("xuguObjectDependenciesSql", () => {
  it("queries both dependency directions using current ALL_* dictionary views", () => {
    const sql = xuguObjectDependenciesSql({ schema: "APP", objectName: "ORDERS", objectType: "table" });
    expect(sql).toContain("FROM ALL_DEPENDS");
    expect(sql).toContain("'DEPENDS_ON'");
    expect(sql).toContain("'REFERENCED_BY'");
    expect(sql).toContain("AND o.OBJ_TYPE = 5");
    expect(sql).toContain("UPPER('APP')");
  });

  it("quotes object names and maps routine objects to Xugu object type 7", () => {
    const sql = xuguObjectDependenciesSql({ schema: "O'REILLY", objectName: "RUN'JOB", objectType: "function" });
    expect(sql).toContain("UPPER('O''REILLY')");
    expect(sql).toContain("UPPER('RUN''JOB')");
    expect(sql).toContain("AND o.OBJ_TYPE = 7");
  });
});
