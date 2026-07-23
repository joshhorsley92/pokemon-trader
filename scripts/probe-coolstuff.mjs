/**
 * Throwaway diagnostic: the CoolStuff POST works from CI but the 19MB static
 * file download gets its socket killed (UND_ERR_SOCKET) from datacenter IPs.
 * Try several download strategies to see which (if any) survives from CI, so we
 * know whether it's fixable in the adapter. Delete once settled.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const BASE = "https://www.coolstuffinc.com";
const OUR_UA = "pokemon-trader/0.1.0";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function getPointer() {
  const post = await fetch(`${BASE}/main_selllist.php?s=pokemon`, {
    method: "POST",
    headers: {
      "User-Agent": OUR_UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "action=getCards",
    signal: AbortSignal.timeout(30000),
  });
  const pointer = JSON.parse(await post.text());
  return `${BASE}/${pointer.rows}`;
}

async function attempt(name, url, init) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
    const buf = await r.arrayBuffer();
    console.log(
      `[${name}] ${r.status} ${Date.now() - t0}ms bytes=${buf.byteLength} enc=${r.headers.get("content-encoding") || "-"}`,
    );
    return buf.byteLength;
  } catch (e) {
    console.log(
      `[${name}] FAILED ${Date.now() - t0}ms ${e.name} ${e.cause?.code || e.message}`,
    );
    return 0;
  }
}

const url = await getPointer();
console.log(`file url: ${url.slice(0, 70)}...`);

// 1. plain (baseline)
await attempt("plain our-UA", url, { headers: { "User-Agent": OUR_UA } });
// 2. retry a few times
for (let i = 1; i <= 3; i++) {
  const n = await attempt(`retry #${i}`, url, { headers: { "User-Agent": OUR_UA } });
  if (n > 0) break;
}
// 3. browser UA + full headers
await attempt("browser-UA + accept", url, {
  headers: {
    "User-Agent": BROWSER_UA,
    Accept: "application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: `${BASE}/main_selllist.php?s=pokemon`,
  },
});
// 4. ranged download (first 1MB) — does a partial survive the WAF?
await attempt("range 0-1MB", url, {
  headers: { "User-Agent": BROWSER_UA, Range: "bytes=0-1048575" },
});
