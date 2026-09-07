import { describe, expect, it } from "vitest";
import { xuguDependencyObjectTypeForTreeNode, xuguObjectDependenciesSql } from "@/lib/database/xuguObjectDependencies";

describe("xuguObjectDependenciesSql", () => {
  it("reads both directions from the accessible dependency dictionary", () => {
    const sql = xuguObjectDependenciesSql({ schema: "APP", objectName: "ORDERS", objectType: "table" });

    expect(sql).toContain("JOIN ALL_DEPENDS");
    expect(sql).toContain("WHERE o.DB_ID = CURRENT_DB_ID");
    expect(sql).toContain("'DEPENDS_ON'");
    expect(sql).toContain("'REFERENCED_BY'");
    expect(sql).toContain("AND o.OBJ_TYPE = 5");
    expect(sql).toContain("ORDER BY r.DIRECTION, s.SCHEMA_NAME, o.OBJ_NAME");
  });

  it("uses the Xugu routine object type and escapes dictionary lookup literals", () => {
    const sql = xuguObjectDependenciesSql({ schema: "O'REILLY", objectName: "RUN'JOB", objectType: "function" });

    expect(sql).toContain("UPPER('O''REILLY')");
    expect(sql).toContain("UPPER('RUN''JOB')");
    expect(sql).toContain("AND o.OBJ_TYPE = 7");
  });
});

describe("xuguDependencyObjectTypeForTreeNode", () => {
  it.each([
    ["table", "table"],
    ["view", "view"],
    ["procedure", "procedure"],
    ["function", "function"],
    ["trigger", "trigger"],
    ["package", "package"],
  ] as const)("maps %s to a supported dependency object", (nodeType, expected) => {
    expect(xuguDependencyObjectTypeForTreeNode(nodeType)).toBe(expected);
  });

  it.each(["materialized_view", "package-body", "type", "sequence", "synonym"] as const)("does not expose unsupported %s objects", (nodeType) => {
    expect(xuguDependencyObjectTypeForTreeNode(nodeType)).toBeNull();
  });
});
