# StudyVault

StudyVault is a static, local-first revision workspace. Create subjects and flashcards, practise active recall, and review cards when they are due. Dexie saves subjects, cards, deletions and review schedules in IndexedDB. Once the app shell is cached, you can reopen StudyVault, edit cards, review and export a backup offline.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. To exercise the service worker, build and serve the production files locally with Wrangler.

```sh
npm run build
npm run preview
```

The static build is written to `dist`. The local preview listens at `http://127.0.0.1:4173`. Dev and preview use separate browser storage origins.

## Quality and release checks

```sh
npm run test:browser:install
npm run quality
```

Open `quality/dashboard/index.html` or read `quality/latest.md`. The generator also writes `quality/latest.json` and archives previous reports in `quality/history/`. In GitHub Actions, download and extract the **studyvault-quality** artifact to view the dashboard. Use `npm run quality -- --release` to require production eligibility locally as well as passing automated checks.

The current revision uses three review grades. Again schedules another attempt in ten minutes. Good and Easy use increasing day intervals, capped at one year. Local backup import merges by item and keeps deletion markers to prevent stale copies from restoring deleted data.

- [Deployment and Google Drive setup](docs/deployment.md)
- [Quality criteria and milestone reviews](quality/README.md)
