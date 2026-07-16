/** Lists XuguDB tablespaces together with their data files and allocation sizes. */
export function xuguTablespaceInventorySql(): string {
  return `SELECT ts.NODEID,
       ts.SPACE_ID,
       ts.SPACE_NAME,
       ts.SPACE_TYPE,
       ts.DATAFILE_NUM,
       ts.MEDIA_ERROR,
       df.FILE_NO,
       df.PATH,
       df.CURR_SIZE,
       df.MAX_SIZE,
       df.STEP_SIZE
FROM ALL_TABLESPACES ts
LEFT JOIN ALL_DATAFILES df ON df.NODEID = ts.NODEID AND df.SPACE_ID = ts.SPACE_ID
ORDER BY ts.NODEID, ts.SPACE_NAME, df.FILE_NO;`;
}
