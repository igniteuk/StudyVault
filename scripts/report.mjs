import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const reviewers = ['UI/UX Reviewer', 'QA Reviewer', 'Security Reviewer', 'Performance Reviewer']
const levels = ['Critical', 'High', 'Medium', 'Low']
const hasText = value => typeof value === 'string' && value.trim().length > 0
const date = value => hasText(value) && Number.isFinite(Date.parse(value))
const row = (label, status, evidence) => ({ label, status, evidence })
const pass = 'pass'
const fail = 'fail'
const pending = 'not assessed'
const fields = ['id', 'feature', 'description', 'evidence', 'fix']
const devices = ['iOS Safari', 'Android Chrome', 'Desktop Chromium']
const requiredBrowser = ['accessibility', 'library', 'review', 'offline', 'backup', 'shell']
const limit = 12

function testResults(suite, results = new Map()) {
  for (const spec of suite.specs ?? []) {
    const tag = spec.title.match(/@([a-z]+)$/)?.[1]
    if (!tag) continue
    const status = spec.tests.every(test => test.status === 'expected' && test.results.length > 0
      && test.results.every(run => run.status === 'passed'))
      && spec.tests.length > 0 ? pass : fail
    results.set(tag, results.has(tag) && results.get(tag) !== pass ? fail : status)
  }
  for (const child of suite.suites ?? []) testResults(child, results)
  return results
}

function category(weight, criteria, findings) {
  const assessed = criteria.every(criterion => criterion.status === pass || criterion.status === fail)
  return { weight, score: assessed ? Math.round(100 * criteria.filter(criterion => criterion.status === pass).length / criteria.length) : null, criteria, findings }
}

function accept(entry) {
  return entry?.status === pass && hasText(entry.evidence) && date(entry.date)
}

