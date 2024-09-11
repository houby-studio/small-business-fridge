// rewrite using import
import * as msal from '@azure/msal-node'

/**
 * Configuration object to be passed to MSAL instance on creation.
 * For a full list of MSAL Node configuration parameters, visit:
 * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/configuration.md
 */
const msalConfig = {
  auth: {
    clientId: process.env.CREDS_CLIENT_ID,
    authority:
      'https://login.microsoftonline.com/' + process.env.CREDS_TENANT_ID,
    clientSecret: process.env.CREDS_CLIENT_SECRET
  }
}

/**
 * Initialize a confidential client application. For more info, visit:
 * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/initialize-confidential-client-application.md
 */
const cca = new msal.ConfidentialClientApplication(msalConfig)

/**
 * Acquires token with client credentials.
 * @param {object} tokenRequest
 */
async function getToken (tokenRequest) {
  return await cca.acquireTokenByClientCredential(tokenRequest)
}

export { getToken }
