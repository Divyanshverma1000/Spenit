# 12 · The Roadmap: What We Do, When, and What It Costs

> **In one line:** don't build for 10M users on day one. Build for the next 10x, and
> write down the **trigger** that tells you it's time for the step after that.

---

## 1. The principle: triggers, not guesses

Each step below has a **trigger**: a number on a dashboard. When the trigger fires,
we do the step. This keeps us from over-engineering early ("YAGNI": You Aren't Gonna Need It)
*and* from being surprised late.

---

## 2. Stage 0: Before real users (now, ~a week of work)

The "cheap insurance" list. Each item is small, and together they cover most of
launch-day chapter 03.

| # | Do | Why | Chapter |
|---|---|---|---|
| 1 | Wrap push sending in `waitUntil` | Stop silently dropped notifications | 06 |
| 2 | Daily free AI quota per user + global AI budget switch | Cap the worst-case bill | 07 |
| 3 | Feature flags: `ai_scan_enabled`, `signups_open`, `ai_free_daily` | Kill switches without deploys | 09 |
| 4 | Fallback AI provider behind the same JSON contract | No single AI point of failure | 07 |
| 5 | Batch the `UsageDaily` counters | Remove the hot row | 04 |
| 6 | Paginate the group screen (latest 50, cursor) | Big groups stay fast | 04 |
| 7 | Request id in logs + error screen | Debug user reports in one search | 09 |
| 8 | Run tests in GitHub Actions on every push | Catch regressions before deploy | 11 |
| 9 | Budget alerts on Groq, Supabase, Cloudflare, Vercel | No surprise bills | 07 |
| 10 | A status page on a separate host | Somewhere to talk when we're down | 03 |
| 11 | Make sure Cloudflare is on the **Workers Paid** plan | The free plan stops serving at 100k requests/day | 12 |

---

## 3. The stages after launch

### Stage 1: 1k → 100k users
| Trigger | Step |
|---|---|
| Any data we can't afford to lose | **Supabase PITR** on (RPO seconds) |
| DB CPU > 50% at peak | Bump Supabase compute one size; check `pg_stat_statements` top 5 |
| Cache hit rate < 50% (measure it!) | **Shared cache** (Upstash Redis) for balances and overview, versioned keys |
| First Groq 429s in logs | Async scan queue + fallback routing |
| p95 of group screen > 800 ms | ETag/304 + pagination checks |

### Stage 2: 100k → 1M users
| Trigger | Step |
|---|---|
| DB CPU > 60% after caching | **First read replica** + read routing + sticky-primary-after-write |
| Push volume > 50k/day | **Cloudflare Queues** for push fan-out + DLQ; outbox table for "save then notify" |
| AI spend > $1k/month | On-device OCR → text model, image-hash cache, model routing |
| Exact rate-limit writes are a top-10 query | Move limits to Durable Objects or Redis |
| Group screen p95 > 300 ms | `GroupBalance` running totals + nightly reconciliation |
| Team grows past 2–3 engineers | Staging environment, gradual deploys, on-call rota, runbooks |

### Stage 3: 1M → 10M users
| Trigger | Step |
|---|---|
| Replica CPU > 60% | More replicas; per-group state in Durable Objects (cache + live updates) |
| `Expense` > 100M rows | Time-based partitioning; archive settled old groups |
| Dashboard queries slow the primary | Analytics pipeline: CDC → ClickHouse/BigQuery; dashboards read there |
| AI spend > $15–30k/month, steady | Fine-tuned small model on serverless GPUs; evaluate reserved GPUs |
| Region outage risk unacceptable | Cross-region replica + DR drill |

### Stage 4: 10M+ (only if writes outgrow one big primary)
- Shard by `group_id` (Citus or similar), per-user summaries via events.
- By then there's a platform team, and this guide has done its job.

---

## 4. What it costs (rough, monthly, Nov 2026 prices, verify before using)

### The unit prices we used
| Service | Price basis (approx.) |
|---|---|
| Cloudflare Workers Paid | $5/month minimum, includes ~10M requests + 30M CPU-ms; pay-as-you-go after |
| Supabase Pro | $25/month per organisation + compute per project (small ~$10, large sizes up to ~$1,000+) |
| Supabase PITR | ~$100/month per 7 days of retention |
| Vercel | Hobby is non-commercial; Pro ~$20/member/month |
| Upstash Redis | Pay per request; ~$0.2 per 100k commands, or fixed plans |
| Groq | See chapter 07 (≈ $0.0012 per scan, ≈ $0.0006 per chat) |

### The bill

| Line | 10k users | 1M users | 10M users |
|---|---|---|---|
| Workers + Queues + DOs | $5 | ~$60 | ~$600 |
| Supabase (plan + compute) | $35 | ~$400 | ~$2,500 |
| Replicas | — | ~$200 | ~$2,000 |
| PITR | (optional) | $100 | $200 |
| Shared cache (Redis) | — | ~$80 | ~$600 |
| Vercel | $20 | ~$50 | ~$300 |
| Observability (logs/metrics) | $0 | ~$100 | ~$800 |
| **AI (no optimisation)** | $22 | $2,200 | $22,000 |
| **AI (with chapter 07 cuts, ~60% less)** | $10 | ~$900 | ~$9,000 |
| **Total (optimised)** | **~$70 (₹6k)** | **~$2,000 (₹1.7 L)** | **~$16,000 (₹14 L)** |
| **Per user per month** | $0.007 | $0.002 | $0.0016 |

### Lessons in this table
1. **AI is ~50–60% of the bill at every scale.** Optimising AI matters more than any
   infra choice.
2. **Cost per user falls with scale** (fixed costs spread out), which is the classic SaaS curve.
3. **Unit economics:** if 2% of 1M users pay ₹49/month → ₹9.8 L/month ≈ $11,700. That's ~6x the
   optimised cost. Even a small paid tier makes Spenit sustainable. Without one, ₹1.7 L/month
   needs ads, sponsors or investors.

---

## 5. What we deliberately *won't* do (and why)

| Tempting | Why not (yet) |
|---|---|
| Microservices | One codebase, one deploy, small team. Split along clear lines (e.g. an "AI service") only when a team or scaling need forces it. |
| Kafka | A queue does what we need. Kafka is for many consumers replaying high-volume streams. |
| Kubernetes | Workers + managed Postgres already give us autoscaling without operating clusters. |
| Sharding early | One big primary + replicas covers us well past 10M users (chapter 04). |
| Multi-region writes | Money correctness across regions is very hard, and our users are in one country. |
| Self-hosted GPUs | Cheaper only above ~$30k/month of steady AI spend (chapter 07). |

> **The senior-engineer move:** "boring technology, scaled with discipline" beats
> "exciting technology, scaled with hope".

---

### Self-check

1. Which three Stage 0 items would you do first, and why?
2. What trigger tells us it's time for a read replica?
3. Why is AI optimisation worth more than any database choice, cost-wise?
4. Name two things we're deliberately not doing, and the reason for each.
