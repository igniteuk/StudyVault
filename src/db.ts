import Dexie, { type Table } from 'dexie'
import { mergeSnapshots, parseSnapshot, schedule, type Card, type Color, type Grade, type Snapshot, type Subject } from './model'

export class Vault extends Dexie {
  subjects!: Table<Subject, string>
  cards!: Table<Card, string>
  meta!: Table<{ key: string; value: string }, string>

  constructor(name = 'studyvault') {
    super(name)
    this.version(1).stores({ subjects: 'id', cards: 'id, subjectId, dueAt', meta: 'key' })
  }

  async snapshot(): Promise<Snapshot> {
    return this.transaction('r', this.subjects, this.cards, async () =>
      parseSnapshot({ version: 1, subjects: await this.subjects.toArray(), cards: await this.cards.toArray() }, false))
  }

  async merge(remote: Snapshot) {
    return this.transaction('rw', this.subjects, this.cards, async () => {
      const current = await this.snapshot()
      const merged = mergeSnapshots(current, remote)
      const subjects = new Map(current.subjects.map(row => [row.id, JSON.stringify(row)]))
      const cards = new Map(current.cards.map(row => [row.id, JSON.stringify(row)]))
      await this.subjects.bulkPut(merged.subjects.filter(row => subjects.get(row.id) !== JSON.stringify(row)))
      await this.cards.bulkPut(merged.cards.filter(row => cards.get(row.id) !== JSON.stringify(row)))
      return merged
    })
  }

  async saveSubject(name: string, color: Color, id = crypto.randomUUID() as string) {
    return this.transaction('rw', this.subjects, async () => {
      const previous = await this.subjects.get(id)
      if (previous?.deleted) throw new Error('This subject was deleted.')
      await this.subjects.put({ id, name: name.trim(), color, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) })
      return id
    })
  }

  async saveCard(subjectId: string, question: string, answer: string, id = crypto.randomUUID() as string) {
    return this.transaction('rw', this.subjects, this.cards, async () => {
      const subject = await this.subjects.get(subjectId)
      const previous = await this.cards.get(id)
      if (!subject || subject.deleted || previous?.deleted) throw new Error('This card or subject was deleted.')
      const now = Date.now()
      const progress = previous ?? { dueAt: now, interval: 0, reviews: 0 }
      await this.cards.put({
        id, subjectId, question: question.trim(), answer: answer.trim(),
        dueAt: progress.dueAt, interval: progress.interval, reviews: progress.reviews,
        updatedAt: Math.max(now, (previous?.updatedAt ?? 0) + 1),
      })
      return id
    })
  }

  async grade(card: Card, grade: Grade) {
    return this.transaction('rw', this.cards, this.subjects, async () => {
      const current = await this.cards.get(card.id)
      const subject = await this.subjects.get(card.subjectId)
      if (!current || current.deleted || !subject || subject.deleted || current.updatedAt !== card.updatedAt) {
        throw new Error('This card changed. Reopen it to continue.')
      }
      const now = Date.now()
      await this.cards.put({ ...current, ...schedule(current, grade, now), updatedAt: Math.max(now, current.updatedAt + 1) })
    })
  }

  async remove(kind: 'subjects' | 'cards', id: string) {
    const table = this[kind]
    await this.transaction('rw', table, async () => {
      const row = await table.get(id)
      if (row && !row.deleted) {
        await table.update(id, { deleted: true, updatedAt: Math.max(Date.now(), row.updatedAt + 1) })
      }
    })
  }

  async deviceId() {
    return this.transaction('rw', this.meta, async () => {
      const existing = await this.meta.get('device')
      if (existing) return existing.value
      const value = crypto.randomUUID()
      await this.meta.put({ key: 'device', value })
      return value
    })
  }
}

export const db = new Vault()
