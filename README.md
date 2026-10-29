# @subimpact/data-mcp

Public-data tools for AI agents, in one MCP server. Point it at your own [Apify](https://apify.com) account and your model can search Google (organic results, People Also Ask, knowledge graph and full AI Overviews), run Google AI Mode queries, watch news mentions across Southeast Asian publishers, collect Google Maps places, Google Jobs, Trends, website contacts, page-to-markdown, Ads Transparency data, YouTube, TikTok, Eventbrite, ATS career pages, Substack, Bluesky, Lazada products, JSON-LD entity graphs, SEO audits and Pinterest — all as JSON instead of browser tabs. Every tool wraps one actor from the [subimpact Apify Store](https://apify.com/subimpact): the server starts the actor with **your** `APIFY_TOKEN`, waits for it, and returns the dataset items. Nothing is scraped locally and no credentials of ours are involved.

## Install

You need an Apify API token: [console.apify.com → Settings → Integrations](https://console.apify.com/settings/integrations). Runs are billed to that Apify account at each actor's Store price (pay per event).

### Claude Code

```bash
claude mcp add subimpact-data -e APIFY_TOKEN=... -- npx -y @subimpact/data-mcp
```

### Claude Desktop

Add this to `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "subimpact-data": {
      "command": "npx",
      "args": ["-y", "@subimpact/data-mcp"],
      "env": {
        "APIFY_TOKEN": "apify_api_your_token"
      }
    }
  }
}
```

### Cursor

Add the same block to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "subimpact-data": {
      "command": "npx",
      "args": ["-y", "@subimpact/data-mcp"],
      "env": {
        "APIFY_TOKEN": "apify_api_your_token"
      }
    }
  }
}
```

Want a smaller tool list? Add `"--tools", "google_search,news_mentions"` to `args`, or set `SUBIMPACT_TOOLS=google_search,news_mentions` in `env`. `get_run_results` is always available.

## Tools

<!-- tools:start -->

| Tool | What it does | Price |
| --- | --- | --- |
| [`google_search`](https://apify.com/subimpact/google-serp-ai-overviews) | Google search as JSON: full AI Overview answers (lists, citations, sources) plus organic results, People Also Ask, knowledge graph, top stories and local results in one… | Google SERP: $0.003 |
| [`google_ai_mode`](https://apify.com/subimpact/google-ai-mode-scraper) | Real Google AI Mode answers (udm=50 tab) rendered in Android Chrome, for any country and language: full answer, structured blocks, resolved source URLs and per-paragraph… | AI Mode search completed: $0.003 + platform usage |
| [`news_mentions`](https://apify.com/subimpact/news-mentions-api) | Search a curated index of publisher news feeds by keyword and get clean article rows: title, snippet, publisher URL, source, region, topic, language and publish time.… | Article: $0.001 + platform usage |
| [`google_maps_places`](https://apify.com/subimpact/google-maps-scraper-plainhttp) | Extract Google Maps places with phone, website, rating, reviews, opening hours, popular times, images and place ID. Plain HTTP, no browser, $1.00 per 1,000 places.… | Place scraped: $0.001; Review scraped: $0.0005; Actor start: $0.00005; Add-on: Company contacts: $0.001 + platform usage |
| [`google_jobs`](https://apify.com/subimpact/google-jobs-scraper) | Scrape Google Jobs listings by query and country: title, company, location, source (LinkedIn, Indeed...), posted date, salary, job type, description and apply links. No… | Job: $0.001 + platform usage |
| [`website_contacts`](https://apify.com/subimpact/website-contact-extractor) | Extract emails, phone numbers and social profile links (Facebook, Instagram, LinkedIn, X, TikTok, YouTube, WhatsApp, Telegram) from any list of websites. Plain HTTP, no… | Page scanned: $0.0008 + platform usage |
| [`google_trends`](https://apify.com/subimpact/google-trends-scraper-keyless) | Scrape Google Trends interest-over-time, related queries/topics, and per-region interest for keywords. No API key, no browser, no captcha. Up to 5 keywords compared per… | Keyword trends bundle: $0.0025 + platform usage |
| [`web_page_markdown`](https://apify.com/subimpact/rag-web-browser-lite) | Web search and fetch tool for AI agents and RAG pipelines. Queries Google Search, scrapes the top N pages over raw HTTP, and returns clean Markdown. $0.001 per page plus… | Page extracted: $0.001 + platform usage |
| [`google_ads_transparency`](https://apify.com/subimpact/google-ads-transparency-scraper) | Scrape Google Ads Transparency Center: find advertisers by name or ID and export their ads with format, first and last shown dates, preview and ad links, filtered by… | Ad: $0.0008; Advertiser: $0.0005 + platform usage |
| [`youtube`](https://apify.com/subimpact/youtube-scraper) | Fast YouTube scraper with no browser and no API key: keyword search with filters, channel videos and Shorts, channel About data, playlists, video details (exact likes,… | Result: $0.001 + platform usage |
| [`tiktok_hashtag`](https://apify.com/subimpact/tiktok-hashtag-scraper) | High-speed TikTok hashtag scraper. Extract videos, views, likes, comments, shares, audio details, and creator profiles by hashtag at an ultra-competitive price. | Video: $0.001 |
| [`eventbrite_events`](https://apify.com/subimpact/eventbrite-scraper) | Scrape Eventbrite events with venue and organizer data by default. Search by city, keyword, category, price and dates, or by event URL or organizer. $2.00 per 1,000… | Event: $0.002 + platform usage |
| [`company_career_jobs`](https://apify.com/subimpact/ats-jobs-api) | Get live job postings straight from company career pages — Greenhouse, Lever, Ashby, Workday, SmartRecruiters — normalized into one schema, with new-job monitoring for… | Job scraped: $0.001; Company monitored: $0.02 + platform usage |
| [`substack`](https://apify.com/subimpact/substack-intel-api) | Substack Intel API — Posts, Archives & Publication Stats | Run started: $0.00005; Post or publication row: $0.001 + platform usage |
| [`bluesky`](https://apify.com/subimpact/bluesky-scraper-api) | Scrape Bluesky posts, profiles, threads, and follower graphs by keyword, hashtag, or handle. No login required. Fast AT Protocol API, JSON/CSV export, pay only per… | Post scraped: $0.001; Profile scraped: $0.002 + platform usage |
| [`lazada_products`](https://apify.com/subimpact/lazada-scraper) | Scrape Lazada search results and category pages across 6 SEA markets (MY/SG/TH/ID/PH/VN) with a real browser session via Apify residential proxy. Monitor price drops,… | Product scraped: $0.00099; Product checked: $0.003; Alert created: $0.01 + platform usage |
| [`jsonld_entities`](https://apify.com/subimpact/jsonld-entity-graph-resolver) | Extract deeply nested JSON-LD, validate against Schema.org (979 types, 1,633 properties), and resolve disconnected blocks into one unified knowledge graph with typed… | Actor start: $0.00005; Page processed: $0.0015 + platform usage |
| [`seo_page_audit`](https://apify.com/subimpact/seo-helper) | Port of the SEO Minion extension as an API: full on-page audits per URL (meta tags, headings, images, links, structured data, hreflang) plus Google SERP snippet previews… | page audit: $0.001; SERP preview: $0.001 + platform usage |
| [`pinterest`](https://apify.com/subimpact/pinterest-scraper) | Scrape Pinterest pins from keyword search, boards and profiles. Full-res originals, video variants, board/pinner metadata, repin counts. Pure HTTP - no browser, no… | Pin scraped: $0.00199; Media downloaded: $0.005 + platform usage |
| [`rss_feed_reader`](https://apify.com/subimpact/rss-feed-reader) | Read RSS, RDF, Atom and JSON Feed URLs and get one clean JSON row per item: title, link, ISO dates, author, summary, categories, image, enclosures. Only-new mode for… | Feed item: $0.0005 + platform usage |
| [`telegram_channel`](https://apify.com/subimpact/telegram-channel-scraper) | Scrape public Telegram channels via the t.me web preview: one row per post with text, date, views, media, link previews, polls, reactions, hashtags and links, plus… | Post: $0.0003; Channel info: $0.001 + platform usage |
| [`google_flights`](https://apify.com/subimpact/google-flights-scraper) | Search Google Flights and get one row per flight option: fare, airlines, flight numbers, times, airports, stops, layovers, aircraft, legroom and CO2. One-way or round… | Flight search: $0.002 + platform usage |
| [`my_grocery_prices`](https://apify.com/subimpact/my-grocery-prices) | One normalised Malaysian grocery price feed from 99 Bulksales, Jaya Grocer and KPDN PriceCatcher, with pack-size parsing, RM per kg / litre / piece unit prices and… | Product price row: $0.001 + platform usage |

<!-- tools:end -->

Every tool also accepts two optional control parameters:

- `_maxItems` (integer, default 50, max 1000) — how many dataset items come back to the model. It truncates the response only; the actor still collects (and charges for) what its input asks for.
- `_maxChargeUsd` (number, default 0.5) — per-run spending cap in USD, sent to Apify as the run option `maxTotalChargeUsd`. The run stops when it reaches the cap, so an accidental large batch cannot cost more than this.

The extra `get_run_results` tool (`runId`, `_maxItems`, `offset`) fetches the status and items of a run that was still running when its tool call returned. Long jobs return a `runId` instead of blocking forever; call it later to collect the results.

## Cost control

Every call is a real Apify run on **your** account, priced per event by the actor (for example `google_search` at $0.003 per SERP, `news_mentions` at $0.001 per article). There is no subscription and this server never charges you: Apify bills your account directly.

- Start with the default `_maxChargeUsd` of `$0.50`; it is passed to Apify and enforced by the platform.
- Use `_maxItems` to keep model context (and token spend on the model side) small.
- Narrow the actor input instead of raising the cap when you need fewer, more targeted results.
- Each response includes `itemCount` (total items in the dataset) and `returned` (items sent to the model), so you can see when a result was truncated.

A single tool call waits up to `SUBIMPACT_TIMEOUT_SECS` (default 240 seconds). If the run is still going, you get its `runId` and can collect the results with `get_run_results`.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `APIFY_TOKEN` | yes (for calls) | Your Apify API token. `tools/list` works without it so directories can introspect the server. |
| `SUBIMPACT_TOOLS` | no | Comma-separated subset of tool names to expose, e.g. `google_search,news_mentions`. |
| `SUBIMPACT_TIMEOUT_SECS` | no | Per-call wait budget in seconds (default `240`). |
| `SUBIMPACT_API_BASE` | no | Override the Apify API base URL (default `https://api.apify.com/v2`); meant for testing against a mock. |

