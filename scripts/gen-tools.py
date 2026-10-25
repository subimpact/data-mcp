#!/usr/bin/env python3
"""Regenerate src/tools.json from PUBLIC Apify Store metadata only (no token).

For every tool in src/tools.json (plus any NEW_TOOLS below) it re-reads:
  GET https://api.apify.com/v2/acts/<user>~<name>                -> title, description, pricing
  GET https://api.apify.com/v2/acts/<user>~<name>/builds/default -> input schema
and rewrites src/tools.json in the same order (new tools appended).

Usage: python3 scripts/gen-tools.py [--check]
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "src" / "tools.json"
UA = {"User-Agent": "subimpact-data-mcp-gen/1.0"}

# tool name -> actor, for actors not yet in tools.json
NEW_TOOLS = {
    "rss_feed_reader": "subimpact/rss-feed-reader",
    "telegram_channel": "subimpact/telegram-channel-scraper",
    "google_flights": "subimpact/google-flights-scraper",
}

PROP_KEYS = ["title", "type", "description", "enum", "enumTitles", "default", "prefill",
             "example", "items", "minimum", "maximum", "minItems", "maxItems"]


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        data = json.load(r)
    return data.get("data", data)


def fmt_price(p):
    return f"${p}"


def build(tool, actor):
    slug = actor.replace("/", "~")
    meta = get(f"https://api.apify.com/v2/acts/{slug}")
    if not meta.get("isPublic"):
        raise SystemExit(f"{actor} is not public")
    rec = (meta.get("pricingInfos") or [{}])[-1]
    events = ((rec.get("pricingPerEvent") or {}).get("actorChargeEvents")) or {}
    pricing = []
    for key, ev in events.items():
        if key == "apify-actor-start":
            continue
        price = ev.get("eventPriceUsd")
        if price is None:
            price = ((ev.get("eventTieredPricingUsd") or {}).get("FREE") or {}).get("tieredEventPriceUsd")
        if price is not None:
            pricing.append(f"{ev.get('eventTitle', key)}: {fmt_price(price)}")
    schema = json.loads(get(f"https://api.apify.com/v2/acts/{slug}/builds/default").get("inputSchema") or "{}")
    props = {}
    for name, p in (schema.get("properties") or {}).items():
        if p.get("editor") == "hidden":
            continue
        props[name] = {k: p[k] for k in PROP_KEYS if k in p}
    inp = {"properties": props, "required": schema.get("required", [])}
    return {
        "tool": tool,
        "actor": actor,
        "title": meta.get("title"),
        "description": meta.get("description"),
        "pricing": pricing,
        "usage_paid_by_user": rec.get("isPPEPlatformUsagePaidByUser"),
        "input": inp,
    }


def main():
    current = json.loads(SPEC.read_text())
    pairs = [(t["tool"], t["actor"]) for t in current]
    known = {t for t, _ in pairs}
    pairs += [(t, a) for t, a in NEW_TOOLS.items() if t not in known]
    fresh = [build(t, a) for t, a in pairs]
    text = json.dumps(fresh, indent=2, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        sys.exit(0 if text == SPEC.read_text() else 1)
    SPEC.write_text(text)
    print(f"wrote {len(fresh)} tools to {SPEC}")


if __name__ == "__main__":
    main()
