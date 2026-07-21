# Cavallino Index

Hourly price tracker for Ferrari F430, SF90, 812, 488 and F360 listings on AutoScout24.ch, published as a GitHub Pages dashboard.

No servers, no database, no accounts beyond GitHub. A scheduled Action crawls, commits the data as files, builds the site, and deploys it.

```
GitHub Actions (hourly)
  └─ crawler/crawl.py ── AutoScout24 API
        └─ crawler/notify.py ── emails newly listed cars (optional)
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

Requests are throttled 4s apart; their edge returns 403 on rapid-fire traffic. A full crawl of the five models is ~17 requests over ~70s.

**Data** (`data/`, committed every run)

| File | Job |
|---|---|
| `listings.json` | Current state of every car ever seen |
| `snapshots.csv` | Append-only history — a row only when price or mileage changed |
| `dashboard.json` | Pre-built payload the frontend fetches |

Snapshots are written on change, not on schedule, so hourly crawling doesn't bloat the repo. A quiet week costs zero rows.

**Site** (`web/`, Vite + React + Recharts)

Fetches `data/dashboard.json`, which is copied next to the built site on deploy. Days-on-market comes from AutoScout's own listing creation date, so it's real from the first crawl rather than starting at zero.

## Alerts

Off by default. Set five secrets and every newly listed car emails you at the end of the crawl that found it.

```bash
gh secret set SMTP_HOST --body "smtp.gmail.com"
gh secret set SMTP_PORT --body "465"          # 465 implicit TLS, or 587 STARTTLS
gh secret set SMTP_USER --body "you@gmail.com"
gh secret set SMTP_PASS --body "<app password>"   # not your account password
gh secret set NOTIFY_TO --body "you@gmail.com"    # comma-separated for several
```

Gmail needs 2FA on and an [app password](https://myaccount.google.com/apppasswords) — it rejects plain account passwords over SMTP. Any SMTP host works; nothing here is Gmail-specific.

Verify the plumbing without waiting for a real new car — `notify.py --test` sends one sample email to `NOTIFY_TO` and touches no state:

```bash
SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
SMTP_USER=you@gmail.com SMTP_PASS='<app password>' \
NOTIFY_TO=zerbinoelenaz@gmail.com \
python crawler/notify.py --test
```

`crawler/notify.py` runs after the crawl, mails the diff, and writes `notified: true` onto each listing it sent. That flag is committed, so **the repo is the delivery log** — no database, same as everything else here.

Consequences worth knowing:

- **The first run after switching alerts on sends nothing.** A `listings.json` where nothing is flagged is a backlog, not news, so it's adopted silently. Otherwise turning this on would mail you 300 cars that have been listed for months.
- **A failed send doesn't mark.** The next crawl retries. A dead mailbox never costs a data point — the crawl is the product, alerts are a side-car.
- **Unset secrets are a no-op**, not an error. The crawl publishes exactly as before.
- **Relists ping.** A dealer deleting and re-posting a car creates a new listing ID, which reads as new. That's the same fingerprinting gap called out at the bottom of this file — alerts inherit it.

### Weekly sold digest

A second, quieter mail: every car that **left the market** in the past week, in one Monday-morning email. A disappearance is all the API gives us — we can't tell a sale from a listing simply being pulled — so the wording stays "sold or delisted".

`crawler/notify.py --weekly` reads the committed `listings.json`, mails the delistings it hasn't reported yet, and writes `sold_notified: true` onto each — the exact same delivery-log contract as new-listing alerts, one flag over. It runs on its own weekly workflow (`.github/workflows/weekly-digest.yml`, `cron: 0 7 * * 1`), reusing the same `SMTP_*` / `NOTIFY_TO` secrets. Same consequences apply: first run adopts the existing delisted backlog silently, a failed send doesn't mark, unset secrets are a no-op.

The dashboard's DELISTED filter now also shows the delisting timestamp — expand any car that has left the market and its detail line carries "left the market YYYY-MM-DD HH:MM UTC", stamped when the crawl confirmed it gone.

Delisted cars are never dropped — `listings.json` keeps every car it has ever seen, flipping `status` to `delisted` rather than deleting the record, so the archive grows for as long as the tracker runs. On top of that, the DELISTED view carries a **TIME ON MARKET** panel: per-model median days from a listing's AutoScout creation date to the crawl that confirmed it gone, plus each model's exit count and range. It's thin at first and sharpens with every departure — the long-run payoff of caching the cars that go offline. (The per-car price sparkline still only reaches back `HISTORY_DAYS`, currently 90; the full price series lives forever in `snapshots.csv`, it's just not all shipped to the frontend.)

## Tuning

**Frequency** — `.github/workflows/update.yml`, the `cron` line. Hourly is the ceiling worth running; asking prices move on a scale of weeks. Every 3h (`17 */3 * * *`) captures essentially the same signal at a quarter of the traffic. GitHub's scheduler is best-effort and skips or delays runs under load — fine here, irrelevant for prices, worth knowing.

**More models** — `MODELS` in `crawl.py`. Model keys come from the API: `f430`, `sf90`, `812`, `488`, `f360`, `296`, `roma`. The keys aren't guessable — `430`, `360` and `sf90-stradale` all return zero, while `f430` and `f360` are right. Check a new key returns a non-zero `totalElements` before adding it.

**Variants aren't queryable.** A Competizione, Pista or Challenge Stradale can only be asked for as its whole model (`812`, `488`, `f360`). Listings carry no version key — just `versionFullName`, free text the dealer types, which is why it contains both `Chalange` and a 145k `Challenge` that is a race car rather than a Challenge Stradale. Filter on that string only if you're willing to be wrong in both directions.

**More makes** — `makeKey` is in `fetch_model`. `GET api.autoscout24.ch/v1/makes?vehicleCategory=car` lists all of them.

## Things worth knowing

- AutoScout24's ToS prohibit automated access. One crawl at ~7 throttled requests is deliberately minimal. Keep it that way.
- A public repo means the crawl history is public too. That's fine for listing data, which is already public — but it's a real choice, not a default.
- GitHub disables scheduled workflows after 60 days of repository inactivity. The hourly data commits normally keep it alive; if it ever stops, GitHub emails you and one manual run resets the clock.
- Dealers delete and relist cars to reset the "online since" date. Catching that means fingerprinting on year + mileage + ZIP rather than listing ID — a good v2.
