#!/usr/bin/env python3
"""
Consolidated email digests.

Runs right after crawl.py in the same Action, reads the listings.json that
crawl just wrote, and emails at most one digest every DIGEST_HOURS (48h):
every new listing plus every price change since the last digest, in one mail.
Between digests the crawl stays quiet and news simply accumulates — unmarked
`notified` flags and snapshot rows are the queue.

Stdlib only, no dependencies. Configured entirely by environment:

  SMTP_HOST   smtp.gmail.com
  SMTP_PORT   465 (implicit TLS) or 587 (STARTTLS)
  SMTP_USER   full address to log in as
  SMTP_PASS   app password, never the account password
  NOTIFY_TO   comma-separated recipients
  NOTIFY_FROM optional, defaults to SMTP_USER

Unset SMTP_HOST and this is a no-op — the crawl still publishes. Alerts are a
side-car, and a broken mailbox must never cost us a data point.

The notified flag lives in listings.json and the last-digest timestamp in
notify_state.json, both committed, so the repo is the delivery log. No state
of our own, same as the rest of this project.
"""

import csv
import json
import os
import re
import smtplib
import ssl
import sys
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
LISTINGS_F = DATA / "listings.json"
SNAPSHOTS_F = DATA / "snapshots.csv"
STATE_F = DATA / "notify_state.json"

# Consolidation window: at most one update email every this many hours. It's a
# cap, not a schedule — a digest goes out on the first crawl after the window
# reopens that actually has something to say.
DIGEST_HOURS = 48

# Display names for the keys crawl.py tracks. Falls back to the raw key, so
# adding a model to MODELS never breaks the mail.
MODEL_NAMES = {
    "f430": "F430",
    "sf90": "SF90",
    "812": "812",
    "488": "488",
    "f360": "F360",
    "296": "296",
    "roma": "Roma",
    "california": "California",
    "purosangue": "Purosangue",
    "458": "458",
    "portofino": "Portofino",
}

SITE = os.environ.get("SITE_URL", "").rstrip("/")


def write(listings):
    """Rewrite listings.json byte-compatibly with crawl.py.

    Same indent, same numeric key order. Anything else turns a one-flag change
    into a whole-file diff on every crawl.
    """
    LISTINGS_F.write_text(
        json.dumps(
            {k: listings[k] for k in sorted(listings, key=int)},
            indent=1,
            ensure_ascii=False,
        )
    )


def money(n):
    return f"CHF {n:,.0f}".replace(",", "'") if n else "price on request"


def km(n):
    return f"{n:,} km".replace(",", "'") if n else "mileage n/a"


def title(l):
    name = MODEL_NAMES.get(l["model_key"], l["model_key"].upper())
    version = (l.get("version") or "").strip()
    # versionFullName is free text the dealer types and usually already leads
    # with the model ("F360 Modena Berlinetta"). Don't say it twice.
    bits = [name] if not version.upper().startswith(name.upper()) else []
    if version:
        bits.append(version)
    if l.get("year"):
        bits.append(f"({l['year']})")
    return " ".join(bits)


def _where(l):
    return " · ".join(x for x in [l.get("seller_city"), l.get("seller_name")] if x)


def _row(l, meta_html):
    return (
        f'<tr>'
        f'<td style="padding:12px 0;border-bottom:1px solid #eee">'
        f'<a href="{l["url"]}" style="color:#c00;font-weight:600;'
        f'text-decoration:none;font-size:15px">{title(l)}</a><br>'
        f'{meta_html}<br>'
        f'<span style="color:#888;font-size:13px">{_where(l)}</span>'
        f"</td></tr>"
    )


