# Bazaar Build Recommender

Enter the items you're currently running in The Bazaar; get a ranked list of
what to look for next, with the reasoning behind each pick.

```bash
npm install
npm run dev       # http://localhost:5173
npm test
```

## What it does

Given a board, it works out three things and combines them into a score:

1. **What you're building.** Archetype affinity is scored, not assigned — a
   board comes back as "44% Poison, 25% Freeze, 19% Crit Weapons" rather than
   being forced into one bucket.
2. **What you're missing.** Every item is assigned roles (win condition,
   sustain, defense, control, scaling, enabler, economy). Roles nothing covers
   become gaps, weighted by how much the archetype you're building needs them.
3. **What actually connects.** Explicit pairs: items that buff a type tag you
   run, items that benefit from a buffer you already have, and payoffs that
   scale off a mechanic your board produces.

It also flags board-space overruns, items whose dependency nothing on your
board supplies, and items worth cutting.

Every recommendation carries its reasons, so you can disagree with it on the
merits instead of trusting a number.

## Data

**The bundled dataset is a 52-item hand-seeded starter set, not the real item
list.** It exists so the app runs out of the box. Mechanics and type tags on
those items are reliable; exact numbers, sizes and tiers are not, and it covers
a fraction of the game.

To get the authoritative data:

```bash
npm run fetch-data              # writes src/data/items.generated.json
npm run fetch-data -- --dry-run # fetch one page, print the field mapping
```

The app prefers `items.generated.json` when present and falls back to the seed
set otherwise. The banner at the top of the page always says which one is live.

> The fetcher was written without network access to bazaardb.gg — the host is
> blocked by the egress policy of the environment it was developed in — so its
> endpoint path comes from the API's published description rather than observed
> traffic. If the first run 404s, the path is wrong: set `BAZAARDB_SEARCH_PATH`
> (and `BAZAARDB_BASE_URL` if needed). If field names differ, `--dry-run` prints
> the raw card next to the normalized result, and `FIELD_ALIASES` in
> `scripts/fetch-bazaardb.ts` takes the correction. A 403/407 means the host is
> blocked where you're running it.

## How it survives balance patches

Item numbers change constantly; what an item *does* mostly doesn't. So nothing
is scored on damage values. `src/core/enrich.ts` reads tooltip text and derives
mechanics, roles, tag buffs, scaling and dependencies, and the recommender works
only on those. A stale item **list** degrades recommendations far more than
stale item **numbers**, which is why the fetcher matters more than the seed set.

The same enrichment runs over seed data and fetched data, so importing ~1300
items needs no hand-annotation.

Enrichment is where the accuracy risk lives, and the tests in
`src/core/enrich.test.ts` pin the cases that bite:

- `"Cleanse burn from yourself"` must not read as a burn source.
- `"Your Weapons gain damage"` is an enabler, not a win condition — it does
  nothing on a board with no weapons.
- `"slowly"` must not read as Slow; `"surcharge"` must not read as Charge.
- Poison/burn items don't get double-counted as direct damage.

## Layout

| Path | |
|---|---|
| `src/core/types.ts` | Item model: raw (from a data source) vs enriched |
| `src/core/enrich.ts` | Tooltip text → mechanics, roles, synergies |
| `src/core/archetypes.ts` | Archetype definitions and role importance |
| `src/core/board.ts` | Board analysis: hero, slots, affinity, gaps, warnings |
| `src/core/recommend.ts` | Scoring, reasons, cut suggestions |
| `src/ui/` | The web app |
| `scripts/fetch-bazaardb.ts` | bazaardb.gg importer |

Scoring weights live in one `WEIGHTS` object in `recommend.ts` — that's the
place to tune how much the tool doubles down on your archetype versus patching
holes in your board.

## Known limits

- Enchantments are imported but not yet scored.
- Skills are out of scope; items only.
- Archetype definitions are hand-written and cover the main lines, not every
  niche build.
- Recommendations don't model tier, cost, or what's actually available in your
  current shop.
