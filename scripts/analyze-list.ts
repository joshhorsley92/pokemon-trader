/**
 * CLI buylist analyzer — same engine as /admin/analyzer, for terminal use.
 *
 * Usage:  npx tsx scripts/analyze-list.ts <list.txt|list.csv>
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/analyze-list.ts <list.txt|list.csv>");
  process.exit(1);
}

async function main() {
  // Dynamic import so dotenv loads before @/db reads DATABASE_URL
  const { analyzeListText } = await import("../src/lib/analyzer/run");
  const { PILOT_SHOP_ID } = await import("../src/lib/tenant");
  const result = await analyzeListText(PILOT_SHOP_ID, readFileSync(file, "utf8"));

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : `$${n.toFixed(2)}`;

  console.log(
    `\nParsed ${result.parsedCount} lines, matched ${result.matchedCount}\n`,
  );
  for (const r of result.summary.results) {
    const offer = r.bestOffer
      ? `${r.bestOffer.vendor} ${fmt(r.bestOffer.cash)} (credit ${fmt(r.bestOffer.credit)})`
      : "no offers";
    console.log(
      `${r.decision.padEnd(8)} ${String(r.item.quantity).padStart(2)}x ${r.item.name}` +
        `  [${r.item.setName ?? "?"}]  market ${fmt(r.item.marketPrice)}` +
        `  buylist: ${offer}  tcgNet ${fmt(r.netTcg)}` +
        (r.flags.length ? `  ⚠ ${r.flags.join(", ")}` : ""),
    );
  }
  const t = result.summary.totals;
  console.log(
    `\nTotals — buylist cash ${fmt(t.buylistCash)} (credit ${fmt(t.buylistCredit)}), ` +
      `TCG net ${fmt(t.tcgNet)}, bulk ${fmt(t.bulk)}, ${t.cards} cards`,
  );
  for (const [vendor, b] of Object.entries(result.summary.vendorBatches)) {
    console.log(`  ship ${b.cards} cards to ${vendor} -> ${fmt(b.cash)} cash`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
