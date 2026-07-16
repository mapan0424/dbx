/** Splits semicolon-terminated declarations without breaking parameter lists. */
export function splitTopLevelDeclarations(value: string): string[] {
  return splitAtTopLevel(value, ";");
}

export function splitTopLevelComma(value: string): string[] {
  return splitAtTopLevel(value, ",");
}

function splitAtTopLevel(value: string, separator: string): string[] {
  const declarations: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth = Math.max(0, depth - 1);
    if (!quoted && char === separator && depth === 0) {
      if (current.trim()) declarations.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) declarations.push(current.trim());
  return declarations;
}
