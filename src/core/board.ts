import { ARCHETYPES, ROLE_IMPORTANCE, type Archetype } from "./archetypes.js";
import {
  ALL_ROLES,
  BOARD_SLOTS,
  SIZE_SLOTS,
  type Hero,
  type Item,
  type Mechanic,
  type Role,
} from "./types.js";

export interface ArchetypeAffinity {
  archetype: Archetype;
  /** 0..1, share of the board's archetype signal that this archetype holds. */
  affinity: number;
  /** Items that contributed the signal, for explanation. */
  contributors: string[];
}

export interface RoleCoverage {
  role: Role;
  count: number;
  /** 0..1 — how badly this role needs filling. 1 means nothing covers it. */
  gap: number;
}

export interface BoardAnalysis {
  hero: Hero | null;
  items: Item[];
  slotsUsed: number;
  slotsFree: number;
  /** Sorted strongest-first, only archetypes with a non-zero signal. */
  affinities: ArchetypeAffinity[];
  primary: ArchetypeAffinity | null;
  roleCoverage: RoleCoverage[];
  /** Roles with a meaningful gap, worst first. */
  gaps: RoleCoverage[];
  mechanics: Set<Mechanic>;
  tags: Set<string>;
  /** Tags the board's own items buff, i.e. what the board pays you for holding. */
  buffedTags: Set<string>;
  warnings: string[];
}

/**
 * Infers the hero from the owned items. `Common` items belong to everyone and
 * so tell us nothing; if the hero-specific items disagree, we report no hero
 * rather than guessing, and the caller can ask.
 */
export function inferHero(items: Item[]): Hero | null {
  const heroes = new Set(
    items.map((i) => i.hero).filter((h): h is Hero => h !== "Common"),
  );
  if (heroes.size === 1) return [...heroes][0] ?? null;
  return null;
}

export function slotsUsed(items: Item[]): number {
  return items.reduce((sum, item) => sum + SIZE_SLOTS[item.size], 0);
}

export function computeAffinities(items: Item[]): ArchetypeAffinity[] {
  const raw = ARCHETYPES.map((archetype) => {
    const contributors: string[] = [];
    let score = 0;

    for (const item of items) {
      let itemScore = 0;
      for (const mechanic of archetype.coreMechanics) {
        if (item.mechanics.includes(mechanic)) itemScore += 1;
        // An item that *scales with* the archetype's mechanic is a payoff
        // piece and is stronger evidence than one that merely applies it.
        if (item.scalesWith.includes(mechanic)) itemScore += 1.5;
      }
      for (const tag of archetype.coreTags) {
        if (item.tags.includes(tag)) itemScore += 0.5;
        if (item.buffsTags.includes(tag)) itemScore += 1.25;
      }
      if (itemScore > 0) {
        score += itemScore;
        contributors.push(item.name);
      }
    }
    return { archetype, score, contributors };
  }).filter((entry) => entry.score > 0);

  const total = raw.reduce((sum, entry) => sum + entry.score, 0);
  if (total === 0) return [];

  return raw
    .map((entry) => ({
      archetype: entry.archetype,
      affinity: entry.score / total,
      contributors: entry.contributors,
    }))
    .sort((a, b) => b.affinity - a.affinity);
}

function computeRoleCoverage(items: Item[]): RoleCoverage[] {
  return ALL_ROLES.map((role) => {
    const count = items.filter((i) => i.roles.includes(role)).length;
    // Two items covering a role is treated as satisfied; the curve is
    // deliberately steep so the first copy of a missing role is the big win.
    const satisfied = Math.min(count, 2) / 2;
    return { role, count, gap: (1 - satisfied) * ROLE_IMPORTANCE[role] };
  });
}

function computeWarnings(
  items: Item[],
  analysis: Pick<BoardAnalysis, "slotsUsed" | "mechanics" | "gaps">,
): string[] {
  const warnings: string[] = [];

  if (analysis.slotsUsed > BOARD_SLOTS) {
    warnings.push(
      `This is ${analysis.slotsUsed} slots of items but the board only holds ${BOARD_SLOTS}. Something has to be cut.`,
    );
  }

  // Items whose stated dependency nothing on the board supplies.
  for (const item of items) {
    const unmet = item.requires.filter((m) => !analysis.mechanics.has(m));
    if (unmet.length > 0) {
      warnings.push(
        `${item.name} keys off ${unmet.join(" / ")}, which nothing else on your board provides.`,
      );
    }
  }

  const winCon = analysis.gaps.find((g) => g.role === "WinCondition");
  if (winCon && winCon.count === 0) {
    warnings.push(
      "No item on this board deals damage. You need a win condition before anything else.",
    );
  }

  return warnings;
}

export function analyzeBoard(items: Item[], heroOverride?: Hero | null): BoardAnalysis {
  const used = slotsUsed(items);
  const affinities = computeAffinities(items);
  const roleCoverage = computeRoleCoverage(items);
  const gaps = roleCoverage
    .filter((r) => r.gap > 0.15)
    .sort((a, b) => b.gap - a.gap);

  const mechanics = new Set(items.flatMap((i) => i.mechanics));
  const tags = new Set(items.flatMap((i) => i.tags));
  const buffedTags = new Set(items.flatMap((i) => i.buffsTags));

  const analysis: BoardAnalysis = {
    hero: heroOverride ?? inferHero(items),
    items,
    slotsUsed: used,
    slotsFree: Math.max(0, BOARD_SLOTS - used),
    affinities,
    primary: affinities[0] ?? null,
    roleCoverage,
    gaps,
    mechanics,
    tags,
    buffedTags,
    warnings: [],
  };

  analysis.warnings = computeWarnings(items, {
    slotsUsed: used,
    mechanics,
    gaps: roleCoverage.sort((a, b) => b.gap - a.gap),
  });

  return analysis;
}
