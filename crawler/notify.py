#!/usr/bin/env python3
"""
New-listing email alerts.

Runs right after crawl.py in the same Action, reads the listings.json that
crawl just wrote, emails anything newly seen, and marks it notified so the
next run stays quiet.

Stdlib only, no dependencies. Configured entirely by environment:

  SMTP_HOST   smtp.gmail.com
  SMTP_PORT   465 (implicit TLS) or 587 (STARTTLS)
  SMTP_USER   full address to log in as
  SMTP_PASS   app password, never the account password
  NOTIFY_TO   comma-separated recipients
  NOTIFY_FROM optional, defaults to SMTP_USER

Unset SMTP_HOST and this is a no-op — the crawl still publishes. Alerts are a
side-car, and a broken mailbox must never cost us a data point.

The notified flag lives in listings.json, which is committed, so the repo is
the delivery log. No state of our own, same as the rest of this project.
"""

import json
import os
import re
import smtplib
import ssl
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import formatdate
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
LISTINGS_F = DATA / "listings.json"

# Display names for the keys crawl.py tracks. Falls back to the raw key, so
# adding a model to MODELS never breaks the mail.
MODEL_NAMES = {
    "f430": "F430",
    "sf90": "SF90",
    "812": "812",
    "488": "488",
    "f360": "F360",
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


def render(cars):
    n = len(cars)
    subject = (
        f"New on AutoScout: {title(cars[0])} — {money(cars[0]['current_price'])}"
        if n == 1
        else f"{n} new Ferrari listings"
    )

    lines, rows = [], []
    for l in cars:
        where = " · ".join(
            x for x in [l.get("seller_city"), l.get("seller_name")] if x
        )
        lines.append(
            f"{title(l)}\n"
            f"  {money(l['current_price'])} · {km(l.get('current_mileage'))}\n"
            f"  {where}\n"
            f"  {l['url']}\n"
        )
        rows.append(
            f'<tr>'
            f'<td style="padding:12px 0;border-bottom:1px solid #eee">'
            f'<a href="{l["url"]}" style="color:#c00;font-weight:600;'
            f'text-decoration:none;font-size:15px">{title(l)}</a><br>'
            f'<span style="font-size:15px">{money(l["current_price"])}</span>'
            f'<span style="color:#888"> · {km(l.get("current_mileage"))}</span><br>'
            f'<span style="color:#888;font-size:13px">{where}</span>'
            f"</td></tr>"
        )

    text = "\n".join(lines)
    html = (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px">'
        f'<h2 style="font-size:16px;font-weight:600">{subject}</h2>'
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

    subject, text, html = render([sample])
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

    if not fresh:
        print("notify: nothing new.")
        return

    if not os.environ.get("SMTP_HOST"):
        print(f"notify: {len(fresh)} new, but SMTP_HOST unset — alerts off, not marking.")
        return

    fresh.sort(key=lambda l: l.get("current_price") or 0)
    subject, text, html = render(fresh)

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
    print(f"notify: emailed {len(fresh)} new listing(s) to {os.environ['NOTIFY_TO']}.")


if __name__ == "__main__":
    sys.exit(main())
