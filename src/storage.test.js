import assert from 'node:assert/strict'
import test from 'node:test'
import { loadGameData, SAVE_KEY, SAVE_VERSION, saveGameData } from './storage.js'

const defaults = { fighters: [{ id: 1, name: 'Default' }], customEvents: ['Default event'], weapons: ['Default weapon'] }

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('round-trips game data through browser storage', () => {
  const storage = memoryStorage()
  const data = { fighters: [{ id: 2, name: 'Saved' }], customEvents: ['Event'], weapons: ['Sword'] }

  assert.equal(saveGameData(data, storage), true)
  assert.deepEqual(loadGameData(defaults, storage), data)
})

test('falls back safely for corrupt or outdated saves', () => {
  assert.deepEqual(loadGameData(defaults, memoryStorage({ [SAVE_KEY]: 'not json' })), defaults)
  assert.deepEqual(loadGameData(defaults, memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: SAVE_VERSION + 1, data: {} }) })), defaults)
})

test('preserves defaults for missing required collections', () => {
  const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: SAVE_VERSION, data: { fighters: [] } }) })
  assert.deepEqual(loadGameData(defaults, storage), { fighters: defaults.fighters, customEvents: defaults.customEvents, weapons: defaults.weapons })
})

test('reports storage write failures without throwing', () => {
  const storage = { setItem: () => { throw new Error('quota exceeded') } }
  assert.equal(saveGameData(defaults, storage), false)
})
