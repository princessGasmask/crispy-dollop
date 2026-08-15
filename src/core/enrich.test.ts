import { describe, expect, it } from "vitest";
import { enrichItem } from "./enrich.js";
import type { RawItem } from "./types.js";

function raw(tooltips: string[], overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "test",
    name: "Test",
    hero: "Common",
    size: "Small",
    startingTier: "Bronze",
    tags: [],
    tooltips,
    ...overrides,
  };
}

describe("mechanic detection", () => {
  it("reads mechanics off tooltip text", () => {
    const item = enrichItem(raw(["Burn the enemy.", "Gain shield."]));
    expect(item.mechanics).toContain("Burn");
    expect(item.mechanics).toContain("Shield");
  });

  it("does not fire on substrings of unrelated words", () => {
    // "slowly" must not read as Slow, "surcharge" must not read as Charge.
    const item = enrichItem(raw(["This slowly accrues a surcharge."]));
    expect(item.mechanics).not.toContain("Slow");
    expect(item.mechanics).not.toContain("Charge");
  });

  it("keeps damage-over-time items out of the direct-damage bucket", () => {
    const item = enrichItem(raw(["Apply poison to the enemy."]));
    expect(item.mechanics).toContain("Poison");
    expect(item.mechanics).not.toContain("Damage");
  });

  it("keeps Damage when the item also hits directly", () => {
    const item = enrichItem(raw(["Deal 20 damage.", "Burn the enemy."]));
    expect(item.mechanics).toContain("Damage");
    expect(item.mechanics).toContain("Burn");
  });
});

describe("role assignment", () => {
  it("treats damage as a win condition and healing as sustain", () => {
    expect(enrichItem(raw(["Deal damage."])).roles).toContain("WinCondition");
    expect(enrichItem(raw(["Heal 30."])).roles).toContain("Sustain");
  });

  it("marks permanent growth as scaling", () => {
    const item = enrichItem(raw(["This gains 5 damage permanently."]));
    expect(item.roles).toContain("Scaling");
  });

  it("counts tag-buffing items as enablers even with no offense of their own", () => {
    const item = enrichItem(raw(["Your Weapons gain +5 damage for the fight."]));
    expect(item.roles).toContain("Enabler");
  });
});

describe("tag buff parsing", () => {
  it("captures the buffed type tag", () => {
    const item = enrichItem(raw(["Your Aquatic items gain haste for 2 seconds."]));
    expect(item.buffsTags).toContain("Aquatic");
  });

  it("ignores generic 'your items' phrasing", () => {
    const item = enrichItem(raw(["Your items gain shield."]));
    expect(item.buffsTags).toHaveLength(0);
  });

  it("does not treat a mechanic name as a type tag", () => {
    const item = enrichItem(raw(["Your Burn deals extra damage."]));
    expect(item.buffsTags).not.toContain("Burn");
  });

  it("resets regex state between items", () => {
    // Module-level global regexes silently skip matches if lastIndex leaks.
    const first = enrichItem(raw(["Your Weapons gain damage."]));
    const second = enrichItem(raw(["Your Weapons gain damage."]));
    expect(second.buffsTags).toEqual(first.buffsTags);
    expect(second.buffsTags).toContain("Weapon");
  });
});

describe("scaling and dependencies", () => {
  it("captures what an item scales off", () => {
    const item = enrichItem(raw(["Deal damage equal to your shield."]));
    expect(item.scalesWith).toContain("Shield");
  });

  it("does not list a dependency the item satisfies itself", () => {
    const item = enrichItem(
      raw(["Freeze an enemy item.", "Deal double damage if the target is frozen."]),
    );
    expect(item.requires).not.toContain("Freeze");
  });
});

describe("cleanse handling", () => {
  it("does not treat cleansing a status as applying it", () => {
    const item = enrichItem(raw(["Gain shield.", "Cleanse burn from yourself."]));
    expect(item.mechanics).not.toContain("Burn");
    expect(item.roles).not.toContain("WinCondition");
  });

  it("treats a cleanse as sustain", () => {
    const item = enrichItem(raw(["Cleanse poison and burn from yourself."]));
    expect(item.roles).toContain("Sustain");
  });

  it("still detects a status applied in a different clause", () => {
    const item = enrichItem(
      raw(["Burn the enemy.", "Cleanse poison from yourself."]),
    );
    expect(item.mechanics).toContain("Burn");
    expect(item.mechanics).not.toContain("Poison");
  });

  it("does not treat immunity as application", () => {
    const item = enrichItem(raw(["You are immune to freeze and slow."]));
    expect(item.mechanics).not.toContain("Freeze");
    expect(item.mechanics).not.toContain("Slow");
  });
});

describe("direct offense vs granted offense", () => {
  it("does not call a weapon-buffer a win condition", () => {
    const item = enrichItem(raw(["Your Weapons gain damage permanently."]));
    expect(item.roles).not.toContain("WinCondition");
    expect(item.roles).toContain("Enabler");
  });

  it("still calls a weapon a win condition", () => {
    expect(enrichItem(raw(["Deal 20 damage."])).roles).toContain("WinCondition");
  });

  it("handles an item that both deals and grants damage", () => {
    const item = enrichItem(
      raw(["Deal 10 damage.", "Your Weapons gain damage."]),
    );
    expect(item.roles).toContain("WinCondition");
    expect(item.roles).toContain("Enabler");
  });
});
