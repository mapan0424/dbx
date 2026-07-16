import { describe, expect, it } from "vitest";
import {
  XUGU_CLUSTER_NODES_SQL,
  XUGU_RUN_INFO_SQL,
  XUGU_VERSION_SQL,
  xuguClusterNodeStateLabel,
  xuguClusterNodeTypeLabel,
  xuguClusterNodesFromResult,
  xuguRunInfoFromResult,
} from "@/lib/database/xuguMonitor";

describe("Xugu monitor metadata", () => {
  it("uses the documented version, node, and run-info sources", () => {
    expect(XUGU_VERSION_SQL).toBe("SELECT VERSION() AS VERSION FROM DUAL;");
    expect(XUGU_CLUSTER_NODES_SQL).toContain("FROM SYS_CLUSTERS");
    expect(XUGU_RUN_INFO_SQL).toContain("FROM SYS_ALL_RUN_INFO");
    expect(XUGU_RUN_INFO_SQL).toContain("ACT_TRANS_NUM");
  });

  it("maps documented node state and role codes", () => {
    expect(xuguClusterNodeStateLabel("2")).toBe("running");
    expect(xuguClusterNodeStateLabel("4")).toBe("offline");
    expect(xuguClusterNodeTypeLabel("1")).toBe("master");
    expect(xuguClusterNodeTypeLabel("4")).toBe("storage");
  });

  it("parses node and run-info rows by column name", () => {
    const nodes = xuguClusterNodesFromResult({
      columns: ["NODE_ID", "NODE_IP", "NODE_PORT", "NODE_TYPE", "NODE_STATE", "CPU_LOAD", "BOOT_TIME", "STORE_NUM", "MAJOR_NUM", "RACK_NO"],
      rows: [[1, "127.0.0.1", 5138, 1, 2, 3, "2026-01-01", 4, 2, 0]],
    });
    const runInfo = xuguRunInfoFromResult({
      columns: ["NODEID", "CURR_T", "REQ_N", "ACT_TRANS_NUM", "LOCK_WAIT_N", "DISK_R_BYTES", "DISK_W_BYTES", "NET_R_BYTES", "NET_W_BYTES", "S_LOCK_N", "X_LOCK_N", "DELAY_STO_N", "DROPED_STO_N", "FREE_STO_N"],
      rows: [[1, "2026-01-01", 10, 2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    });

    expect(nodes[0]).toMatchObject({ nodeId: "1", host: "127.0.0.1", state: "2", majorCount: "2" });
    expect(runInfo[0]).toMatchObject({ nodeId: "1", activeTransactions: "2", freeStores: "11" });
  });
});
