import { enrichAll } from "../core/enrich.js";
import type { ItemDataset, RawItem } from "../core/types.js";
import seed from "./seed-items.json";

interface RawDataset {
  provenance: ItemDataset["provenance"];
  items: RawItem[];
}

/**
 * `npm run fetch-data` writes `items.generated.json` next to this file. It's
 * gitignored and usually absent, so the import is optional and we fall back to
 * the bundled seed set.
 */
const generated = import.meta.glob<RawDataset>("./items.generated.json", {
  eager: true,
  import: "default",
});

export function loadDataset(): ItemDataset {
  const fetched = Object.values(generated)[0];
  const raw: RawDataset = fetched ?? (seed as RawDataset);
  return {
    provenance: raw.provenance,
    items: enrichAll(raw.items),
  };
}

export const dataset: ItemDataset = loadDataset();
