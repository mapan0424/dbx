import { describe, expect, it } from "vitest";
import { parseXuguSchedulerJobs, xuguCreateSchedulerJobSql, xuguDisableSchedulerJobSql, xuguDropSchedulerJobSql, xuguRunSchedulerJobSql, xuguSchedulerJobListSql, xuguSchedulerNextRunSql } from "@/lib/database/xuguScheduler";

describe("xuguScheduler", () => {
  it("builds database-scoped scheduler job metadata SQL", () => {
    const sql = xuguSchedulerJobListSql("SYSTEM");
    expect(sql).toContain("FROM ALL_JOBS j");
    expect(sql).toContain("LEFT JOIN ALL_USERS u");
    expect(sql).toContain("ALL_DATABASES");
    expect(sql).toContain("UPPER('SYSTEM')");
  });

  it("uses the database LAST_RUN_T value when calculating the next execution", () => {
    const sql = xuguSchedulerNextRunSql("SYSTEM", "SYNC");
    expect(sql).toContain("JOB_NEXT_RUNTIME(j.JOB_NAME, j.LAST_RUN_T)");
    expect(sql).toContain("UPPER('SYNC')");
  });

  it("builds documented DBMS_SCHEDULER calls", () => {
    expect(xuguDisableSchedulerJobSql("JOB_A")).toBe("BEGIN\n  DBMS_SCHEDULER.DISABLE('JOB_A', FALSE);\nEND;");
    expect(xuguRunSchedulerJobSql("JOB_A")).toBe("BEGIN\n  DBMS_SCHEDULER.RUN_JOB('JOB_A', TRUE);\nEND;");
    expect(xuguDropSchedulerJobSql("JOB_A")).toBe("BEGIN\n  DBMS_SCHEDULER.DROP_JOB('JOB_A', FALSE);\nEND;");
  });

  it("builds a positional create-job block compatible with XuguDB", () => {
    const sql = xuguCreateSchedulerJobSql({
      name: "JOB_A",
      type: "stored_procedure",
      action: "SYNC_ORDERS",
      argumentCount: 1,
      startDate: "SYSDATE",
      repeatInterval: "FREQ=DAILY;INTERVAL=1;",
      enabled: false,
      autoDrop: false,
      comments: "nightly job",
    });
    expect(sql).toContain("DBMS_SCHEDULER.CREATE_JOB(");
    expect(sql).toContain("'JOB_A',");
    expect(sql).toContain("'stored_procedure',");
    expect(sql).toContain("SYSDATE,");
    expect(sql).toContain("FALSE,");
    expect(sql).toContain("'nightly job'");
  });

  it("sets supplied scheduler argument expressions after creating a job", () => {
    const sql = xuguCreateSchedulerJobSql({
      name: "SYNC",
      type: "stored_procedure",
      action: "APP.SYNC_ORDERS",
      argumentCount: 2,
      argumentValues: ["42", "'nightly'"],
    });

    expect(sql).toContain("DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('SYNC', 1, 42);");
    expect(sql).toContain("DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('SYNC', 2, 'nightly');");
  });

  it("maps XuguDB scheduler rows", () => {
    const [job] = parseXuguSchedulerJobs({
      columns: ["JOB_ID", "OWNER", "JOB_NAME", "JOB_TYPE", "JOB_ACTION", "JOB_PARAM_NUM", "ENABLE", "AUTO_DROP", "STATE"],
      rows: [["42", "SYSDBA", "SYNC", "stored_procedure", "SYNC_ORDERS", "2", "T", "F", "IDLE"]],
    } as any);
    expect(job).toMatchObject({ id: "42", owner: "SYSDBA", name: "SYNC", argumentCount: 2, enabled: true, autoDrop: false, state: "IDLE" });
  });
});