export function makeReport({ commit, sourceDigest, checks, unit, browser, audit, coverage, build, sizes, review, previous }) {
  const findings = Array.isArray(review?.findings) ? review.findings.filter(item =>
    item && fields.every(field => hasText(item[field])) && reviewers.includes(item.reviewer) && levels.includes(item.severity)
      && ['open', 'fixed', 'in progress'].includes(item.status)
      && (item.reference === undefined || hasText(item.reference))) : []
  const valid = Boolean(Array.isArray(review?.findings) && findings.length === review.findings.length
    && new Set(findings.map(item => item.id)).size === findings.length)
  const reviewDate = date(review?.date) ? review.date : null
  const current = Boolean(valid && reviewDate && review.sourceDigest === sourceDigest)
  const assessments = reviewers.map(name => {
    const entry = current ? review.reviewers?.[name] : null
    return { name, status: accept(entry) ? 'complete' : 'pending', evidence: entry?.evidence ?? null, date: entry?.date ?? null }
  })
  const browserTests = testResults(browser ?? {})
  const browserCriterion = (label, tag) => row(label, browserTests.get(tag) ?? pending, `Playwright @${tag}`)
  const checkCriterion = (label, id) => row(label, checks[id].status === 'skipped' ? pending : checks[id].status, checks[id].command)
  const budget = (label, key, max) => row(label, sizes ? sizes[key] <= max ? pass : fail : pending,
    sizes ? `${sizes[key].toLocaleString('en-GB')} B of ${max.toLocaleString('en-GB')} B budget` : 'Production measurement unavailable')
  const specialist = name => findings.filter(item => item.reviewer === name).map(item => item.id)
  const advisories = audit?.metadata?.vulnerabilities
  const securityReview = assessments.find(item => item.name === 'Security Reviewer')
  const securityVerdict = current ? review.reviewers?.['Security Reviewer']?.verdict : null
  const categories = {
    'UI/UX': category(25, [
      browserCriterion('Layout at desktop and mobile widths and axe scans', 'accessibility'),
      browserCriterion('Keyboard reveal and focus order', 'review'),
      browserCriterion('Labelled library controls and empty state', 'library'),
      row('Settings availability and backup feedback',
        browserTests.has('shell') && browserTests.has('backup')
          ? browserTests.get('shell') === pass && browserTests.get('backup') === pass ? pass : fail : pending,
        'Playwright @shell and @backup'),
    ], specialist('UI/UX Reviewer')),
    Functionality: category(35, [
      browserCriterion('Library CRUD', 'library'),
      browserCriterion('Review scheduling after reload', 'review'),
      browserCriterion('IndexedDB persistence and offline writes', 'offline'),
      browserCriterion('Backup export and merge', 'backup'),
      checkCriterion('Scheduler, merge and Drive integration tests', 'unit'),
    ], specialist('QA Reviewer')),
    Security: category(25, [
      row('No Moderate, High or Critical dependency entries',
        advisories ? advisories.moderate + advisories.high + advisories.critical === 0 ? pass : fail : pending,
        advisories ? `${advisories.moderate} Moderate, ${advisories.high} High, ${advisories.critical} Critical` : 'npm audit results unavailable'),
      browserCriterion('Security headers and local-only startup', 'shell'),
      checkCriterion('Mocked Drive scope, expiry, malformed data and retries', 'unit'),
      row('Specialist review of data handling and deployment controls',
        securityReview.status === 'complete' && [pass, fail].includes(securityVerdict) ? securityVerdict : pending,
        securityReview.evidence ?? 'Current source review required'),
    ], specialist('Security Reviewer')),
    Performance: category(15, [
      budget('Gzip production JavaScript', 'js', 175 * 1024),
      budget('Gzip production CSS', 'css', 30 * 1024),
      budget('Uncompressed precache', 'shell', 1024 * 1024),
      row('Offline navigation and no third-party startup requests',
        browserTests.has('offline') && browserTests.has('shell') ?
          browserTests.get('offline') === pass && browserTests.get('shell') === pass ? pass : fail : pending,
        'Playwright @offline and @shell'),
    ], specialist('Performance Reviewer')),
  }
  const weighted = Object.values(categories)
  const score = weighted.every(item => item.score !== null)
    ? Math.round(weighted.reduce((total, item) => total + item.score * item.weight / 100, 0)) : null
  const automated = Object.values(checks).every(item => item.status === pass)
    && requiredBrowser.every(tag => browserTests.get(tag) === pass)
    && categories.Performance.criteria.every(criterion => criterion.status === pass)
  const blockers = Object.values(checks).filter(item => item.status !== pass).map(item => `${item.name} ${item.status}`)
  for (const tag of requiredBrowser) {
    if (browserTests.get(tag) !== pass) blockers.push(`Required Playwright @${tag}: ${browserTests.get(tag) ?? 'missing'}`)
  }
  for (const criterion of categories.Performance.criteria) {
    if (criterion.status !== pass) blockers.push(`${criterion.label}: ${criterion.status}`)
  }
  if (!valid && review !== null) blockers.push('Review evidence is invalid')
  const critical = findings.filter(item => ['Critical', 'High'].includes(item.severity) && (item.status !== 'fixed' || !current))
  blockers.push(...critical.map(item => `${item.id} — ${item.severity}: ${item.description}`))
  const preview = automated && !critical.length && (valid || review === null)
  if (!current) blockers.push('Specialist review evidence must match the source fingerprint')
  for (const entry of assessments) if (entry.status !== 'complete') blockers.push(`${entry.name} sign-off pending`)
  if (securityVerdict !== pass) blockers.push('Security source review is pending or did not pass')
  const acceptance = Object.fromEntries(devices.map(device => [device, current && accept(review.install?.[device])
    ? review.install[device] : { status: 'pending', evidence: null }]))
  for (const [device, entry] of Object.entries(acceptance)) {
    if (entry.status !== pass) blockers.push(`Installed offline launch on ${device} is pending`)
  }
  const drive = !build ? 'Build unavailable' : !build.driveClient ? 'Unavailable (local-first release)'
    : current && accept(review.drive) && review.drive.client === build.driveClient ? 'Verified' : 'Configured, verification pending'
  if (build?.driveClient && drive !== 'Verified') blockers.push('Two-device Drive sync is pending for this OAuth client')
  const distribution = Object.fromEntries(levels.map(level => [level, {
    open: findings.filter(item => item.severity === level && item.status !== 'fixed').length,
    fixed: findings.filter(item => item.severity === level && item.status === 'fixed').length,
  }]))
  const previousItems = new Map((Array.isArray(previous?.findings) ? previous.findings : []).map(item => [item.id, item]))
  const fixedSincePrevious = findings.filter(item => item.status === 'fixed' && previousItems.has(item.id)
    && previousItems.get(item.id).status !== 'fixed').map(item => item.id)
  return {
    generatedAt: new Date().toISOString(), reviewDate, commit, sourceDigest, build: build?.version ?? null,
    checks, tests: {
      unit: unit ? { passed: unit.numPassedTests, failed: unit.numFailedTests, skipped: unit.numPendingTests + unit.numTodoTests } : null,
      browser: browser?.stats ? { passed: browser.stats.expected, failed: browser.stats.unexpected,
        skipped: browser.stats.skipped, flaky: browser.stats.flaky } : null,
    },
    coverage, dependencies: audit?.metadata?.vulnerabilities ?? null, sizes, categories, score,
    assessments, findings, distribution, acceptance, drive, fixedSincePrevious,
    baseline: previous?.generatedAt ?? null, blockers, automated, preview, production: Boolean(preview && blockers.length === 0),
  }
}

