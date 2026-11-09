import { existsSync, readFileSync } from "node:fs";
import { coreFile } from "@videosaas/plate-engine";
import { storyWorldFor } from "@videosaas/contracts";
import { LETTER_HELPERS } from "./letter-helpers.ts";

export { LETTER_HELPERS };

export type StyleTier = "light" | "medium" | "heavy";

export const TIER_LINES: Record<StyleTier, number> = {
  light: 220,
  medium: 260,
  heavy: 320
};

export const approxTokens = (maxLines: number): string =>
  (Math.round((maxLines * 28) / 100) * 100).toLocaleString("en-US");

export const DEFAULT_MAX_LINES = 220;
export const SOURCE_BUDGET_CHARS = 60_000;
export const KIT_BUDGET_CHARS = 150_000;
export const SCENE_EXCERPT_BUDGET_CHARS = 14_000;
export const EXCERPT_PLAN_VERSION = "excerpt-v1:60000:14000";
export const CUT_POLICY_VERSION = "kit-v2:150000:plate-v1:60000:14000";
export const MIN_KIT_HELPERS = 3;
export const POLICY_REPAIR_MAX = 1;
export const KIT_REPAIR_MAX = POLICY_REPAIR_MAX;

export type StyleGuide = {
  tier: StyleTier;
  lines: number;
  example: string;
  body: string;
  raw: string;
};

/** Parses a style guide markdown file with YAML-style front matter (`tier`, `lines`, `example`). */
export function parseGuide(raw: string): StyleGuide {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error("Guide is missing front matter block (--- ... ---).");
  const fm = m[1]!;
  const body = m[2]!.trim();
  const fields: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx < 0) throw new Error(`Invalid front matter line: "${line}"`);
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    fields[key] = val;
  }
  const tier = fields.tier as StyleTier;
  if (tier !== "light" && tier !== "medium" && tier !== "heavy") {
    throw new Error(`Invalid or missing guide tier "${fields.tier ?? ""}" (expected light|medium|heavy).`);
  }
  const lines = fields.lines ? Number(fields.lines) : TIER_LINES[tier];
  if (!Number.isInteger(lines) || lines < 100 || lines > 1200) {
    throw new Error(`Invalid guide lines "${fields.lines ?? ""}".`);
  }
  const example = fields.example ?? "plate-excerpt";
  if (!example) throw new Error("Guide front matter must specify `example`.");
  return { tier, lines, example, body, raw };
}

/** Extracts all exported symbol names from a TypeScript module source. */
export function exportedNamesOf(source: string): string[] {
  const names = new Set<string>();
  const stmts = splitTopLevelStatements(source);
  for (const st of stmts) {
    const code = stripLeadingComments(st.text).trimStart();
    if (!code.startsWith("export ")) continue;
    const rest = code.slice("export ".length).trimStart();
    const fnMatch = /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(rest);
    if (fnMatch) {
      names.add(fnMatch[1]!);
      continue;
    }
    const typeMatch = /^(?:type|interface|class|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(rest);
    if (typeMatch) {
      names.add(typeMatch[1]!);
      continue;
    }
    const varMatch = /^(?:const|let|var)\s+([\s\S]*)$/.exec(rest);
    if (varMatch) {
      for (const n of extractVarDeclaratorNames(varMatch[1]!)) names.add(n);
      continue;
    }
    const listMatch = /^\{([^}]*)\}/.exec(rest);
    if (listMatch) {
      for (const part of listMatch[1]!.split(",")) {
        const cleaned = part.trim().replace(/^type\s+/, "");
        if (!cleaned) continue;
        const asParts = cleaned.split(/\s+as\s+/);
        const exported = (asParts[1] ?? asParts[0])!.trim();
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exported)) names.add(exported);
      }
    }
  }
  return [...names];
}

/** Extracts top-level declarator names from `a = 1, b: T = 2` (ignoring commas inside `{...}`, `[...]`, `(...)`, `<...>`). */
function extractVarDeclaratorNames(declList: string): string[] {
  const names: string[] = [];
  let paren = 0, bracket = 0, brace = 0, angle = 0;
  let inEq = false;
  let segStart = 0;
  const pushSeg = (seg: string) => {
    const m = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(seg);
    if (m) names.push(m[1]!);
  };
  for (let i = 0; i < declList.length; i++) {
    const ch = declList[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(declList, i);
      continue;
    }
    if (ch === "/" && declList[i + 1] === "/") {
      i = skipLineComment(declList, i);
      continue;
    }
    if (ch === "/" && declList[i + 1] === "*") {
      i = skipBlockComment(declList, i);
      continue;
    }
    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (!inEq && ch === "<") angle++;
    else if (!inEq && ch === ">" && angle > 0) angle--;
    else if (paren === 0 && bracket === 0 && brace === 0 && angle === 0) {
      if (ch === "=" && declList[i + 1] !== ">") {
        inEq = true;
      } else if (ch === ",") {
        pushSeg(declList.slice(segStart, i));
        segStart = i + 1;
        inEq = false;
      } else if (ch === ";") {
        pushSeg(declList.slice(segStart, i));
        return names;
      }
    }
  }
  pushSeg(declList.slice(segStart));
  return names;
}

/**
 * Extracts helper/symbol names quoted in backticks in the "Kit helpers" section (and inline helper references) of a guide.
 */
