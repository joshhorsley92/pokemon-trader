/**
 * Throwaway diagnostic: from wherever this runs (locally = residential, GitHub
 * Actions = datacenter), fetch Full Grip set pages and count the buylist forms
 * (the add-to-cart-form the real adapter harvests). Residential sees 13-19
 * forms/page; if CI sees products but zero forms, Full Grip is serving
 * datacenter IPs a form-less page and that's why the crawl yields seen=0.
 * Delete once the fix is settled.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const BASE = "https://www.fullgripgames.com";
const INDEX = "/buylist/pokemon_singles/226";
const UA = "pokemon-trader/0.1.0";
const TIMEOUT_MS = 20_000;
const SETS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  return { status: res.status, ms: Date.now() - t0, body };
}

function countForms(html) {
  return (html.match(/class="[^"]*add-to-cart-form[^"]*"/gi) || []).length;
}
function hasProducts(html) {
  return /<li class="product"/i.test(html);
}
function setLinks(html) {
  const out = new Map();
  const re = /href="(\/buylist\/[a-z0-9_]+(?:-[a-z0-9_]+)?\/(\d+))"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== INDEX) out.set(m[1], m[1]);
  }
  return [...out.values()];
}

const idx = await get(INDEX);
const links = setLinks(idx.body);
console.log(`index: ${idx.status} ${idx.ms}ms setLinks=${links.length}`);

let totalForms = 0;
for (const path of links.slice(0, SETS)) {
  const r = await get(`${path}?page=1&sort_by_price=0`);
  const forms = countForms(r.body);
  totalForms += forms;
  console.log(
    `  ${path} ${r.status} ${r.ms}ms products=${hasProducts(r.body)} forms=${forms}`,
  );
  await sleep(450);
}
console.log(`TOTAL buylist forms across ${SETS} sets: ${totalForms}`);
console.log(
  totalForms === 0
    ? "=> VERDICT: form-less pages from this IP (datacenter block on buying data)"
    : "=> VERDICT: forms present — adapter would harvest listings from here",
);
