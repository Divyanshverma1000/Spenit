# 07 · AI at Scale: Cost, Quotas and Who Pays

> **In one line:** AI is our smallest workload by count and our biggest by cost. Scaling
> it is mostly an **economics** problem: tokens × price × users, then cutting each factor.

---

## 1. How AI is billed: tokens

Models read and write **tokens** (~¾ of a word in English, often more per word in Hindi).
You pay per million tokens, **input and output priced separately**. Output usually costs 3–5x more.

### Spenit's AI calls (estimates, measure the real numbers in `UsageDaily.ai_tokens_*`)

| Call | Model today | Input tokens | Output tokens |
|---|---|---|---|
| Read a bill/order photo | `qwen/qwen3.8-27b` (vision) | ~1,500–3,000 (image + prompt) | ~400–1,200 (JSON items) |
| "Type it" expense | `openai/gpt-oss-120b` | ~800 | ~200 |
| Group/personal chat question | `openai/gpt-oss-120b` | ~2,000–4,000 (context) | ~200–400 |

### Prices (approx., Nov 2026, **check groq.com/pricing**)
- `gpt-oss-120b` on Groq: ~**$0.15 per 1 M input**, ~**$0.60 per 1 M output**. Batch and
  cached-input discounts of ~50% are reported.
- Vision models vary widely (roughly $0.20–$0.90 per 1 M). We'll assume **$0.30 in / $0.60 out**.

### Cost per action

```
 cost = input_tokens × in_price / 1e6  +  output_tokens × out_price / 1e6

 Scan:  2,500 × 0.30/1e6 + 800 × 0.60/1e6  = $0.00075 + $0.00048 ≈ $0.0012  (≈ ₹0.10)
 Chat:  3,000 × 0.15/1e6 + 300 × 0.60/1e6  = $0.00045 + $0.00018 ≈ $0.0006  (≈ ₹0.05)
 Type:    800 × 0.15/1e6 + 200 × 0.60/1e6                        ≈ $0.0002
```

### Monthly AI bill by scale (using chapter 02's usage assumptions)

| Users | Scans/month | Chats/month | AI cost/month |
|---|---|---|---|
| 10k | 13.5k | 9k | ~$22 (₹1.9k) |
| 1 M | 1.35 M | 900k | ~$2,200 (₹1.9 L) |
| 10 M | 13.5 M | 9 M | ~$22,000 (₹19 L) |

Plus **retries, abuse, and the launch spike** (×2–3 in the bad week). These numbers are
manageable **if we control them**. The danger is uncontrolled cost, not the average.

---

## 2. Who pays? Three models

### A. Our key for everyone (server key)
- ✅ Zero friction. The "wow" works on first open.
- ❌ We pay for every scan. One account's quota is shared by all (bottleneck #1).
- ❌ Abuse: a bot with 1,000 fake accounts can burn our budget.

### B. Bring Your Own Key (BYOK), which we support today
- ✅ Free for us. The user's own quota.
- ❌ **Almost no mainstream user will do it.** "Create a Groq account, generate an API key,
  paste it" is a developer workflow. At scale, maybe ~1% of users.
- ❌ Support burden: expired keys, wrong models, "it says 401".
- ✅ Great for **power users and early testers**, and as an escape hatch.
- We encrypt stored keys (AES-GCM, `enc:v1:`): good practice, keep it.

### C. Hybrid with quotas (our choice)
```
 Every user:   N free scans/day + M chats/day on our key        (e.g. 3 scans, 5 chats)
 Over quota:   friendly prompt → "type it" (free, no AI) or come back tomorrow
 Power users:  BYOK for unlimited
 Later:        Spenit Plus (₹49–99/month) for unlimited + priority queue
```
- The quota is the **budget control**: cost ≤ users × quota × cost per action.
  With 3 scans/day, the absolute worst case at 1M DAU is 3M scans × $0.0012 ≈ $3,600/day.
  That's knowable and alertable.
- The per-user **exact** limiter we built (`strictLimit`, 20/min and 400/day) is the
  enforcement mechanism. Add the daily *free* quota on top.

> **Is "Groq for everyone via BYOK" feasible?** As the *main* model, no: it kills the
> first-use magic and won't be adopted. As an *option* alongside a free quota on our key, yes.

---

## 3. Cutting cost 10x without users noticing

Ordered by impact-to-effort:

