import { describe, expect, it } from "vitest";
import {
  getDatabaseUserAdminProvider,
  kingbaseShowGrantsSql,
  xuguGrantPrivilegesSql,
  xuguRevokePrivilegesSql,
} from "@/lib/database/databaseUserAdmin";

describe("database user admin providers", () => {
  it("uses sys_catalog for Kingbase role metadata", () => {
    const provider = getDatabaseUserAdminProvider("kingbase");

    expect(provider).not.toBeNull();
    expect(provider?.dialect).toBe("postgres");
    expect(provider?.listUsersSql()).toContain("FROM sys_catalog.sys_roles r");
    expect(provider?.listUsersSql()).not.toContain("pg_catalog");
  });

  it("builds Kingbase grant SQL without PostgreSQL catalog tables", () => {
    const sql = kingbaseShowGrantsSql({ user: "role'o", host: "LOGIN" });

    expect(sql).toContain("FROM sys_catalog.sys_roles r");
    expect(sql).toContain("FROM sys_catalog.sys_auth_members m");
    expect(sql).toContain("CROSS JOIN sys_catalog.sys_database d");
    expect(sql).toContain("CROSS JOIN sys_catalog.sys_namespace n");
    expect(sql).toContain("WHERE r.rolname = 'role''o'");
    expect(sql).not.toContain("pg_catalog");
    expect(sql).not.toContain("pg_roles");
  });

  it("uses DBA views and Xugu account grammar", () => {
    const provider = getDatabaseUserAdminProvider("xugu");

    expect(provider).not.toBeNull();
    expect(provider?.dialect).toBe("xugu");
    expect(provider?.listUsersSql()).toContain("FROM DBA_USERS");
    expect(provider?.listUsersSql()).toContain("FROM DBA_ROLES");
    expect(provider?.listUsersSql()).toContain("USER_NAME,");
    expect(provider?.listUsersSql()).not.toMatch(/USER_NAME\s+AS\s+user/i);
    expect(provider?.fallbackListUsersSql?.()).toContain("FROM ALL_USERS");
    expect(provider?.showGrantsSql({ user: "app_user", host: "" })).toContain("FROM DBA_ROLE_MEMBERS");
    expect(provider?.showGrantsSql({ user: "app_user", host: "" })).toContain("FROM DBA_ACLS");
    expect(provider?.createUserSql({ user: "app_user", host: "", password: "pa'ss" })).toBe('CREATE USER "app_user" IDENTIFIED BY \'pa\'\'ss\';');
    expect(provider?.createUserSql({ user: "reporter", host: "", password: "", isRole: true })).toBe('CREATE ROLE "reporter";');
    expect(provider?.dropUserSql({ user: "reporter", host: "", isRole: true })).toBe('DROP ROLE "reporter";');
    expect(provider?.alterLoginSql({ user: "app_user", host: "" }, false)).toBe('ALTER USER "app_user" ACCOUNT LOCK;');
  });

  it("builds Xugu database, schema, object, and role grants", () => {
    const user = { user: "app_user", host: "" };

    expect(xuguGrantPrivilegesSql({ user, privileges: ["SELECT ANY TABLE"], database: "", scope: "database" }))
      .toBe('GRANT SELECT ANY TABLE TO "app_user";');
    expect(xuguGrantPrivilegesSql({ user, privileges: ["CREATE ANY TABLE"], database: "OPS", scope: "schema" }))
      .toBe('GRANT CREATE ANY TABLE IN SCHEMA "OPS" TO "app_user";');
    expect(xuguGrantPrivilegesSql({ user, privileges: ["SELECT", "UPDATE"], database: "OPS", table: "ORDERS", scope: "table", grantOption: true }))
      .toBe('GRANT SELECT, UPDATE ON TABLE "OPS"."ORDERS" TO "app_user" WITH GRANT OPTION;');
    expect(xuguGrantPrivilegesSql({ user, privileges: [], database: "", scope: "role", role: "REPORTER" }))
      .toBe('GRANT ROLE "REPORTER" TO "app_user";');
    expect(xuguRevokePrivilegesSql({ user, privileges: ["SELECT"], database: "OPS", table: "ORDERS", scope: "table", grantOption: true }))
      .toBe('REVOKE GRANT OPTION FOR SELECT ON TABLE "OPS"."ORDERS" FROM "app_user";');
  });
});
