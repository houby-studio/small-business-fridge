import env from '#start/env'

/**
 * Which build of the app is actually running.
 *
 * The values are baked into the image at build time (see the `ARG`/`ENV` block in the
 * production stage of the Dockerfile) and mirrored into OCI labels, so `docker inspect`
 * answers the same question without the app having to be up.
 *
 * Deliberately NOT exposed on `/api/v1/health`: that endpoint is unauthenticated and, in
 * a typical deployment, reachable from the internet. Operators read the version from the
 * image label instead, and signed-in users see it in the UI.
 */
const rawCommit = env.get('GIT_SHA') || ''
const rawDate = env.get('BUILD_DATE') || ''

export type BuildInfo = {
  /** Release version, e.g. `3.0.0`. `dev` for an unreleased local build. */
  version: string
  /** Full commit SHA the image was built from, or `null` when unknown. */
  commit: string | null
  /** First 7 characters of the commit SHA, or `null` when unknown. */
  commitShort: string | null
  /** ISO 8601 build timestamp, or `null` when unknown. */
  buildDate: string | null
}

const buildInfo: BuildInfo = Object.freeze({
  version: env.get('APP_VERSION') || 'dev',
  commit: rawCommit || null,
  commitShort: rawCommit ? rawCommit.slice(0, 7) : null,
  buildDate: rawDate || null,
})

export default buildInfo
