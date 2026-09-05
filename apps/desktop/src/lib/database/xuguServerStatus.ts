import type { ConnectionConfig, QueryResult } from "@/types/database";
import { effectiveDatabaseTypeForConnection } from "@/lib/database/jdbcDialect";

export interface XuguClusterNode {
  nodeId: string;
  rackNo: string;
  host: string;
  port: string;
  nodeType: string;
  state: string;
  cpuLoad: string;
  bootTime: string;
  storeCount: string;
  majorCount: string;
}

export interface XuguRunInfo {
  nodeId: string;
  activeTransactions: string;
  lockWaits: string;
  diskReadBytes: string;
  diskWriteBytes: string;
  networkReadBytes: string;
  networkWriteBytes: string;
  freeStores: string;
}

export interface XuguSessionSummary {
  nodeId: string;
  sessions: string;
  activeSessions: string;
  memoryBytes: string;
}

export interface XuguTransactionSummary {
  nodeId: string;
  activeTransactions: string;
}

export const XUGU_VERSION_SQL = "SELECT VERSION() AS VERSION FROM DUAL;";

export const XUGU_CLUSTER_NODES_SQL = `
SELECT
  NODE_ID,
  RACK_NO,
  NODE_IP,
  NODE_PORT,
  NODE_TYPE,
  NODE_STATE,
  CPU_LOAD,
  BOOT_TIME,
  STORE_NUM,
  MAJOR_NUM
FROM SYS_CLUSTERS
ORDER BY NODE_ID;`.trim();

export const XUGU_RUN_INFO_SQL = `
SELECT
  NODEID,
  ACT_TRANS_NUM,
  LOCK_WAIT_N,
  DISK_R_BYTES,
  DISK_W_BYTES,
  NET_R_BYTES,
  NET_W_BYTES,
  FREE_STO_N
FROM SYS_ALL_RUN_INFO
ORDER BY NODEID;`.trim();

/** Per-node session totals. This is optional because restricted users may not see SYS_ALL_SESSIONS. */
export const XUGU_SESSION_SUMMARY_SQL = `
SELECT NODEID AS NODE_ID,
       COUNT(*) AS SESSIONS,
       SUM(MEM_SIZE) AS MEMORY_BYTES
FROM SYS_ALL_SESSIONS
GROUP BY NODEID
ORDER BY NODEID;`.trim();

/** The thread-session view is the Xugu-specific definition of an active statement. */
export const XUGU_ACTIVE_SESSION_SQL = `
SELECT NODEID AS NODE_ID,
       COUNT(*) AS ACTIVE_SESSIONS
FROM SYS_ALL_THD_SESSION
WHERE STATE = 1
GROUP BY NODEID
ORDER BY NODEID;`.trim();

export const XUGU_TRANSACTION_SUMMARY_SQL = `
SELECT NODEID AS NODE_ID,
       COUNT(*) AS ACTIVE_TRANSACTIONS
FROM SYS_ALL_TRANS
GROUP BY NODEID
ORDER BY NODEID;`.trim();

export const XUGU_LOCK_WAITS_SQL = "SELECT COUNT(*) AS LOCK_WAITS FROM SYS_ALL_LWAITERS;";

export function connectionSupportsXuguServerDashboard(connection: ConnectionConfig | undefined): boolean {
  return !!connection && effectiveDatabaseTypeForConnection(connection) === "xugu";
}

export function xuguClusterNodeStateLabel(state: string): "joining" | "running" | "error" | "offline" | "unknown" {
  switch (Number(state)) {
    case 1:
      return "joining";
    case 2:
      return "running";
    case 3:
      return "error";
    case 4:
      return "offline";
    default:
      return "unknown";
  }
}

export type XuguClusterNodeRole = "master" | "standby" | "storage" | "query" | "worker" | "change";

export function xuguClusterNodeTypeLabels(type: string): XuguClusterNodeRole[] {
  const value = Number(type);
  if (!Number.isFinite(value) || value <= 0) return [];
  const roles: Array<[number, XuguClusterNodeRole]> = [
    [1, "master"],
    [2, "standby"],
    [4, "storage"],
    [8, "query"],
    [16, "worker"],
    [32, "change"],
  ];
  return roles.filter(([bit]) => (value & bit) === bit).map(([, role]) => role);
}

export function xuguClusterNodesFromResult(result: QueryResult): XuguClusterNode[] {
  return result.rows.map((row) => ({
    nodeId: valueAt(result, row, "NODE_ID"),
    rackNo: valueAt(result, row, "RACK_NO"),
    host: valueAt(result, row, "NODE_IP"),
    port: valueAt(result, row, "NODE_PORT"),
    nodeType: valueAt(result, row, "NODE_TYPE"),
    state: valueAt(result, row, "NODE_STATE"),
    cpuLoad: valueAt(result, row, "CPU_LOAD"),
    bootTime: valueAt(result, row, "BOOT_TIME"),
    storeCount: valueAt(result, row, "STORE_NUM"),
    majorCount: valueAt(result, row, "MAJOR_NUM"),
  }));
}

export function xuguRunInfoFromResult(result: QueryResult): XuguRunInfo[] {
  return result.rows.map((row) => ({
    nodeId: valueAt(result, row, "NODEID"),
    activeTransactions: valueAt(result, row, "ACT_TRANS_NUM"),
    lockWaits: valueAt(result, row, "LOCK_WAIT_N"),
    diskReadBytes: valueAt(result, row, "DISK_R_BYTES"),
    diskWriteBytes: valueAt(result, row, "DISK_W_BYTES"),
    networkReadBytes: valueAt(result, row, "NET_R_BYTES"),
    networkWriteBytes: valueAt(result, row, "NET_W_BYTES"),
    freeStores: valueAt(result, row, "FREE_STO_N"),
  }));
}

export function xuguSessionSummaryFromResult(result: QueryResult): XuguSessionSummary[] {
  return result.rows.map((row) => ({
    nodeId: valueAt(result, row, "NODE_ID"),
    sessions: valueAt(result, row, "SESSIONS"),
    activeSessions: valueAt(result, row, "ACTIVE_SESSIONS"),
    memoryBytes: valueAt(result, row, "MEMORY_BYTES"),
  }));
}

export function xuguTransactionSummaryFromResult(result: QueryResult): XuguTransactionSummary[] {
  return result.rows.map((row) => ({
    nodeId: valueAt(result, row, "NODE_ID"),
    activeTransactions: valueAt(result, row, "ACTIVE_TRANSACTIONS"),
  }));
}

export function xuguScalarFromResult(result: QueryResult, column: string): string {
  return result.rows.length > 0 ? valueAt(result, result.rows[0], column) : "";
}

export function xuguVersionFromResult(result: QueryResult): string {
  return xuguScalarFromResult(result, "VERSION");
}

function valueAt(result: QueryResult, row: unknown[], column: string): string {
  const index = result.columns.findIndex((candidate) => candidate.toUpperCase() === column.toUpperCase());
  return index < 0 || row[index] == null ? "" : String(row[index]);
}
