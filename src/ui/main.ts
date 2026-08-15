import { dataset } from "../data/loadItems.js";
import { recommend, type Reason } from "../core/recommend.js";
import { BOARD_SLOTS, SIZE_SLOTS, type Hero, type Item } from "../core/types.js";

const HEROES: Hero[] = [
  "Vanessa",
  "Pygmalien",
  "Dooley",
  "Mak",
  "Stelle",
  "Jules",
];

interface State {
  ownedIds: string[];
  heroFilter: Hero | "auto";
  query: string;
  highlighted: number;
}

const STORAGE_KEY = "bazaar-recommender-board";

const state: State = {
  ownedIds: loadSavedBoard(),
  heroFilter: "auto",
  query: "",
  highlighted: 0,
};

const byId = new Map(dataset.items.map((item) => [item.id, item]));

function loadSavedBoard(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveBoard(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ownedIds));
  } catch {
    // Private-browsing or storage-disabled; the app works fine without it.
  }
}

function owned(): Item[] {
  return state.ownedIds
    .map((id) => byId.get(id))
    .filter((item): item is Item => item !== undefined);
}

function searchPool(query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ownedSet = new Set(state.ownedIds);
  return dataset.items
    .filter((item) => !ownedSet.has(item.id))
    .filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      // Prefix matches first — typing "can" should surface Cannon, not
      // everything with "can" buried in a tag.
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    })
    .slice(0, 12);
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

function itemMeta(item: Item): string {
  const bits = [item.hero === "Common" ? "Any hero" : item.hero, item.size];
  if (item.tags.length > 0) bits.push(item.tags.join(" · "));
  return bits.join(" • ");
}

function renderSearch(): string {
  const results = searchPool(state.query);
  const list =
    results.length > 0
      ? `<div class="results" role="listbox">${results
          .map(
            (item, index) => `
        <button role="option" data-add="${item.id}" class="${index === state.highlighted ? "active" : ""}">
          <span>${escapeHtml(item.name)}</span>
          <span class="meta">${escapeHtml(itemMeta(item))}</span>
        </button>`,
          )
          .join("")}</div>`
      : "";

  return `
    <div class="search-wrap">
      <input type="search" id="search" placeholder="Add an item you have…"
             autocomplete="off" value="${escapeHtml(state.query)}" />
      ${list}
    </div>`;
}

function renderOwned(): string {
  const items = owned();
  const used = items.reduce((sum, i) => sum + SIZE_SLOTS[i.size], 0);
  const pct = Math.min((used / BOARD_SLOTS) * 100, 100);

  return `
    <div class="slots">
      <span>${used} / ${BOARD_SLOTS} slots</span>
      <div class="slot-bar">
        <div class="slot-fill ${used > BOARD_SLOTS ? "over" : ""}" style="width:${pct}%"></div>
      </div>
    </div>
    <div class="owned-list">
      ${
        items.length === 0
          ? `<p class="empty">Nothing added yet. Search above for the items you're running.</p>`
          : items
              .map(
                (item) => `
          <div class="owned-item">
            <div>
              <div>${escapeHtml(item.name)}</div>
              <div class="meta">${escapeHtml(itemMeta(item))}</div>
            </div>
            <button data-remove="${item.id}" title="Remove" aria-label="Remove ${escapeHtml(item.name)}">×</button>
          </div>`,
              )
              .join("")
      }
    </div>`;
}

function renderAnalysis(result: ReturnType<typeof recommend>): string {
  const { analysis } = result;
  if (analysis.items.length === 0) {
    return `<p class="empty">Add a few items and this fills in with what your board is doing and what it's missing.</p>`;
  }

  const archetypes = analysis.affinities
    .filter((a) => a.affinity >= 0.08)
    .map(
      (a) => `
      <div class="archetype-row">
        <span class="name">${escapeHtml(a.archetype.name)}</span>
        <span class="bar"><span style="width:${(a.affinity * 100).toFixed(0)}%"></span></span>
        <span class="pct">${(a.affinity * 100).toFixed(0)}%</span>
      </div>`,
    )
    .join("");

  const gaps = analysis.gaps
    .map(
      (g) =>
        `<span class="chip">${escapeHtml(g.role)}${g.count === 0 ? " — none" : ` — only ${g.count}`}</span>`,
    )
    .join("");

  return `
    ${
      analysis.hero
        ? `<div class="chips"><span class="chip primary">${escapeHtml(analysis.hero)}</span></div>`
        : ""
    }
    ${archetypes || `<p class="empty">No clear archetype yet.</p>`}
    ${analysis.primary ? `<p class="blurb">${escapeHtml(analysis.primary.archetype.blurb)}</p>` : ""}
    ${gaps ? `<h2 style="margin-top:16px">Gaps</h2><div class="chips">${gaps}</div>` : ""}
    ${
      analysis.warnings.length > 0
        ? `<ul class="warnings">${analysis.warnings
            .map((w) => `<li>${escapeHtml(w)}</li>`)
            .join("")}</ul>`
        : ""
    }`;
}

/**
 * On a small board almost every role reads as a gap, so an unfiltered list
 * repeats "covers X, which your board has none of" on every single card and
 * buries the reason this item in particular is worth looking for. Keep the
 * highest-weight gap line and let synergy and archetype reasons through.
 */
