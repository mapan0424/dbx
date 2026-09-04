import type { NamingStyle } from "./namingStyleDetector";

/**
 * A single identifier: letters, digits, and identifier separator characters.
 * Selections that do not match (spaces, operators, comments, CJK/Cyrillic
 * text, multi-line content) are left untouched instead of being rewritten.
 */
export const SINGLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_$-]+$/;

const LEADING_SEPARATOR_PATTERN = /^[_$-]+/;
const TRAILING_SEPARATOR_PATTERN = /[_$-]+$/;
const SEPARATOR_RUN_PATTERN = /[_$-]+/;

function isAsciiLowercase(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isAsciiUppercase(code: number): boolean {
  return code >= 65 && code <= 90;
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/**
 * Split word boundaries without lookbehind so the desktop bundle remains
 * compatible with older WebKit/JavaScriptCore runtimes.
 *
 * Boundaries are lower→Upper (userName), UPPER→Upper+lower (HTTPServer), and
 * digit→letter (user2Name / sha256Hash). Letter→digit is deliberately NOT a
 * boundary so digit runs stay attached to the preceding word.
 */
function splitIdentifierSegment(segment: string): string[] {
  if (segment.length < 2) return [segment];

  const words: string[] = [];
  let wordStart = 0;

  for (let index = 1; index < segment.length; index += 1) {
    const previous = segment.charCodeAt(index - 1);
    const current = segment.charCodeAt(index);
    const next = segment.charCodeAt(index + 1);
    const lowerToUpper = isAsciiLowercase(previous) && isAsciiUppercase(current);
    const acronymBoundary = isAsciiUppercase(previous) && isAsciiUppercase(current) && isAsciiLowercase(next);
    const digitToLetter = isAsciiDigit(previous) && (isAsciiLowercase(current) || isAsciiUppercase(current));

    if (lowerToUpper || acronymBoundary || digitToLetter) {
      words.push(segment.slice(wordStart, index));
      wordStart = index;
    }
  }

  words.push(segment.slice(wordStart));
  return words;
}

interface IdentifierParts {
  leading: string;
  words: string[];
  trailing: string;
}

function splitIntoWords(core: string): IdentifierParts {
  const leadingMatch = LEADING_SEPARATOR_PATTERN.exec(core);
  const leading = leadingMatch ? leadingMatch[0] : "";
  const trailingMatch = TRAILING_SEPARATOR_PATTERN.exec(core);
  const trailing = trailingMatch ? trailingMatch[0] : "";
  const inner = core.slice(leading.length, core.length - trailing.length);
  const words = inner
    .split(SEPARATOR_RUN_PATTERN)
    .flatMap(splitIdentifierSegment)
    .filter((word) => word.length > 0);
  return { leading, words, trailing };
}

/**
 * Capitalize a word for camelCase/PascalCase output. Only all-uppercase words
 * (SCREAMING_SNAKE chunks and acronyms) fold their tail to lowercase;
 * mixed-case words keep their body so `user2Name` survives as `User2Name`
 * instead of degrading to `User2name`.
 */
function capitalizeWord(word: string): string {
  if (word.length <= 1) return word.toUpperCase();
  const isAllUppercase = word === word.toUpperCase();
  return word.charAt(0).toUpperCase() + (isAllUppercase ? word.slice(1).toLowerCase() : word.slice(1));
}

/**
 * Convert text to specified naming style.
 *
 * Leading/trailing whitespace and separator runs (`_`, `$`, `-`) are preserved
 * verbatim; only the identifier core is rewritten. Text that is not a single
 * identifier (after trimming whitespace) is returned unchanged.
 */
export function convertToNamingStyle(text: string, targetStyle: NamingStyle): string {
  if (!text) return text;

  const core = text.trim();
  if (!core || !SINGLE_IDENTIFIER_PATTERN.test(core)) return text;

  const whitespaceStart = text.length - text.trimStart().length;
  const leadingWhitespace = text.slice(0, whitespaceStart);
  const trailingWhitespace = text.slice(whitespaceStart + core.length);

  const { leading, words, trailing } = splitIntoWords(core);
  if (words.length === 0) return text;

  let converted: string;
  switch (targetStyle) {
    case "camelCase":
      converted = words.map((word, index) => (index === 0 ? word.toLowerCase() : capitalizeWord(word))).join("");
      break;

    case "PascalCase":
      converted = words.map(capitalizeWord).join("");
      break;

    case "snake_case":
      converted = words.map((word) => word.toLowerCase()).join("_");
      break;

    case "SCREAMING_SNAKE_CASE":
      converted = words.map((word) => word.toUpperCase()).join("_");
      break;

    case "kebab-case":
      converted = words.map((word) => word.toLowerCase()).join("-");
      break;

    default:
      return text;
  }

  return leadingWhitespace + leading + converted + trailing + trailingWhitespace;
}
