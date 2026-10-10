// The gallery's use-case groups. Kept in its own module so the browser can import the labels without the catalog.
/** How people browse: by what the video is for, never by how it is made. */
export const galleryUseCases = [
  { id: "saas", label: "SaaS & product", blurb: "Launches, feature demos, release notes, proof points, product explainers and walkthroughs, in clean, sketch, doodle, hairline and handmade looks." },
  { id: "explain", label: "Explainers & learning", blurb: "Maths and science, tech diagrams, whiteboard, flat vector, kinetic type, screencasts, data and maps: a style for every lesson." },
  { id: "brand", label: "Brand & social", blurb: "Showreels, bold type and short clips made to be shared." },
  { id: "threed", label: "3D & cinematic", blurb: "Product spins, fly-throughs, worlds and dioramas with real depth and light." },
  { id: "story", label: "Story & film", blurb: "Whole scenes in illustrated, painted, paper and clay styles, for narrative and cinematic films." },
  { id: "colour", label: "Colour themes", blurb: "The same film in a different palette and type." }
] as const;
export type GalleryUseCase = (typeof galleryUseCases)[number]["id"];