export function guideHelperRefs(guideBody: string): string[] {
  const refs = new Set<string>();
  const skip = new Set([
    "ctx", "frame", "env", "g", "c", "p", "d", "t", "x", "y", "rad", "col", "skip",
    "paper", "coldpress", "washGran", "pencilTooth", "risoSpeck", "risoMottle", "draftTooth", "blueMottle",
    "ce_vine", "ce_comp", "ce_blend", "ce_streak", "ce_sheet",
    "folkTaleKit", "sumiEKit", "paintedOilKit", "colouredPencilKit", "colouredPencilCrow",
    "blueprintKit", "brokenColourKit", "charcoalErasureKit", "embroideryKit", "isometricKit",
    "scrapbookKit", "scrapbookEngraving", "scratchboardKit", "drafting", "riso",
    "core", "film", "gallery", "rgba"
  ]);
  for (const m of guideBody.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)(?:\([^`]*\))?`/g)) {
    const name = m[1]!;
    if (!skip.has(name)) refs.add(name);
  }
  return [...refs];
}

function skipString(s: string, start: number): number {
  const quote = s[start]!;
  let i = start + 1;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && ch === "$" && s[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < s.length && depth > 0) {
        const c = s[i]!;
        if (c === "'" || c === '"' || c === "`") {
          i = skipString(s, i) + 1;
          continue;
        }
        if (c === "/" && s[i + 1] === "/") {
          i = skipLineComment(s, i) + 1;
          continue;
        }
        if (c === "/" && s[i + 1] === "*") {
          i = skipBlockComment(s, i) + 1;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      continue;
    }
    if (ch === quote) return i;
    i++;
  }
  return s.length - 1;
}

function skipLineComment(s: string, start: number): number {
  const nl = s.indexOf("\n", start + 2);
  return nl < 0 ? s.length - 1 : nl;
}

function skipBlockComment(s: string, start: number): number {
  const end = s.indexOf("*/", start + 2);
  return end < 0 ? s.length - 1 : end + 1;
}

type RawStatement = {
  text: string;
  leadingComment: string;
  code: string;
};

/** Splits a TypeScript file into top-level statements, attaching leading comments to each statement. */
function splitTopLevelStatements(source: string): RawStatement[] {
  const out: RawStatement[] = [];
  let paren = 0, bracket = 0, brace = 0;
  let stmtStart = 0;
  const n = source.length;

  const flush = (endIdx: number) => {
    const raw = source.slice(stmtStart, endIdx).trim();
    stmtStart = endIdx;
    if (!raw) return;
    const { leadingComment, code } = separateLeadingComments(raw);
    out.push({ text: raw, leadingComment, code });
  };

  for (let i = 0; i < n; i++) {
    const ch = source[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") {
      brace = Math.max(0, brace - 1);
      if (paren === 0 && bracket === 0 && brace === 0) {
        let j = i + 1;
        while (j < n && (source[j] === " " || source[j] === "\t")) j++;
        if (source[j] === ";") {
          // Consume trailing inline comment on the same line if any
          let k = j + 1;
          while (k < n && (source[k] === " " || source[k] === "\t")) k++;
          if (source[k] === "/" && source[k + 1] === "/") {
            k = skipLineComment(source, k) + 1;
          } else {
            k = j + 1;
          }
          flush(k);
          i = k - 1;
        } else if (source[j] === "\n" || source[j] === "\r" || j === n) {
          // Check if this `}` closed a function/class/interface/type declaration at top level
          const codeBefore = stripLeadingComments(source.slice(stmtStart, i + 1)).trimStart();
          if (/^(?:export\s+)?(?:async\s+)?(?:function|class|interface|enum|type)\b/.test(codeBefore)) {
            flush(i + 1);
          }
        }
      }
    } else if (ch === ";" && paren === 0 && bracket === 0 && brace === 0) {
      let k = i + 1;
      while (k < n && (source[k] === " " || source[k] === "\t")) k++;
      if (source[k] === "/" && source[k + 1] === "/") {
        k = skipLineComment(source, k) + 1;
      } else {
        k = i + 1;
      }
      flush(k);
      i = k - 1;
    }
  }
  if (stmtStart < n) flush(n);
  return out;
}

function separateLeadingComments(raw: string): { leadingComment: string; code: string } {
  let i = 0;
  const n = raw.length;
  while (i < n) {
    while (i < n && /\s/.test(raw[i]!)) i++;
    if (raw[i] === "/" && raw[i + 1] === "/") {
      i = skipLineComment(raw, i) + 1;
    } else if (raw[i] === "/" && raw[i + 1] === "*") {
      i = skipBlockComment(raw, i) + 1;
    } else {
      break;
    }
  }
  return {
    leadingComment: raw.slice(0, i).trim(),
    code: raw.slice(i).trim()
  };
}

function stripLeadingComments(raw: string): string {
  return separateLeadingComments(raw).code;
}

/**
 * Elides a class body so only field declarations and method/constructor signatures with `{ /* ... *\/ }` remain.
 */
function elideClassDeclaration(code: string): string {
  const openBrace = findFirstTopLevelChar(code, "{");
  if (openBrace < 0) return code;
  const header = code.slice(0, openBrace).trimEnd();
  const body = code.slice(openBrace + 1, code.lastIndexOf("}"));
  const members: string[] = [];
  let i = 0;
  const n = body.length;
  let segStart = 0;
  let paren = 0, bracket = 0, brace = 0;

  for (; i < n; i++) {
    const ch = body[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(body, i);
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      i = skipLineComment(body, i);
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      i = skipBlockComment(body, i);
      continue;
    }
    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") {
      if (paren === 0 && bracket === 0 && brace === 0) {
        const beforeBrace = body.slice(segStart, i);
        const { leadingComment, code: memberSig } = separateLeadingComments(beforeBrace);
        const sigTrimmed = memberSig.trim();
        // Check if this is a method/constructor signature (ends with `)` or return type after `)`)
        if (sigTrimmed.includes("(")) {
          // Skip to matching `}`
          let depth = 1;
          let j = i + 1;
          while (j < n && depth > 0) {
            const c = body[j]!;
            if (c === "'" || c === '"' || c === "`") { j = skipString(body, j) + 1; continue; }
            if (c === "/" && body[j + 1] === "/") { j = skipLineComment(body, j) + 1; continue; }
            if (c === "/" && body[j + 1] === "*") { j = skipBlockComment(body, j) + 1; continue; }
            if (c === "{") depth++;
            else if (c === "}") depth--;
            j++;
          }
          const prefix = leadingComment ? `  ${leadingComment}\n  ` : "  ";
          members.push(`${prefix}${sigTrimmed} { /* ... */ }`);
          segStart = j;
          i = j - 1;
          continue;
        }
      }
      brace++;
    } else if (ch === "}") {
      brace = Math.max(0, brace - 1);
    } else if (ch === ";" && paren === 0 && bracket === 0 && brace === 0) {
      const prop = body.slice(segStart, i + 1).trim();
      if (prop) members.push(`  ${prop}`);
      segStart = i + 1;
    }
  }
  return `${header} {\n${members.join("\n")}\n}`;
}

function findFirstTopLevelChar(s: string, target: string): number {
  let paren = 0, bracket = 0, brace = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(s, i); continue; }
    if (ch === "/" && s[i + 1] === "/") { i = skipLineComment(s, i); continue; }
    if (ch === "/" && s[i + 1] === "*") { i = skipBlockComment(s, i); continue; }
    if (paren === 0 && bracket === 0 && brace === 0 && ch === target) return i;
    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
  }
  return -1;
}

