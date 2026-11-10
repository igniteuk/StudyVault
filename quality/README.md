# StudyVault quality process

Run `npm run quality` at the end of each milestone. This installs locked dependencies, checks types and lint, runs unit and IndexedDB integration tests, builds production files, runs Playwright against the Pages emulator and runs the full dependency audit. It generates the JSON, Markdown and standalone dashboard even after an ordinary check fails. Reports retain up to 12 earlier snapshots. Actions restores a recent report on the same branch, or the base branch for a pull request, when an artifact is available.

## Evidence and scoring

Each category divides 100 points equally among its listed criteria. A pass earns its full share and a measured failure earns zero. A category with missing evidence is **Not assessed**. Round each category to an integer and compute the weighted aggregate only when all four categories are assessed. The report lists actual evidence and related specialist finding IDs. Tests and budgets describe this implementation and browser coverage.

| Category | Weight | Repeatable criteria |
| --- | ---: | --- |
| UI/UX | 25% | Playwright checks responsive empty screens and axe rules, keyboard review, labelled library editing and settings feedback. |
| Functionality | 35% | Playwright verifies CRUD, review after reload, offline writes after reload, and backup flows. Vitest verifies scheduling, merges and integration paths. |
| Security | 25% | No npm audit entries at Moderate or above for full credit, Pages security header tests, mocked Drive integration, and a current specialist source verdict. |
| Performance | 15% | Gzip JS ≤175 KiB, gzip CSS ≤30 KiB, exact shell precache ≤1 MiB, and offline navigation plus zero external requests during ordinary startup. |

Production requires passing checks and performance budgets, current sign-off from the four independent reviewers, zero unresolved Critical or High issues, and current install evidence. A configured Drive build also requires live two-device verification for that build’s OAuth client. Scores do not override these gates. Preview uses the same automated checks and severity gate so physical-device tests can happen before production.

## Milestone reviews

Run the following specialist reviews separately in a supported Codex session at each major milestone and before releasing. GitHub Actions reads their evidence and runs automated checks. It has no Codex integration.

- **UI/UX Reviewer** tests onboarding, mobile and desktop layout, visual contrast, keyboard navigation, error states and accessible review flows.
- **QA Reviewer** verifies normal and failure paths, persistence across reload, offline changes, backup recovery and test/release coverage.
- **Security Reviewer** inspects the dependency audit, OAuth and scope handling, private data, backup validation, content policy, caching boundaries and CI deployment gates. Record a security verdict of `pass` or `fail`.
- **Performance Reviewer** inspects the three build budgets, service-worker update and cleanup behaviour, and absence of external calls during local-first startup.

Record findings under `quality/review.json`. Use stable IDs and include reviewer, severity, feature, optional `reference` (file and line), description, reproduction/evidence, recommended `fix`, and status (`open`, `in progress`, `fixed`). Keep fixed entries so the next report can track changes. Each reviewer entry includes `status: "pass"` after completing their assessment, the review `date` in ISO format, and an `evidence` description. A reviewer can complete an assessment with open findings. The security verdict is separate from review completion.

Set the evidence’s `sourceDigest` to the output of `node scripts/quality.mjs --fingerprint` for the reviewed source, after reviewing fixes. The fingerprint excludes the evidence file so updating attestations does not invalidate the code evidence. The report separately records the checked-out commit where available.

## Physical release verification

For **iOS Safari**, **Android Chrome**, and **Desktop Chromium**, use the matching preview build over HTTPS. On iOS use Safari’s **Share → Add to Home Screen**. On Android and desktop use the browser’s install action. Create a subject and a card, close the installed app, switch offline, reopen from the app icon, review the card and reopen again. Check the grade persisted. Record each pass under `install` with its date, device/OS/browser and result. This step verifies a real installed launch. The Playwright suite covers installation prerequisites and browser offline behaviour.

When Drive ships configured, test two devices against the same OAuth project and account. Create a card on A, sync A then B, edit and grade it on B, sync back to A and confirm the new state. Repeat with a deletion and after disconnect/reconnect. Put the date and steps/result under `drive` with `status: "pass"` and `client` matching the client fingerprint in that production build’s `dist/build-info.json`. Use a production-equivalent HTTPS test origin registered to the production client. Leave the evidence absent until verified. Use synthetic cards and keep credentials and personal study data out of reviewer evidence.
