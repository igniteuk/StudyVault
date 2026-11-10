export const DAY = 86_400_000
export const maxBackupBytes = 5 * 1024 * 1024
const maxReviews = 999_999_999
export const colors = ['fern', 'amber', 'iris', 'rose'] as const
export type Color = typeof colors[number]

type RecordBase = { id: string; updatedAt: number; deleted?: true }
export type Subject = RecordBase & { name: string; color: Color }
export type Card = RecordBase & {
  subjectId: string
  question: string
  answer: string
  dueAt: number
  interval: number
  reviews: number
}
export type Snapshot = { version: 1; subjects: Subject[]; cards: Card[] }
export type Grade = 'again' | 'good' | 'easy'

export function schedule(card: Card, grade: Grade, now: number) {
  const interval = grade === 'again' ? 0
    : grade === 'good' ? Math.max(1, Math.ceil(card.interval * 1.6))
      : Math.max(3, Math.ceil(card.interval * 2.5))
  return {
    interval: Math.min(interval, 365),
    dueAt: now + (grade === 'again' ? 10 * 60_000 : Math.min(interval, 365) * DAY),
    reviews: Math.min(maxReviews, card.reviews + 1),
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function string(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && value.trim().length > 0
}

function base(value: unknown): value is Record<string, unknown> & RecordBase {
  return object(value) && string(value.id, 100) && integer(value.updatedAt)
    && value.updatedAt < Number.MAX_SAFE_INTEGER && (value.deleted === undefined || value.deleted === true)
}

function subject(value: unknown): value is Subject {
  return base(value) && string(value.name, 80) && colors.some(color => color === value.color)
}

function card(value: unknown): value is Card {
  return base(value) && string(value.subjectId, 100) && string(value.question, 3000) && string(value.answer, 5000)
    && integer(value.dueAt) && value.dueAt <= 8_640_000_000_000_000
    && integer(value.interval) && value.interval <= 365 && integer(value.reviews) && value.reviews <= maxReviews
}

export function parseSnapshot(value: unknown, validateClock = true): Snapshot {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.subjects) || !Array.isArray(value.cards)
    || !value.subjects.every(subject) || !value.cards.every(card)
    || new Set(value.subjects.map(row => row.id)).size !== value.subjects.length
    || new Set(value.cards.map(row => row.id)).size !== value.cards.length) {
    throw new Error('The backup format is invalid or unsupported.')
  }
  const latest = Date.now() + 366 * DAY
  if (validateClock && (value.subjects.some(row => row.updatedAt >= latest) || value.cards.some(row => row.updatedAt >= latest))) {
    throw new Error('The backup format is invalid. Check the clocks on your devices.')
  }
  // Reconstruct the wire format so imported fields cannot affect conflict resolution.
  return {
    version: 1,
    subjects: value.subjects.map(({ id, updatedAt, deleted, name, color }) => ({ id, updatedAt, deleted, name, color })),
    cards: value.cards.map(({ id, updatedAt, deleted, subjectId, question, answer, dueAt, interval, reviews }) =>
      ({ id, updatedAt, deleted, subjectId, question, answer, dueAt, interval, reviews })),
  }
}

function mergeRows<T extends RecordBase>(left: T[], right: T[]) {
  const merged = new Map(left.map(row => [row.id, row]))
  for (const row of right) {
    const previous = merged.get(row.id)
    if (!previous || row.updatedAt > previous.updatedAt
      || (row.updatedAt === previous.updatedAt
        && (Number(Boolean(row.deleted)) > Number(Boolean(previous.deleted))
          || (row.deleted === previous.deleted && JSON.stringify(row) > JSON.stringify(previous))))) {
      merged.set(row.id, row)
    }
  }
  return [...merged.values()].sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
}

export function mergeSnapshots(left: Snapshot, right: Snapshot): Snapshot {
  return { version: 1, subjects: mergeRows(left.subjects, right.subjects), cards: mergeRows(left.cards, right.cards) }
}

export const emptySnapshot: Snapshot = { version: 1, subjects: [], cards: [] }
