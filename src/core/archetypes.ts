import type { Hero, Mechanic, Role } from "./types.js";

/**
 * Archetypes are scored, not assigned. A board is rarely "a burn board" and
 * nothing else — it's 70% burn, 30% economy, with a freeze splash — and the
 * recommender works better if it can say so.
 *
 * `coreMechanics` / `coreTags` are the evidence that a board is leaning into
 * an archetype. `needs` is what that archetype characteristically lacks and
 * should be shopping for, which drives gap detection.
 */
export interface Archetype {
  id: string;
  name: string;
  /** Heroes that can realistically assemble this. `Common` means any hero. */
  heroes: Hero[];
  coreMechanics: Mechanic[];
  coreTags: string[];
  /** Roles this archetype needs covered to actually close games. */
  needs: Role[];
  blurb: string;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: "burn",
    name: "Burn",
    heroes: ["Vanessa", "Pygmalien", "Dooley", "Mak", "Stelle", "Jules"],
    coreMechanics: ["Burn"],
    coreTags: ["Dragon", "Potion"],
    needs: ["Sustain", "Scaling", "Enabler"],
    blurb:
      "Stack burn and let it tick. Wants haste/cooldown to apply it faster and sustain to survive the ramp.",
  },
  {
    id: "poison",
    name: "Poison",
    heroes: ["Vanessa", "Mak", "Stelle", "Jules"],
    coreMechanics: ["Poison"],
    coreTags: ["Potion", "Aquatic"],
    needs: ["Sustain", "Scaling", "Enabler"],
    blurb:
      "Poison scales off stacks, not hits. Wants cooldown reduction and enough defense to reach the late fight.",
  },
  {
    id: "freeze",
    name: "Freeze / Control",
    heroes: ["Vanessa", "Dooley", "Stelle"],
    coreMechanics: ["Freeze", "Slow"],
    coreTags: [],
    needs: ["WinCondition", "Scaling"],
    blurb:
      "Lock the enemy board down so your damage gets there first. Needs a real win condition behind the control.",
  },
  {
    id: "crit-weapons",
    name: "Crit Weapons",
    heroes: ["Vanessa", "Dooley", "Jules"],
    coreMechanics: ["Crit", "Damage"],
    coreTags: ["Weapon"],
    needs: ["Sustain", "Enabler"],
    blurb:
      "Big weapons hitting often and hitting hard. Wants crit chance, haste, and something to keep you alive.",
  },
  {
    id: "shield-scaling",
    name: "Shield / Attrition",
    heroes: ["Pygmalien", "Dooley", "Stelle"],
    coreMechanics: ["Shield", "Regen", "Heal"],
    coreTags: ["Apparel", "Property"],
    needs: ["WinCondition", "Scaling"],
    blurb:
      "Outlast everything, then win slowly. The failure mode is having no way to actually close the fight.",
  },
  {
    id: "economy",
    name: "Economy / Value",
    heroes: ["Pygmalien", "Vanessa", "Dooley", "Mak", "Stelle", "Jules"],
    coreMechanics: ["Income", "Value"],
    coreTags: ["Loot", "Property"],
    needs: ["WinCondition", "Defense"],
    blurb:
      "Snowball gold into a better board later. Needs to not die during the greedy early days.",
  },
  {
    id: "haste-tempo",
    name: "Haste / Multicast",
    heroes: ["Dooley", "Vanessa", "Jules"],
    coreMechanics: ["Haste", "Multicast", "Charge", "Cooldown"],
    coreTags: ["Tool", "Tech", "Friend"],
    needs: ["WinCondition", "Sustain"],
    blurb:
      "Cycle your board fast enough that quantity becomes quality. Needs a payoff worth triggering repeatedly.",
  },
];

/** How much each role matters when it's missing entirely. */
export const ROLE_IMPORTANCE: Record<Role, number> = {
  WinCondition: 1.0,
  Sustain: 0.75,
  Defense: 0.6,
  Scaling: 0.7,
  Enabler: 0.5,
  Control: 0.35,
  Economy: 0.3,
};

export function archetypeById(id: string): Archetype | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}
