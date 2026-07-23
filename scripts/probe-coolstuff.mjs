/**
 * Throwaway diagnostic: from wherever this runs (locally = residential, GitHub
 * Actions = datacenter), walk the CoolStuff sell-list fetch and report where it
 * succeeds/fails. It parses 20k+ rows fine from residential, so a CI seen=0
 * failure points at datacenter-IP blocking. Delete once settled.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const BASE = "https://www.coolstuffinc.com";
const UA = { "User-Agent": "pokemon-trader/0.1.0" };

async function run() {
  const t0 = Date.now();
  const post = await fetch(`${BASE}/main_selllist.php?s=pokemon`, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "action=getCards",
    signal: AbortSignal.timeout(30000),
  });
  const text = await post.text();
  console.log(
    `POST getCards: ${post.status} ${Date.now() - t0}ms server=${post.headers.get("server") || "-"} cf-ray=${post.headers.get("cf-ray") || "-"} bytes=${text.length}`,
  );
  console.log(`  head: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  let pointer;
  try {
    pointer = JSON.parse(text);
  } catch {
    console.log("=> VERDICT: POST did not return JSON (challenge/block page)");
    return;
  }
  console.log(
    `  status=${pointer.status} rowsType=${Array.isArray(pointer.rows) ? "array" : typeof pointer.rows}`,
  );
  let rows;
  if (Array.isArray(pointer.rows)) {
    rows = pointer.rows;
  } else if (typeof pointer.rows === "string") {
    const t1 = Date.now();
    const fr = await fetch(`${BASE}/${pointer.rows}`, {
      headers: UA,
      signal: AbortSignal.timeout(60000),
    });
    const ft = await fr.text();
    console.log(`  GET file: ${fr.status} ${Date.now() - t1}ms bytes=${ft.length}`);
    try {
      rows = JSON.parse(ft);
    } catch {
      console.log("=> VERDICT: static file did not return JSON (blocked)");
      return;
    }
  } else {
    console.log("=> VERDICT: unexpected rows payload");
    return;
  }
  console.log(`  rows=${rows.length}`);
  console.log(
    rows.length > 0
      ? "=> VERDICT: CoolStuff data reachable from this IP — adapter would sync"
      : "=> VERDICT: zero rows returned",
  );
}

run().catch((e) =>
  console.log(`=> VERDICT: FAILED ${e.name} ${e.cause?.code || e.message}`),
);