CLI flags: `--tools a,b,c`, `--help`, `--version`.

## What it is not

- **Not a local scraper.** It does not fetch pages or parse HTML itself; it runs Apify actors, which do the scraping on Apify's infrastructure.
- **Not a credential holder of ours.** The only token it uses is the `APIFY_TOKEN` you set. The server ships with no secrets and calls no private backend.
- **Not free.** Every tool call is an Apify run billed to your Apify account at the actor's Store price. The `_maxChargeUsd` cap limits a single run, not your monthly Apify spend.
- **Not an official Apify product**, and not affiliated with Google, TikTok, Meta, Lazada or the other platforms whose public data the actors read.
- **Not a guarantee of data.** Public sites change; review each actor's Store page for current coverage, pricing and limitations.

## Development

```bash
npm install
npm run build       # tsc + copy src/tools.json into dist/
npm test            # offline tests: mocked fetch + a stdio round trip
npm run typecheck
npm run gen:readme  # regenerate the tool table above from src/tools.json
node dist/index.js  # run the stdio server
```

`src/tools.json` is a verbatim snapshot of public Apify Store actor metadata: tool names, descriptions, pay-per-event pricing and input schemas. The MCP tool definitions, descriptions and this README's tool table are generated from it.

## License

MIT © 2026 subimpact network