/** Finds top-level `=>` arrows (outside `{...}`, `[...]`, `(...)`). */
function findTopLevelArrows(s: string): number[] {
  const arrows: number[] = [];
  let paren = 0, bracket = 0, brace = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i]!;
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(s, i); continue; }
    if (ch === "/" && s[i + 1] === "/") { i = skipLineComment(s, i); continue; }
    if (ch === "/" && s[i + 1] === "*") { i = skipBlockComment(s, i); continue; }
    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (paren === 0 && bracket === 0 && brace === 0 && ch === "=" && s[i + 1] === ">") {
      arrows.push(i);
      i++;
    }
  }
  return arrows;
}

/**
 * Produces an API extract of a kit module: imports, top comments, and every `export` declaration's
 * signature and leading doc comment, with function/method bodies elided as `{ /* ... *\/ }`.
 */
export function kitApi(source: string): string {
  const stmts = splitTopLevelStatements(source);
  const out: string[] = [];

  for (let idx = 0; idx < stmts.length; idx++) {
    const st = stmts[idx]!;
    const { leadingComment, code } = st;
    if (!code) {
      if (idx === 0 && leadingComment) out.push(leadingComment);
      continue;
    }
    if (code.startsWith("import ")) {
      out.push(leadingComment ? `${leadingComment}\n${code}` : code);
      continue;
    }
    if (!code.startsWith("export ")) continue;

    // Keep only the immediately relevant doc/section comment above this export (last contiguous comment block)
    const docComment = extractTrailingDocComment(leadingComment, idx === 0);
    const withDoc = (sig: string) => (docComment ? `${docComment}\n${sig}` : sig);

    const rest = code.slice("export ".length).trimStart();
    if (/^(?:type|interface)\b/.test(rest)) {
      out.push(withDoc(code));
      continue;
    }
    if (/^class\b/.test(rest)) {
      out.push(withDoc(elideClassDeclaration(code)));
      continue;
    }
    if (/^(?:async\s+)?function\b/.test(rest)) {
      const braceIdx = findFirstTopLevelChar(code, "{");
      if (braceIdx >= 0) {
        out.push(withDoc(`${code.slice(0, braceIdx).trimEnd()} { /* ... */ }`));
      } else {
        out.push(withDoc(code));
      }
      continue;
    }
    if (/^(?:const|let|var)\b/.test(rest)) {
      const arrows = findTopLevelArrows(code);
      if (arrows.length > 0) {
        const lastArrow = arrows[arrows.length - 1]!;
        const prefix = code.slice(0, lastArrow + 2).trimEnd();
        out.push(withDoc(`${prefix} { /* ... */ };`));
        continue;
      }
      // Constant declaration(s)
      if (code.length <= 200 && !code.includes("\n")) {
        out.push(withDoc(code));
      } else {
        const eqIdx = findFirstTopLevelEquals(code);
        if (eqIdx >= 0) {
          const lhs = code.slice(0, eqIdx + 1).trimEnd();
          const rhs = code.slice(eqIdx + 1).trim();
          if (rhs.startsWith("[")) {
            out.push(withDoc(`${lhs} [ /* ... */ ];`));
          } else {
            out.push(withDoc(`${lhs} { /* ... */ };`));
          }
        } else {
          out.push(withDoc(code));
        }
      }
      continue;
    }
    out.push(withDoc(code));
  }
  return out.join("\n");
}

function findFirstTopLevelEquals(s: string): number {
  let paren = 0, bracket = 0, brace = 0, angle = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(s, i); continue; }
    if (ch === "/" && s[i + 1] === "/") { i = skipLineComment(s, i); continue; }
    if (ch === "/" && s[i + 1] === "*") { i = skipBlockComment(s, i); continue; }
    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (ch === "<") angle++;
    else if (ch === ">" && angle > 0) angle--;
    else if (paren === 0 && bracket === 0 && brace === 0 && angle === 0 && ch === "=" && s[i + 1] !== ">" && s[i + 1] !== "=") {
      return i;
    }
  }
  return -1;
}

function extractTrailingDocComment(comment: string, keepAllIfFirst = false): string {
  if (!comment) return "";
  if (keepAllIfFirst) return comment;
  const paragraphs = comment.split(/\r?\n\s*\r?\n/);
  return paragraphs[paragraphs.length - 1]!.trim();
}

/** Sends the whole kit when <= budgetChars (default 60_000), otherwise its `kitApi` extract. */
export function kitForPrompt(source: string, budgetChars = SOURCE_BUDGET_CHARS): string {
  return source.length <= budgetChars ? source : kitApi(source);
}

type PlateStmt = {
  index: number;
  kind: "import" | "film" | "draw" | "helper" | "const" | "other";
  names: string[];
  headerComment: string;
  fullText: string;
  elidedText: string;
  omittedComment: string;
  refs: Set<string>;
};

function extractIdentifierRefs(code: string): Set<string> {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, " ");
  const refs = new Set<string>();
  for (const m of stripped.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    refs.add(m[1]!);
  }
  return refs;
}

function elideHelperStatement(code: string, names: string[], docComment: string): { elidedText: string; omittedComment: string } {
  const primaryName = names[0] ?? "anonymous";
  const prefixDoc = docComment ? `${docComment}\n` : "";
  const fnMatch = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([\s\S]*?)\)/.exec(code);
  if (fnMatch) {
    const braceIdx = findFirstTopLevelChar(code, "{");
    const args = fnMatch[2]!.replace(/\s+/g, " ").trim();
    const marker = `/* helper body omitted: ${fnMatch[1]}(${args}) */`;
    if (braceIdx >= 0) {
      return {
        elidedText: `${prefixDoc}${code.slice(0, braceIdx).trimEnd()} { ${marker} }`,
        omittedComment: marker
      };
    }
  }
  const arrows = findTopLevelArrows(code);
  if (arrows.length > 0) {
    const firstArrow = arrows[0]!;
    const beforeArrow = code.slice(0, firstArrow).trimEnd();
    const parenStart = beforeArrow.lastIndexOf("(");
    const parenEnd = beforeArrow.lastIndexOf(")");
    const args = parenStart >= 0 && parenEnd > parenStart ? beforeArrow.slice(parenStart + 1, parenEnd).replace(/\s+/g, " ").trim() : "";
    const marker = `/* helper body omitted: ${primaryName}(${args}) */`;
    return {
      elidedText: `${prefixDoc}${code.slice(0, firstArrow + 2).trimEnd()} { ${marker} };`,
      omittedComment: marker
    };
  }
  // Check for IIFE `const X = (() => { ... })();`
  if (/\(\s*\(\s*\)\s*=>/.test(code)) {
    const eqIdx = findFirstTopLevelEquals(code);
    const marker = `/* helper body omitted: ${primaryName}() */`;
    if (eqIdx >= 0) {
      return {
        elidedText: `${prefixDoc}${code.slice(0, eqIdx + 1).trimEnd()} (() => { ${marker} })();`,
        omittedComment: marker
      };
    }
  }
  // Multi-line constant or object/array literal
  const eqIdx = findFirstTopLevelEquals(code);
  const marker = `/* helper body omitted: ${primaryName}() */`;
  if (eqIdx >= 0) {
    const lhs = code.slice(0, eqIdx + 1).trimEnd();
    const rhs = code.slice(eqIdx + 1).trim();
    if (rhs.startsWith("[")) {
      return { elidedText: `${prefixDoc}${lhs} [ ${marker} ];`, omittedComment: marker };
    }
    if (rhs.startsWith("{")) {
      return { elidedText: `${prefixDoc}${lhs} { ${marker} };`, omittedComment: marker };
    }
  }
  return { elidedText: `${prefixDoc}${code}`, omittedComment: marker };
}

