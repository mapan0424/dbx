import type { QueryResult } from "@/types/database";
import { quoteXuguString } from "@/lib/database/xuguScheduler";

export interface XuguPartition {
  number: string;
  name: string;
  value: string;
  online: string;
}

export interface XuguSubpartition {
  number: string;
  name: string;
  value: string;
}

export interface XuguTablePartitions {
  partitions: XuguPartition[];
  subpartitions: XuguSubpartition[];
}

export type XuguPartitionAction = "ONLINE" | "OFFLINE" | "DROP";

/** Builds the partition DDL supported by the Xugu object manager. */
export function xuguPartitionActionSql(options: { schema: string; table: string; partition: string; action: XuguPartitionAction; subpartition?: boolean }): string {
  const table = quoteXuguIdentifier(options.schema, options.table);
  const partition = quoteXuguIdentifier(options.partition);
  const kind = options.subpartition ? "SUBPARTITION" : "PARTITION";
  if (options.action === "DROP") return `ALTER TABLE ${table} DROP ${kind} ${partition};`;
  return `ALTER TABLE ${table} SET ${kind} ${partition} ${options.action};`;
}

/** ALL_SUBPARTIS has no parent partition number, so subpartitions stay table-level. */
export function xuguTablePartitionsSql(schema: string, table: string): string {
  const where = `UPPER(s.SCHEMA_NAME) = UPPER(${quoteXuguString(schema)})\n  AND UPPER(t.TABLE_NAME) = UPPER(${quoteXuguString(table)})`;
  return `SELECT 'PARTITION' AS KIND, p.PARTI_NO AS OBJECT_NO, p.PARTI_NAME AS OBJECT_NAME,
       p.PARTI_VAL AS OBJECT_VALUE, p.ONLINE AS ONLINE
FROM ALL_PARTIS p
JOIN ALL_TABLES t ON t.DB_ID = p.DB_ID AND t.TABLE_ID = p.TABLE_ID
JOIN ALL_SCHEMAS s ON s.DB_ID = t.DB_ID AND s.SCHEMA_ID = t.SCHEMA_ID
WHERE ${where}
UNION ALL
SELECT 'SUBPARTITION' AS KIND, sp.SUBPARTI_NO AS OBJECT_NO, sp.SUBPARTI_NAME AS OBJECT_NAME,
       sp.SUBPARTI_VAL AS OBJECT_VALUE, NULL AS ONLINE
FROM ALL_SUBPARTIS sp
JOIN ALL_TABLES t ON t.DB_ID = sp.DB_ID AND t.TABLE_ID = sp.TABLE_ID
JOIN ALL_SCHEMAS s ON s.DB_ID = t.DB_ID AND s.SCHEMA_ID = t.SCHEMA_ID
WHERE ${where}
ORDER BY KIND, OBJECT_NO;`;
}

export function parseXuguTablePartitions(result: QueryResult): XuguTablePartitions {
  const partitions: XuguPartition[] = [];
  const subpartitions: XuguSubpartition[] = [];
  for (const row of result.rows) {
    const kind = valueAt(result, row, "KIND").toUpperCase();
    const common = { number: valueAt(result, row, "OBJECT_NO"), name: valueAt(result, row, "OBJECT_NAME"), value: valueAt(result, row, "OBJECT_VALUE") };
    if (kind === "PARTITION") partitions.push({ ...common, online: valueAt(result, row, "ONLINE") });
    if (kind === "SUBPARTITION") subpartitions.push(common);
  }
  return { partitions, subpartitions };
}

function valueAt(result: QueryResult, row: QueryResult["rows"][number], column: string): string {
  const index = result.columns.findIndex((candidate) => candidate.toUpperCase() === column);
  return index < 0 || row[index] == null ? "" : String(row[index]);
}

function quoteXuguIdentifier(...parts: string[]): string {
  return parts.map((part) => `"${part.replace(/"/g, '""')}"`).join(".");
}
