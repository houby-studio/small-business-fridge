/**
 * The server's clock on the client. A timestamp the page sends back (when a product was
 * counted) is compared with order timestamps on the server, so it must not depend on how
 * wrong the phone's clock is.
 *
 * `sync` has to run the moment a server timestamp ARRIVES — the offset is "server time minus
 * client time at that moment". Computing it later (e.g. lazily on first use) shrinks it by
 * however long the page has been open and makes `now()` collapse onto the server timestamp.
 */
export function createServerClock(clientNow: () => number = Date.now) {
  let offset = 0
  return {
    sync(serverIso: string | null | undefined) {
      const server = serverIso ? Date.parse(serverIso) : Number.NaN
      offset = Number.isNaN(server) ? 0 : server - clientNow()
    },
    /** The server's current time as ISO. */
    now(): string {
      return new Date(clientNow() + offset).toISOString()
    },
  }
}
