import { analyzeBoard, computeAffinities, type BoardAnalysis } from "./board.js";
import { ROLE_IMPORTANCE } from "./archetypes.js";
import { SIZE_SLOTS, type Hero, type Item } from "./types.js";

/**
 * Scoring weights. Kept in one object so the balance between "double down on
 * what you're building" and "patch the hole in your board" is tunable in one
 * place rather than smeared through the scoring function.
 */
export const WEIGHTS = {
  archetypeFit: 3.0,
  directSynergy: 2.5,
  gapFill: 4.0,
  /**
   * Multiplier when the missing role is one the board's own plan calls for.
   * Without this, a committed shield board scores four more shield items above
   * the damage source it has been explicitly warned it lacks: archetype fit
   * compounds across mechanics and tags, while a gap is only ever worth one
   * role, so unweighted gap-filling loses every time.
   */
  planNeedMultiplier: 2.0,
  scalingPayoff: 1.5,
  /** Penalty per unmet dependency the item would bring with it. */
  unmetRequirement: -2.0,
  /** Penalty when the item doesn't fit the free space. */
  noRoom: -1.5,
  /** Small nudge toward items that fit the hero exactly. */
  heroMatch: 0.4,
};

export interface Reason {
  kind: "archetype" | "synergy" | "gap" | "scaling" | "warning" | "space";
  text: string;
  weight: number;
}

export interface Recommendation {
  item: Item;
  score: number;
  reasons: Reason[];
}

export interface CutSuggestion {
  item: Item;
  /** 0..1 — how poorly this item fits what the board is actually doing. */
  misfit: number;
  reason: string;
}

export interface RecommendationResult {
  analysis: BoardAnalysis;
  recommendations: Recommendation[];
  cuts: CutSuggestion[];
}

export interface RecommendOptions {
  /** Restrict to this hero (plus Common). Falls back to the inferred hero. */
  hero?: Hero | null;
  limit?: number;
  /**
   * When false, items that don't fit the remaining space are still scored (with
   * a penalty) rather than hidden — useful once the board is full and the real
   * question is what to swap in.
   */
  hideUnfittable?: boolean;
}

function scoreArchetypeFit(item: Item, analysis: BoardAnalysis): Reason[] {
  const reasons: Reason[] = [];

  for (const { archetype, affinity } of analysis.affinities) {
    // Ignore archetypes the board is barely touching, or every item that
    // happens to share one mechanic gets a spurious recommendation.
    if (affinity < 0.15) continue;

    const mechanicHits = archetype.coreMechanics.filter((m) =>
      item.mechanics.includes(m),
    );
    const tagHits = archetype.coreTags.filter(
      (t) => item.tags.includes(t) || item.buffsTags.includes(t),
    );
    if (mechanicHits.length === 0 && tagHits.length === 0) continue;

    const strength = affinity * (mechanicHits.length + tagHits.length * 0.6);
    reasons.push({
      kind: "archetype",
      text: `Fits your ${archetype.name} lean (${[...mechanicHits, ...tagHits].join(", ")}).`,
      weight: strength * WEIGHTS.archetypeFit,
    });
  }
  return reasons;
}

function scoreDirectSynergy(item: Item, analysis: BoardAnalysis): Reason[] {
  const reasons: Reason[] = [];

  // The candidate buffs a type tag the board already runs.
  const buffsWhatYouHave = item.buffsTags.filter((t) => analysis.tags.has(t));
  for (const tag of buffsWhatYouHave) {
    const beneficiaries = analysis.items.filter((i) => i.tags.includes(tag));
    reasons.push({
      kind: "synergy",
      text: `Buffs your ${tag} items (${beneficiaries.map((i) => i.name).join(", ")}).`,
      weight: WEIGHTS.directSynergy * Math.min(beneficiaries.length, 3),
    });
  }

  // The board already buffs a type tag the candidate has.
  const buffedByBoard = item.tags.filter((t) => analysis.buffedTags.has(t));
  for (const tag of buffedByBoard) {
    const enablers = analysis.items.filter((i) => i.buffsTags.includes(tag));
    reasons.push({
      kind: "synergy",
      text: `Your ${enablers.map((i) => i.name).join(", ")} already buffs ${tag} items.`,
      weight: WEIGHTS.directSynergy * Math.min(enablers.length, 3),
    });
  }

  return reasons;
}

function scoreGapFill(item: Item, analysis: BoardAnalysis): Reason[] {
  const reasons: Reason[] = [];
  const planNeeds = analysis.primary?.archetype.needs ?? [];

  for (const gap of analysis.gaps) {
    if (!item.roles.includes(gap.role)) continue;
    const needed = planNeeds.includes(gap.role);
    const weight =
      gap.gap * WEIGHTS.gapFill * (needed ? WEIGHTS.planNeedMultiplier : 1);

    reasons.push({
      kind: "gap",
      text:
        gap.count === 0
          ? `Covers ${gap.role}, which your board has none of${needed ? ` — and ${analysis.primary?.archetype.name} needs it` : ""}.`
          : `Shores up ${gap.role} (you only have ${gap.count}).`,
      weight,
    });
  }
  return reasons;
}

