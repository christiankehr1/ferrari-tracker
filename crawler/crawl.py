#!/usr/bin/env python3
"""
Ferrari price tracker — AutoScout24.ch crawler.

Runs hourly in GitHub Actions. Stdlib only, no dependencies.

Writes three files in data/:
  listings.json   — current state of every listing we've ever seen
  snapshots.csv   — append-only price history (a row only when price/mileage changes)
  dashboard.json  — pre-built payload the frontend fetches

Delisting needs two consecutive misses, so one flaky crawl can't
mark the whole fleet as sold.
"""

import csv
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.autoscout24.ch/v1/listings/search"
# Model keys are the API's, not guessable — verify a new one returns a non-zero
# totalElements before adding it. "360" and "488-pista" both return nothing;
# "f360" and "488" are the real keys. Variants (Competizione, Pista, Challenge
# Stradale) aren't queryable — they're only a free-text versionFullName on the
# listing, so a model is the finest thing we can ask for.
MODELS = ["f430", "sf90", "812", "488", "f360"]
PAGE_SIZE = 20
DELAY = 4.0          # their edge 403s rapid-fire requests
MISSES_TO_DELIST = 2
HISTORY_DAYS = 90

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

DATA = Path(__file__).resolve().parent.parent / "data"
LISTINGS_F = DATA / "listings.json"
SNAPSHOTS_F = DATA / "snapshots.csv"
DASHBOARD_F = DATA / "dashboard.json"

NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat()


_FRAC = re.compile(r"\.(\d+)")


def parse_dt(s):
    """ISO parse that tolerates AutoScout's timestamps.

    They emit fractional seconds at whatever precision they land on
    ("...T09:28:00.31+00:00"), and fromisoformat before 3.11 accepts only
    exactly 3 or 6 digits. Pad to 6 so any Python parses it.
    """
    s = s.replace("Z", "+00:00")
    s = _FRAC.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), s, count=1)
    return datetime.fromisoformat(s)


def post(body, attempt=1):
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        if attempt >= 3:
            raise
        time.sleep(DELAY * attempt * 2)
        return post(body, attempt + 1)


def fetch_model(model_key):
    """Paginate one model.

    The sort is load-bearing: without it the API returns an unstable order and
    pagination silently duplicates some cars while dropping others (measured:
    54 unique out of 57 on every unsorted run). PRICE/ASC returns complete sets.

    Returns (listings_by_id, total, complete).
    """
    by_id, page, total = {}, 0, None
    while True:
        d = post({
            "query": {"makeModelVersions": [{"makeKey": "ferrari", "modelKey": model_key}]},
            "pagination": {"page": page, "size": PAGE_SIZE},
            "sort": [{"type": "PRICE", "order": "ASC"}],
        })
        total = d["totalElements"]
        for l in d["content"]:
            by_id[l["id"]] = l
        page += 1
        if page * PAGE_SIZE >= total or not d["content"]:
            break
        time.sleep(DELAY)
    return by_id, total, len(by_id) == total


def load_listings():
    if LISTINGS_F.exists():
        return {int(k): v for k, v in json.loads(LISTINGS_F.read_text()).items()}
    return {}


def load_snapshots():
    rows = []
    if SNAPSHOTS_F.exists():
        with SNAPSHOTS_F.open() as f:
            for r in csv.DictReader(f):
                rows.append({
                    "listing_id": int(r["listing_id"]),
                    "ts": r["ts"],
                    "price": float(r["price"]) if r["price"] else None,
                    "mileage": int(r["mileage"]) if r["mileage"] else None,
                })
    return rows


