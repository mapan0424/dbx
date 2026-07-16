import { splitTopLevelComma, splitTopLevelDeclarations } from "@/lib/database/xuguProgramMembersInternal";

export type XuguProgramMemberKind = "PROCEDURE" | "FUNCTION" | "ATTRIBUTE" | "METHOD";

export interface XuguProgramMember {
  name: string;
  kind: XuguProgramMemberKind;
  declaration: string;
  returnType?: string;
  parameters?: XuguProgramParameter[];
}

export interface XuguProgramParameter {
  name: string;
  declaration: string;
  mode?: "IN" | "OUT" | "IN OUT";
  dataType?: string;
}

/** Extracts public members from a package/type SPEC, never from its BODY. */
export function parseXuguProgramSpecMembers(source: string): XuguProgramMember[] {
  const body = publicDeclarationArea(source);
  if (!body) return [];
  const objectBody = body.trim().replace(/;\s*$/, "").match(/^OBJECT\s*\(([\s\S]*)\)\s*$/i)?.[1];
  if (objectBody != null) return parseObjectTypeMembers(objectBody);
  const members: XuguProgramMember[] = [];
  for (const declaration of splitTopLevelDeclarations(body)) {
    const normalized = declaration.replace(/\s+/g, " ").trim();
    const routine = normalized.match(/^(PROCEDURE|FUNCTION)\s+"?([\w$#]+)"?\b([\s\S]*)$/i);
    if (routine) {
      const kind = routine[1].toUpperCase() as "PROCEDURE" | "FUNCTION";
      const returnType = kind === "FUNCTION" ? routine[3].match(/\bRETURN\s+(.+)$/i)?.[1]?.trim() : undefined;
      const parameters = parseRoutineParameters(routine[3]);
      members.push({ name: routine[2], kind, declaration: normalized, returnType, ...(parameters ? { parameters } : {}) });
      continue;
    }
    const attribute = normalized.match(/^"?([\w$#]+)"?\s+(.+)$/i);
    if (attribute && !/^(CREATE|TYPE|IS|AS|END)\b/i.test(normalized)) {
      members.push({ name: attribute[1], kind: "ATTRIBUTE", declaration: normalized });
    }
  }
  return members;
}

function parseObjectTypeMembers(body: string): XuguProgramMember[] {
  return splitTopLevelComma(body)
    .map((declaration) => declaration.replace(/\s+/g, " ").trim())
    .flatMap<XuguProgramMember>((declaration) => {
      const method = declaration.match(/^(?:MEMBER\s+)?(PROCEDURE|FUNCTION)\s+"?([\w$#]+)"?\b([\s\S]*)$/i);
      if (method) {
        const kind = method[1].toUpperCase() as "PROCEDURE" | "FUNCTION";
        const parameters = parseRoutineParameters(method[3]);
        return [{ name: method[2], kind: "METHOD" as const, declaration, returnType: kind === "FUNCTION" ? method[3].match(/\bRETURN\s+(.+)$/i)?.[1]?.trim() : undefined, ...(parameters ? { parameters } : {}) }];
      }
      const attribute = declaration.match(/^"?([\w$#]+)"?\s+(.+)$/i);
      return attribute ? [{ name: attribute[1], kind: "ATTRIBUTE" as const, declaration }] : [];
    });
}

function parseRoutineParameters(value: string): XuguProgramParameter[] | undefined {
  const parameterText = firstParenthesizedContent(value);
  if (parameterText == null || !parameterText.trim()) return undefined;
  const parameters = splitTopLevelComma(parameterText).flatMap<XuguProgramParameter>((part) => {
    const declaration = part.replace(/\s+/g, " ").trim();
    const match = declaration.match(/^"?([\w$#]+)"?\s+(?:(IN\s+OUT|INOUT|IN|OUT)\s+)?(.+)$/i);
    if (!match) return [];
    const mode = match[2]?.replace(/\s+/g, " ").toUpperCase();
    return [{
      name: match[1],
      declaration,
      mode: mode === "INOUT" ? "IN OUT" : mode as XuguProgramParameter["mode"],
      dataType: match[3].trim(),
    }];
  });
  return parameters.length ? parameters : undefined;
}

function firstParenthesizedContent(value: string): string | null {
  let start = -1;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(" && start < 0) {
      start = index + 1;
      depth = 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")" && start >= 0 && --depth === 0) return value.slice(start, index);
  }
  return null;
}

function publicDeclarationArea(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const start = withoutComments.search(/\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:PACKAGE|TYPE))\b/i);
  if (start < 0) return "";
  const isIndex = withoutComments.slice(start).search(/\bIS\b/i);
  if (isIndex < 0) return "";
  const afterIs = start + isIndex + 2;
  const end = withoutComments.slice(afterIs).search(/\bEND\b/i);
  return withoutComments.slice(afterIs, end < 0 ? undefined : afterIs + end);
}
