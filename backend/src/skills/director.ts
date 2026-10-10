import { skillBundle } from "./loader.ts";
const bundle = await skillBundle();
export const SCRIPT_FOR_MOTION = bundle.text("director/SCRIPT_FOR_MOTION.md");
export const WATCHABILITY = bundle.text("director/WATCHABILITY.md");
export const ROUTING = bundle.text("director/ROUTING.md");
export const MOTION_DIRECTION = bundle.text("director/MOTION_DIRECTION.md");
export const SHOT_DIRECTION = bundle.text("director/SHOT_DIRECTION.md");
