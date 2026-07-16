import { describe, expect, it } from "vitest";
import { normalizeSidebarObjectKind, sidebarObjectKindsForDatabase } from "@/lib/database/databaseObjectCapabilities";

describe("databaseObjectCapabilities", () => {
  it("exposes materialized views for Dameng", () => {
    expect(sidebarObjectKindsForDatabase("dameng")).toContain("MATERIALIZED_VIEW");
  });

  it("exposes Xugu stored-program object kinds in the sidebar", () => {
    expect(sidebarObjectKindsForDatabase("xugu")).toEqual(expect.arrayContaining(["PROCEDURE", "FUNCTION", "TRIGGER", "SEQUENCE", "SYNONYM", "PACKAGE", "PACKAGE_BODY", "TYPE", "TYPE_BODY"]));
    expect(normalizeSidebarObjectKind("TRIGGER")).toBe("TRIGGER");
    expect(normalizeSidebarObjectKind("TYPE BODY")).toBe("TYPE_BODY");
    expect(normalizeSidebarObjectKind("SYNONYM")).toBe("SYNONYM");
  });

  it("normalizes space separated materialized view types", () => {
    expect(normalizeSidebarObjectKind("MATERIALIZED VIEW")).toBe("MATERIALIZED_VIEW");
  });
});
