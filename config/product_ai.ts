import env from '#start/env'

/**
 * Optional AI help in the product form (docs/product-images.md → "Text suggestions"):
 * a description in the catalogue's tone, a category and allergens. Any Azure OpenAI /
 * Foundry chat deployment works. Read at call time so tests can point it at a stub.
 */
const productAiConfig = {
  /** e.g. https://my-foundry.cognitiveservices.azure.com — empty disables the feature. */
  endpoint: env.get('PRODUCT_AI_ENDPOINT', ''),
  deployment: env.get('PRODUCT_AI_DEPLOYMENT', 'gpt-5-mini'),
  apiVersion: env.get('PRODUCT_AI_API_VERSION', '2024-10-21'),
  /** Auth, first match wins: API key, Entra service principal, or a static bearer token. */
  apiKey: env.get('PRODUCT_AI_API_KEY', ''),
  tenantId: env.get('PRODUCT_AI_TENANT_ID', ''),
  clientId: env.get('PRODUCT_AI_CLIENT_ID', ''),
  clientSecret: env.get('PRODUCT_AI_CLIENT_SECRET', ''),
  /** Local testing only (`az account get-access-token`); expires within the hour. */
  bearerToken: env.get('PRODUCT_AI_BEARER_TOKEN', ''),
  /** Entra token endpoint base — overridable for tests. */
  authorityUrl: env.get('PRODUCT_AI_AUTHORITY_URL', 'https://login.microsoftonline.com'),
  timeoutMs: 45_000,
}

export default productAiConfig
