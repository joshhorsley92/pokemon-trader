/**
 * Throwaway diagnostic: reproduce the Full Grip crawl from wherever this runs
 * (locally = residential, GitHub Actions = datacenter) to find where it stalls.
 * The index loads fine from CI, so the nightly hang must be during the
 * sustained set-page crawl — this walks the first N set pages with the real
 * throttle and prints per-request status/timing so a rate-limit tarpit shows
 * up as a jump in latency or a timeout. Delete once the fix is settled.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const BASE = "https://www.fullgripgames.com";
const INDEX = "/buylist/pokemon_singles/226";
const UA = "pokemon-trader/0.1.0"; // the exact UA the real crawl uses
const THROTTLE_MS = 450; // matches the adapter
const TIMEOUT_MS = 20_000;
const MAX_SETS = 60; // enough sequential requests to trip a rate limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  return { status: res.status, ms: Date.now() - t0, bytes: body.length, body };
}

function parseSetLinks(html) {
  const out = new Map();
  const re = /href="(\/buylist\/[a-z0-9_]+(?:-[a-z0-9_]+)?\/(\d+))"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === INDEX) continue;
    out.set(m[1], m[1]);
  }
  return [...out.values()];
}

const idx = await get(INDEX);
const links = parseSetLinks(idx.body);
console.log(`index: ${idx.status} ${idx.ms}ms setLinks=${links.length}`);

let slowest = 0;
let requests = 0;
const t0 = Date.now();
for (const path of links.slice(0, MAX_SETS)) {
  try {
    const r = await get(`${path}?page=1&sort_by_price=0`);
    requests++;
    slowest = Math.max(slowest, r.ms);
    const hasProducts = /<li class="product"/i.test(r.body);
    const flag = r.ms > 5000 ? "  <-- SLOW" : r.status !== 200 ? "  <-- NON-200" : "";
    console.log(`  #${requests} ${path} ${r.status} ${r.ms}ms products=${hasProducts}${flag}`);
  } catch (e) {
    console.log(`  #${requests + 1} ${path} STALLED/FAILED: ${e.name} ${e.cause?.code || e.message}`);
    break;
  }
  await sleep(THROTTLE_MS);
}
console.log(
  `crawled ${requests}/${MAX_SETS} set pages in ${((Date.now() - t0) / 1000).toFixed(1)}s, slowest ${slowest}ms`,
);