def render_digest(new, changes):
    """One consolidated mail: everything since the last digest. New listings
    first, then price moves on cars already reported. `changes` items carry a
    `prev_price` key next to the usual listing fields."""
    parts = []
    if new:
        parts.append(f"{len(new)} new listing{'s' if len(new) != 1 else ''}")
    if changes:
        parts.append(f"{len(changes)} price change{'s' if len(changes) != 1 else ''}")
    subject = (
        # A lone new car keeps the old, specific subject — it's the best line.
        f"New on AutoScout: {title(new[0])} — {money(new[0]['current_price'])}"
        if len(new) == 1 and not changes
        else "Ferrari update: " + ", ".join(parts)
    )

    text_sections, html_sections = [], []

    if new:
        lines, rows = [], []
        for l in new:
            lines.append(
                f"{title(l)}\n"
                f"  {money(l['current_price'])} · {km(l.get('current_mileage'))}\n"
                f"  {_where(l)}\n"
                f"  {l['url']}\n"
            )
            rows.append(_row(
                l,
                f'<span style="font-size:15px">{money(l["current_price"])}</span>'
                f'<span style="color:#888"> · {km(l.get("current_mileage"))}</span>',
            ))
        text_sections.append("NEW LISTINGS\n\n" + "\n".join(lines))
        html_sections.append(
            '<h3 style="font-size:13px;color:#888;text-transform:uppercase;'
            'letter-spacing:.05em;margin:20px 0 4px">New listings</h3>'
            f'<table style="width:100%;border-collapse:collapse">{"".join(rows)}</table>'
        )

    if changes:
        lines, rows = [], []
        for l in changes:
            pct = (l["current_price"] - l["prev_price"]) / l["prev_price"] * 100
            move = f"{money(l['prev_price'])} → {money(l['current_price'])} ({pct:+.1f}%)"
            lines.append(
                f"{title(l)}\n"
                f"  {move} · {km(l.get('current_mileage'))}\n"
                f"  {_where(l)}\n"
                f"  {l['url']}\n"
            )
            color = "#1a7f37" if pct < 0 else "#c00"
            rows.append(_row(
                l,
                f'<span style="font-size:15px">{money(l["prev_price"])} → '
                f'{money(l["current_price"])}</span> '
                f'<span style="color:{color};font-size:13px">({pct:+.1f}%)</span>'
                f'<span style="color:#888"> · {km(l.get("current_mileage"))}</span>',
            ))
        text_sections.append("PRICE CHANGES\n\n" + "\n".join(lines))
        html_sections.append(
            '<h3 style="font-size:13px;color:#888;text-transform:uppercase;'
            'letter-spacing:.05em;margin:20px 0 4px">Price changes</h3>'
            f'<table style="width:100%;border-collapse:collapse">{"".join(rows)}</table>'
        )

    text = "\n\n".join(text_sections)
    html = (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px">'
        f'<h2 style="font-size:16px;font-weight:600">{subject}</h2>'
        + "".join(html_sections)
    )
    if SITE:
        text += f"\nDashboard: {SITE}\n"
        html += (
            f'<p style="font-size:13px"><a href="{SITE}" style="color:#888">'
            "Open the dashboard</a></p>"
        )
    html += "</div>"
    return subject, text, html


