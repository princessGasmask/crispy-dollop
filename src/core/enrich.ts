import type { Item, Mechanic, RawItem, Role } from "./types.js";

/**
 * Turns tooltip text into the structured facts the recommender scores on.
 *
 * This runs over every item from every source, including the ~1300 items a
 * bazaardb fetch produces, so it has to be keyword-driven rather than
 * hand-curated. The rules below are tuned to be *specific*: a false positive
 * here (deciding an item is a burn payoff when it merely mentions burn)
 * propagates into every recommendation the item appears in.
 */

interface MechanicRule {
  mechanic: Mechanic;
  pattern: RegExp;
}

/**
 * Word-boundary anchored so "Slow" doesn't fire on "slowly" and "Charge"
 * doesn't fire on "surcharge".
 */
const MECHANIC_RULES: MechanicRule[] = [
  { mechanic: "Burn", pattern: /\bburn(s|ing)?\b/i },
  { mechanic: "Poison", pattern: /\bpoison(s|ed|ing)?\b/i },
  { mechanic: "Freeze", pattern: /\bfreez(e|es|ing)\b|\bfrozen\b/i },
  { mechanic: "Slow", pattern: /\bslow(s|ed|ing)?\b/i },
  { mechanic: "Haste", pattern: /\bhaste(s|n|ned)?\b/i },
  { mechanic: "Shield", pattern: /\bshield(s|ed|ing)?\b/i },
  { mechanic: "Regen", pattern: /\bregen(eration)?\b/i },
  { mechanic: "Heal", pattern: /\bheal(s|ing)?\b/i },
  { mechanic: "Crit", pattern: /\bcrit(ical)?\b/i },
  { mechanic: "Lifesteal", pattern: /\blifesteal\b/i },
  { mechanic: "Ammo", pattern: /\bammo\b|\breload(s|ing)?\b/i },
  { mechanic: "Charge", pattern: /\bcharge(s|d)?\b/i },
  { mechanic: "Multicast", pattern: /\bmulticast\b/i },
  { mechanic: "Destroy", pattern: /\bdestroy(s|ed)?\b/i },
  { mechanic: "Transform", pattern: /\btransform(s|ed)?\b/i },
  { mechanic: "Income", pattern: /\bincome\b/i },
  { mechanic: "Value", pattern: /\bvalue\b|\bgold\b/i },
  { mechanic: "Cooldown", pattern: /\bcooldown\b|\bseconds? less\b/i },
  { mechanic: "Damage", pattern: /\bdeal(s)?\b[^.]*\bdamage\b|\bdamage\b/i },
];

/**
 * "your Weapons gain", "all Aquatic items get", "adjacent Friends have".
 * Captures the buffed type tag. Requires a possessive/scoping word in front so
 * that a plain mention of the tag ("This is a Weapon") doesn't match.
 *
 * Case matters here and the two halves need opposite treatment: the leading
 * determiner may be sentence-capitalised ("Your Weapons…"), but the captured
 * tag must stay case-*sensitive*, since capitalisation is what distinguishes a
 * type tag ("Weapons") from a generic noun ("items"). So neither pattern can
 * carry the `i` flag; the determiners spell out both cases instead.
 */
const BUFFS_TAG_PATTERNS: RegExp[] = [
  /\b(?:[Yy]our|[Aa]ll|[Oo]ther|[Aa]djacent|[Ee]ach)\s+([A-Z][a-zA-Z]+)s?\b(?=[^.]*\b(?:gain|get|have|deal|has|are|become)s?\b)/g,
  /\b(?:[Gg]ain|[Gg]et)s?\b[^.]*\bfor each\s+([A-Z][a-zA-Z]+)s?\s+item/g,
];

/** "for each Burn", "based on your Shield", "equal to your Poison". */
const SCALES_WITH_PATTERNS: RegExp[] = [
  /\bfor each\s+([a-zA-Z]+)\b/gi,
  /\bbased on\s+(?:your\s+)?([a-zA-Z]+)\b/gi,
  /\bequal to\s+(?:your\s+)?([a-zA-Z]+)\b/gi,
  /\bper\s+([a-zA-Z]+)\s+you have\b/gi,
];

