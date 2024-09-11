import axios from 'axios'
import logger from './logger.js'

/**
 * Acquires token with client credentials.
 * @param {object} userId
 * @param {object} token
 */
async function getUserDetails(userId, token) {
  const options = {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }

  let apiResponse = null
  try {
    apiResponse = await axios.get(
      'https://graph.microsoft.com/v1.0/users/' + userId,
      options
    )
    return apiResponse.data
  } catch (error) {
    if (error.response.status === 404) {
      logger.warn(
        `server.functions.getuserdetails__User [${userId}] was not found in the directory.`
      )
    } else {
      logger.error(
        `server.functions.getuserdetails__Unhandled error: ${error.response.status} ${error.response.statusText}`
      )
    }
    return null
  }
}

export { getUserDetails }