function selectReasons(reasons: Reason[]): Reason[] {
  const picked: Reason[] = [];
  let gapsShown = 0;

  for (const reason of reasons) {
    if (reason.kind === "gap") {
      if (gapsShown >= 1) continue;
      gapsShown++;
    }
    picked.push(reason);
    if (picked.length === 4) break;
  }
  return picked;
}

function renderRecommendations(result: ReturnType<typeof recommend>): string {
  if (result.analysis.items.length === 0) {
    return `<p class="empty">Recommendations appear once you've added at least one item.</p>`;
  }
  if (result.recommendations.length === 0) {
    return `<p class="empty">Nothing in the current dataset synergises with this board. With the seed dataset that's common — run <code>npm run fetch-data</code> for the full item list.</p>`;
  }

  return result.recommendations
    .map(
      (rec, index) => `
      <div class="rec">
        <div class="rec-head">
          <span class="rank">${index + 1}.</span>
          <span class="name">${escapeHtml(rec.item.name)}</span>
          <span class="meta">${escapeHtml(itemMeta(rec.item))}</span>
          <span class="score">${rec.score.toFixed(1)}</span>
        </div>
        <ul>
          ${selectReasons(rec.reasons)
            .map(
              (r) =>
                `<li class="${r.kind}">${escapeHtml(r.text)}</li>`,
            )
            .join("")}
        </ul>
      </div>`,
    )
    .join("");
}

function renderCuts(result: ReturnType<typeof recommend>): string {
  if (result.cuts.length === 0) return "";
  return `
    <div class="panel" style="margin-top:20px">
      <h2>Consider cutting</h2>
      ${result.cuts
        .map(
          (cut) =>
            `<div class="cut"><strong>${escapeHtml(cut.item.name)}</strong> — ${escapeHtml(cut.reason)}</div>`,
        )
        .join("")}
    </div>`;
}

function render(): void {
  const hero = state.heroFilter === "auto" ? undefined : state.heroFilter;
  const result = recommend(owned(), dataset.items, { hero, limit: 15 });

  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <header>
      <h1>Bazaar Build Recommender</h1>
      <p>Add what you're running. Get ranked picks for what to look for next, and why.</p>
    </header>

    ${
      dataset.provenance.source === "seed"
        ? `<div class="banner"><strong>Seed dataset (${dataset.items.length} items).</strong>
             ${escapeHtml(dataset.provenance.note ?? "")}</div>`
        : `<div class="banner" style="border-color:var(--good);background:rgba(111,191,115,0.1)">
             ${dataset.items.length} items from ${escapeHtml(dataset.provenance.source)}
             ${dataset.provenance.fetchedAt ? `· fetched ${escapeHtml(dataset.provenance.fetchedAt.slice(0, 10))}` : ""}</div>`
    }

    <div class="layout">
      <div>
        <div class="panel">
          <h2>Your board</h2>
          <div class="controls">
            <select id="hero">
              <option value="auto">Hero: auto-detect</option>
              ${HEROES.map(
                (h) =>
                  `<option value="${h}" ${state.heroFilter === h ? "selected" : ""}>${h}</option>`,
              ).join("")}
            </select>
          </div>
          ${renderSearch()}
          <div style="margin-top:12px">${renderOwned()}</div>
        </div>

        <div class="panel" style="margin-top:20px">
          <h2>What your board is doing</h2>
          ${renderAnalysis(result)}
        </div>
      </div>

      <div>
        <div class="panel">
          <h2>Look for these</h2>
          ${renderRecommendations(result)}
        </div>
        ${renderCuts(result)}
      </div>
    </div>

    <footer>
      Recommendations are computed from item mechanics and tags, not from exact
      numbers — so they survive balance patches better than they survive a stale
      item list. Refresh the data with <code>npm run fetch-data</code>.
    </footer>`;

  wireEvents();
}

function wireEvents(): void {
  const search = document.getElementById("search") as HTMLInputElement | null;
  if (search) {
    search.addEventListener("input", () => {
      state.query = search.value;
      state.highlighted = 0;
      render();
    });

    search.addEventListener("keydown", (event: KeyboardEvent) => {
      const results = searchPool(state.query);
      if (results.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        state.highlighted =
          (state.highlighted + delta + results.length) % results.length;
        render();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const choice = results[state.highlighted];
        if (choice) addItem(choice.id);
      } else if (event.key === "Escape") {
        state.query = "";
        render();
      }
    });

    // Keep focus and caret across the re-render that typing triggers.
    if (state.query) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  document.querySelectorAll<HTMLElement>("[data-add]").forEach((element) => {
    element.addEventListener("click", () => {
      const id = element.dataset.add;
      if (id) addItem(id);
    });
  });

  document.querySelectorAll<HTMLElement>("[data-remove]").forEach((element) => {
    element.addEventListener("click", () => {
      const id = element.dataset.remove;
      if (!id) return;
      state.ownedIds = state.ownedIds.filter((existing) => existing !== id);
      saveBoard();
      render();
    });
  });

  const heroSelect = document.getElementById("hero") as HTMLSelectElement | null;
  heroSelect?.addEventListener("change", () => {
    state.heroFilter = heroSelect.value as Hero | "auto";
    render();
  });
}

function addItem(id: string): void {
  if (!state.ownedIds.includes(id)) state.ownedIds.push(id);
  state.query = "";
  state.highlighted = 0;
  saveBoard();
  render();
}

render();
