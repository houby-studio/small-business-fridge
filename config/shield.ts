import { defineConfig } from '@adonisjs/shield'

const shieldConfig = defineConfig({
  /**
   * Configure CSP policies for your app. Refer documentation
   * to learn more
   */
  csp: {
    enabled: false,
    directives: {},
    reportOnly: false,
  },

  /**
   * Configure CSRF protection options. Refer documentation
   * to learn more
   */
  csrf: {
    enabled: true,
    exceptRoutes: (ctx) => {
      const url = ctx.request.url()
      return (
        url.startsWith('/api/') ||
        url === '/mcp' ||
        url === '/oauth/register' ||
        url === '/oauth/token'
      )
    },
    enableXsrfCookie: true,
    /**
     * Unsafe verbs only — Shield validates exactly the methods listed here, so adding
     * GET/HEAD/OPTIONS would demand a token on every navigation. That makes the list a
     * gate keyed on `request.method()`, which is why method spoofing stays disabled in
     * config/app.ts: a spoofed verb would otherwise pick which side of this gate it lands on.
     */
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  /**
   * Control how your website should be embedded inside
   * iFrames
   */
  xFrame: {
    enabled: true,
    action: 'DENY',
  },

  /**
   * Force browser to always use HTTPS
   */
  hsts: {
    enabled: true,
    maxAge: '180 days',
  },

  /**
   * Disable browsers from sniffing the content type of a
   * response and always rely on the "content-type" header.
   */
  contentTypeSniffing: {
    enabled: true,
  },
})

export default shieldConfig
