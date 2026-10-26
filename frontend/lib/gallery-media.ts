const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** Template previews live in object storage behind the backend; `gallery:<file>` is their reference in the catalog. */
export const galleryMediaUrl = (src: string) => src.startsWith("gallery:") ? `${apiOrigin}/v1/gallery/${src.slice("gallery:".length)}` : src;
