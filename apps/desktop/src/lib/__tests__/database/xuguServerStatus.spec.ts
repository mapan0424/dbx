import { describe, expect, it } from "vitest";
import {
  XUGU_ACTIVE_SESSION_SQL,
  XUGU_CLUSTER_NODES_SQL,
  XUGU_LOCK_WAITS_SQL,
  XUGU_RUN_INFO_SQL,
  XUGU_SESSION_SUMMARY_SQL,
  XUGU_TRANSACTION_SUMMARY_SQL,
  XUGU_VERSION_SQL,
  connectionSupportsXuguServerDashboard,
  xuguClusterNodeStateLabel,
  xuguClusterNodeTypeLabels,
  xuguClusterNodesFromResult,
  xuguRunInfoFromResult,
  xuguSessionSummaryFromResult,
  xuguTransactionSummaryFromResult,
  xuguVersionFromResult,
} from "@/lib/database/xuguServerStatus";

describe("Xugu server status helpers", () => {
  it("keeps the first-phase catalog queries scoped to Xugu system views", () => {
    expect(XUGU_VERSION_SQL).toContain("VERSION()");
    expect(XUGU_CLUSTER_NODES_SQL).toContain("FROM SYS_CLUSTERS");
    expect(XUGU_RUN_INFO_SQL).toContain("FROM SYS_ALL_RUN_INFO");
    expect(XUGU_SESSION_SUMMARY_SQL).toContain("FROM SYS_ALL_SESSIONS");
    expect(XUGU_ACTIVE_SESSION_SQL).toContain("FROM SYS_ALL_THD_SESSION");
    expect(XUGU_ACTIVE_SESSION_SQL).toContain("WHERE STATE = 1");
    expect(XUGU_TRANSACTION_SUMMARY_SQL).toContain("FROM SYS_ALL_TRANS");
    expect(XUGU_LOCK_WAITS_SQL).toContain("SYS_ALL_LWAITERS");
  });

  it("recognizes native and JDBC Xugu connections only", () => {
    expect(connectionSupportsXuguServerDashboard({ id: "x", name: "Xugu", db_type: "xugu" } as any)).toBe(true);
    expect(connectionSupportsXuguServerDashboard({ id: "pg", name: "Postgres", db_type: "postgres" } as any)).toBe(false);
    expect(connectionSupportsXuguServerDashboard(undefined)).toBe(false);
  });

  it("maps documented node states and roles", () => {
    expect(xuguClusterNodeStateLabel("2")).toBe("running");
    expect(xuguClusterNodeStateLabel("4")).toBe("offline");
    expect(xuguClusterNodeTypeLabels("1")).toEqual(["master"]);
    expect(xuguClusterNodeTypeLabels("29")).toEqual(["master", "storage", "query", "worker"]);
    expect(xuguClusterNodeTypeLabels("0")).toEqual([]);
    expect(xuguClusterNodeStateLabel("999")).toBe("unknown");
  });

  it("parses status rows by column name instead of column order", () => {
    const nodes = xuguClusterNodesFromResult({
      columns: ["NODE_IP", "NODE_ID", "NODE_STATE", "NODE_TYPE", "NODE_PORT", "RACK_NO", "CPU_LOAD", "BOOT_TIME", "STORE_NUM", "MAJOR_NUM"],
      rows: [["127.0.0.1", 1, 2, 1, 5138, 0, 4, "2026-01-01", 10, 8]],
    });
    const runInfo = xuguRunInfoFromResult({
      columns: ["FREE_STO_N", "NODEID", "ACT_TRANS_NUM", "LOCK_WAIT_N", "DISK_R_BYTES", "DISK_W_BYTES", "NET_R_BYTES", "NET_W_BYTES"],
      rows: [[11, 1, 2, 3, 4, 5, 6, 7]],
    });
    const sessions = xuguSessionSummaryFromResult({
      columns: ["MEMORY_BYTES", "SESSIONS", "NODE_ID", "ACTIVE_SESSIONS"],
      rows: [[1024, 4, 1, 2]],
    });
    const transactions = xuguTransactionSummaryFromResult({
      columns: ["ACTIVE_TRANSACTIONS", "NODE_ID"],
      rows: [[3, 1]],
    });

    expect(nodes[0]).toMatchObject({ nodeId: "1", host: "127.0.0.1", state: "2", majorCount: "8" });
    expect(runInfo[0]).toMatchObject({ nodeId: "1", activeTransactions: "2", freeStores: "11" });
    expect(sessions[0]).toMatchObject({ nodeId: "1", sessions: "4", activeSessions: "2", memoryBytes: "1024" });
    expect(transactions[0]).toMatchObject({ nodeId: "1", activeTransactions: "3" });
  });

  it("returns an empty value for missing or null values", () => {
    expect(xuguVersionFromResult({ columns: ["VERSION"], rows: [[null]] })).toBe("");
    expect(xuguVersionFromResult({ columns: ["OTHER"], rows: [["x"]] })).toBe("");
  });
});
