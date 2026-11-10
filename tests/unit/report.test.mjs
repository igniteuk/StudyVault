import { describe, expect, it } from 'vitest'
import { makeReport } from '../../scripts/report.mjs'

const reviewerNames = ['UI/UX Reviewer', 'QA Reviewer', 'Security Reviewer', 'Performance Reviewer']
const targets = ['iOS Safari', 'Android Chrome', 'Desktop Chromium']
const tags = ['accessibility', 'library', 'review', 'offline', 'backup', 'shell']
const record = { status: 'pass', date: '2026-11-10', evidence: 'Synthetic policy test evidence' }

function candidate() {
  return {
    sourceDigest: 'candidate',
    checks: Object.fromEntries(['install', 'types', 'lint', 'unit', 'build', 'browser', 'audit'].map(id =>
      [id, { status: 'pass', name: id, command: id }])),
    browser: { specs: tags.map(tag => ({
      title: 'required case @' + tag, tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
    })) },
    build: { version: 'test-build', driveClient: null },
    audit: { metadata: { vulnerabilities: { moderate: 0, high: 0, critical: 0 } } },
    sizes: { js: 10, css: 10, shell: 30 },
    review: {
      sourceDigest: 'candidate', date: record.date, findings: [],
      reviewers: Object.fromEntries(reviewerNames.map(name => [name, { ...record, verdict: 'pass' }])),
      install: Object.fromEntries(targets.map(name => [name, record])),
    },
  }
}

describe('Release policy', () => {
  it('allows a fully evidenced local-only release', () => {
    expect(makeReport(candidate())).toMatchObject({ production: true, preview: true, blockers: [] })
  })

  it('rejects a run with a missing required test even if Playwright succeeded', () => {
    const input = candidate()
    input.browser.specs.shift()
    expect(makeReport(input)).toMatchObject({
      production: false, preview: false, automated: false,
      blockers: expect.arrayContaining(['Required Playwright @accessibility: missing']),
    })
  })

  it('blocks High and Critical findings regardless of the score', () => {
    for (const severity of ['High', 'Critical']) {
      const input = candidate()
      input.review.findings.push({
        id: 'TEST-01', reviewer: 'Security Reviewer', severity, feature: 'Release policy',
        description: 'Synthetic blocking finding', evidence: 'Reproduction', fix: 'Repair', status: 'open',
      })
      expect(makeReport(input)).toMatchObject({ score: 100, production: false, preview: false })
    }
  })

  it('requires current review and physical installation evidence for production', () => {
    const stale = candidate()
    stale.review.sourceDigest = 'previous'
    const noInstall = candidate()
    delete noInstall.review.install['iOS Safari']
    for (const input of [stale, noInstall]) {
      expect(makeReport(input)).toMatchObject({ production: false, preview: true })
    }
  })

  it('requires live Drive evidence that matches the configured client', () => {
    const input = candidate()
    input.build.driveClient = 'client'
    expect(makeReport(input).production).toBe(false)
    input.review.drive = { ...record, client: 'other-client' }
    expect(makeReport(input).production).toBe(false)
    input.review.drive.client = 'client'
    expect(makeReport(input)).toMatchObject({ production: true, drive: 'Verified' })
  })

  it('distinguishes absent and malformed review evidence for preview', () => {
    expect(makeReport({ ...candidate(), review: null }).preview).toBe(true)
    for (const review of [{}, false, '']) expect(makeReport({ ...candidate(), review }).preview).toBe(false)
  })
})
