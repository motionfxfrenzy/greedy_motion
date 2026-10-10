// The frame protocol lives in @videosaas/contracts so the editor and the backend serve the same bridge.
export { FRAME_BRIDGE_SCRIPT, frameShellHtml, injectBridge, isFrameEvent } from "@videosaas/contracts";
export type { FrameCommand, FrameEvent, FrameRects } from "@videosaas/contracts";
