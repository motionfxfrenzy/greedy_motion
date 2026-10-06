// Fetching user-supplied URLs (SSRF-safe).
// - http/https on default ports only; no credentials in the URL.
// - The resolved IP is checked inside the socket's DNS lookup, so the address that is validated is the
//   address that is connected to (no DNS-rebinding window). Private, loopback, link-local, CGNAT,
//   multicast, and cloud-metadata ranges are refused.
// - Redirects are followed manually (max 3) and every hop is re-validated.
// - Bodies are capped by size and the whole request by time.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export class FetchRefused extends Error {}

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const blockedV4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
];

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return !blockedV4.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPublicAddress(mapped[1]);
    if (v6 === "::" || v6 === "::1") return false;
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast, 64:ff9b::/96 NAT64, 2001:db8::/32 docs
    return !/^(f[cd]|fe[89ab]|ff|64:ff9b:|2001:db8:)/.test(v6);
  }
  return false;
}

const guardedLookup = (hostname: string, options: object, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const list = addresses as LookupAddress[];
    const bad = list.find((entry) => !isPublicAddress(entry.address));
    if (bad || list.length === 0) return callback(Object.assign(new FetchRefused(`${hostname} resolves to a private or reserved address.`), { code: "EREFUSED" }), "");
    const wantsAll = (options as { all?: boolean }).all;
    if (wantsAll) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export function validateUrl(input: string): URL {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input.trim());
  if (scheme && !/^https?$/i.test(scheme[1])) throw new FetchRefused("Only http and https URLs are allowed.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new FetchRefused("That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchRefused("Only http and https URLs are allowed.");
  if (url.username || url.password) throw new FetchRefused("URLs with credentials are not allowed.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new FetchRefused("Only standard web ports are allowed.");
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) throw new FetchRefused("Private addresses are not allowed.");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(url.hostname)) throw new FetchRefused("Local hostnames are not allowed.");
  return url;
}

export type SafeResponse = { url: string; status: number; contentType: string; body: Buffer };

function requestOnce(url: URL, maxBytes: number, timeoutMs: number): Promise<SafeResponse & { location?: string }> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: "GET",
      lookup: guardedLookup as never,
      timeout: timeoutMs,
      headers: { "user-agent": "VideoSaaS-BrandFetcher/0.1 (+brand kit import)", accept: "text/html,text/css,image/*;q=0.9,*/*;q=0.5" }
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new FetchRefused(`Response is larger than ${Math.round(maxBytes / 1024)} KB.`)); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        url: url.toString(),
        status: response.statusCode ?? 0,
        contentType: String(response.headers["content-type"] ?? ""),
        body: Buffer.concat(chunks),
        location: typeof response.headers.location === "string" ? response.headers.location : undefined
      }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new FetchRefused("The site took too long to respond.")));
    request.on("error", reject);
    request.end();
  });
}

export async function safeFetch(input: string, { maxBytes = 2_000_000, timeoutMs = 8_000 } = {}): Promise<SafeResponse> {
  let url = validateUrl(input);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await requestOnce(url, maxBytes, timeoutMs);
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = validateUrl(new URL(response.location, url).toString());
      continue;
    }
    return response;
  }
  throw new FetchRefused("Too many redirects.");
}
