// Compile-time test, never imported or run: the helpers that change Pro state must not be callable without the edit
// capability that requireProEdit(request) mints. If one of these calls stops being an error, `tsc` fails on the unused
// expectation and the guarantee is gone.
import type { ProManifest, VideoProject } from "@videosaas/contracts";
import { enqueueProRender, openPro, writeProFiles } from "./routes.ts";

declare const project: VideoProject & { pro: ProManifest };

export async function mustNotCompile() {
  // @ts-expect-error opening a project needs the capability
  await openPro(project, "blank");
  // @ts-expect-error writing files needs the capability
  await writeProFiles("project-id", {});
  // @ts-expect-error queueing a render needs the capability
  await enqueueProRender(project, "final");
  // @ts-expect-error a look-alike object is not a capability
  await openPro({ userId: "someone" }, project, "blank");
}
