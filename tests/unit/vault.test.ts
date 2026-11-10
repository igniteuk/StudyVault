import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from '../../src/db'
import { DAY, emptySnapshot, mergeSnapshots, parseSnapshot, schedule, type Card, type Snapshot } from '../../src/model'

const card: Card = { id: 'c', subjectId: 's', question: 'Prompt', answer: 'Answer', dueAt: 0, interval: 2, reviews: 1, updatedAt: 100 }
let vault: Vault

beforeEach(() => { vault = new Vault(`test-${crypto.randomUUID()}`) })
afterEach(() => vault.delete())

describe('Review scheduler', () => {
  it('schedules all grades and bounds intervals', () => {
    expect(schedule(card, 'again', 0)).toEqual({ dueAt: 600_000, interval: 0, reviews: 2 })
    expect(schedule(card, 'good', 0)).toMatchObject({ dueAt: 4 * DAY, interval: 4 })
    expect(schedule(card, 'easy', 0)).toMatchObject({ dueAt: 5 * DAY, interval: 5 })
    expect(schedule({ ...card, interval: 365 }, 'easy', 0).interval).toBe(365)
  })
})

describe('Snapshot validation and merge', () => {
  it('rejects malformed, duplicate and future-dated records', () => {
    expect(() => parseSnapshot({ version: 2 })).toThrow('invalid')
    expect(() => parseSnapshot({ ...emptySnapshot, cards: [card, card] })).toThrow('invalid')
    expect(() => parseSnapshot({ ...emptySnapshot, cards: [{ ...card, updatedAt: Date.now() + 400 * DAY }] })).toThrow('invalid')
    expect(parseSnapshot({ ...emptySnapshot, cards: [{ ...card, privateKey: 'extra' }] }).cards[0]).toEqual(card)
  })

  it('converges for ties and preserves deletion markers', () => {
    const left: Snapshot = { ...emptySnapshot, cards: [card] }
    const right: Snapshot = { ...emptySnapshot, cards: [{ ...card, deleted: true }] }
    expect(mergeSnapshots(left, right)).toEqual(mergeSnapshots(right, left))
    expect(mergeSnapshots(left, right).cards[0].deleted).toBe(true)
    const edited: Snapshot = { ...emptySnapshot, cards: [{ ...card, answer: 'A new answer' }] }
    expect(mergeSnapshots(left, edited)).toEqual(mergeSnapshots(edited, left))
  })
})

describe('IndexedDB integration', () => {
  it('persists a graded card across database reopen and edits', async () => {
    const subject = await vault.saveSubject('Biology', 'fern')
    const id = await vault.saveCard(subject, 'Question', 'Answer')
    await vault.grade((await vault.cards.get(id))!, 'good')
    vault.close()
    await vault.open()
    await vault.saveCard(subject, 'New prompt', 'Answer', id)
    expect(await vault.cards.get(id)).toMatchObject({ reviews: 1, question: 'New prompt', interval: 1 })
  })

  it('rejects stale grading and prevents writes into removed subjects', async () => {
    const subject = await vault.saveSubject('Biology', 'fern')
    const id = await vault.saveCard(subject, 'Question', 'Answer')
    const before = (await vault.cards.get(id))!
    await vault.grade(before, 'good')
    await expect(vault.grade(before, 'easy')).rejects.toThrow('changed')
    await vault.remove('subjects', subject)
    await expect(vault.saveCard(subject, 'Question', 'Answer')).rejects.toThrow('deleted')
    expect((await vault.snapshot()).subjects[0].deleted).toBe(true)
  })

  it('keeps independent changes and does not resurrect deleted cards', async () => {
    const id = await vault.saveSubject('Biology', 'fern')
    const cardId = await vault.saveCard(id, 'Question', 'Answer')
    const old = await vault.snapshot()
    await vault.remove('cards', cardId)
    await vault.merge({ ...old, subjects: [...old.subjects, { id: 'new', updatedAt: 1, color: 'iris', name: 'Physics' }] })
    const result = await vault.snapshot()
    expect(result.cards[0].deleted).toBe(true)
    expect(result.subjects.map(row => row.name).sort()).toEqual(['Biology', 'Physics'])
  })

  it('can grade a card imported at the maximum review count', async () => {
    await vault.merge(parseSnapshot({
      version: 1,
      subjects: [{ id: 's', updatedAt: 100, name: 'Biology', color: 'fern' }],
      cards: [{ ...card, reviews: 999_999_999 }],
    }))
    await vault.grade((await vault.snapshot()).cards[0], 'good')
    expect((await vault.snapshot()).cards[0].reviews).toBe(999_999_999)
  })
})
