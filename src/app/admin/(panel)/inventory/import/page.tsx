import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import Inventory" };

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Import inventory from CSV</h1>
        <p className="text-sm text-neutral-500">
          Works with Collectr portfolio exports (PRO) or any CSV with a product
          name column. Map the columns, review, and import. Imported items are
          matched to the catalog by name where possible so they track market
          price automatically.
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
