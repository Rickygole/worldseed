# CI and health workflows

Both workflows live in `.github/workflows/`. Neither uses a key, token or repository secret, and nothing in them costs money.

- **CI** (`ci.yml`) runs on every push and pull request to `main`. Three independent jobs, each shown as its own check on the commit:
  `frontend` (`npm ci`, `tsc --noEmit`, `eslint --max-warnings 0`, `vitest run`, then `npm run build` with `WS_REQUIRE_SNAPSHOT=1`; the simulator tests take about 90 s),
  `hygiene` (`scripts/check-repo-hygiene.sh` on the full history: forbidden words, secrets, required files, workflow rules), and
  `pipeline` (`pytest` on the committed snapshot; the two tests that need the git-ignored `data/raw` are skipped, and `-rs` lists why).
- **Health** (`health.yml`) runs every 6 hours (minute 17, UTC) and on demand (Actions tab, Health, Run workflow). It fetches
  `https://worldseed-mu.vercel.app/` (HTTP 200 and the text "WorldSeed") and `/api/health` (HTTP 200 and JSON with `ok: true`), three attempts each with 30 s and 60 s waits.
- **Reading a run:** green means every check passed. Red means click the failed job, then the failed step, and read the last lines; the health job prints the HTTP status of each attempt.
  A health failure means the site was unreachable or unhealthy on all three tries, not that a key is missing: `degraded: true` (no AI keys yet) still counts as healthy.
- **Notifications:** GitHub emails the person who last edited the workflow's schedule when a scheduled run fails (per GitHub's documentation; not yet observed for this repo, unverified). Check Settings, Notifications if no mail arrives.
- **Limits and the 60-day rule:** GitHub disables scheduled workflows in a public repository after 60 days without repository activity, so the health ping can stop on its own. Any commit before then resets the clock; if it stops, re-enable it in the Actions tab or run it by hand. Scheduled runs can also start late under load. Public-repo Actions minutes are free.
