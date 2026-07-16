import { describe, expect, it } from "vitest";
import { xuguTablespaceInventorySql } from "@/lib/database/xuguTablespaces";

describe("xuguTablespaceInventorySql", () => {
  it("lists tablespace metadata and associated data files", () => {
    const sql = xuguTablespaceInventorySql();
    expect(sql).toContain("FROM ALL_TABLESPACES ts");
    expect(sql).toContain("LEFT JOIN ALL_DATAFILES df");
    expect(sql).toContain("ts.MEDIA_ERROR");
    expect(sql).toContain("df.PATH");
  });
});