/**
 * Phrasings that mean "this item eats a resource the rest of the board must
 * produce" — the item is conditional, not self-sufficient.
 */
const REQUIRES_PATTERNS: RegExp[] = [
  /\bif\s+(?:the\s+)?(?:enemy|target|it)\s+is\s+([a-zA-Z]+)\b/gi,
  /\bwhen(?:ever)?\s+you\s+(?:gain|apply|use)\s+([a-zA-Z]+)\b/gi,
  /\bconsume(?:s)?\s+(?:your\s+)?([a-zA-Z]+)\b/gi,
];

/** Text that marks an item as growing over the course of a run or a fight. */
const SCALING_PATTERN =
  /\bpermanent(ly)?\b|\bthis gains?\b|\bfor the (?:rest of the )?(?:fight|day|run)\b|\bupgrade(s|d)?\b/i;

const MECHANIC_BY_LOWER_NAME = new Map<string, Mechanic>(
  MECHANIC_RULES.map((r) => [r.mechanic.toLowerCase(), r.mechanic]),
);
// A couple of natural-language spellings that don't equal the enum name.
MECHANIC_BY_LOWER_NAME.set("frozen", "Freeze");
MECHANIC_BY_LOWER_NAME.set("regeneration", "Regen");
MECHANIC_BY_LOWER_NAME.set("burning", "Burn");
MECHANIC_BY_LOWER_NAME.set("critical", "Crit");

function toMechanic(word: string): Mechanic | null {
  return MECHANIC_BY_LOWER_NAME.get(word.toLowerCase().replace(/s$/, "")) ?? null;
}

function collect(patterns: RegExp[], text: string): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    // Patterns are module-level and global, so lastIndex must be reset or
    // consecutive items would start matching mid-string.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const captured = match[1];
      if (captured) out.push(captured);
      if (match.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }
  return out;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Clauses that *remove* a status rather than apply one: "Cleanse burn from
 * yourself", "You are immune to freeze". Without this, every antidote and
 * cleanse effect reads as a burn/poison source and gets scored as a win
 * condition — the tooltip mentions the word, so the naive rule fires.
 */
const CLEANSE_PATTERN =
  /\b(?:cleanse|cleanses|remove|removes|immune|immunity|prevent|prevents|clear|clears|reduces?)\b/i;

/** Statuses that a cleanse clause is acting *against*, not applying. */
const STATUS_MECHANICS: Mechanic[] = ["Burn", "Poison", "Freeze", "Slow"];

