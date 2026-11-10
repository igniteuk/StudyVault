import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { publishReport } from './report.mjs'

const workspace = 'quality/.work'
const inputs = ['.env.example', '.github/workflows', 'src', 'public', 'scripts', 'tests', 'index.html',
  'eslint.config.js', 'package.json', 'package-lock.json', 'playwright.config.ts', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts']
function inputFiles(path) {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap(name => inputFiles(`${path}/${name}`)) : [path]
}
const fingerprint = createHash('sha256')
for (const path of inputs.flatMap(inputFiles).sort()) {
  const bytes = readFileSync(path)
  fingerprint.update(path + '\0')
  fingerprint.update(path.endsWith('.png') ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n'))
  fingerprint.update('\0')
}
const sourceDigest = fingerprint.digest('hex')
if (process.argv.includes('--fingerprint')) {
  console.log(sourceDigest)
  process.exit(0)
}

mkdirSync(workspace, { recursive: true })
for (const file of ['unit.json', 'browser.json', 'audit.json']) rmSync(`${workspace}/${file}`, { force: true })
rmSync('coverage/coverage-summary.json', { force: true })

function json(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) }
  catch { return fallback }
}

const checks = {}
function check(id, name, args, condition = true, capture = false) {
  let status = 'skipped'
  if (condition) {
    console.log(`\n--- ${name} ---`)
    const executable = process.env.npm_execpath ? process.execPath : 'npm'
    const command = process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args
    const result = spawnSync(executable, command, {
      encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', timeout: 420_000,
    })
    if (result.error) console.error(result.error.message)
    if (capture) writeFileSync(`${workspace}/${id}.json`, result.stdout ?? '')
    status = result.status === 0 ? 'pass' : 'fail'
  }
  checks[id] = { name, command: `npm ${args.join(' ')}`, status }
  return status === 'pass'
}

const installed = check('install', 'Dependency installation', ['ci', '--no-audit'])
check('types', 'TypeScript', ['run', 'typecheck'], installed)
check('lint', 'ESLint', ['run', 'lint'], installed)
check('unit', 'Unit and integration tests', ['test'], installed)
const built = check('build', 'Production build', ['run', 'build'], installed)
const ready = process.env.CI
  ? check('browserSetup', 'Playwright browser setup', ['exec', '--', 'playwright', 'install', '--with-deps', 'chromium'], installed)
  : installed
check('browser', 'Playwright browser tests', ['run', 'test:browser'], built && ready)
check('audit', 'Dependency security audit', ['audit', '--audit-level=high', '--json', '--offline=false'], installed, true)

const unit = json(`${workspace}/unit.json`)
const browser = json(`${workspace}/browser.json`)
const audit = json(`${workspace}/audit.json`)
const coverage = json('coverage/coverage-summary.json')?.total ?? null
if (checks.unit.status === 'pass' && (!unit?.numPassedTests || unit.numPendingTests || unit.numTodoTests || unit.numFailedTests)) checks.unit.status = 'fail'
if (checks.browser.status === 'pass' && (!browser?.stats?.expected || browser.stats.skipped || browser.stats.flaky || browser.stats.unexpected)) checks.browser.status = 'fail'
if (checks.audit.status === 'pass' && !audit?.metadata?.vulnerabilities) checks.audit.status = 'fail'
const commit = process.env.GITHUB_SHA ?? (spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null)
const build = built ? json('dist/build-info.json') : null
let sizes = null
try {
  const assets = build?.shell.map(path => ({ path, bytes: readFileSync(`dist${path}${path.endsWith('/') ? 'index.html' : ''}`) }))
  const compressed = extension => assets.filter(asset => asset.path.endsWith(extension))
    .reduce((sum, asset) => sum + gzipSync(asset.bytes).length, 0)
  if (assets) sizes = { js: compressed('.js'), css: compressed('.css'), shell: assets.reduce((sum, asset) => sum + asset.bytes.length, 0) }
} catch (error) {
  console.error('Could not measure the production shell.', error.message)
}
if (built && !sizes) checks.build.status = 'fail'

const evidence = 'quality/review.json'
const review = existsSync(evidence) ? json(evidence) ?? {} : null
const result = publishReport({ commit, sourceDigest, checks, unit, browser, audit, coverage, build, sizes,
  review, previous: json('quality/latest.json') })
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `production=${result.production}\npreview=${result.preview}\n`)
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, readFileSync('quality/latest.md'))
console.log(`\nProduction eligibility: ${result.production ? 'Eligible' : 'Blocked'}\nReport: quality/latest.md`)
if (!result.automated || (process.argv.includes('--release') && !result.production)) process.exitCode = 1
