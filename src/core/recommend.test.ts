import { describe, expect, it } from "vitest";
import { enrichAll } from "./enrich.js";
import { analyzeBoard } from "./board.js";
import { recommend } from "./recommend.js";
import type { RawItem } from "./types.js";
import seed from "../data/seed-items.json";

const pool = enrichAll((seed as { items: RawItem[] }).items);

function pick(...ids: string[]) {
  return ids.map((id) => {
    const item = pool.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`seed dataset is missing ${id}`);
    return item;
  });
}

function names(result: ReturnType<typeof recommend>): string[] {
  return result.recommendations.map((r) => r.item.name);
}

describe("board analysis", () => {
  it("infers the hero from hero-specific items", () => {
    expect(analyzeBoard(pick("cutlass", "anchor")).hero).toBe("Vanessa");
  });

  it("reports no hero when the board mixes heroes", () => {
    expect(analyzeBoard(pick("cutlass", "lemonade-stand")).hero).toBeNull();
  });

  it("ignores Common items when inferring the hero", () => {
    expect(analyzeBoard(pick("cutlass", "bar-of-gold")).hero).toBe("Vanessa");
  });

  it("counts board slots by item size", () => {
    // Cutlass (Medium, 2) + Cannon (Large, 3) + Chum (Small, 1).
    const analysis = analyzeBoard(pick("cutlass", "cannon", "chum"));
    expect(analysis.slotsUsed).toBe(6);
    expect(analysis.slotsFree).toBe(4);
  });

  it("warns when the board is over capacity", () => {
    const analysis = analyzeBoard(
      pick("cannon", "submarine", "laser-array", "cutlass"),
    );
    expect(analysis.slotsUsed).toBeGreaterThan(10);
    expect(analysis.warnings.some((w) => w.includes("only holds"))).toBe(true);
  });

  it("flags a board with no damage at all", () => {
    const analysis = analyzeBoard(pick("bandages", "lemonade-stand"));
    expect(analysis.warnings.some((w) => w.includes("win condition"))).toBe(true);
  });
});

describe("recommendations", () => {
  it("returns nothing owned", () => {
    const result = recommend(pick("cutlass"), pool);
    expect(names(result)).not.toContain("Cutlass");
  });

  it("respects hero legality", () => {
    const result = recommend(pick("cutlass"), pool, { limit: 100 });
    // Vanessa board: no Pygmalien or Dooley items should be suggested.
    for (const rec of result.recommendations) {
      expect(["Vanessa", "Common"]).toContain(rec.item.hero);
    }
  });

  it("suggests tag-buffers for the tags you actually run", () => {
    // Two Aquatic items should pull Aquatic payoffs to the top.
    const result = recommend(pick("anchor", "jellyfish"), pool, { limit: 6 });
    expect(names(result)).toContain("Pirate Flag");
  });

  it("suggests items that benefit from a buffer you already have", () => {
    // Spyglass buffs Weapons, so Weapons should be recommended.
    const result = recommend(pick("spyglass"), pool, { limit: 8 });
    const top = result.recommendations.slice(0, 8).map((r) => r.item);
    expect(top.some((item) => item.tags.includes("Weapon"))).toBe(true);
  });

  it("explains every recommendation", () => {
    const result = recommend(pick("cutlass", "spyglass"), pool);
    for (const rec of result.recommendations) {
      expect(rec.reasons.length).toBeGreaterThan(0);
      for (const reason of rec.reasons) expect(reason.text).not.toBe("");
    }
  });

  it("prioritises a missing win condition on a board with none", () => {
    const result = recommend(pick("bandages", "leather-vest"), pool, { limit: 5 });
    const top = result.recommendations.slice(0, 5).map((r) => r.item);
    expect(top.some((item) => item.roles.includes("WinCondition"))).toBe(true);
  });

  it("penalises items that don't fit the remaining space", () => {
    // Fill the board to 9 slots, then a Large item has nowhere to go.
    const full = pick("cannon", "submarine", "cutlass", "chum");
    const result = recommend(full, pool, { limit: 100 });
    const large = result.recommendations.find((r) => r.item.size === "Large");
    if (large) {
      expect(large.reasons.some((r) => r.kind === "space")).toBe(true);
    }
  });

  it("can hide items that don't fit", () => {
    const full = pick("cannon", "submarine", "cutlass", "chum");
    const result = recommend(full, pool, {
      limit: 100,
      hideUnfittable: true,
    });
    expect(result.recommendations.every((r) => r.item.size === "Small")).toBe(true);
  });

  it("returns no recommendations for an empty board without crashing", () => {
    const result = recommend([], pool);
    expect(result.recommendations).toEqual([]);
    expect(result.cuts).toEqual([]);
  });
});

describe("cut suggestions", () => {
  it("flags an item pulling against the rest of the board", () => {
    // A committed Aquatic/weapon board with a lone economy property on it.
    const board = pick("anchor", "jellyfish", "pirate-flag", "bar-of-gold");
    const result = recommend(board, pool);
    expect(result.cuts.map((c) => c.item.name)).toContain("Bar of Gold");
  });

  it("does not flag an off-archetype item that covers a scarce role", () => {
    // Bandages is the only sustain on an otherwise all-weapon board.
    const board = pick("cutlass", "cannon", "bandages");
    const result = recommend(board, pool);
    expect(result.cuts.map((c) => c.item.name)).not.toContain("Bandages");
  });
});
