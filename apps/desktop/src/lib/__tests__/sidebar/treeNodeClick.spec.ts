import { describe, expect, it } from "vitest";
import { objectSourceKindForTreeNode, objectSourceTargetForTreeNode, treeNodeRowAction } from "@/lib/sidebar/treeNodeClick";

describe("treeNodeClick", () => {
  it("opens synonym nodes as synonym source", () => {
    expect(objectSourceKindForTreeNode("synonym")).toBe("SYNONYM");
    expect(treeNodeRowAction("synonym", false)).toBe("open-source");
  });

  it("expands package containers while preserving source behavior for leaf packages", () => {
    expect(treeNodeRowAction("package", true)).toBe("toggle");
    expect(treeNodeRowAction("package", false)).toBe("open-source");
  });

  it("routes package members to their owning package body", () => {
    expect(
      objectSourceTargetForTreeNode({
        id: "pkg:member",
        label: "calculate(p_value IN INT)",
        type: "function",
        objectName: "calculate",
        parentName: "business_api",
        parentSchema: "app_schema",
        parentType: "package",
        schema: "ignored_schema",
        signature: "p_value IN INT",
      }),
    ).toEqual({
      name: "business_api",
      schema: "app_schema",
      objectType: "PACKAGE",
      signature: "p_value IN INT",
    });
  });

  it("keeps standalone routine source routing unchanged", () => {
    expect(objectSourceTargetForTreeNode({ id: "proc", label: "standalone_proc", type: "procedure", schema: "app" })).toEqual({
      name: "standalone_proc",
      schema: "app",
      objectType: "PROCEDURE",
      signature: undefined,
    });
  });

  it("does not reinterpret unrelated parent metadata as a package member", () => {
    expect(objectSourceTargetForTreeNode({ id: "routine", label: "child_routine", type: "function", schema: "app", parentName: "other_parent" })).toEqual({
      name: "child_routine",
      schema: "app",
      objectType: "FUNCTION",
      signature: undefined,
    });
  });
});
