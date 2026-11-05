const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isThrowawayDbName(name) {
  return typeof name === "string" && name.length > 0 && !name.includes("/") && (name.startsWith("plates_") || name.includes("test"));
}

export function databaseName(...args) {
  const url = args.length === 0 ? process.env.DATABASE_URL : args[0];
  if (typeof url !== "string" || !url.trim()) return "";
  try {
    return new URL(url).pathname.slice(1);
  } catch {
    return "";
  }
}

export function assertThrowawayDb(...args) {
  const url = args.length === 0 ? process.env.DATABASE_URL : args[0];
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("DATABASE_URL is required and must point at a local throwaway database (plates_* or *test*).");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`Refusing non-local DATABASE_URL host "${host}" (expected localhost, 127.0.0.1, or [::1]).`);
  }
  const db = parsed.pathname.slice(1);
  if (!isThrowawayDbName(db)) {
    throw new Error(`Refusing non-throwaway database "${db || "(empty)"}" (name must start with "plates_" or contain "test").`);
  }
  return db;
}
