/**
 * Imports the full item list from bazaardb.gg into `src/data/items.generated.json`.
 *
 *   npm run fetch-data              # fetch everything
 *   npm run fetch-data -- --dry-run # fetch one page and print the mapping
 *   npm run fetch-data -- --limit 50
 *
 * IMPORTANT — this was written without network access to bazaardb.gg (the host
 * is blocked by the egress policy in the environment where it was authored), so
 * the endpoint paths below are from the API's published description rather than
 * observed traffic. `normalizeCard` is deliberately tolerant of field-name
 * variation, and `--dry-run` prints both the raw card and the normalized result
 * so any mismatch is a one-line fix in FIELD_ALIASES rather than a rewrite.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Hero, RawItem, Size, Tier } from "../src/core/types.js";

const BASE_URL = process.env.BAZAARDB_BASE_URL ?? "https://bazaardb.gg";
const SEARCH_PATH = process.env.BAZAARDB_SEARCH_PATH ?? "/api/search";
const PAGE_SIZE = 100;

const OUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/items.generated.json",
);

/** Field names we'll accept for each property, first match wins. */
const FIELD_ALIASES = {
  id: ["id", "slug", "uri", "card_id"],
  name: ["name", "title", "card_name"],
  hero: ["hero", "heroes", "character"],
  size: ["size", "card_size"],
  tier: ["base_tier", "startingTier", "starting_tier", "tier"],
  tags: ["tags", "types", "customTags", "custom_tags"],
  hiddenTags: ["hiddenTags", "hidden_tags"],
  tooltips: ["tooltips", "tooltip", "text", "description", "attributes"],
  source: ["source", "dropSource", "drop_source", "merchant"],
  enchantments: ["enchantments", "enchants"],
} as const;

type Json = Record<string, unknown>;

function pick(card: Json, aliases: readonly string[]): unknown {
  for (const key of aliases) {
    if (card[key] !== undefined && card[key] !== null) return card[key];
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const obj = entry as Json;
          return String(obj.text ?? obj.name ?? obj.value ?? "");
        }
        return String(entry);
      })
      .filter((s) => s.length > 0);
  }
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

const KNOWN_HEROES: Hero[] = [
  "Vanessa",
  "Pygmalien",
  "Dooley",
  "Mak",
  "Stelle",
  "Jules",
];

function normalizeHero(value: unknown): Hero {
  const candidates = asStringArray(value);
  // Items available to several heroes behave like Common for our purposes:
  // they're legal whatever you're playing.
  if (candidates.length !== 1) return "Common";
  const match = KNOWN_HEROES.find(
    (h) => h.toLowerCase() === candidates[0]?.toLowerCase(),
  );
  return match ?? "Common";
}

function normalizeSize(value: unknown): Size {
  const text = String(value ?? "").toLowerCase();
  if (text.startsWith("l")) return "Large";
  if (text.startsWith("m")) return "Medium";
  return "Small";
}

const KNOWN_TIERS: Tier[] = ["Bronze", "Silver", "Gold", "Diamond", "Legendary"];

function normalizeTier(value: unknown): Tier {
  const text = String(value ?? "").toLowerCase();
  return KNOWN_TIERS.find((t) => t.toLowerCase() === text) ?? "Bronze";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeCard(card: Json): RawItem | null {
  const name = pick(card, FIELD_ALIASES.name);
  if (typeof name !== "string" || name.length === 0) return null;

  const rawId = pick(card, FIELD_ALIASES.id);
  // Hidden tags carry real synergy information (an item can be "Aquatic" for
  // synergy purposes without printing it), so they're merged into tags.
  const tags = [
    ...asStringArray(pick(card, FIELD_ALIASES.tags)),
    ...asStringArray(pick(card, FIELD_ALIASES.hiddenTags)),
  ];

  return {
    id: typeof rawId === "string" && rawId ? slugify(rawId) : slugify(name),
    name,
    hero: normalizeHero(pick(card, FIELD_ALIASES.hero)),
    size: normalizeSize(pick(card, FIELD_ALIASES.size)),
    startingTier: normalizeTier(pick(card, FIELD_ALIASES.tier)),
    tags: [...new Set(tags)],
    tooltips: asStringArray(pick(card, FIELD_ALIASES.tooltips)),
    source: (() => {
      const s = pick(card, FIELD_ALIASES.source);
      return typeof s === "string" ? s : undefined;
    })(),
    enchantments: asStringArray(pick(card, FIELD_ALIASES.enchantments)),
  };
}

/** Pulls the card array out of whatever envelope the response uses. */
function extractCards(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload as Json[];
  if (payload && typeof payload === "object") {
    const obj = payload as Json;
    for (const key of ["results", "cards", "items", "data", "hits"]) {
      if (Array.isArray(obj[key])) return obj[key] as Json[];
    }
  }
  return [];
}

async function fetchPage(page: number, limit: number): Promise<Json[]> {
  const url = new URL(SEARCH_PATH, BASE_URL);
  url.searchParams.set("c", "items");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `${url} responded ${response.status} ${response.statusText}. ` +
        `If this is a 403/407 the host is blocked by an egress policy; if it is ` +
        `404 the endpoint path differs — set BAZAARDB_SEARCH_PATH.`,
    );
  }
  return extractCards(await response.json());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIndex = args.indexOf("--limit");
  const maxItems =
    limitIndex >= 0 ? Number(args[limitIndex + 1] ?? PAGE_SIZE) : Infinity;

  const collected: RawItem[] = [];
  const seen = new Set<string>();

  for (let page = 0; collected.length < maxItems; page++) {
    const cards = await fetchPage(page, PAGE_SIZE);
    if (cards.length === 0) break;

    if (dryRun) {
      console.log("--- raw card sample ---");
      console.log(JSON.stringify(cards[0], null, 2));
      console.log("--- normalized ---");
      console.log(JSON.stringify(normalizeCard(cards[0] ?? {}), null, 2));
      return;
    }

    for (const card of cards) {
      const item = normalizeCard(card);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      collected.push(item);
    }

    process.stdout.write(`\rfetched ${collected.length} items…`);
    if (cards.length < PAGE_SIZE) break;
  }

  const withoutTooltips = collected.filter((i) => i.tooltips.length === 0);
  const dataset = {
    provenance: {
      source: BASE_URL,
      fetchedAt: new Date().toISOString(),
      note: `Imported from bazaardb.gg via scripts/fetch-bazaardb.ts.`,
    },
    items: collected,
  };

  await writeFile(OUT_PATH, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(`\nwrote ${collected.length} items to ${OUT_PATH}`);

  // Tooltips are what the whole recommender reads; silently importing a
  // dataset without them would produce confident, meaningless output.
  if (withoutTooltips.length > 0) {
    console.warn(
      `warning: ${withoutTooltips.length} items have no tooltip text ` +
        `(e.g. ${withoutTooltips.slice(0, 3).map((i) => i.name).join(", ")}). ` +
        `Check the 'tooltips' aliases in FIELD_ALIASES against the real response shape.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