/**
 * If a single large statement (such as a big `draw` or `build` function with inner helper functions)
 * must be shrunk to fit a tight budget, elides inner arrow/function declarations inside its body
 * with `{ /* helper body omitted: name(args) *\/ }` while keeping balanced braces/parens.
 */
function shrinkLargeFunctionBody(stmtText: string, maxChars: number): string {
  if (stmtText.length <= maxChars) return stmtText;
  // Replace inner multi-line helper declarations `const foo = (args) => { ... };` with elided bodies
  const openBrace = findFirstTopLevelChar(stmtText, "{");
  if (openBrace < 0) return stmtText;
  const header = stmtText.slice(0, openBrace + 1);
  const closeBrace = stmtText.lastIndexOf("}");
  if (closeBrace <= openBrace) return stmtText;
  const inner = stmtText.slice(openBrace + 1, closeBrace);
  const tail = stmtText.slice(closeBrace);
  const innerStmts = splitTopLevelStatements(inner);
  if (innerStmts.length <= 1) return stmtText;

  const rendered = innerStmts.map((st) => {
    const code = st.code;
    const varMatch = /^(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(code);
    if (varMatch && (findTopLevelArrows(code).length > 0 || code.length > 260)) {
      const { elidedText } = elideHelperStatement(code, [varMatch[1]!], "");
      return `  ${elidedText}`;
    }
    return `  ${st.text}`;
  });
  let candidate = `${header}\n${rendered.join("\n")}\n${tail}`;
  if (candidate.length <= maxChars) return candidate;

  // Drop middle inner statements from largest to smallest, replacing with omission markers, keeping the last return/draw statements
  const keepLast = Math.min(2, rendered.length);
  const indices = rendered
    .slice(0, rendered.length - keepLast)
    .map((text, idx) => ({ idx, len: text.length }))
    .sort((a, b) => b.len - a.len);

  for (const { idx } of indices) {
    if (candidate.length <= maxChars) break;
    const st = innerStmts[idx]!;
    const varMatch = /^(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(st.code);
    const name = varMatch?.[1] ?? `step_${idx}`;
    rendered[idx] = `  /* helper body omitted: ${name}() */`;
    candidate = `${header}\n${rendered.filter((x, i, a) => !(x.includes("helper body omitted") && a[i - 1]?.includes("helper body omitted"))).join("\n")}\n${tail}`;
  }
  return candidate;
}

/**
 * Planned plate excerpt:
 * - Returns the whole plate when `source.length <= budgetChars` (default 60_000).
 * - Otherwise keeps imports, top comments, the exported film/draw function and everything it calls
 *   up to `budgetChars` by priority (`draw`/scene function first, then helpers it calls, then constants),
 *   dropping unreferenced helper bodies while keeping their signatures and marking every omission
 *   explicitly with `/* helper body omitted: name(args) *\/`.
 * - Never performs a character-count cut mid-statement.
 */
export function plateExcerpt(source: string, budgetChars = SOURCE_BUDGET_CHARS): string {
  if (source.length <= budgetChars) return source;

  const rawStmts = splitTopLevelStatements(source);
  let topHeaderComment = "";

  const stmts: PlateStmt[] = rawStmts.map((raw, index) => {
    const { leadingComment, code } = raw;
    let headerComment = "";
    let docComment = leadingComment;
    if (leadingComment && !topHeaderComment && index <= 6) {
      topHeaderComment = leadingComment;
      headerComment = leadingComment;
      docComment = "";
    } else {
      docComment = extractTrailingDocComment(leadingComment, false);
    }

    const stripped = code.replace(/^export\s+/, "").trimStart();
    let names: string[] = [];
    const fnMatch = /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(stripped);
    const typeMatch = /^(?:type|interface|class|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(stripped);
    const varMatch = /^(?:const|let|var)\s+([\s\S]*)$/.exec(stripped);
    if (fnMatch) names = [fnMatch[1]!];
    else if (typeMatch) names = [typeMatch[1]!];
    else if (varMatch) names = extractVarDeclaratorNames(varMatch[1]!);

    let kind: PlateStmt["kind"] = "other";
    if (code.startsWith("import ")) {
      kind = "import";
    } else if (/^export\s+const\s+[A-Za-z0-9_$]+\s*:\s*Film\b/.test(code) || /^export\s+const\s+drawStorybook\b/.test(code)) {
      kind = "film";
    } else if (
      names.some((n) => /^draw[A-Z]|^draw$|^build$|^PROC$|^R$|^steps$/.test(n)) ||
      /^export\s+(?:const|function)\s+draw/.test(code)
    ) {
      kind = "draw";
    } else if (
      fnMatch ||
      findTopLevelArrows(code).length > 0 ||
      /\(\s*\(\s*\)\s*=>/.test(code)
    ) {
      kind = "helper";
    } else if (typeMatch || varMatch) {
      kind = "const";
    }

    const { elidedText, omittedComment } =
      kind === "helper" || (kind === "const" && (code.length > 220 || code.includes("\n")) && !typeMatch)
        ? elideHelperStatement(code, names, docComment)
        : { elidedText: docComment ? `${docComment}\n${code}` : code, omittedComment: `/* helper body omitted: ${names[0] ?? "block"}() */` };

    const fullText = headerComment ? `${headerComment}\n${docComment ? `${docComment}\n` : ""}${code}` : docComment ? `${docComment}\n${code}` : code;
    const refs = extractIdentifierRefs(code);
    for (const n of names) refs.delete(n);

    return {
      index,
      kind,
      names,
      headerComment,
      fullText,
      elidedText: headerComment ? `${headerComment}\n${elidedText}` : elidedText,
      omittedComment,
      refs
    };
  });

  const byName = new Map<string, PlateStmt>();
  for (const st of stmts) {
    for (const n of st.names) byName.set(n, st);
  }

  // BFS from film & draw statements to compute call priority
  const roots = stmts.filter((s) => s.kind === "film" || s.kind === "draw");
  const directHelperIndices = new Set<number>();
  const transitiveHelperIndices: number[] = [];
  const referencedConstIndices: number[] = [];
  const visited = new Set<number>(roots.map((r) => r.index));

  const queue: { stmt: PlateStmt; depth: number }[] = roots.map((stmt) => ({ stmt, depth: 0 }));
  while (queue.length > 0) {
    const { stmt, depth } = queue.shift()!;
    for (const ref of stmt.refs) {
      const target = byName.get(ref);
      if (!target || visited.has(target.index)) continue;
      visited.add(target.index);
      if (target.kind === "helper" || target.kind === "draw") {
        if (depth === 0) directHelperIndices.add(target.index);
        else transitiveHelperIndices.push(target.index);
      } else if (target.kind === "const") {
        referencedConstIndices.push(target.index);
      }
      queue.push({ stmt: target, depth: depth + 1 });
    }
  }

  // State per statement: "full" | "elided" | "omitted"
  const state = new Map<number, "full" | "elided" | "omitted">();
  for (const st of stmts) {
    if (st.kind === "import" || st.kind === "film" || st.kind === "draw") {
      state.set(st.index, "full");
    } else {
      state.set(st.index, "elided");
    }
  }

  const renderWithStates = (headerScale = 1, shrinkDrawTo = Infinity): string => {
    const parts: string[] = [];
    for (const st of stmts) {
      const mode = state.get(st.index)!;
      if (mode === "omitted") continue;
      let text = mode === "full" ? st.fullText : st.elidedText;
      if (st.headerComment && headerScale < 1) {
        const hLines = st.headerComment.split("\n");
        const keepLines = Math.max(2, Math.floor(hLines.length * headerScale));
        const shortHeader = hLines.slice(0, keepLines).join("\n");
        text = text.replace(st.headerComment, shortHeader);
      }
      if ((st.kind === "draw" || st.kind === "film") && text.length > shrinkDrawTo) {
        text = shrinkLargeFunctionBody(text, shrinkDrawTo);
      }
      parts.push(text);
    }
    return parts.join("\n\n");
  };

  let current = renderWithStates();

  if (current.length <= budgetChars) {
    // Greedily upgrade statements from "elided" to "full" in priority order
    const upgradeOrder: number[] = [
      ...directHelperIndices,
      ...transitiveHelperIndices,
      ...referencedConstIndices,
      ...stmts.filter((s) => !visited.has(s.index) && s.kind === "const").map((s) => s.index),
      ...stmts.filter((s) => !visited.has(s.index) && s.kind === "helper").map((s) => s.index),
      ...stmts.filter((s) => s.kind === "other").map((s) => s.index)
    ];
    for (const idx of upgradeOrder) {
      if (state.get(idx) === "full") continue;
      state.set(idx, "full");
      const next = renderWithStates();
      if (next.length <= budgetChars) {
        current = next;
      } else {
        state.set(idx, "elided");
      }
    }
    return current;
  }

  // Base skeleton with all elided signatures is still > budgetChars (e.g., tight budget).
  // 1. Elide secondary draw/build helpers that aren't the final exported film/draw
  const primaryFilmOrDraw = stmts.filter(
    (s) => s.kind === "film" || /^export\s+(?:const|function)\s+draw/.test(stripLeadingComments(s.fullText))
  );
  const primarySet = new Set(primaryFilmOrDraw.map((s) => s.index));
  // Keep at least one draw/build function in primarySet if none matched export draw
  if (primarySet.size <= 1) {
    const drawCandidate = [...stmts].reverse().find((s) => s.kind === "draw");
    if (drawCandidate) primarySet.add(drawCandidate.index);
  }
  for (const st of stmts) {
    if (st.kind === "draw" && !primarySet.has(st.index)) {
      state.set(st.index, "elided");
    }
  }
  current = renderWithStates();
  if (current.length <= budgetChars) return current;

  // 2. Omit unreferenced `other` and `const` statements, then unreferenced `helper` statements (keeping at least one omission marker)
  const dropOrder = [
    ...stmts.filter((s) => s.kind === "other").map((s) => s.index),
    ...stmts.filter((s) => s.kind === "const" && !visited.has(s.index)).map((s) => s.index),
    ...stmts.filter((s) => s.kind === "helper" && !visited.has(s.index)).map((s) => s.index),
    ...stmts.filter((s) => s.kind === "const" && visited.has(s.index)).map((s) => s.index),
    ...stmts.filter((s) => s.kind === "helper" && visited.has(s.index) && !directHelperIndices.has(s.index)).map((s) => s.index)
  ];
  for (const idx of dropOrder) {
    if (current.length <= budgetChars) break;
    state.set(idx, "omitted");
    current = renderWithStates(0.35);
  }
  if (current.length <= budgetChars) return current;

  // 3. Shrink the large draw/film body itself so we always stay <= budgetChars with balanced delimiters
  const targetPerDraw = Math.max(800, Math.floor((budgetChars - 1200) / Math.max(1, primarySet.size)));
  current = renderWithStates(0.25, targetPerDraw);
  while (current.length > budgetChars) {
    const removable = stmts.find((s) => state.get(s.index) === "elided" && !primarySet.has(s.index) && s.kind !== "import");
    if (!removable) break;
    state.set(removable.index, "omitted");
    current = renderWithStates(0.2, Math.max(500, targetPerDraw - 400));
  }
  return current;
}

/**
 * Planned excerpt of the template film's own scene function (used when a style has a guide
 * and `example: plate-excerpt`), showing how the template film's scene/timeline/draw function moves.
 */
export function plateSceneExcerpt(source: string, budgetChars = SCENE_EXCERPT_BUDGET_CHARS): string {
  const effectiveBudget = Math.min(budgetChars, Math.max(3500, Math.floor(source.length * 0.72)));
  return plateExcerpt(source, effectiveBudget);
}

/** Verifies that `{}`, `()`, and `[]` are balanced outside strings and comments. */
export function hasBalancedDelimiters(source: string): { ok: boolean; reason?: string } {
  const stack: { ch: string; pos: number }[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push({ ch, pos: i });
    } else if (ch === ")" || ch === "]" || ch === "}") {
      const last = stack.pop();
      if (!last || last.ch !== pairs[ch]) {
        return { ok: false, reason: `Unmatched "${ch}" at char ${i} (expected match for "${last?.ch ?? "none"}")` };
      }
    }
  }
  if (stack.length > 0) {
    const last = stack[stack.length - 1]!;
    return { ok: false, reason: `Unclosed "${last.ch}" at char ${last.pos}` };
  }
  return { ok: true };
}

/**
 * Builds the `STORY WORLD (advisory)` block for the scene writer, mirroring `storyWorldRule` in `director.ts`.
 */
export function storyWorldBlockFor(
  brief: { look?: string | null; styleExample?: string | null },
  override?: string
): string | null {
  if (override !== undefined) {
    const trimmed = override.trim();
    if (!trimmed) return null;
    return trimmed.startsWith("STORY WORLD (advisory")
      ? trimmed
      : `STORY WORLD (advisory: a helper, not a rule): ${trimmed}`;
  }
  const world = storyWorldFor(brief);
  if (!world) return null;
  return `STORY WORLD (advisory: a helper, not a rule): ${world.world} Ideas: ${world.elements.join("; ")}. Plan pictures only; never change approved lines, keywords or scenes.`;
}

export type KitModule = {
  name: string;
  specifier: string;
  relPath: string;
  path: string;
  source: string;
  exportedNames: string[];
};

const CORE_SPECIFIERS = new Set(["core", "film", "gallery"]);

function parseLocalKitImports(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of stripped.matchAll(/(?:from|import)\s+["']\.\/([A-Za-z0-9_]+)(?:\.ts)?["']/g)) {
    const mod = m[1]!;
    if (!CORE_SPECIFIERS.has(mod) && !out.includes(mod)) {
      out.push(mod);
    }
  }
  return out;
}

let lastKitModulesPlateName: string | null = null;

export function consumeLastKitModulesPlateName(): string | null {
  const v = lastKitModulesPlateName;
  lastKitModulesPlateName = null;
  return v;
}

/**
 * Resolves a plate's own local imports (`import ... from "./x"`, excluding `./core`, `./film`, `./gallery`)
 * to `canvas-core/<x>.ts`, transitively for kit modules, de-duplicated, in dependency order.
 */
export function kitModulesFor(plateName: string): KitModule[] {
  lastKitModulesPlateName = plateName;
  const platePath = coreFile(plateName);
  if (!existsSync(platePath)) return [];
  const visited = new Set<string>();
  const order: KitModule[] = [];

  const visit = (modName: string) => {
    const filePath = coreFile(modName);
    if (!existsSync(filePath)) return;
    const src = readFileSync(filePath, "utf8");
    for (const dep of parseLocalKitImports(src)) {
      if (!visited.has(dep)) {
        visited.add(dep);
        visit(dep);
        const depPath = coreFile(dep);
        if (existsSync(depPath)) {
          const depSrc = readFileSync(depPath, "utf8");
          order.push({
            name: dep,
            specifier: `./${dep}`,
            relPath: `canvas-core/${dep}.ts`,
            path: depPath,
            source: depSrc,
            exportedNames: exportedNamesOf(depSrc)
          });
        }
      }
    }
  };

  visit(plateName);
  return order;
}

function elideExportStatementWithOmission(code: string, docComment: string): { names: string[]; elidedText: string; fullText: string } {
  const fullText = docComment ? `${docComment}\n${code}` : code;
  const withDoc = (sig: string) => (docComment ? `${docComment}\n${sig}` : sig);
  const rest = code.slice("export ".length).trimStart();
  const names = exportedNamesOf(code);
  const primaryName = names[0] ?? "export";
  const marker = `/* body omitted: ${primaryName} */`;

  if (/^(?:type|interface)\b/.test(rest)) {
    return { names, elidedText: fullText, fullText };
  }
  if (/^class\b/.test(rest)) {
    const elidedClass = elideClassDeclaration(code).replace(/\{\s*\/\*\s*\.\.\.\s*\*\/\s*\}/g, `{ ${marker} }`);
    return { names, elidedText: withDoc(elidedClass), fullText };
  }
  if (/^(?:async\s+)?function\b/.test(rest)) {
    const braceIdx = findFirstTopLevelChar(code, "{");
    if (braceIdx >= 0) {
      return { names, elidedText: withDoc(`${code.slice(0, braceIdx).trimEnd()} { ${marker} }`), fullText };
    }
    return { names, elidedText: fullText, fullText };
  }
  if (/^(?:const|let|var)\b/.test(rest)) {
    const arrows = findTopLevelArrows(code);
    if (arrows.length > 0) {
      const lastArrow = arrows[arrows.length - 1]!;
      const prefix = code.slice(0, lastArrow + 2).trimEnd();
      return { names, elidedText: withDoc(`${prefix} { ${marker} };`), fullText };
    }
    if (code.length <= 200 && !code.includes("\n")) {
      return { names, elidedText: fullText, fullText };
    }
    const eqIdx = findFirstTopLevelEquals(code);
    if (eqIdx >= 0) {
      const lhs = code.slice(0, eqIdx + 1).trimEnd();
      const rhs = code.slice(eqIdx + 1).trim();
      if (rhs.startsWith("[")) {
        return { names, elidedText: withDoc(`${lhs} [ ${marker} ];`), fullText };
      }
      return { names, elidedText: withDoc(`${lhs} { ${marker} };`), fullText };
    }
  }
  return { names, elidedText: fullText, fullText };
}

/**
 * Formats a style's resolved kit modules for the scene writer prompt:
 * - When the total length of all kit modules for the style is `<= budgetChars` (150,000), every module is sent in full.
 * - When total length exceeds `budgetChars`, sends each module's complete API (every `export` signature with its doc comment)
 *   plus the full bodies of the exported helpers referenced by `plateSource`, in usage-frequency priority order,
 *   with every elided body marked `/* body omitted: name *\/`.
 */
export function kitModulesForPrompt(
  modules: readonly KitModule[],
  plateSource = "",
  budgetChars = KIT_BUDGET_CHARS
): { name: string; specifier: string; relPath: string; text: string; full: boolean }[] {
  const totalChars = modules.reduce((acc, m) => acc + m.source.length, 0);
  if (totalChars <= budgetChars) {
    return modules.map((m) => ({
      name: m.name,
      specifier: m.specifier,
      relPath: m.relPath,
      text: m.source,
      full: true
    }));
  }

  const strippedPlate = plateSource
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, " ");
  const refCounts = new Map<string, number>();
  for (const m of strippedPlate.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    const id = m[1]!;
    refCounts.set(id, (refCounts.get(id) ?? 0) + 1);
  }

  type ModEntry = {
    mod: KitModule;
    items: { names: string[]; elidedText: string; fullText: string; isFull: boolean; maxRefCount: number }[];
  };

  const modEntries: ModEntry[] = modules.map((mod) => {
    const stmts = splitTopLevelStatements(mod.source);
    const items: ModEntry["items"] = [];
    for (let idx = 0; idx < stmts.length; idx++) {
      const st = stmts[idx]!;
      const { leadingComment, code } = st;
      if (!code) {
        if (idx === 0 && leadingComment) {
          items.push({ names: [], elidedText: leadingComment, fullText: leadingComment, isFull: true, maxRefCount: 0 });
        }
        continue;
      }
      if (code.startsWith("import ")) {
        const text = leadingComment ? `${leadingComment}\n${code}` : code;
        items.push({ names: [], elidedText: text, fullText: text, isFull: true, maxRefCount: 0 });
        continue;
      }
      if (!code.startsWith("export ")) continue;
      const docComment = extractTrailingDocComment(leadingComment, idx === 0);
      const { names, elidedText, fullText } = elideExportStatementWithOmission(code, docComment);
      const maxRefCount = names.reduce((max, n) => Math.max(max, refCounts.get(n) ?? 0), 0);
      items.push({
        names,
        elidedText,
        fullText,
        isFull: elidedText === fullText,
        maxRefCount
      });
    }
    return { mod, items };
  });

  const renderMod = (entry: ModEntry) => entry.items.map((it) => (it.isFull ? it.fullText : it.elidedText)).join("\n");
  const totalRendered = () => modEntries.reduce((acc, e) => acc + renderMod(e).length, 0);

  // Candidates referenced by the plate's drawing code first (by frequency descending), then any remaining exports
  const candidates: { entryIdx: number; itemIdx: number; count: number }[] = [];
  modEntries.forEach((entry, entryIdx) => {
    entry.items.forEach((item, itemIdx) => {
      if (!item.isFull) {
        candidates.push({ entryIdx, itemIdx, count: item.maxRefCount });
      }
    });
  });
  candidates.sort((a, b) => b.count - a.count);

  let currentLen = totalRendered();
  for (const cand of candidates) {
    if (cand.count <= 0) break;
    const item = modEntries[cand.entryIdx]!.items[cand.itemIdx]!;
    const delta = item.fullText.length - item.elidedText.length;
    if (currentLen + delta <= budgetChars) {
      item.isFull = true;
      currentLen += delta;
    }
  }

  return modEntries.map((entry) => {
    const text = renderMod(entry);
    const full = entry.items.every((it) => it.isFull);
    return {
      name: entry.mod.name,
      specifier: entry.mod.specifier,
      relPath: entry.mod.relPath,
      text,
      full
    };
  });
}

function plateTopLevelHelperNames(plateName: string, plateSource: string): string[] {
  const names: string[] = [];
  const cap = plateName ? `${plateName[0]!.toUpperCase()}${plateName.slice(1)}` : "";
  const exclude = new Set([plateName, "film", `draw${cap}`, "draw", "STYLE"]);
  const stmts = splitTopLevelStatements(plateSource);
  for (const st of stmts) {
    const code = st.code.replace(/^export\s+/, "").trimStart();
    const fnMatch = /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(code);
    if (fnMatch) {
      const n = fnMatch[1]!;
      if (!exclude.has(n) && !names.includes(n)) names.push(n);
      continue;
    }
    const varMatch = /^(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(code);
    if (varMatch && (findTopLevelArrows(code).length > 0 || /\(\s*\(\s*\)\s*=>/.test(code))) {
      const n = varMatch[1]!;
      if (!exclude.has(n) && !names.includes(n)) names.push(n);
    }
  }
  if (names.length < MIN_KIT_HELPERS) {
    for (const m of plateSource.matchAll(/\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*\([^)]*\)\s*(?::[^=]+)?=>/g)) {
      const n = m[1]!;
      if (!exclude.has(n) && !names.includes(n)) names.push(n);
    }
  }
  return names;
}

/**
 * Returns all helper names for `plateName` (exported names of `kitModulesFor(plateName)` when the style has kit modules,
 * or the plate's own helper function names when the plate itself is the kit), ranked by usage frequency in the plate.
 */
export function kitHelperNamesFor(plateName: string): { all: string[]; top12: string[]; hasSeparateKit: boolean } {
  const kits = kitModulesFor(plateName);
  const platePath = coreFile(plateName);
  const plateSource = existsSync(platePath) ? readFileSync(platePath, "utf8") : "";
  const strippedPlate = plateSource
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, " ");

  const countInPlate = (name: string): number => {
    const escaped = name.replace(/\$/g, "\\$");
    return (strippedPlate.match(new RegExp(`\\b${escaped}\\b`, "g")) ?? []).length;
  };

  if (kits.length > 0) {
    const exported: string[] = [];
    for (const k of kits) {
      for (const n of k.exportedNames) {
        if (!exported.includes(n)) exported.push(n);
      }
    }
    const ranked = [...exported].sort((a, b) => countInPlate(b) - countInPlate(a) || exported.indexOf(a) - exported.indexOf(b));
    return { all: ranked, top12: ranked.slice(0, 12), hasSeparateKit: true };
  }

  const plateHelpers = plateTopLevelHelperNames(plateName, plateSource);
  const ranked = [...plateHelpers].sort((a, b) => countInPlate(b) - countInPlate(a) || plateHelpers.indexOf(a) - plateHelpers.indexOf(b));
  return { all: ranked, top12: ranked.slice(0, 12), hasSeparateKit: false };
}

export type KitUseCheckResult = {
  ok: boolean;
  used: string[];
  topHelpers: string[];
  message?: string;
};

/**
 * Pure, no-model-call check that an authored scene module builds from the style's kit helpers
 * (referencing at least `MIN_KIT_HELPERS = 3` distinct helper names as identifiers, imported or copied by name).
 */
export function checkKitUse(plateName: string, code: string): KitUseCheckResult {
  const { all, top12 } = kitHelperNamesFor(plateName);
  const refs = extractIdentifierRefs(code);
  const used = all.filter((name) => refs.has(name));
  if (used.length >= MIN_KIT_HELPERS) {
    return { ok: true, used, topHelpers: top12 };
  }
  return {
    ok: false,
    used,
    topHelpers: top12,
    message: `Build the scene from the style's kit helpers: use at least 3 of: ${top12.join(", ")}`
  };
}

/**
 * Returns the de-duplicated list of letter/glyph/text-drawing helpers from `LETTER_HELPERS`
 * for `plateName`'s kit modules and `plateName` itself.
 */
export function letterHelpersFor(plateName: string): string[] {
  const savedLast = lastKitModulesPlateName;
  const kits = kitModulesFor(plateName);
  lastKitModulesPlateName = savedLast;
  const out: string[] = [];
  for (const k of kits) {
    for (const h of LETTER_HELPERS[k.name] ?? []) {
      if (!out.includes(h)) out.push(h);
    }
  }
  for (const h of LETTER_HELPERS[plateName] ?? []) {
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * Replaces comments (`// ...`, `/* ... *\/`) and string literal text (`'...'`, `"..."`, `` `...` ``)
 * with spaces while preserving line breaks (`\n`, `\r`) and keeping `${...}` expressions inside template literals live.
 */
export function blankStringsAndComments(source: string): string {
  const out = source.split("");
  const blankRange = (start: number, end: number) => {
    for (let k = start; k <= end && k < out.length; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  const scanString = (start: number): number => {
    const quote = source[start]!;
    out[start] = " ";
    let i = start + 1;
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === "\\") {
        blankRange(i, i + 1);
        i += 2;
        continue;
      }
      if (quote === "`" && ch === "$" && source[i + 1] === "{") {
        blankRange(i, i + 1);
        i += 2;
        let depth = 1;
        while (i < source.length && depth > 0) {
          const c = source[i]!;
          if (c === "'" || c === '"' || c === "`") {
            i = scanString(i) + 1;
            continue;
          }
          if (c === "/" && source[i + 1] === "/") {
            const end = skipLineComment(source, i);
            blankRange(i, end);
            i = end + 1;
            continue;
          }
          if (c === "/" && source[i + 1] === "*") {
            const end = skipBlockComment(source, i);
            blankRange(i, end);
            i = end + 1;
            continue;
          }
          if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) {
              out[i] = " ";
              i++;
              break;
            }
          }
          i++;
        }
        continue;
      }
      if (ch === quote) {
        out[i] = " ";
        return i;
      }
      if (ch !== "\n" && ch !== "\r") out[i] = " ";
      i++;
    }
    return source.length - 1;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      i = scanString(i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = skipLineComment(source, i);
      blankRange(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = skipBlockComment(source, i);
      blankRange(i, end);
      i = end;
      continue;
    }
  }
  return out.join("");
}

export type NoTextIssue = {
  kind: "letter-helper" | "canvas-text";
  name: string;
  line: number;
};

export type NoTextCheckResult = {
  ok: boolean;
  issues: NoTextIssue[];
  message?: string;
};

/**
 * Pure check that fails when `code`:
 * (a) calls or references `fillText`, `strokeText`, `measureText`, `ctx.font` / `.font =`, or
 * (b) calls any helper from `LETTER_HELPERS` of the style's kit modules or the plate itself
 *     (as an identifier call, imported or copied),
 * ignoring matches inside comments and inside string literals.
 */
export function checkNoText(plateName: string, code: string): NoTextCheckResult {
  const blanked = blankStringsAndComments(code);
  const lines = blanked.split(/\r?\n/);
  const helpers = letterHelpersFor(plateName);
  const issues: (NoTextIssue & { col: number })[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const lineText = lines[idx]!;
    const lineNum = idx + 1;

    for (const m of lineText.matchAll(/\b(fillText|strokeText|measureText)\b/g)) {
      issues.push({
        kind: "canvas-text",
        name: m[1]!,
        line: lineNum,
        col: m.index ?? 0
      });
    }

    for (const m of lineText.matchAll(/\bctx\.font\b|\.font\s*=/g)) {
      const raw = m[0]!;
      issues.push({
        kind: "canvas-text",
        name: raw.startsWith("ctx.") ? "ctx.font" : "font",
        line: lineNum,
        col: m.index ?? 0
      });
    }

    for (const h of helpers) {
      const escaped = h.replace(/\$/g, "\\$");
      const re = new RegExp(`\\b(${escaped})\\s*\\(`, "g");
      for (const m of lineText.matchAll(re)) {
        const col = m.index ?? 0;
        const before = lineText.slice(0, col);
        if (/\bfunction\s+$/.test(before)) continue;
        issues.push({
          kind: "letter-helper",
          name: h,
          line: lineNum,
          col
        });
      }
    }
  }

  issues.sort((a, b) => a.line - b.line || a.col - b.col);
  const cleanIssues: NoTextIssue[] = issues.map(({ kind, name, line }) => ({ kind, name, line }));

  if (cleanIssues.length === 0) {
    return { ok: true, issues: [] };
  }

  const helperNames: string[] = [];
  const canvasNames: string[] = [];
  for (const iss of cleanIssues) {
    if (iss.kind === "letter-helper") {
      if (!helperNames.includes(iss.name)) helperNames.push(iss.name);
    } else {
      if (!canvasNames.includes(iss.name)) canvasNames.push(iss.name);
    }
  }

  let targetDesc: string;
  if (helperNames.length > 0 && canvasNames.length > 0) {
    targetDesc = `${helperNames.join("/")} (and ${canvasNames.join("/")})`;
  } else if (helperNames.length > 0) {
    targetDesc = helperNames.join("/");
  } else {
    targetDesc = canvasNames.join("/");
  }

  return {
    ok: false,
    issues: cleanIssues,
    message: `No words in the picture: remove the calls to ${targetDesc}; the editor lays on all text. Draw shapes and marks instead.`
  };
}

export type ScenePolicyIssue =
  | NoTextIssue
  | {
      kind: "kit-use";
      name: string;
      line: number;
    };

export type ScenePolicyCheckResult = {
  ok: boolean;
  issues: ScenePolicyIssue[];
  message?: string;
  kitUse: KitUseCheckResult;
  noText: NoTextCheckResult;
};

/**
 * Combined policy check for `author.ts`: `checkKitUse(plateName, code)` + `checkNoText(plateName, code)`,
 * returning `{ ok, issues, message }` with the repair messages joined so the model fixes all issues in one go.
 */
export function checkScene(plateName: string, code: string): ScenePolicyCheckResult {
  const kitUse = checkKitUse(plateName, code);
  const noText = checkNoText(plateName, code);
  const ok = kitUse.ok && noText.ok;
  const issues: ScenePolicyIssue[] = [
    ...(kitUse.ok ? [] : [{ kind: "kit-use" as const, name: "kit-helpers", line: 1 }]),
    ...noText.issues
  ];
  if (ok) {
    return { ok: true, issues: [], kitUse, noText };
  }
  const messages = [kitUse.message, noText.message].filter((m): m is string => Boolean(m));
  return {
    ok: false,
    issues,
    message: `${messages.join(" ")} Fix all issues in one go.`,
    kitUse,
    noText
  };
}