export function publishReport(input) {
  const { previous } = input
  const report = makeReport(input)
  mkdirSync('quality/history', { recursive: true })
  mkdirSync('quality/dashboard', { recursive: true })
  if (previous?.generatedAt && date(previous.generatedAt)) {
    const stamp = new Date(previous.generatedAt).toISOString().replace(/[:.]/g, '-')
    writeFileSync(`quality/history/${stamp}.json`, JSON.stringify(previous, null, 2) + '\n')
    if (existsSync('quality/latest.md')) writeFileSync(`quality/history/${stamp}.md`, readFileSync('quality/latest.md'))
  }
  const history = readdirSync('quality/history').filter(name => /^\d.*\.json$/.test(name)).sort().reverse()
  for (const name of history.slice(limit)) {
    rmSync(`quality/history/${name}`, { force: true })
    rmSync(`quality/history/${name.replace(/\.json$/, '.md')}`, { force: true })
  }
  const sections = reportSections(report)
  writeFileSync('quality/latest.json', JSON.stringify(report, null, 2) + '\n')
  writeFileSync('quality/latest.md', '# StudyVault quality report\n\n' + sections.map(([title, lines]) =>
    `## ${title}\n\n${lines.map(line => '- ' + safeMarkdown(line)).join('\n')}\n`).join('\n'))
  writeFileSync('quality/dashboard/index.html', dashboard(report, sections, history.slice(0, limit)))
  writeFileSync('quality/dashboard/style.css', dashboardStyle)
  return report
}

