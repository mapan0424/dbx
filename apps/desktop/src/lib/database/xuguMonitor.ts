import type { QueryResult } from "@/types/database";

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
  currentTime: string;
  requests: string;
  activeTransactions: string;
  lockWaits: string;
  diskReadBytes: string;
  diskWriteBytes: string;
  networkReadBytes: string;
  networkWriteBytes: string;
  sharedLocks: string;
  exclusiveLocks: string;
  delayedStores: string;
  droppedStores: string;
  freeStores: string;
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
  CURR_T,
  REQ_N,
  ACT_TRANS_NUM,
  LOCK_WAIT_N,
  DISK_R_BYTES,
  DISK_W_BYTES,
  NET_R_BYTES,
  NET_W_BYTES,
  S_LOCK_N,
  X_LOCK_N,
  DELAY_STO_N,
  DROPED_STO_N,
  FREE_STO_N
FROM SYS_ALL_RUN_INFO
ORDER BY NODEID;`.trim();

export function xuguClusterNodeStateLabel(state: string): "joining" | "running" | "error" | "offline" | "unknown" {
  switch (Number(state)) {
    case 1: return "joining";
    case 2: return "running";
    case 3: return "error";
    case 4: return "offline";
    default: return "unknown";
  }
}

export function xuguClusterNodeTypeLabel(type: string): "master" | "standby" | "storage" | "unknown" {
  switch (Number(type)) {
    case 1: return "master";
    case 2: return "standby";
    case 4: return "storage";
    default: return "unknown";
  }
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
    currentTime: valueAt(result, row, "CURR_T"),
    requests: valueAt(result, row, "REQ_N"),
    activeTransactions: valueAt(result, row, "ACT_TRANS_NUM"),
    lockWaits: valueAt(result, row, "LOCK_WAIT_N"),
    diskReadBytes: valueAt(result, row, "DISK_R_BYTES"),
    diskWriteBytes: valueAt(result, row, "DISK_W_BYTES"),
    networkReadBytes: valueAt(result, row, "NET_R_BYTES"),
    networkWriteBytes: valueAt(result, row, "NET_W_BYTES"),
    sharedLocks: valueAt(result, row, "S_LOCK_N"),
    exclusiveLocks: valueAt(result, row, "X_LOCK_N"),
    delayedStores: valueAt(result, row, "DELAY_STO_N"),
    droppedStores: valueAt(result, row, "DROPED_STO_N"),
    freeStores: valueAt(result, row, "FREE_STO_N"),
  }));
}

export function xuguVersionFromResult(result: QueryResult): string {
  return result.rows[0]?.[0] == null ? "" : String(result.rows[0][0]);
}

function valueAt(result: QueryResult, row: unknown[], column: string): string {
  const index = result.columns.findIndex((candidate) => candidate.toUpperCase() === column);
  return index < 0 || row[index] == null ? "" : String(row[index]);
}
