#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const STYLES_PATH = join(REPO_ROOT, "frontend/app/styles.css");
const COMPONENTS_DIR = join(REPO_ROOT, "frontend/components");

const stripAll = process.argv.includes("--all");
const dryRun = process.argv.includes("--dry-run");

/**
 * Scans `frontend/components/*.tsx` for any `ce-*` class names that still exist
 * in JSX (specifically `PlateFinal` in `plate-preview.tsx` and `FinalRenderStep` in `studio.tsx`).
 */
function findUsedCeClasses() {
  const used = new Map(); // className -> Set of "file:line"
  const files = readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  for (const file of files) {
    const full = join(COMPONENTS_DIR, file);
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((line, idx) => {
      const matches = line.matchAll(/\bce-[a-z0-9-]+/g);
      for (const m of matches) {
        const cls = m[0];
        if (!used.has(cls)) used.set(cls, new Set());
        used.get(cls).add(`frontend/components/${file}:${idx + 1}`);
      }
    });
  }
  return used;
}

/**
 * Tokenizes a CSS stylesheet or media block body into top-level statements
 * (preserving comments, whitespace, `@keyframes`, `@media`, and style rules byte-for-byte).
 */
function parseCssNodes(css) {
  const nodes = [];
  let i = 0;
  const n = css.length;

  while (i < n) {
    // 1. Whitespace
    if (/\s/.test(css[i])) {
      const start = i;
      while (i < n && /\s/.test(css[i])) i++;
      nodes.push({ type: "ws", raw: css.slice(start, i) });
      continue;
    }

    // 2. Comment
    if (css[i] === "/" && css[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < n && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      nodes.push({ type: "comment", raw: css.slice(start, i) });
      continue;
    }

    // 3. Rule or At-Rule
    const start = i;
    let inSingle = false;
    let inDouble = false;
    let parenDepth = 0;
    while (i < n) {
      const ch = css[i];
      if (ch === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (!inDouble && ch === "'") inSingle = !inSingle;
      else if (!inSingle && ch === '"') inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === "(") parenDepth++;
        else if (ch === ")" && parenDepth > 0) parenDepth--;
        else if (parenDepth === 0 && (ch === "{" || ch === ";")) {
          break;
        }
      }
      i++;
    }

    if (i >= n) {
      nodes.push({ type: "raw", raw: css.slice(start) });
      break;
    }

    if (css[i] === ";") {
      i++;
      nodes.push({ type: "at-stmt", raw: css.slice(start, i) });
      continue;
    }

    // css[i] === "{"
    const prelude = css.slice(start, i);
    const bodyStart = i + 1;
    i++;
    let braceDepth = 1;
    inSingle = false;
    inDouble = false;
    while (i < n && braceDepth > 0) {
      const ch = css[i];
      if (ch === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (!inDouble && ch === "'") inSingle = !inSingle;
      else if (!inSingle && ch === '"') inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === "/" && css[i + 1] === "*") {
          i += 2;
          while (i < n && !(css[i] === "*" && css[i + 1] === "/")) i++;
          i = Math.min(n, i + 2);
          continue;
        }
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }
      i++;
    }
    const body = css.slice(bodyStart, i - 1);
    const raw = css.slice(start, i);
    const trimmedPrelude = prelude.trim();
    if (trimmedPrelude.startsWith("@media")) {
      nodes.push({ type: "media", prelude, body, raw });
    } else if (trimmedPrelude.startsWith("@")) {
      nodes.push({ type: "at-block", prelude, body, raw });
    } else {
      nodes.push({ type: "rule", prelude, body, raw });
    }
  }

  return nodes;
}

function splitSelectors(prelude) {
  const list = [];
  let cur = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];
    if (ch === "\\" && i + 1 < prelude.length) {
      cur += ch + prelude[i + 1];
      i++;
      continue;
    }
    if (!inDouble && ch === "'") inSingle = !inSingle;
    else if (!inSingle && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "(") parenDepth++;
      else if (ch === ")" && parenDepth > 0) parenDepth--;
      else if (ch === "[") bracketDepth++;
      else if (ch === "]" && bracketDepth > 0) bracketDepth--;
      else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
        list.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.length > 0) list.push(cur);
  return list;
}

function extractCeClasses(selector) {
  return Array.from(selector.matchAll(/\.ce-[a-z0-9-]+/g), (m) => m[0].slice(1));
}

function shouldRemoveSelector(selector, usedCeClasses) {
  const trimmed = selector.trim();
  if (!trimmed.startsWith(".ce-")) return false;
  if (stripAll) return true;
  const ceClasses = extractCeClasses(trimmed);
  if (ceClasses.length === 0) return false;
  // Remove if ANY .ce-* class in the selector chain is unused in JSX
  return ceClasses.some((cls) => !usedCeClasses.has(cls));
}