const displayScore = score => score === null ? 'Not assessed' : `${score}/100`
const displayTests = results => results ? Object.entries(results).map(([key, value]) => `${value} ${key}`).join(', ') : 'Not measured'
function reportSections(report) {
  return [
    ['Release status', [
      `Production deployment ${report.production ? 'eligible' : 'blocked'}`,
      `Commit ${report.commit ?? 'uncommitted workspace'} · Build ${report.build ?? 'unavailable'}`,
      `Source SHA-256 ${report.sourceDigest}`,
      `Reviewed ${report.reviewDate ?? 'pending'} · Generated ${report.generatedAt}`,
      `Google Drive ${report.drive}`,
    ]],
    ['Checks and coverage', [
      ...Object.values(report.checks).map(check => `${check.name} · ${check.status} (${check.command})`),
      `Unit and integration · ${displayTests(report.tests.unit)}`,
      `Browser · ${displayTests(report.tests.browser)}`,
      `Dependencies · ${displayTests(report.dependencies)}`,
      report.coverage ? 'V8 coverage across src · ' + Object.entries(report.coverage)
        .filter(([, value]) => typeof value.pct === 'number').map(([key, value]) => `${key} ${value.pct}%`).join(', ') : 'Coverage was not measured',
    ]],
    ['Weighted quality', [
      `Aggregate · ${displayScore(report.score)}`,
      ...Object.entries(report.categories).flatMap(([name, item]) => [
        `${name} · ${item.weight}% weight · ${displayScore(item.score)} · Findings ${item.findings.join(', ') || 'none recorded'}`,
        ...item.criteria.map(criterion => `${criterion.label} · ${criterion.status} · ${criterion.evidence}`),
      ]),
    ]],
    ['Specialist assessments', report.assessments.map(item => `${item.name} · ${item.status}${item.date ? ' · ' + item.date : ''}${item.evidence ? ' · ' + item.evidence : ''}`)],
    ['Severity distribution', Object.entries(report.distribution).map(([level, item]) => `${level} · ${item.open} open · ${item.fixed} fixed`)],
    ['Reviewer findings', report.findings.length ? report.findings.map(item =>
      `${item.id} · ${item.reviewer} · ${item.severity} · ${item.status} · ${item.feature}${item.reference ? ' · ' + item.reference : ''}. ${item.description} Evidence — ${item.evidence} Fix — ${item.fix}`) : ['None recorded']],
    ['Fixed since the previous report', report.baseline
      ? [`Baseline ${report.baseline}`, ...(report.fixedSincePrevious.length ? report.fixedSincePrevious : ['No newly closed findings'])]
      : ['No previous report available']],
    ['Release acceptance', Object.entries(report.acceptance).map(([device, entry]) =>
      `${device} · ${entry.status}${entry.evidence ? ' · ' + entry.evidence : ''}`)],
    ['Remaining blockers', report.blockers.length ? report.blockers : ['None']],
  ]
}

const html = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const safeMarkdown = value => html(value).replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]]/g, '\\$&')
function dashboard(report, sections, history) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>StudyVault quality dashboard</title><link rel="stylesheet" href="style.css"></head>
<body><header><p>STUDYVAULT · DEVELOPMENT</p><h1>Quality dashboard</h1>
<p class="state ${report.production ? 'eligible' : 'blocked'}">${report.production ? 'Production eligible' : 'Production blocked'}</p>
<nav><a href="../latest.json">JSON report</a> <a href="../latest.md">Markdown report</a></nav></header>
<main><div class="cards">${Object.entries(report.categories).map(([name, item]) =>
    `<article><h2>${html(name)}</h2><strong>${displayScore(item.score)}</strong><p>${item.weight}% weight</p></article>`).join('')}</div>
${sections.map(([title, lines]) => `<section><h2>${html(title)}</h2><ul>${lines.map(line => `<li>${html(line)}</li>`).join('')}</ul></section>`).join('\n')}
<section><h2>Report history</h2>${history.length ? `<ul>${history.map(name => `<li><a href="../history/${encodeURIComponent(name)}">${html(name)}</a></li>`).join('')}</ul>` : '<p>No archived reports yet.</p>'}</section></main></body></html>`
}

const dashboardStyle = `body{margin:0 auto;max-width:74rem;padding:2rem 1.2rem;background:#141e18;color:#f3f4ec;font:1rem/1.6 system-ui,sans-serif}
header{border-bottom:1px solid #435849;margin-bottom:1.5rem;padding-bottom:1.5rem}header>p:first-child{font-size:.8rem;letter-spacing:.14em;color:#bbcbb7}
h1{font:clamp(2.1rem,6vw,4rem)/1.1 Georgia,serif;margin:.3em 0}h2{font-size:1.25rem;margin:.2em 0}p{margin:.5em 0}
a{color:#e0edaa;text-underline-offset:3px}nav a{margin-right:1rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.7rem}
article,section{background:#1c2820;border:1px solid #435849;padding:1rem;border-radius:.75rem}section{margin:1rem 0;overflow-wrap:anywhere}
article strong{font-size:1.6rem}.state{width:fit-content;padding:.2rem .65rem;border-radius:1rem}.blocked{background:#5b382d;color:#ffe0c4}.eligible{background:#344b31;color:#e0edaa}`
