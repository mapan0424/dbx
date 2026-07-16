import { describe, expect, it } from "vitest";
import { copyNameForTreeNode } from "@/lib/sidebar/treeNodeClick";

describe("copyNameForTreeNode", () => {
  it("uses a trigger's object name rather than its descriptive tree label", () => {
    expect(
      copyNameForTreeNode({
        id: "connection:db:schema:table:__triggers:TR_AUDIT",
        label: "TR_AUDIT (BEFORE INSERT · FOR EACH ROW · DISABLED)",
        objectName: "TR_AUDIT",
        type: "trigger",
      }),
    ).toBe("TR_AUDIT");
  });
});
