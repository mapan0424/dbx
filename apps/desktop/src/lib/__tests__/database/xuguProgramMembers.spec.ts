import { describe, expect, it } from "vitest";
import { parseXuguProgramSpecMembers } from "@/lib/database/xuguProgramMembers";

describe("xuguProgramMembers", () => {
  it("reads public package procedures and functions, including parameter commas", () => {
    expect(parseXuguProgramSpecMembers(`CREATE OR REPLACE PACKAGE app.orders_api IS
      PROCEDURE sync_order(p_id INTEGER, p_note VARCHAR(100));
      FUNCTION total(p_start DATE, p_end DATE) RETURN NUMERIC;
    END orders_api;`)).toEqual([
      { name: "sync_order", kind: "PROCEDURE", declaration: "PROCEDURE sync_order(p_id INTEGER, p_note VARCHAR(100))", parameters: [{ name: "p_id", declaration: "p_id INTEGER", dataType: "INTEGER" }, { name: "p_note", declaration: "p_note VARCHAR(100)", dataType: "VARCHAR(100)" }] },
      { name: "total", kind: "FUNCTION", declaration: "FUNCTION total(p_start DATE, p_end DATE) RETURN NUMERIC", returnType: "NUMERIC", parameters: [{ name: "p_start", declaration: "p_start DATE", dataType: "DATE" }, { name: "p_end", declaration: "p_end DATE", dataType: "DATE" }] },
    ]);
  });

  it("reads object-type attributes but ignores type headers and body-only routines", () => {
    expect(parseXuguProgramSpecMembers(`CREATE TYPE app.address_t IS OBJECT (
      city VARCHAR(80),
      zip_code INTEGER,
      MEMBER FUNCTION label RETURN VARCHAR
    ); END;`)).toEqual([
      { name: "city", kind: "ATTRIBUTE", declaration: "city VARCHAR(80)" },
      { name: "zip_code", kind: "ATTRIBUTE", declaration: "zip_code INTEGER" },
      { name: "label", kind: "METHOD", declaration: "MEMBER FUNCTION label RETURN VARCHAR", returnType: "VARCHAR" },
    ]);
  });
});