def main():
    DATA.mkdir(exist_ok=True)
    listings = load_listings()
    snapshots = load_snapshots()

    latest = {}  # listing_id -> most recent snapshot
    for s in snapshots:
        latest[s["listing_id"]] = s

    seen = set()
    new_rows = []
    complete = True
    stats = {"new": 0, "price_changes": 0, "delisted": 0}

    for model_key in MODELS:
        found, total, ok = fetch_model(model_key)
        complete = complete and ok
        print(f"{model_key}: {len(found)}/{total} listings{'' if ok else '  ** INCOMPLETE **'}")

        for l in found.values():
            lid = l["id"]
            seen.add(lid)
            seller = l.get("seller") or {}

            prev = listings.get(lid)
            if prev is None:
                stats["new"] += 1

            listings[lid] = {
                "id": lid,
                "model_key": model_key,
                "version": l.get("versionFullName"),
                "year": l.get("firstRegistrationYear"),
                "hp": l.get("horsePower"),
                "transmission": l.get("transmissionType"),
                "condition": l.get("conditionType"),
                "seller_name": seller.get("name"),
                "seller_type": seller.get("type"),
                "seller_city": seller.get("city"),
                "seller_zip": seller.get("zipCode"),
                "as24_created": l.get("createdDate"),
                "first_seen": prev["first_seen"] if prev else NOW,
                "last_seen": NOW,
                "status": "active",
                "delisted_at": None,
                "misses": 0,
                "url": f"https://www.autoscout24.ch/de/d/{lid}",
                "current_price": l.get("price"),
                "current_mileage": l.get("mileage"),
                "first_price": (prev or {}).get("first_price") or l.get("price"),
            }

            # Append a snapshot only when something actually moved.
            last = latest.get(lid)
            changed = (
                last is None
                or last["price"] != l.get("price")
                or last["mileage"] != l.get("mileage")
            )
            if changed:
                if last is not None and last["price"] != l.get("price"):
                    stats["price_changes"] += 1
                row = {
                    "listing_id": lid,
                    "ts": NOW,
                    "price": l.get("price"),
                    "mileage": l.get("mileage"),
                }
                new_rows.append(row)
                snapshots.append(row)
                latest[lid] = row

        time.sleep(DELAY)

    if not seen:
        raise SystemExit("Empty crawl — refusing to touch state.")

    # Delisting: only ever inferred from a provably complete crawl, and only
    # after two consecutive misses. A gap in the data must never read as "sold".
    if complete:
        for lid, l in listings.items():
            if lid in seen or l["status"] == "delisted":
                continue
            l["misses"] = l.get("misses", 0) + 1
            if l["misses"] >= MISSES_TO_DELIST:
                l["status"] = "delisted"
                l["delisted_at"] = NOW
                stats["delisted"] += 1
    else:
        print("Partial crawl: prices recorded, delisting checks skipped.")

    # --- write state ---
    LISTINGS_F.write_text(
        json.dumps({str(k): v for k, v in sorted(listings.items())}, indent=1, ensure_ascii=False)
    )

    with SNAPSHOTS_F.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["listing_id", "ts", "price", "mileage"])
        w.writeheader()
        for r in sorted(snapshots, key=lambda x: (x["listing_id"], x["ts"])):
            w.writerow(r)

    # --- build frontend payload ---
    cutoff = (datetime.now(timezone.utc).timestamp() - HISTORY_DAYS * 86400)
    hist = {}
    for s in snapshots:
        if parse_dt(s["ts"]).timestamp() >= cutoff:
            hist.setdefault(s["listing_id"], []).append({"ts": s["ts"], "price": s["price"]})

    def days_on_market(l):
        """Prefer AutoScout's own creation date — it's true listing age and is
        available on the very first crawl. Fall back to our own first_seen."""
        start = parse_dt(l.get("as24_created") or l["first_seen"])
        end = parse_dt(l["delisted_at"] or NOW)
        return max(0, int((end - start).total_seconds() // 86400))

    payload = {
        "crawled_at": NOW,
        "stats": stats,
        "listings": [
            {
                **{k: v for k, v in l.items() if k != "misses"},
                "days_on_market": days_on_market(l),
                "history": sorted(hist.get(l["id"], []), key=lambda x: x["ts"]),
            }
            for l in listings.values()
        ],
    }
    DASHBOARD_F.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    print(
        f"crawled={len(seen)} new={stats['new']} "
        f"price_changes={stats['price_changes']} delisted={stats['delisted']} "
        f"snapshot_rows_added={len(new_rows)}"
    )


if __name__ == "__main__":
    main()
