import { RecurrenceRule, scheduleJob } from 'node-schedule'
import moment from 'moment'
import User from '../models/user.js'
import logger from '../functions/logger.js'
import { getToken } from '../functions/obtainAccessToken.js'
import { getUserDetails } from '../functions/getUserDetails.js'
moment.locale('cs')

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
const rule = new RecurrenceRule()
rule.hour = process.env.TASKS_DAILY_USER_PHONES_HOUR
rule.minute = process.env.TASKS_DAILY_USER_PHONES_MINUTE

const scheduledTask = scheduleJob(rule, async function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_USER_PHONES_ENABLED) {
    return
  }

  logger.info(
    'server.tasks.dailyuserphones__Started scheduled task to user phones and update data.'
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
        const formattedPhone = userDetails.businessPhones[0]
          .replace(/ /g, '')
          .replace('+', '00')
        if (user.phone !== formattedPhone) {
          User.updateOne({ _id: user._id }, { phone: formattedPhone }).then(
            () => {
              logger.info(
                `server.tasks.dailyuserphones__Updated user [${user.email}] phone to [${formattedPhone}]`
              )
            }
          )
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
