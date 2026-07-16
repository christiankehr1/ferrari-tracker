# Cavallino Index

Hourly price tracker for Ferrari F430 and SF90 listings on AutoScout24.ch, published as a GitHub Pages dashboard.

No servers, no database, no accounts beyond GitHub. A scheduled Action crawls, commits the data as files, builds the site, and deploys it.

```
GitHub Actions (hourly)
  └─ crawler/crawl.py ── AutoScout24 API
        └─ commits data/*.{json,csv} to the repo
              └─ builds web/ and deploys to GitHub Pages
```

## Setup

Needs the [GitHub CLI](https://cli.github.com), signed in (`gh auth login`).

```bash
./setup.sh                        # or: ./setup.sh my-repo-name public
```

That creates the repo, pushes, turns Pages on, runs the first crawl, and prints the live URL. Safe to re-run. Takes ~2 min.

`data/` already holds a real first crawl (132 cars), so the dashboard has content the moment it deploys.

Public is simplest — Pages on a private repo needs a paid GitHub plan.

<details>
<summary>By hand instead</summary>

1. `gh repo create ferrari-tracker --public --source=. --remote=origin --push`
2. Settings → Pages → Source: **GitHub Actions** (before the first run, or deploy fails)
3. Actions → "Crawl and publish" → **Run workflow**
4. Site lands at `https://<you>.github.io/ferrari-tracker/`

</details>

After the first run it crawls by itself at :17 every hour.

## How it works

**Crawler** (`crawler/crawl.py`, stdlib only, no dependencies)

Calls AutoScout24's public search API — `POST api.autoscout24.ch/v1/listings/search`, unauthenticated JSON, no HTML parsing.

Two details that are load-bearing:

- **The sort is required for correctness.** Without `sort: PRICE/ASC` the API returns an unstable order, and paginating gives you 54 unique cars out of 57 — some duplicated across pages, others never returned. Measured, repeatably. With the sort, sets come back complete.
- **A gap must never read as "sold".** Delisting requires two consecutive misses *and* a crawl that returned exactly `totalElements` cars. A partial crawl records prices and skips delisting entirely.

Requests are throttled 4s apart; their edge returns 403 on rapid-fire traffic. A full crawl is ~7 requests over ~30s.

**Data** (`data/`, committed every run)

| File | Job |
|---|---|
| `listings.json` | Current state of every car ever seen |
| `snapshots.csv` | Append-only history — a row only when price or mileage changed |
| `dashboard.json` | Pre-built payload the frontend fetches |

Snapshots are written on change, not on schedule, so hourly crawling doesn't bloat the repo. A quiet week costs zero rows.

**Site** (`web/`, Vite + React + Recharts)

Fetches `data/dashboard.json`, which is copied next to the built site on deploy. Days-on-market comes from AutoScout's own listing creation date, so it's real from the first crawl rather than starting at zero.

## Tuning

**Frequency** — `.github/workflows/update.yml`, the `cron` line. Hourly is the ceiling worth running; asking prices move on a scale of weeks. Every 3h (`17 */3 * * *`) captures essentially the same signal at a quarter of the traffic. GitHub's scheduler is best-effort and skips or delays runs under load — fine here, irrelevant for prices, worth knowing.

**More models** — `MODELS` in `crawl.py`. Model keys come from the API: `f430`, `sf90`, `296`, `812`, `roma`. Note `430` and `sf90-stradale` return zero — the keys aren't guessable, check against the API first.

**More makes** — `makeKey` is in `fetch_model`. `GET api.autoscout24.ch/v1/makes?vehicleCategory=car` lists all of them.

## Things worth knowing

- AutoScout24's ToS prohibit automated access. One crawl at ~7 throttled requests is deliberately minimal. Keep it that way.
- A public repo means the crawl history is public too. That's fine for listing data, which is already public — but it's a real choice, not a default.
- GitHub disables scheduled workflows after 60 days of repository inactivity. The hourly data commits normally keep it alive; if it ever stops, GitHub emails you and one manual run resets the clock.
- Dealers delete and relist cars to reset the "online since" date. Catching that means fingerprinting on year + mileage + ZIP rather than listing ID — a good v2.
