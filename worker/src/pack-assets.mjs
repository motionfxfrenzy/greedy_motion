// Template-pack pictures for the capture page (backend/src/plates/pack-assets.ts). A scene of a template with pictures reads them by
// name; the backend resolves the names to the current files when it freezes an export (scene.assets) or when the worker asks
// (control op assets.resolve): { name: "u:<uploads key>" | "o:<outputs key>" }. Before Chromium opens the page, the worker downloads
// each one and writes it into window.__ASSETS__ as a data: URL (the page blocks every other request). A picture that is missing (a
// depth map that failed or has not landed) is left out: the scene's env.image(name) returns undefined and it draws flat.
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const REF_RE = /^([uo]):(plates\/([0-9a-f-]{36})\/assets\/[A-Za-z0-9_.-]+)$/i;
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * The identity a drawn clip of this scene is cached under: the bundle digest alone for scenes without pictures (unchanged), and the
 * bundle digest plus the pictures' digest otherwise, so a scene whose depth map landed or whose picture was redrawn is drawn again,
 * and two projects with identical scene code never share a clip.
 */
export function clipCacheDigest(scene) {
  if (!scene?.assetsDigest) return scene?.bundleDigest;
  return createHash("sha256").update(`${scene.bundleDigest}|assets|${scene.assetsDigest}`).digest("hex");
}

/** Writes name -> data: URL into the page's window.__ASSETS__ (the first `window.__ASSETS__={}` only). */
export function withAssetData(html, dataUrls) {
  const entries = Object.entries(dataUrls ?? {});
  if (!entries.length) return html;
  return html.replace("window.__ASSETS__={};", `window.__ASSETS__=${JSON.stringify(Object.fromEntries(entries)).replace(/</g, "\\u003c")};`);
}

/**
 * Downloads a scene's resolved pictures (`refs`: name -> "u:<key>" | "o:<key>") and returns the page with them inlined. Only keys under
 * this project's assets folder are read. `storage` is { downloadPlateInput, downloadPlateOutput } (storage.mjs). Never throws for a
 * missing picture.
 */
export async function injectPackAssets(html, projectId, refs, storage, scratch, log = () => undefined) {
  const keys = refs && typeof refs === "object" ? refs : {};
  const names = Object.keys(keys).filter((n) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(n));
  if (!names.length) return html;
  const data = {};
  for (const name of names) {
    const m = REF_RE.exec(String(keys[name]));
    if (!m || m[3] !== projectId || m[2].includes("..")) { log("warn", "plate_asset_ref_refused", { projectId, name }); continue; }
    const file = join(scratch, `asset-${name}`);
    try {
      await (m[1] === "u" ? storage.downloadPlateInput : storage.downloadPlateOutput)(m[2], file);
      const ext = m[2].split(".").pop().toLowerCase();
      data[name] = `data:${MIME[ext] ?? "image/png"};base64,${(await readFile(file)).toString("base64")}`;
    } catch (error) {
      log("info", "plate_asset_missing", { projectId, name, message: String(error?.message ?? error).slice(0, 200) });
    } finally {
      await rm(file, { force: true }).catch(() => undefined);
    }
  }
  return withAssetData(html, data);
}
