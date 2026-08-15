/**
 * Two-layer item model.
 *
 * `RawItem` is deliberately close to what a data source (bazaardb.gg, a manual
 * export, the seed file) actually hands us: identity, board footprint, type
 * tags, and the tooltip lines. Nothing interpreted.
 *
 * `Item` is a RawItem plus everything `enrich.ts` infers from the tooltips.
 * The recommender only ever reads `Item`, so a freshly fetched dataset and the
 * bundled seed dataset go through exactly the same interpretation code.
 *
 * The split matters because of patch drift: numbers on Bazaar items change
 * constantly, but *what an item does* (burns, freezes, buffs your Weapons)
 * is stable. Recommendations are built on the stable half.
 */

export type Hero =
  | "Vanessa"
  | "Pygmalien"
  | "Dooley"
  | "Mak"
  | "Stelle"
  | "Jules"
  | "Common";

/** Board footprint. The board holds 10 slots' worth of items. */
export type Size = "Small" | "Medium" | "Large";

export const SIZE_SLOTS: Record<Size, number> = {
  Small: 1,
  Medium: 2,
  Large: 3,
};

export const BOARD_SLOTS = 10;

export type Tier = "Bronze" | "Silver" | "Gold" | "Diamond" | "Legendary";

export const TIER_ORDER: Tier[] = [
  "Bronze",
  "Silver",
  "Gold",
  "Diamond",
  "Legendary",
];

/**
 * What an item *does*. Derived from tooltip text, not hand-authored, so the
 * vocabulary has to stay small enough that keyword rules can hit it reliably.
 */
export type Mechanic =
  | "Damage"
  | "Burn"
  | "Poison"
  | "Freeze"
  | "Slow"
  | "Haste"
  | "Shield"
  | "Heal"
  | "Regen"
  | "Crit"
  | "Lifesteal"
  | "Ammo"
  | "Charge"
  | "Multicast"
  | "Income"
  | "Value"
  | "Cooldown"
  | "Destroy"
  | "Transform";

/**
 * The job an item does on a board. A board that is all win-condition and no
 * sustain loses to anything that outlasts it, which is most of what the
 * recommender is trying to catch.
 */
export type Role =
  | "WinCondition"
  | "Sustain"
  | "Defense"
  | "Control"
  | "Scaling"
  | "Enabler"
  | "Economy";

export const ALL_ROLES: Role[] = [
  "WinCondition",
  "Sustain",
  "Defense",
  "Control",
  "Scaling",
  "Enabler",
  "Economy",
];

/** The shape a data source is expected to provide. */
export interface RawItem {
  /** Stable slug, e.g. `bar-of-gold`. */
  id: string;
  name: string;
  hero: Hero;
  size: Size;
  startingTier: Tier;
  /** Type tags as printed on the card: Weapon, Aquatic, Friend, Tool, ... */
  tags: string[];
  /** Tooltip lines, one entry per line, at a representative tier. */
  tooltips: string[];
  /** Where the item comes from, when the source knows: merchant, monster, event. */
  source?: string;
  /** Enchantment names the item can roll, when known. */
  enchantments?: string[];
}

/** A RawItem after `enrich()` has interpreted its tooltips. */
export interface Item extends RawItem {
  mechanics: Mechanic[];
  roles: Role[];
  /**
   * Type tags this item buffs on *other* items — parsed out of phrasings like
   * "your Weapons gain +5 damage". This is the backbone of pair detection.
   */
  buffsTags: string[];
  /** Mechanics this item's payoff grows with ("for each Burn you have"). */
  scalesWith: Mechanic[];
  /**
   * Mechanics this item needs the rest of the board to supply. An item that
   * consumes Freeze is close to dead on a board with no freeze source, and
   * recommending it there is exactly the mistake worth avoiding.
   */
  requires: Mechanic[];
}

export interface ItemDataset {
  /** Where this data came from, surfaced in the UI so provenance is visible. */
  provenance: {
    source: string;
    fetchedAt: string | null;
    note?: string;
  };
  items: Item[];
}
