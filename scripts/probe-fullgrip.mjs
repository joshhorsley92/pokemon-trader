/**
 * Throwaway diagnostic: hit the Full Grip buylist index from wherever this
 * runs (locally = residential IP, GitHub Actions = datacenter IP) under a few
 * header configurations and report status/timing. Purpose: figure out whether
 * Full Grip stalls our CI crawl because of the IP range or because the request
 * doesn't look browser-like enough. Delete once we've settled the fix.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const URL = "https://www.fullgripgames.com/buylist/pokemon_singles/226";
const TIMEOUT_MS = 20_000;

const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://www.fullgripgames.com/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Upgrade-Insecure-Requests": "1",
};

const CONFIGS = {
  "current (custom UA only)": { "User-Agent": "pokemon-trader/0.1.0" },
  "browser UA only": { "User-Agent": BROWSER["User-Agent"] },
  "full browser headers": BROWSER,
};

for (const [name, headers] of Object.entries(CONFIGS)) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    console.log(
      `[${name}] ${res.status} in ${Date.now() - t0}ms bytes=${body.length} server=${res.headers.get("server") || "-"} cf-ray=${res.headers.get("cf-ray") || "-"}`,
    );
  } catch (e) {
    console.log(
      `[${name}] FAILED after ${Date.now() - t0}ms: ${e.name} ${e.cause?.code || e.message}`,
    );
  }
}
