import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { liveQuery } from 'dexie'
import {
  ArrowRight, BookOpen, CircleHelp, Cloud, Coffee, Layers3, LayoutGrid, Plus, Settings,
  Sparkles, Target, Wifi, WifiOff,
} from 'lucide-react'
import { db } from './db'
import { colors, emptySnapshot, schedule, type Card, type Color, type Grade, type Subject } from './model'
import { VaultSettings } from './VaultSettings'

const navigation = [
  { path: '/', label: 'Overview', icon: LayoutGrid },
  { path: '/library', label: 'Library', icon: BookOpen },
  { path: '/review', label: 'Review', icon: Layers3 },
  { path: '/settings', label: 'Settings', icon: Settings },
]

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

type Editor = { kind: 'subject'; subject?: Subject } | { kind: 'card'; subjectId: string; card?: Card }
type Deletion = { kind: 'subjects' | 'cards'; id: string; label: string }

export function App() {
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [ready, setReady] = useState(false)
  const [offlineFailed, setOfflineFailed] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/')
  const [subjectId, setSubjectId] = useState('')
  const [editor, setEditor] = useState<Editor>()
  const [deletion, setDeletion] = useState<Deletion>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [clock, setClock] = useState(Date.now)
  const online = useOnline()

  useEffect(() => {
    const subscription = liveQuery(() => db.snapshot()).subscribe({
      next(value) { setSnapshot(value); setReady(true) },
      error() { setStorageError(true); setReady(true) },
    })
    const pop = () => {
      setPath(location.pathname.replace(/\/$/, '') || '/')
      setEditor(undefined)
      setDeletion(undefined)
      setNotice('')
      setError('')
    }
    const updateClock = () => setClock(Date.now())
    const offlineError = () => setOfflineFailed(true)
    const timer = window.setInterval(updateClock, 15_000)
    document.addEventListener('vault-offline-failed', offlineError)
    window.addEventListener('popstate', pop)
    window.addEventListener('focus', updateClock)
    return () => {
      subscription.unsubscribe()
      window.clearInterval(timer)
      document.removeEventListener('vault-offline-failed', offlineError)
      window.removeEventListener('popstate', pop)
      window.removeEventListener('focus', updateClock)
    }
  }, [])

  const { subjects, cards, cardsBySubject } = useMemo(() => {
    const subjects = snapshot.subjects.filter(row => !row.deleted).sort((a, b) => a.name.localeCompare(b.name))
    const cardsBySubject = new Map<string, Card[]>(subjects.map(row => [row.id, []]))
    const cards = snapshot.cards.filter(row => !row.deleted && cardsBySubject.has(row.subjectId))
    for (const card of cards) cardsBySubject.get(card.subjectId)!.push(card)
    return { subjects, cards, cardsBySubject }
  }, [snapshot])
  const due = cards.filter(row => row.dueAt <= clock).sort((a, b) => a.dueAt - b.dueAt)
  const selected = subjects.find(row => row.id === subjectId) ?? subjects[0]
  const deck = selected ? cardsBySubject.get(selected.id)! : []
  const activePath = navigation.some(item => item.path === path) ? path : '/'

  function go(next: string, focus = true) {
    if (next !== path) history.pushState(null, '', next)
    setPath(next)
    setEditor(undefined)
    setDeletion(undefined)
    setNotice('')
    setError('')
    window.scrollTo(0, 0)
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus())
  }

  function visit(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go(next)
  }

  function openEditor(next: Editor) {
    go('/library', false)
    setEditor(next)
  }

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setClock(Date.now())
      setNotice(message)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The change could not be saved. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!editor) return
    const primary = String(form.get(editor.kind === 'subject' ? 'name' : 'question')).trim()
    const answer = String(form.get('answer') ?? '').trim()
    if (!primary || (editor.kind === 'card' && !answer)) {
      setError('Fill in each field before saving.')
      return
    }
    const success = await run(async () => {
      if (editor.kind === 'subject') {
        setSubjectId(await db.saveSubject(primary, String(form.get('color')) as Color, editor.subject?.id))
      } else {
        await db.saveCard(editor.subjectId, primary, answer, editor.card?.id)
      }
    }, editor.kind === 'subject' ? 'Subject saved.' : 'Card saved.')
    if (success) {
      setEditor(undefined)
      requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus())
    }
  }

  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(clock)
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar">
        <a className="brand" href="/" onClick={event => visit(event, '/')}>
          <span className="brand-icon"><Layers3 size={20} aria-hidden="true" /></span>
          <span>StudyVault<small>REVISION WORKSPACE</small></span>
        </a>
        <nav aria-label="Workspace">
          <p className="nav-label">WORKSPACE</p>
          {navigation.map(({ path: link, label, icon: Icon }) => (
            <a key={link} href={link} onClick={event => visit(event, link)} aria-current={activePath === link ? 'page' : undefined}>
              <Icon size={19} aria-hidden="true" /><span>{label}</span>
              {link === '/review' && due.length > 0 && <span className="nav-count">{due.length}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" /> Local-first workspace</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>{date}</span>
          <span className="connection">{online ? <Wifi size={16} /> : <WifiOff size={16} />}
            {online ? 'Local workspace' : 'Working offline'}</span>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {error && <p className="message error" role="alert">{error}</p>}
          {offlineFailed && <p className="message error" role="alert">Offline setup could not finish. Reopen StudyVault online to try again.</p>}
          <div role="status" className={notice ? 'message success' : 'visually-hidden'}>{notice}</div>
          {!ready ? <h1 tabIndex={-1}>Opening your vault…</h1>
            : storageError ? <><h1 tabIndex={-1}>Vault storage is unavailable</h1><p>Enable browser storage for this site and reload to open your vault.</p></>
            : activePath === '/' ? <>
              <section className="hero">
                <div className="hero-decoration" aria-hidden="true"><Layers3 size={220} strokeWidth={0.6} /></div>
                <p className="eyebrow"><Sparkles size={15} /> YOUR STUDY SPACE</p>
                <h1 tabIndex={-1}>Make it stick.</h1>
                <p>Build a deck, practise active recall, and make a little progress every day.</p>
                <button className="primary" onClick={() => due.length ? go('/review') : openEditor(subjects.length
                  ? { kind: 'card', subjectId: selected.id } : { kind: 'subject' })}>
                  {due.length ? 'Start review' : subjects.length ? 'Add a flashcard' : 'Create your first subject'} <ArrowRight size={18} />
                </button>
              </section>
              <section className="stats" aria-label="Study at a glance">
                <Stat icon={<Target size={19} />} value={due.length} label="Due now" tone="amber" />
                <Stat icon={<BookOpen size={19} />} value={subjects.length} label="Subjects" tone="fern" />
                <Stat icon={<Layers3 size={19} />} value={cards.length} label="Flashcards" tone="iris" />
              </section>
              <section>
                <div className="section-heading"><div><p className="eyebrow">ORGANISE</p><h2>Your subjects</h2></div>
                  <button className="secondary" onClick={() => openEditor({ kind: 'subject' })}><Plus size={17} /> New subject</button>
                </div>
                {subjects.length ? <div className="subject-grid">
                  {subjects.map(subject => <button className="subject-tile panel" key={subject.id} onClick={() => { setSubjectId(subject.id); go('/library') }}>
                    <span className={`tile-icon ${subject.color}`}><BookOpen size={20} /></span>
                    <span><strong>{subject.name}</strong><small>{cardsBySubject.get(subject.id)!.length} cards</small></span>
                    <ArrowRight size={17} className="tile-arrow" />
                  </button>)}
                </div> : <div className="empty panel"><BookOpen size={28} /><h3>A fresh start</h3><p>Add a subject to start collecting what you want to remember.</p></div>}
              </section>
            </> : activePath === '/library' ? <>
              <div className="section-heading page-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h1 tabIndex={-1}>Library</h1><p>Organise your subjects and turn notes into flashcards.</p></div>
                <button className="primary" onClick={() => openEditor({ kind: 'subject' })}><Plus size={17} /> New subject</button>
              </div>
              {editor && <form className="panel editor" onSubmit={save} key={editor.kind === 'subject' ? editor.subject?.id ?? 'subject' : editor.card?.id ?? 'card'}>
                <h2>{editor.kind === 'subject' ? editor.subject ? 'Edit subject' : 'New subject' : editor.card ? 'Edit flashcard' : 'New flashcard'}</h2>
                {editor.kind === 'subject' ? <>
                  <label>Subject name<input name="name" required maxLength={80} defaultValue={editor.subject?.name}
                    ref={node => { if (node && !node.dataset.focused) { node.dataset.focused = 'true'; node.focus() } }} /></label>
                  <label>Colour<select name="color" defaultValue={editor.subject?.color ?? 'fern'}>
                    {colors.map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}
                  </select></label>
                </> : <>
                  <label>Question<textarea name="question" rows={3} required maxLength={3000} defaultValue={editor.card?.question}
                    ref={node => { if (node && !node.dataset.focused) { node.dataset.focused = 'true'; node.focus() } }} /></label>
                  <label>Answer<textarea name="answer" rows={4} required maxLength={5000} defaultValue={editor.card?.answer} /></label>
                </>}
                <div className="actions"><button className="primary" disabled={busy}>{editor.kind === 'subject' ? 'Save subject' : 'Save card'}</button>
                  <button type="button" className="secondary" onClick={() => { setEditor(undefined); setError(''); document.querySelector<HTMLElement>('main h1')?.focus() }}>Cancel</button></div>
              </form>}
              {deletion && <section className="panel editor" aria-labelledby="delete-heading">
                <h2 id="delete-heading" tabIndex={-1} ref={node => node?.focus()}>Delete {deletion.label}?</h2>
                <p>{deletion.kind === 'subjects' ? 'This removes the subject and its cards from your library.' : 'This removes the flashcard and its review progress.'}</p>
                <div className="actions"><button className="danger" disabled={busy} onClick={async () => {
                  if (await run(() => db.remove(deletion.kind, deletion.id), 'Deleted.')) {
                    setDeletion(undefined)
                    document.querySelector<HTMLElement>('main h1')?.focus()
                  }
                }}>Confirm delete</button>
                  <button className="secondary" onClick={() => { setDeletion(undefined); document.querySelector<HTMLElement>('main h1')?.focus() }}>Cancel</button></div>
              </section>}
              {selected ? <>
                <div className="subject-tabs" aria-label="Subjects">
                  {subjects.map(subject => <button className="chip" key={subject.id} aria-pressed={selected.id === subject.id}
                    onClick={() => { setSubjectId(subject.id); setEditor(undefined); setDeletion(undefined); setError('') }}>
                    <span className={`subject-dot ${subject.color}`} />{subject.name}
                  </button>)}
                </div>
                <section className="panel deck">
                  <div className="section-heading">
                    <div><p className="eyebrow">SUBJECT</p><h2>{selected.name}</h2></div>
                    <div className="actions"><button className="secondary" onClick={() => openEditor({ kind: 'subject', subject: selected })}>Edit subject</button>
                      <button className="secondary" onClick={() => { setEditor(undefined); setDeletion({ kind: 'subjects', id: selected.id, label: selected.name }) }}>Delete subject</button>
                      <button className="primary" onClick={() => openEditor({ kind: 'card', subjectId: selected.id })}><Plus size={17} /> Add card</button></div>
                  </div>
                  {deck.length ? <ul className="card-list">
                    {deck.map(card => <li key={card.id}>
                      <div><strong>{card.question}</strong><small>{card.reviews === 0 ? 'New card' : card.dueAt <= clock ? 'Due for review' :
                        `Next review ${new Date(card.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}</small></div>
                      <div className="actions"><button className="secondary" aria-label={`Edit card: ${card.question}`} onClick={() => openEditor({ kind: 'card', subjectId: selected.id, card })}>Edit</button>
                        <button className="secondary" aria-label={`Delete card: ${card.question}`} onClick={() => { setEditor(undefined); setDeletion({ kind: 'cards', id: card.id, label: 'this card' }); window.scrollTo(0, 0) }}>Delete</button></div>
                    </li>)}
                  </ul> : <div className="empty"><Layers3 size={28} /><h3>Start this deck</h3><p>Add a question and its answer to make your first flashcard.</p></div>}
                </section>
              </> : !editor && <div className="panel empty"><BookOpen size={28} /><h2>Your library is empty</h2><p>Create a subject to hold your first deck.</p></div>}
            </> : activePath === '/review' ? <>
              <div className="page-heading"><p className="eyebrow">ACTIVE RECALL</p><h1 tabIndex={-1}>Review</h1>
                <p>{due.length ? `${due.length} ${due.length === 1 ? 'card' : 'cards'} ready to practise.` : 'A little practice goes a long way.'}</p></div>
              {due[0] ? <ReviewCard key={due[0].id + ':' + due[0].updatedAt} card={due[0]} subject={subjects.find(row => row.id === due[0].subjectId)!}
                busy={busy} grade={grade => run(() => db.grade(due[0], grade), 'Review saved.')} />
                : <div className="panel empty"><Coffee size={32} /><h2>{cards.length ? 'You’re all caught up' : 'No cards to review yet'}</h2>
                  <p>{cards.length ? 'Come back when your next cards are due.' : 'Add a flashcard in your library to start practising.'}</p>
                  <button className="secondary" onClick={() => go('/library')}>Open library <ArrowRight size={17} /></button>
                </div>}
            </> : <VaultSettings online={online} />}
        </main>
        <footer className="footer"><CircleHelp size={15} /> Your study data lives in this browser. <Cloud size={15} /> Drive is optional.</footer>
      </div>
    </div>
  )
}

function Stat({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone: string }) {
  return <div className="stat panel"><span className={`tile-icon ${tone}`}>{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>
}

function ReviewCard({ card, subject, busy, grade }: { card: Card; subject: Subject; busy: boolean; grade: (grade: Grade) => Promise<boolean> }) {
  const [revealed, setRevealed] = useState(false)
  const outcomes: { id: Grade; label: string }[] = [{ id: 'again', label: 'Again' }, { id: 'good', label: 'Good' }, { id: 'easy', label: 'Easy' }]
  return <article className="panel review-card">
    <p className="eyebrow"><span className={`subject-dot ${subject.color}`} />{subject.name}</p>
    <p className="review-label">QUESTION</p><h2>{card.question}</h2>
    {revealed ? <><div className="answer" role="region" tabIndex={-1} aria-labelledby="answer-label" aria-describedby="answer-text"
      ref={node => { if (node && !node.dataset.focused) { node.dataset.focused = 'true'; node.focus() } }}>
      <p className="review-label" id="answer-label">ANSWER</p><p id="answer-text">{card.answer}</p></div>
      <div className="grades">{outcomes.map(outcome => <button className="secondary" key={outcome.id} disabled={busy}
        onClick={async () => {
          if (await grade(outcome.id)) requestAnimationFrame(() =>
            (document.querySelector<HTMLElement>('.reveal') ?? document.querySelector<HTMLElement>('main h1'))?.focus())
        }}>
        <strong>{outcome.label}</strong><span>{outcome.id === 'again' ? '10 min' : `${schedule(card, outcome.id, Date.now()).interval}d`}</span>
      </button>)}</div></> : <button className="primary reveal" onClick={() => setRevealed(true)}>Reveal answer <ArrowRight size={17} /></button>}
  </article>
}
