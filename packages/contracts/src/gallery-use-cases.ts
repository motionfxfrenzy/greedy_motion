// The gallery's use-case groups. Kept in its own module so the browser can import the labels without the catalog.
/** How people browse: by what the video is for, never by how it is made. */
export const galleryUseCases = [
  { id: "trending", label: "Trending", blurb: "Formats taking off on Shorts, Reels and TikTok right now: story-led films with a fast narrator, made end to end." },
  { id: "saas", label: "SaaS & product", blurb: "Launches, feature demos, release notes, proof points, product explainers and walkthroughs, in clean, sketch, doodle, hairline and handmade looks." },
  { id: "explain", label: "Explainers & learning", blurb: "Maths and science, tech diagrams, whiteboard, flat vector, kinetic type, screencasts, data and maps: a style for every lesson." },
  { id: "brand", label: "Brand & social", blurb: "Showreels, bold type and short clips made to be shared." },
  { id: "threed", label: "3D & cinematic", blurb: "Product spins, fly-throughs, worlds and dioramas with real depth and light." },
  { id: "story", label: "Story & film", blurb: "Whole scenes in illustrated, painted, paper and clay styles, for narrative and cinematic films." },
  { id: "colour", label: "Colour themes", blurb: "The same film in a different palette and type." }
] as const;
export type GalleryUseCase = (typeof galleryUseCases)[number]["id"];

/** Search text as the backend uses it: leading and trailing spaces removed, runs of whitespace collapsed to one space, at most 80 characters.
 *  The browser applies the same rule before it asks (and before it writes the URL), so "  case   study " and "case study" are one search. */
export const normalizeSearch = (text: string | undefined | null): string => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

/** The Trending tab is a curated list, in this order (a template keeps its own tab too). */
export const trendingGalleryIds = ["cutout-tales-western", "history-reel", "picture-film", "dark-fable"] as const;