function splitClauses(text: string): string[] {
  return text
    .split(/(?<=\.)\s+|\n+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function deriveMechanics(text: string): Mechanic[] {
  const found: Mechanic[] = [];

  for (const clause of splitClauses(text)) {
    const isCleanse = CLEANSE_PATTERN.test(clause);
    for (const rule of MECHANIC_RULES) {
      if (!rule.pattern.test(clause)) continue;
      // A cleanse clause naming a status means the item counters it.
      if (isCleanse && STATUS_MECHANICS.includes(rule.mechanic)) continue;
      found.push(rule.mechanic);
    }
  }

  // "Damage" is implied by burn/poison but adding it everywhere makes every
  // damage-over-time item look like a direct-damage win condition, which
  // flattens the archetype signal. Only keep it when it stands alone.
  if (
    found.includes("Damage") &&
    (found.includes("Burn") || found.includes("Poison")) &&
    !/\bdeal(s)?\s+\d|\bdeal(s)?\s+damage\b/i.test(text)
  ) {
    return unique(found.filter((m) => m !== "Damage"));
  }
  return unique(found);
}

/**
 * A clause that hands a mechanic to *other* items ("Your Weapons gain damage")
 * rather than doing it itself.
 */
const GRANT_CLAUSE_PATTERN =
  /\b(?:[Yy]our|[Aa]ll|[Oo]ther|[Aa]djacent|[Ee]ach)\s+[A-Z][a-zA-Z]+s?\b[^.]*\b(?:gain|get|have)s?\b/;

/**
 * True when the item deals offense under its own power, as opposed to only
 * granting it. A Sharpening Stone that gives your Weapons damage is an
 * Enabler, not a win condition — recommending it to a board with no weapons
 * would be exactly backwards.
 */
function hasDirectOffense(text: string): boolean {
  return splitClauses(text).some((clause) => {
    if (GRANT_CLAUSE_PATTERN.test(clause)) return false;
    if (CLEANSE_PATTERN.test(clause)) return false;
    return /\bdamage\b|\bburn\b|\bpoison\b/i.test(clause);
  });
}

function deriveRoles(
  text: string,
  mechanics: Mechanic[],
  tags: string[],
): Role[] {
  const roles = new Set<Role>();

  if (
    (mechanics.includes("Damage") ||
      mechanics.includes("Burn") ||
      mechanics.includes("Poison")) &&
    hasDirectOffense(text)
  ) {
    roles.add("WinCondition");
  }
  if (mechanics.includes("Heal") || mechanics.includes("Regen") || mechanics.includes("Lifesteal")) {
    roles.add("Sustain");
  }
  if (mechanics.includes("Shield")) roles.add("Defense");
  if (mechanics.includes("Freeze") || mechanics.includes("Slow") || mechanics.includes("Destroy")) {
    roles.add("Control");
  }
  if (
    mechanics.includes("Haste") ||
    mechanics.includes("Charge") ||
    mechanics.includes("Cooldown") ||
    mechanics.includes("Multicast") ||
    mechanics.includes("Ammo")
  ) {
    roles.add("Enabler");
  }
  if (mechanics.includes("Income") || mechanics.includes("Value") || tags.includes("Loot")) {
    roles.add("Economy");
  }
  if (SCALING_PATTERN.test(text)) roles.add("Scaling");
  // Cleansing a status you're suffering is defensive upkeep, so the item still
  // earns a Sustain role even though the status mechanic was filtered out.
  if (CLEANSE_PATTERN.test(text) && STATUS_MECHANICS.some((m) => text.toLowerCase().includes(m.toLowerCase()))) {
    roles.add("Sustain");
  }

  return [...roles];
}

/**
 * An item that buffs a tag is an enabler even if its own tooltip never deals
 * damage — a "your Weapons gain +damage" item is doing enabler work.
 */
const BUFF_CAPTURE_STOPWORDS =
  /^(item|items|thing|things|other|adjacent|each|all|your|this|these|those|enemy|hero|player)$/i;

function deriveBuffsTags(text: string): string[] {
  return unique(
    collect(BUFFS_TAG_PATTERNS, text)
      .map((word) => word.replace(/s$/, ""))
      // Type tags are printed capitalised on cards; that plus a stopword list
      // is what separates "your Weapons gain" from "your items gain".
      .filter((word) => /^[A-Z]/.test(word) && word.length > 2)
      .filter((word) => !BUFF_CAPTURE_STOPWORDS.test(word))
      // A mechanic name here means we caught "your Burn deals..." — that's
      // scaling, not a type-tag buff, and deriveScalesWith handles it.
      .filter((word) => !toMechanic(word)),
  );
}

function deriveScalesWith(text: string): Mechanic[] {
  return unique(
    collect(SCALES_WITH_PATTERNS, text)
      .map(toMechanic)
      .filter((m): m is Mechanic => m !== null),
  );
}

function deriveRequires(text: string, own: Mechanic[]): Mechanic[] {
  return unique(
    collect(REQUIRES_PATTERNS, text)
      .map(toMechanic)
      .filter((m): m is Mechanic => m !== null)
      // If the item produces the thing itself, it isn't a dependency.
      .filter((m) => !own.includes(m)),
  );
}

/** Interpret one raw item. */
export function enrichItem(raw: RawItem): Item {
  const text = raw.tooltips.join(" ");
  const mechanics = deriveMechanics(text);
  const buffsTags = deriveBuffsTags(text);
  const roles = deriveRoles(text, mechanics, raw.tags);

  if (buffsTags.length > 0) roles.push("Enabler");

  return {
    ...raw,
    mechanics,
    roles: unique(roles),
    buffsTags,
    scalesWith: deriveScalesWith(text),
    requires: deriveRequires(text, mechanics),
  };
}

export function enrichAll(raws: RawItem[]): Item[] {
  return raws.map(enrichItem);
}