function transformNodes(nodes, usedCeClasses, removedSelectors, keptCeSelectors) {
  const out = [];

  for (const node of nodes) {
    if (node.type === "rule") {
      const rawSelectors = splitSelectors(node.prelude);
      const kept = [];
      for (const sel of rawSelectors) {
        const trimmed = sel.trim();
        if (shouldRemoveSelector(trimmed, usedCeClasses)) {
          removedSelectors.push(trimmed);
        } else {
          if (trimmed.startsWith(".ce-")) {
            keptCeSelectors.push(trimmed);
          }
          kept.push(sel);
        }
      }
      if (kept.length === rawSelectors.length) {
        out.push(node);
      } else if (kept.length > 0) {
        const newPrelude = kept.join(",");
        out.push({
          type: "rule",
          prelude: newPrelude,
          body: node.body,
          raw: `${newPrelude}{${node.body}}`
        });
      }
      continue;
    }

    if (node.type === "media") {
      const innerNodes = parseCssNodes(node.body);
      const beforeRemoved = removedSelectors.length;
      const transformedInner = transformNodes(innerNodes, usedCeClasses, removedSelectors, keptCeSelectors);
      if (removedSelectors.length === beforeRemoved) {
        out.push(node);
      } else {
        const hasRulesLeft = transformedInner.some(
          (n) => n.type === "rule" || n.type === "media" || n.type === "at-block" || n.type === "at-stmt"
        );
        if (hasRulesLeft) {
          const newBody = transformedInner.map((n) => n.raw).join("");
          out.push({
            type: "media",
            prelude: node.prelude,
            body: newBody,
            raw: `${node.prelude}{${newBody}}`
          });
        } else {
          removedSelectors.push(`${node.prelude.trim()}{...}`);
        }
      }
      continue;
    }

    out.push(node);
  }

  return out;
}

/**
 * Extracts all non-.ce-* rules `(selector, body)` from a CSS string to prove
 * that non-.ce-* rules are 100% byte-identical before and after.
 */
function collectNonCeRules(css, scope = "") {
  const result = [];
  const nodes = parseCssNodes(css);
  for (const node of nodes) {
    if (node.type === "rule") {
      const nonCeSels = splitSelectors(node.prelude)
        .map((s) => s.trim())
        .filter((s) => !s.startsWith(".ce-"));
      if (nonCeSels.length > 0) {
        result.push(`${scope}${nonCeSels.join(",")}{${node.body}}`);
      }
    } else if (node.type === "media") {
      result.push(...collectNonCeRules(node.body, `${scope}${node.prelude.trim()} -> `));
    } else if (node.type === "at-block" || node.type === "at-stmt") {
      result.push(`${scope}${node.raw}`);
    }
  }
  return result;
}

function main() {
  const originalCss = readFileSync(STYLES_PATH, "utf8");
  const usedCeClasses = findUsedCeClasses();

  const removedSelectors = [];
  const keptCeSelectors = [];

  const nodes = parseCssNodes(originalCss);
  const transformed = transformNodes(nodes, usedCeClasses, removedSelectors, keptCeSelectors);

  // Clean up orphaned comments that preceded removed .ce-* sections (`/* Review: the draft is older... */`)
  const cleanedCss = transformed
    .map((n) => n.raw)
    .join("")
    .replace(/\/\* Review: the draft is older than the chosen style\. \*\/\s*\n?/g, "");

  // Verify that every non-.ce-* rule is 100% identical before and after
  const beforeNonCe = collectNonCeRules(originalCss);
  const afterNonCe = collectNonCeRules(cleanedCss);

  if (beforeNonCe.length !== afterNonCe.length) {
    throw new Error(
      `Non-.ce-* rule count changed! Before: ${beforeNonCe.length}, After: ${afterNonCe.length}`
    );
  }
  for (let i = 0; i < beforeNonCe.length; i++) {
    if (beforeNonCe[i] !== afterNonCe[i]) {
      throw new Error(
        `Non-.ce-* rule mismatch at index ${i}:\n  Before: ${beforeNonCe[i]}\n  After:  ${afterNonCe[i]}`
      );
    }
  }

  if (!dryRun) {
    writeFileSync(STYLES_PATH, cleanedCss, "utf8");
  }

  console.log(`Removed ${removedSelectors.length} .ce-* selectors from frontend/app/styles.css:`);
  for (const sel of removedSelectors) {
    console.log(`  - ${sel}`);
  }
  console.log(
    `\nVerification: ${beforeNonCe.length}/${afterNonCe.length} non-.ce-* rules are 100% byte-identical (0 non-.ce-* diffs).`
  );
  if (!stripAll && keptCeSelectors.length > 0) {
    console.log(
      `\nRetained ${keptCeSelectors.length} .ce-* selectors still referenced by PlateFinal (plate-preview.tsx) or FinalRenderStep (studio.tsx):`
    );
    for (const [cls, locs] of usedCeClasses.entries()) {
      console.log(`  - .${cls} -> ${[...locs].join(", ")}`);
    }
  }
}

main();
