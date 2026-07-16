import env from '#start/env'

/**
 * Configuration for the product-rating public feed.
 *
 * `publicFeedEnabled` controls whether the shared public feed of ratings is
 * visible to customers:
 *
 *  - `false` (default) — the public feed is OFF. A customer only ever sees their
 *    own ratings; ratings of other users (including ones previously marked
 *    `public`) are hidden, the visibility toggle and upvote actions disappear,
 *    and the server refuses to persist a `public` visibility coming from a
 *    customer. Suppliers and admins keep seeing everything.
 *  - `true` — customers see other users' public ratings, can upvote them and
 *    may pick public visibility when rating.
 *
 * Driven exclusively by the `RATINGS_PUBLIC_FEED_ENABLED` env variable; there is
 * no in-app toggle. Changing it requires a restart/redeploy.
 */
const ratingsConfig = {
  publicFeedEnabled: env.get('RATINGS_PUBLIC_FEED_ENABLED', false),
}

export default ratingsConfig
