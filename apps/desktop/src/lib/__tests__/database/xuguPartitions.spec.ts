import { describe, expect, it } from "vitest";
import { parseXuguTablePartitions, xuguPartitionActionSql, xuguTablePartitionsSql } from "@/lib/database/xuguPartitions";

describe("xuguPartitions", () => {
  it("builds online, offline, and drop DDL with quoted identifiers", () => {
    expect(xuguPartitionActionSql({ schema: "APP", table: "ORDER", partition: "P_2026", action: "ONLINE" })).toBe('ALTER TABLE "APP"."ORDER" SET PARTITION "P_2026" ONLINE;');
    expect(xuguPartitionActionSql({ schema: "APP", table: "ORDER", partition: "SP_A", action: "OFFLINE", subpartition: true })).toBe('ALTER TABLE "APP"."ORDER" SET SUBPARTITION "SP_A" OFFLINE;');
    expect(xuguPartitionActionSql({ schema: "APP", table: "ORDER", partition: "P_2026", action: "DROP" })).toBe('ALTER TABLE "APP"."ORDER" DROP PARTITION "P_2026";');
  });

  it("reads primary and subpartition metadata from ALL dictionary views", () => {
    const sql = xuguTablePartitionsSql("APP", "ORDERS");
    expect(sql).toContain("FROM ALL_PARTIS p");
    expect(sql).toContain("FROM ALL_SUBPARTIS sp");
    expect(sql).toContain("UPPER('APP')");
    expect(sql).toContain("UPPER('ORDERS')");
  });

  it("keeps subpartitions separate because the dictionary has no parent number", () => {
    expect(parseXuguTablePartitions({ columns: ["KIND", "OBJECT_NO", "OBJECT_NAME", "OBJECT_VALUE", "ONLINE"], rows: [["PARTITION", 0, "P2025", "2026-01-01", "T"], ["SUBPARTITION", 0, "P2025_01", "2025-02-01", null]] } as any)).toEqual({
      partitions: [{ number: "0", name: "P2025", value: "2026-01-01", online: "T" }],
      subpartitions: [{ number: "0", name: "P2025_01", value: "2025-02-01" }],
    });
  });
});