| # | Technique | Saves | How |
|---|---|---|---|
| 1 | **Don't call AI when not needed** | 20–40% | The quick-add parser handles "milk 60" with regex. Only ambiguous text goes to the LLM. We already do this in personal quick add. |
| 2 | **Cache by image hash** | 5–15% | Users retry the same photo. Hash the compressed image, reuse the result for 24 h. |
| 3 | **Smaller images** | 20–40% of vision input | Vision tokens grow with resolution. 1280 px is often enough for a bill. Crop to the receipt area. |
| 4 | **On-device OCR first** | 50–80% of scans | Run OCR *on the phone* (Google ML Kit, Apple Vision, or Tesseract via WebAssembly in the browser) → send **text** to a cheap text model instead of an image to a vision model. Fall back to vision only when OCR is poor. |
| 5 | **Model routing** | 30–60% | Easy, well-structured inputs go to a small, cheap model. Only hard ones go to the big model. Measure accuracy per route. |
| 6 | **Shorter prompts and context** | 10–30% | Chat context: send only the relevant rows (we already filter with `groupAiContext`), not the whole history. |
| 7 | **Prompt caching** | up to 50% of repeated input | Our long, fixed system prompt (`ORDER_EXTRACT_PROMPT`) is the same on every call. Providers that cache prompt prefixes charge less for it. |
| 8 | **Batch API** | ~50% | For non-urgent work (insights, re-processing), use batch inference. |
| 9 | **Output limits** | 5–10% | `max_tokens`, and JSON mode so the model doesn't ramble. |

---

## 4. Reliability: never depend on one AI provider

```
           ┌─► Groq (primary: fast, cheap)
 Router ───┼─► Provider B (fallback: e.g. Gemini Flash, OpenRouter, Together, Fireworks)
           └─► "Type it instead" (final fallback: no AI)
```

- A **circuit breaker** per provider: after X failures in Y seconds, stop calling it for
  Z seconds and go straight to the fallback. This saves time and stops hammering a sick
  provider.
- **Same JSON contract** for every provider, so `normalizeOrder()` doesn't care who answered.
  Our normalisation layer (`orderExtract.ts`) is already the right shape for this.
- **Evaluation set:** keep 100 real (anonymised) bills with known correct answers. Run
  every new model or provider against them **before** switching. Without this, cheaper
  models will quietly make reading worse.

---

## 5. When to self-host models

### What self-hosting means
Renting GPUs (e.g. an NVIDIA H100/L40S) and running open models (Qwen, Llama, gpt-oss)
with an inference server (**vLLM**, **TGI**, **SGLang**), plus autoscaling, monitoring
and on-call.

### The maths
- One rented H100 costs ~$2–3/hour ≈ **$1,500–2,200/month**. You need **at least 2** for
  redundancy, and more for peak hours. Peak-to-average is ~5x for us (dinner time), so GPUs
  sit idle most of the day unless you fill them with batch work.
- **Plus people:** someone who knows GPU inference, quantisation, batching and upgrades.
  That's the real cost.

| Monthly API spend | Self-host? |
|---|---|
| < $5k | ❌ No. The API is cheaper than one engineer's time. |
| $5k–$30k | 🤔 Only if we have a clear reason (privacy, latency, a custom fine-tuned model) |
| > $30k, steady, predictable | ✅ Run the numbers seriously. Often a **hybrid**: own GPUs for the steady base load, API for spikes. |

**At Spenit's projected ~$2k/month at 1M users, self-hosting makes no sense.** Around
10M users (~$20k+/month), it becomes a real conversation, *especially* if on-device OCR plus
a **small fine-tuned model** (say a 3–8B model trained on Indian bills) can do the job.
Small models are cheap to host and fast.

### Other reasons to self-host (beyond cost)
- **Privacy/data residency:** bills never leave our infrastructure (helpful for India's
  DPDP Act story).
- **Latency control:** no shared queue at a provider.
- **Fine-tuning:** a model specialised for GST bills, Blinkit screenshots and UPI receipts.

### The direction we'd take
```
 Now (≤100k users)    Groq + fallback provider, free quota, BYOK for power users
 1M users             + on-device OCR → text model, image-hash cache, routing, async queue
 3–10M users          + fine-tune a small model on our own (consented, anonymised) data,
                        host it on a serverless GPU platform (pay per second, e.g. Modal,
                        Replicate, Workers AI) before owning GPUs
 10M+ users           Own/reserved GPUs for base load + API for spikes, if the maths holds
```

---

## 6. Guardrails (do these before launch)

1. **Daily free quota per user** (enforced server-side).
2. **Global daily budget**: if today's tokens × price passes the threshold, switch scans to
   "type it" mode for free users (a feature flag, no deploy).
3. **Budget alerts** at 50/80/100% (provider dashboard + our `UsageDaily` + admin push).
4. **Abuse signals**: many accounts from one device/IP, scans of non-bills, scripted timing.
5. **Privacy**: we already mask names on receipts before sending them to AI and never store
   photos. Keep it that way, and say so in the privacy policy.

---

### Self-check

1. Compute the cost of 100k scans at 2,000 input / 600 output tokens, $0.30/$0.60 per M.
2. Why won't BYOK work as the main model for a consumer app?
3. Name three ways to cut vision cost, and which one is the biggest.
4. What does a circuit breaker do, and why does it help *the sick provider* too?
5. At what monthly spend would you seriously consider self-hosting, and what besides
   GPUs goes into that cost?

*(1: 100k × (2000×0.3 + 600×0.6)/1e6 = 100k × $0.00096 = $96.)*
