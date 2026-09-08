export const SAVE_KEY = 'last-one-standing:game-data'
export const SAVE_VERSION = 1

export function loadGameData(defaults, storage = globalThis.localStorage) {
  if (!storage) return defaults

  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return defaults

    const save = JSON.parse(raw)
    if (save.version !== SAVE_VERSION || !save.data) return defaults

    return {
      fighters: Array.isArray(save.data.fighters) && save.data.fighters.length ? save.data.fighters : defaults.fighters,
      customEvents: Array.isArray(save.data.customEvents) ? save.data.customEvents : defaults.customEvents,
      weapons: Array.isArray(save.data.weapons) ? save.data.weapons : defaults.weapons,
    }
  } catch {
    return defaults
  }
}

export function saveGameData(data, storage = globalThis.localStorage) {
  if (!storage) return false

  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, savedAt: new Date().toISOString(), data }))
    return true
  } catch {
    return false
  }
}