function scoreScalingPayoff(item: Item, analysis: BoardAnalysis): Reason[] {
  const supplied = item.scalesWith.filter((m) => analysis.mechanics.has(m));
  if (supplied.length === 0) return [];
  return [
    {
      kind: "scaling",
      text: `Scales off ${supplied.join(" / ")}, which your board already produces.`,
      weight: WEIGHTS.scalingPayoff * supplied.length,
    },
  ];
}

function scorePenalties(item: Item, analysis: BoardAnalysis): Reason[] {
  const reasons: Reason[] = [];

  const unmet = item.requires.filter((m) => !analysis.mechanics.has(m));
  if (unmet.length > 0) {
    reasons.push({
      kind: "warning",
      text: `Needs ${unmet.join(" / ")} to come online, and nothing on your board supplies it.`,
      weight: WEIGHTS.unmetRequirement * unmet.length,
    });
  }

  const cost = SIZE_SLOTS[item.size];
  if (cost > analysis.slotsFree) {
    reasons.push({
      kind: "space",
      text:
        analysis.slotsFree === 0
          ? `Board is full — you'd have to cut ${cost} slot${cost > 1 ? "s" : ""} for this.`
          : `Needs ${cost} slots, you have ${analysis.slotsFree} free.`,
      weight: WEIGHTS.noRoom * (cost - analysis.slotsFree),
    });
  }

  return reasons;
}

function isHeroLegal(item: Item, hero: Hero | null): boolean {
  if (!hero) return true;
  return item.hero === hero || item.hero === "Common";
}

/**
 * Items on the board that aren't participating in what the board is doing.
 * Surfaced separately because "what should I look for" usually has an implied
 * second half: "and what do I drop for it".
 */
function findCuts(analysis: BoardAnalysis): CutSuggestion[] {
  if (analysis.affinities.length === 0) return [];

  const cuts: CutSuggestion[] = [];
  for (const item of analysis.items) {
    // Leave-one-out: an item must fit the archetypes the *rest* of the board
    // supports. Scoring it against the full board lets a lone off-plan item
    // vouch for itself — a single gold item makes the board look "economy",
    // which then justifies keeping the gold item.
    const others = analysis.items.filter((other) => other.id !== item.id);
    const context = computeAffinities(others);

    let fit = 0;
    for (const { archetype, affinity } of context) {
      if (affinity < 0.15) continue;
      const hits =
        archetype.coreMechanics.filter((m) => item.mechanics.includes(m)).length +
        archetype.coreTags.filter((t) => item.tags.includes(t)).length;
      fit += affinity * hits;
    }

    // An item can earn its slot by covering a role instead of matching the
    // archetype — a lone healer on a burn board is doing a job. Only roles
    // that actually matter count; being the board's only gold item is not a
    // reason to keep a gold item.
    const coversScarceRole = item.roles.some((role) => {
      const coverage = analysis.roleCoverage.find((r) => r.role === role);
      if (!coverage || coverage.count > 1 || coverage.gap <= 0) return false;
      const neededByPlan = analysis.primary?.archetype.needs.includes(role) ?? false;
      return neededByPlan || ROLE_IMPORTANCE[role] >= 0.6;
    });

    if (fit < 0.2 && !coversScarceRole) {
      cuts.push({
        item,
        misfit: 1 - Math.min(fit / 0.2, 1),
        reason: analysis.primary
          ? `Doesn't contribute to your ${analysis.primary.archetype.name} plan or cover a role you're short on.`
          : "Isn't pulling in the same direction as the rest of the board.",
      });
    }
  }
  return cuts.sort((a, b) => b.misfit - a.misfit);
}

export function recommend(
  owned: Item[],
  pool: Item[],
  options: RecommendOptions = {},
): RecommendationResult {
  const analysis = analyzeBoard(owned, options.hero);

  // With nothing on the board every role reads as a gap, so scoring would rank
  // the pool by generic role coverage and present it as tailored advice. There
  // is genuinely nothing to recommend from.
  if (owned.length === 0) {
    return { analysis, recommendations: [], cuts: [] };
  }

  const ownedIds = new Set(owned.map((i) => i.id));
  const hero = options.hero ?? analysis.hero;

  const recommendations: Recommendation[] = [];

  for (const item of pool) {
    if (ownedIds.has(item.id)) continue;
    if (!isHeroLegal(item, hero)) continue;
    if (options.hideUnfittable && SIZE_SLOTS[item.size] > analysis.slotsFree) {
      continue;
    }

    const reasons = [
      ...scoreArchetypeFit(item, analysis),
      ...scoreDirectSynergy(item, analysis),
      ...scoreGapFill(item, analysis),
      ...scoreScalingPayoff(item, analysis),
      ...scorePenalties(item, analysis),
    ];

    if (hero && item.hero === hero) {
      reasons.push({
        kind: "archetype",
        text: `${hero} item — always in your shop pool.`,
        weight: WEIGHTS.heroMatch,
      });
    }

    // An item with only penalties isn't a recommendation.
    const hasPositive = reasons.some((r) => r.weight > 0);
    if (!hasPositive) continue;

    const score = reasons.reduce((sum, r) => sum + r.weight, 0);
    if (score <= 0) continue;

    recommendations.push({
      item,
      score,
      reasons: reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    });
  }

  recommendations.sort((a, b) => b.score - a.score);

  return {
    analysis,
    recommendations: recommendations.slice(0, options.limit ?? 20),
    cuts: findCuts(analysis),
  };
}