def send(subject, text, html):
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ["SMTP_USER"]
    to = [a.strip() for a in os.environ["NOTIFY_TO"].split(",") if a.strip()]

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ.get("NOTIFY_FROM", user)
    msg["To"] = ", ".join(to)
    msg["Date"] = formatdate(localtime=True)
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as s:
            s.login(user, os.environ["SMTP_PASS"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.starttls(context=ctx)
            s.login(user, os.environ["SMTP_PASS"])
            s.send_message(msg)


def _parse_dt(s):
    """Lenient ISO parse for AutoScout's variable fractional-second precision.
    Mirrors crawl.py's parser so days-on-market lines up with the dashboard."""
    s = s.replace("Z", "+00:00")
    s = re.sub(r"\.(\d+)", lambda m: "." + m.group(1)[:6].ljust(6, "0"), s, count=1)
    return datetime.fromisoformat(s)


def days_listed(l):
    """Days from first listing to delisting, same basis as the dashboard's
    days_on_market (prefer AutoScout's own createdDate). None if undatable."""
    try:
        start = _parse_dt(l.get("as24_created") or l["first_seen"])
        end = _parse_dt(l["delisted_at"])
        return max(0, int((end - start).total_seconds() // 86400))
    except (KeyError, TypeError, ValueError):
        return None


def load_state():
    """notify_state.json: currently just {last_digest_at}. Missing or broken
    reads as empty — worst case the price-change window falls back to
    DIGEST_HOURS and a digest goes out immediately, never a crash."""
    try:
        return json.loads(STATE_F.read_text())
    except (OSError, ValueError):
        return {}


def price_changes_since(listings, since):
    """Active, already-reported listings whose asking price moved after `since`,
    each returned as a copy carrying `prev_price` — the last price recorded at
    or before `since`.

    Reads snapshots.csv: crawl.py appends a row only when price or mileage
    moved, so per listing the last row at-or-before `since` is what the last
    digest (or the new-listing mail) showed."""
    if not SNAPSHOTS_F.exists():
        return []

    snaps = {}
    with SNAPSHOTS_F.open() as f:
        for r in csv.DictReader(f):
            snaps.setdefault(r["listing_id"], []).append(r)

    changes = []
    for l in listings.values():
        # New cars are the digest's other section; delisted cars are the
        # weekly's business.
        if l.get("status") != "active" or not l.get("notified"):
            continue
        rows = sorted(snaps.get(str(l["id"]), []), key=lambda r: r["ts"])
        before = [r for r in rows if _parse_dt(r["ts"]) <= since]
        if not before or not rows or rows[-1] is before[-1]:
            continue
        prev = float(before[-1]["price"]) if before[-1]["price"] else None
        cur = float(rows[-1]["price"]) if rows[-1]["price"] else None
        # Only real price moves; mileage-only snapshots and price-on-request
        # transitions don't make the mail.
        if prev and cur and prev != cur:
            changes.append({**l, "prev_price": prev, "current_price": cur})

    changes.sort(key=lambda l: abs(l["current_price"] - l["prev_price"]), reverse=True)
    return changes


def render_weekly(cars):
    """Digest of cars that left the market since the last weekly run.

    We can't tell a sale from a listing simply being pulled — a disappearance
    is all the API gives us — so the wording stays 'left the market', never
    'sold'."""
    n = len(cars)
    subject = (
        f"1 Ferrari left the market: {title(cars[0])}"
        if n == 1
        else f"{n} Ferraris left the market this week"
    )

    lines, rows = [], []
    for l in cars:
        where = " · ".join(
            x for x in [l.get("seller_city"), l.get("seller_name")] if x
        )
        d = days_listed(l)
        meta = " · ".join(
            x for x in [
                f"last ask {money(l.get('current_price'))}",
                km(l.get("current_mileage")),
                f"{d}d on market" if d is not None else None,
                f"delisted {(l.get('delisted_at') or '')[:10]}",
            ] if x
        )
        lines.append(f"{title(l)}\n  {meta}\n  {where}\n  {l['url']}\n")
        rows.append(
            f'<tr>'
            f'<td style="padding:12px 0;border-bottom:1px solid #eee">'
            f'<a href="{l["url"]}" style="color:#c00;font-weight:600;'
            f'text-decoration:none;font-size:15px">{title(l)}</a><br>'
            f'<span style="font-size:13px;color:#888">{meta}</span><br>'
            f'<span style="color:#888;font-size:13px">{where}</span>'
            f"</td></tr>"
        )

    intro = (
        "A tracked Ferrari left AutoScout in the past week — sold or "
        "delisted, the listing is gone:"
        if n == 1
        else f"{n} tracked Ferraris left AutoScout in the past week "
        "(sold or delisted):"
    )
    text = intro + "\n\n" + "\n".join(lines)
    html = (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px">'
        f'<h2 style="font-size:16px;font-weight:600">{subject}</h2>'
        f'<p style="font-size:13px;color:#555">{intro}</p>'
        f'<table style="width:100%;border-collapse:collapse">{"".join(rows)}</table>'
    )
    if SITE:
        text += f"\nDashboard: {SITE}\n"
        html += (
            f'<p style="font-size:13px"><a href="{SITE}" style="color:#888">'
            "Open the dashboard</a></p>"
        )
    html += "</div>"
    return subject, text, html


def weekly_digest():
    """Weekly recap of every car that has been delisted since the last digest.

    Mirrors main()'s new-listing contract exactly, one level down: `sold_notified`
    is the delivery log, cold start adopts the existing delisted backlog silently,
    and a failed send never marks. Meant to run on a weekly cron, so 'since the
    last digest' is 'the past seven days' in practice."""
    if not LISTINGS_F.exists():
        print("notify --weekly: no listings.json — nothing to do.")
        return

    listings = json.loads(LISTINGS_F.read_text())
    delisted = [l for l in listings.values() if l.get("status") == "delisted"]
    gone = [l for l in delisted if not l.get("sold_notified")]

    # Cold start: a listings.json where no delisted car carries the flag is a
    # backlog, not this week's news. Adopt it silently so switching the digest
    # on doesn't mail every car that ever left the market.
    if delisted and not any(l.get("sold_notified") for l in delisted):
        for l in delisted:
            l["sold_notified"] = True
        write(listings)
        print(f"notify --weekly: first run — adopted {len(delisted)} past "
              "delisting(s), sent nothing.")
        return

    if not gone:
        print("notify --weekly: nothing left the market since the last digest.")
        return

    if not os.environ.get("SMTP_HOST"):
        print(f"notify --weekly: {len(gone)} delisted, but SMTP_HOST unset — "
              "digest off, not marking.")
        return

    gone.sort(key=lambda l: l.get("delisted_at") or "", reverse=True)
    subject, text, html = render_weekly(gone)

    try:
        send(subject, text, html)
    except Exception as e:
        print(f"notify --weekly: send failed ({e.__class__.__name__}: {e}) — "
              "will retry next run.")
        return

    for l in gone:
        listings[str(l["id"])]["sold_notified"] = True
    write(listings)
    print(f"notify --weekly: emailed {len(gone)} delisting(s) to {os.environ['NOTIFY_TO']}.")
    return 0


def test_send():
    """Send one real email on demand, to prove the SMTP path end to end.

    Uses a genuine recent listing as the sample so the mail looks exactly like
    the real thing, and never touches the notified flags. `notify.py --test`.
    """
    if not os.environ.get("SMTP_HOST"):
        print("notify --test: SMTP_HOST unset. Set the SMTP_* / NOTIFY_TO env "
              "vars first (see README's Alerts section).")
        return 1

    sample = None
    if LISTINGS_F.exists():
        active = [l for l in json.loads(LISTINGS_F.read_text()).values()
                  if l.get("status") == "active" and l.get("current_price")]
        if active:
            sample = min(active, key=lambda l: l["current_price"])
    if sample is None:
        sample = {
            "model_key": "f430", "version": "F430 F1", "year": 2007,
            "current_price": 89000, "current_mileage": 42000,
            "seller_city": "Zürich", "seller_name": "Test dealer",
            "url": "https://www.autoscout24.ch/",
        }

    subject, text, html = render_digest([sample], [])
    subject = "[test] " + subject
    text = "This is a test of the Cavallino Index alert. A real one looks like:\n\n" + text
    print(f"notify --test: sending sample to {os.environ.get('NOTIFY_TO', '(NOTIFY_TO unset)')} …")
    send(subject, text, html)
    print("notify --test: sent. Check the inbox (and spam on first delivery).")
    return 0


def main():
    if "--test" in sys.argv:
        return test_send()

    if "--weekly" in sys.argv:
        return weekly_digest()

    if not LISTINGS_F.exists():
        print("notify: no listings.json — nothing to do.")
        return

    listings = json.loads(LISTINGS_F.read_text())
    fresh = [
        l for l in listings.values()
        if l.get("status") == "active" and not l.get("notified")
    ]

    # Cold start: a listings.json where nothing carries the flag is a backlog,
    # not news. Adopt it silently. Otherwise switching alerts on would mail the
    # entire fleet, and every car in it is old.
    if not any(l.get("notified") for l in listings.values()):
        for l in listings.values():
            l["notified"] = True
        write(listings)
        print(f"notify: first run — adopted {len(listings)} existing listings, sent nothing.")
        return

    now = datetime.now(timezone.utc)
    last = load_state().get("last_digest_at")

    # The consolidation gate: inside the window, hold everything — don't mark,
    # don't send. Fresh listings simply stay unflagged and price moves keep
    # accumulating in snapshots.csv until the window reopens.
    if last and now - _parse_dt(last) < timedelta(hours=DIGEST_HOURS):
        reopens = (_parse_dt(last) + timedelta(hours=DIGEST_HOURS)).strftime("%Y-%m-%d %H:%M UTC")
        if fresh:
            print(f"notify: holding {len(fresh)} new listing(s) — "
                  f"digest window reopens {reopens}.")
        else:
            print(f"notify: digest window closed until {reopens}, nothing held.")
        return

    # No prior digest (first run of the consolidated format): look back one
    # window rather than the whole snapshot history, or that first mail would
    # replay months of price moves.
    since = _parse_dt(last) if last else now - timedelta(hours=DIGEST_HOURS)
    changes = price_changes_since(listings, since)

    if not fresh and not changes:
        print("notify: window open but nothing to report.")
        return

    if not os.environ.get("SMTP_HOST"):
        print(f"notify: {len(fresh)} new / {len(changes)} price change(s), "
              "but SMTP_HOST unset — alerts off, not marking.")
        return

    fresh.sort(key=lambda l: l.get("current_price") or 0)
    subject, text, html = render_digest(fresh, changes)

    try:
        send(subject, text, html)
    except Exception as e:
        # Don't mark, don't fail the crawl. Next run retries; the data is what
        # matters and it's already written.
        print(f"notify: send failed ({e.__class__.__name__}: {e}) — will retry next run.")
        return

    for l in fresh:
        listings[str(l["id"])]["notified"] = True
    write(listings)
    STATE_F.write_text(json.dumps({"last_digest_at": now.isoformat()}, indent=1))
    print(f"notify: digest sent to {os.environ['NOTIFY_TO']} — "
          f"{len(fresh)} new, {len(changes)} price change(s).")


if __name__ == "__main__":
    sys.exit(main())
