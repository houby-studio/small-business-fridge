import { RecurrenceRule, scheduleJob } from 'node-schedule'
import moment from 'moment'
import User from '../models/user.js'
import logger from '../functions/logger.js'
import { getToken } from '../functions/obtainAccessToken.js'
import { getUserDetails } from '../functions/getUserDetails.js'
moment.locale('cs')

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
var rule = new RecurrenceRule()
rule.hour = process.env.TASKS_DAILY_USER_PHONES_HOUR
rule.minute = process.env.TASKS_DAILY_USER_PHONES_MINUTE

var scheduledTask = scheduleJob(rule, async function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_USER_PHONES_ENABLED) {
    return
  }

  logger.info(
    `server.tasks.dailyuserphones__Started scheduled task to user phones and update data.`
  )

  // Obtain Access Token
  const tokenRequest = {
    scopes: ['https://graph.microsoft.com/.default']
  }
  const authResponse = await getToken(tokenRequest)

  // Fetch all active users
  User.aggregate([
    { $match: { disabled: { $in: [null, false] } } },
    { $project: { _id: 1, email: 1, oid: 1, phone: 1 } }
  ]).then((docs) => {
    docs.forEach(async (user) => {
      const userDetails = await getUserDetails(
        user.oid,
        authResponse.accessToken
      )
      if (!userDetails) {
        logger.info(
          `server.tasks.dailyuserphones__User [${user.email}] not found in the directory, skipping phone comparison.`
        )
        return
      }
      if (userDetails.businessPhones[0]) {
        if (user.phone !== userDetails.businessPhones[0]) {
          User.updateOne(
            { _id: user._id },
            { phone: userDetails.businessPhones[0] }
          ).then((_result) => {
            logger.info(
              `server.tasks.dailyuserphones__Updated user [${user.email}] phone to [${userDetails.businessPhones[0]}]`
            )
          })
        } else {
          logger.info(
            `server.tasks.dailyuserphones__User [${user.email}] phone is already up to date.`
          )
        }
      } else {
        logger.info(
          `server.tasks.dailyuserphones__User [${user.email}] does not have attribute phone.`
        )
      }
    })
  })
})

export default scheduledTask
