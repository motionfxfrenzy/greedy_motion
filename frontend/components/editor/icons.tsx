import type { SVGProps } from "react";

/** Small inline icon set (24-unit grid, drawn at 12–16 px). The app has no icon library. */
const PATHS = {
  layers: "M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  clips: "M3 6h18M3 12h18M3 18h18M7 4v4M14 10v4M10 16v4",
  comps: "M4 4h10v10H4zM10 10h10v10H10z",
  assets: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9.5h.01",
  library: "M5 3v18M10 3v18M15 5l4 .8-3 15.4-4-.8",
  history: "M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2",
  play: "M7 4.5v15l12-7.5-12-7.5Z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  stepBack: "M6 5v14M18 5v14L9 12l9-7Z",
  stepFwd: "M18 5v14M6 5v14l9-7-9-7Z",
  undo: "M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12",
  redo: "m15 7 5 5-5 5M20 12H10a6 6 0 0 0 0 12",
  search: "M10.5 18a7.5 7.5 0 1 1 5.3-2.2L21 21",
  check: "m5 12.5 4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  caretDown: "m6 9 6 6 6-6",
  caretRight: "m9 6 6 6-6 6",
  caretUp: "m6 15 6-6 6 6",
  chevL: "m15 5-7 7 7 7",
  chevR: "m9 5 7 7-7 7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  eyeOff: "M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.6 7.7A16 16 0 0 0 2 12s4 6 10 6a9 9 0 0 0 3.6-.8",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  float: "M8 8h12v12H8zM4 4h12v2M4 4v12h2",
  dock: "M3 4h18v16H3zM9 4v16",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  solid: "M4 4h16v16H4z",
  shape: "M4 7h16v10H4z",
  nul: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z",
  adjustment: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 4v16",
  camera: "M3 8h12v10H3zM15 11l6-3v10l-6-3",
  light: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  image: "M4 5h16v14H4zM4 16l4-4 4 4 3-3 5 5M9 9.5h.01",
  precomp: "M4 4h10v10H4zM10 10h10v10H10z",
  audio: "M4 10v4h3l5 4V6L7 10H4Zm12.5 0a3.5 3.5 0 0 1 0 4M19 7.5a7 7 0 0 1 0 9",
  video: "M3 6h13v12H3zM16 10l5-3v10l-5-3",
  stopwatch: "M12 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM12 11v4M9.5 3h5M12 3v4",
  keyframe: "m12 4 7 8-7 8-7-8 7-8Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  reset: "M4 12a8 8 0 1 1 3 6.2M4 20v-4h4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  split: "M12 3v18M7 8 3 12l4 4M17 8l4 4-4 4",
  flag: "M6 21V4M6 5h11l-2 4 2 4H6",
  snap: "M5 3v8a7 7 0 0 0 14 0V3M5 8h4M15 8h4",
  ripple: "M4 12h6M14 12h6M10 7l4 5-4 5",
  speed: "M3 19c6 0 4-14 10-14s4 14 8 14",
  render: "M5 4l14 8-14 8V4Z",
  check2: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 12.5l3 3 5-6",
  warn: "M12 4 2.5 20h19L12 4ZM12 10v4M12 17h.01",
  dot: "M12 12h.01",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z",
  comment: "M4 5h16v11H9l-5 4V5Z",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4",
  bridge: "M3 17c3-8 15-8 18 0M3 17v3M21 17v3M8 11v9M16 11v9",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  copy: "M8 8h12v12H8zM4 16V4h12"
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export const LAYER_ICON: Record<string, IconName> = { text: "text", solid: "solid", shape: "shape", null: "nul", adjustment: "adjustment", camera: "camera", light: "light", image: "image", precomp: "precomp", audio: "audio" };
