export type XuguDependencyObjectType = "table" | "view" | "procedure" | "function" | "trigger" | "package";

const OBJECT_TYPE_CODES: Record<XuguDependencyObjectType, number> = {
  table: 5,
  procedure: 7,
  function: 7,
  view: 9,
  trigger: 11,
  package: 18,
};

/**
 * Reads XuguDB's dependency dictionary in both directions. This deliberately
 * uses ALL_* views, rather than the old plugin's SYS_* table-name prefix, so
 * it works with the current server dictionary layout.
 */
export function xuguObjectDependenciesSql(options: { schema: string; objectName: string; objectType: XuguDependencyObjectType }): string {
  const schema = quoteXuguString(options.schema);
  const objectName = quoteXuguString(options.objectName);
  const objectType = OBJECT_TYPE_CODES[options.objectType];
  return `WITH target AS (
  SELECT o.DB_ID, o.USER_ID, o.SCHEMA_ID, o.OBJ_ID
  FROM ALL_OBJECTS o
  JOIN ALL_SCHEMAS s ON s.DB_ID = o.DB_ID AND s.SCHEMA_ID = o.SCHEMA_ID
  WHERE UPPER(s.SCHEMA_NAME) = UPPER(${schema})
    AND UPPER(o.OBJ_NAME) = UPPER(${objectName})
    AND o.OBJ_TYPE = ${objectType}
), dependency_rows AS (
  SELECT 'DEPENDS_ON' AS DIRECTION, d.OWNER_ID2 AS OWNER_ID, d.OBJ_ID2 AS OBJ_ID, d.DB_ID
  FROM target t
  JOIN ALL_DEPENDS d ON d.DB_ID = t.DB_ID AND d.OWNER_ID1 = t.USER_ID AND d.OBJ_ID1 = t.OBJ_ID
  UNION ALL
  SELECT 'REFERENCED_BY' AS DIRECTION, d.OWNER_ID1 AS OWNER_ID, d.OBJ_ID1 AS OBJ_ID, d.DB_ID
  FROM target t
  JOIN ALL_DEPENDS d ON d.DB_ID = t.DB_ID AND d.OWNER_ID2 = t.USER_ID AND d.OBJ_ID2 = t.OBJ_ID
)
SELECT r.DIRECTION,
       s.SCHEMA_NAME,
       o.OBJ_NAME AS OBJECT_NAME,
       CASE o.OBJ_TYPE
         WHEN 5 THEN 'TABLE'
         WHEN 7 THEN 'PROCEDURE_OR_FUNCTION'
         WHEN 9 THEN 'VIEW'
         WHEN 11 THEN 'TRIGGER'
         WHEN 18 THEN 'PACKAGE'
         ELSE 'OBJECT_' || o.OBJ_TYPE
       END AS OBJECT_TYPE
FROM dependency_rows r
JOIN ALL_OBJECTS o ON o.DB_ID = r.DB_ID AND o.USER_ID = r.OWNER_ID AND o.OBJ_ID = r.OBJ_ID
JOIN ALL_SCHEMAS s ON s.DB_ID = o.DB_ID AND s.SCHEMA_ID = o.SCHEMA_ID
ORDER BY r.DIRECTION, s.SCHEMA_NAME, o.OBJ_NAME;`;
}

function quoteXuguString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
