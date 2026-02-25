# ML Recommendations — Phase 2 Design Notes

**Status**: Not implemented. Phase 1 (statistical model) is live and sufficient for current scale.
**Revisit when**: >50 products, >30 active users, or statistical model accuracy becomes noticeably poor.

---

## What Phase 1 Does (current)

`RecommendationService.computeForUser()` runs a single SQL query with a hand-tuned 3-component score:

```
score = 0.40 × temporal_affinity   (bought at similar time-of-day/day-of-week before?)
      + 0.35 × purchase_frequency   (how often relative to most-bought item?)
      + 0.25 × recency_decay        (EXP decay over 14-day half-life)
```

Results are stored nightly in `recommendations` (model = `'statistical'`) and served via
`getRecommendedIds()`. Weights are fixed constants — no learning.

---

## What Phase 2 Would Add

A trained gradient-boosted tree (LightGBM) that replaces or augments the statistical score.
The key difference: it **learns weights from data** rather than using constants, and can
capture interaction effects the formula misses (e.g. "user A buys Cola on Fridays but
user B buys it on Mondays").

---

## Data Already Being Collected

Everything needed for training exists in the DB:

| Table             | Relevant columns                                   | Used as                                  |
| ----------------- | -------------------------------------------------- | ---------------------------------------- |
| `orders`          | `buyer_id`, `delivery_id`, `created_at`, `channel` | Ground truth — positive labels           |
| `deliveries`      | `product_id`, `price`, `amount_left`, `created_at` | Product availability context             |
| `page_views`      | `user_id`, `channel`, `created_at`                 | Implicit interest signal (weak positive) |
| `kiosk_sessions`  | `user_id`, `created_at`                            | Session context                          |
| `recommendations` | `user_id`, `product_id`, `score`, `rank`           | Baseline model signal as a feature       |

There are no explicit **negative** labels — a user not buying something isn't necessarily
a dislike. Use **random negative sampling**: for each positive (user bought product X),
sample 3–5 products the user has never bought as negatives.

---

## Feature Engineering

Build a flat feature vector per `(user, product, context)` triple.

### User features

- `user_total_orders` — lifetime order count
- `user_orders_last_30d` — recency of activity
- `user_active_days` — distinct days with at least one order
- `user_preferred_hour` — mode of purchase hour (0–23)
- `user_preferred_dow` — mode of purchase day-of-week (0–6)
- `user_avg_price` — mean price paid across all orders
- `user_category_entropy` — diversity of categories purchased (low = loyal to few categories)

### Product features

- `product_global_popularity` — total orders across all users (log-scaled)
- `product_orders_last_30d` — recent global momentum
- `product_price` — raw price
- `product_category_id` — one-hot or embedding
- `product_stock` — current `amount_left` (proxy for availability)
- `product_days_in_stock` — age since first delivery

### User × Product interaction features

- `user_product_buy_count` — how many times this user bought this product
- `user_product_last_bought_days` — days since last purchase (999 if never)
- `user_product_temporal_affinity` — the existing SQL affinity score (reuse as a feature)
- `user_category_buy_count` — purchases in this product's category
- `is_favorite` — boolean (from `user_favorite_products` pivot)

### Context features (at inference time)

- `hour_of_day` — current hour in Europe/Prague
- `day_of_week` — current day
- `is_weekend` — boolean
- `days_since_last_session` — kiosk sessions or page views

### Meta-feature

- `statistical_score` — Phase 1 score as an additional input feature

---

## Model

**LightGBM binary classifier** (`lgb.LGBMClassifier`) predicting P(user buys product in
next session).

Reasons for LightGBM over alternatives:

- Handles mixed numeric/categorical features natively
- Fast training on small datasets (<10k rows)
- No need for feature normalisation
- Exports to ONNX or plain JSON for lightweight inference

### Training setup

```python
import lightgbm as lgb

model = lgb.LGBMClassifier(
    n_estimators=300,
    learning_rate=0.05,
    num_leaves=31,
    min_child_samples=10,   # prevents overfitting on small data
    subsample=0.8,
    colsample_bytree=0.8,
    class_weight='balanced', # handles negative-sample imbalance
)
```

Split: train on orders before last 30 days, evaluate on last 30 days (temporal split —
do NOT shuffle, that leaks future data into training).

### Evaluation metrics

- **Precision@4** — are the 4 shown products relevant? (primary UX metric)
- **Recall@4** — of products the user would buy, how many appear in the 4?
- **NDCG@4** — ranking quality (rewards putting the best item first)
- Compare against Phase 1 baseline on the held-out 30 days

---

## Architecture Sketch

```
Training pipeline (Python script, run offline or nightly):
  1. Extract features from PostgreSQL → pandas DataFrame
  2. Build positive/negative samples
  3. Train LGBMClassifier
  4. Export model to JSON (lgb.Booster.save_model)
  5. Store model file in storage/ml/ with timestamp

Inference (Node.js, at request time or nightly batch):
  Option A — batch (recommended for simplicity):
    - Run Node.js script that loads model JSON via `lightgbm` npm package
    - Compute scores for all (user, product) pairs
    - Write results into `recommendations` table (model = 'lightgbm')
    - `getRecommendedIds()` already supports querying by model name

  Option B — real-time:
    - Python FastAPI sidecar on localhost:5001
    - Called from RecommendationService via HTTP fetch
    - Returns ranked product IDs
    - More latency-sensitive, harder to deploy
```

**Recommendation**: start with Option A (batch nightly). It requires no new HTTP service,
slots into the existing scheduler, and `recommendations` table already has the `model`
column to distinguish statistical vs lightgbm rows.

---

## RecommendationService Changes Needed

`getRecommendedIds()` already queries by model. To prefer ML when available:

```typescript
async getRecommendedIds(userId: number, limit: number = 4): Promise<number[]> {
  // Try ML model first, fall back to statistical, then live computation
  for (const model of ['lightgbm', 'statistical'] as const) {
    const rows = await Recommendation.query()
      .where('userId', userId)
      .where('model', model)
      .orderBy('rank', 'asc')
      .limit(limit)
      .select('productId')
    if (rows.length > 0) return rows.map((r) => r.productId)
  }
  return (await this.computeForUser(userId)).slice(0, limit).map((s) => s.productId)
}
```

The `model` column in `recommendations` already supports `'statistical' | 'lightgbm'`
(see `app/models/recommendation.ts`).

---

## Implementation Checklist

When ready to implement:

- [ ] Write `scripts/build_training_data.ts` — exports feature DataFrame to CSV
- [ ] Write `scripts/train_model.py` — trains LightGBM, saves to `storage/ml/`
- [ ] Write `scripts/score_users.ts` — loads model, writes to `recommendations` table
- [ ] Add `score_users.ts` to scheduler (e.g. 03:00, after statistical refresh at 02:00)
- [ ] Add `lightgbm` npm package (or `node-lightgbm`) for Node.js inference
- [ ] Update `getRecommendedIds()` to prefer `'lightgbm'` model (see snippet above)
- [ ] Measure Precision@4 and NDCG@4 vs statistical baseline on held-out month
- [ ] Only deploy if ML beats statistical by >5% on primary metric

---

## Notes on Data Volume

The model is worthwhile when there is enough signal:

- Each user needs ~20+ orders to learn reliable preferences
- The system needs ~500+ total orders to avoid overfitting across users
- Below these thresholds, the statistical model will likely outperform because
  it uses hand-coded domain knowledge that the tree cannot infer from sparse data

Check with: `SELECT buyer_id, COUNT(*) FROM orders GROUP BY buyer_id ORDER BY 2 DESC`
