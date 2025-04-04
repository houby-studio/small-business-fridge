// modules and functions require
import { sendMail } from './sendMail.js'
import passport from 'passport'
import { OIDCStrategy } from 'passport-azure-ad'
import logger from './logger.js'
import User from '../models/user.js'

const cookieEncryptionKeys = [
  {
    key: process.env.CREDS_COOKIE_ENCRYPTION_KEY,
    iv: process.env.CREDS_COOKIE_ENCRYPTION_VALUE
  }
]

// Helper function to find user in database
const findByOid = function (oid, fn) {
  User.findOne({
    oid
  })
    .then((user) => {
      return fn(null, user)
    })
    .catch((err) => {
      return fn(err)
    })
}

// Helper function to work with user object
passport.serializeUser(function (user, done) {
  done(null, user.oid)
})

// Helper function to work with user object
passport.deserializeUser(function (oid, done) {
  findByOid(oid, function (err, user) {
    done(err, user)
  })
})

// Define passport strategy using variables from config
passport.use(
  new OIDCStrategy(
    {
      identityMetadata: process.env.CREDS_IDENTITY_METADATA,
      clientID: process.env.CREDS_CLIENT_ID,
      responseType: process.env.CREDS_RESPONSE_TYPE,
      responseMode: process.env.CREDS_RESPONSE_MODE,
      redirectUrl: process.env.CREDS_REDIRECT_URL,
      allowHttpForRedirectUrl:
        process.env.CREDS_ALLOW_HTTP_FOR_REDIRECT_URL.toLowerCase() ===
          'true' || false,
      clientSecret: process.env.CREDS_CLIENT_SECRET,
      validateIssuer:
        process.env.CREDS_VALIDATE_ISSUER.toLowerCase() === 'true' || false,
      isB2C: process.env.CREDS_ISB2C.toLowerCase() === 'true' || false,
      issuer: process.env.CREDS_ISSUER,
      passReqToCallback: false,
      scope: ['profile', 'offline_access', 'email'],
      loggingLevel: process.env.CREDS_LOGGING_LEVEL,
      nonceMaxAmount: parseInt(process.env.CREDS_NONCE_MAX_AMOUNT),
      useCookieInsteadOfSession:
        process.env.CREDS_USE_COOKIE_INSTEAD_OF_SESSION.toLowerCase() ===
          'true' || false,
      cookieEncryptionKeys,
      cookieSameSite:
        process.env.CREDS_COOKIE_SAME_SITE.toLowerCase() === 'true' || false
    },
    function (_iss, _sub, profile, _accessToken, _refreshToken, done) {
      if (!profile.oid) {
        logger.error(
          'server.functions.azurepassport__User profile does not contain OID.',
          {
            metadata: {
              profile
            }
          }
        )
        return done(new Error('User profile does not contain OID'), null)
      }
      // asynchronous verification
      process.nextTick(function () {
        findByOid(profile.oid, function (err, user) {
          if (err) {
            logger.error(
              'server.functions.azurepassport__Failed to fetch user from database.',
              {
                metadata: {
                  error: err.message
                }
              }
            )
            return done(err)
          }
          if (!user) {
            // Auto-registration
            logger.info(
              `server.functions.azurepassport__User [${profile._json.email}] not found in database. Starting automatic registration.`
            )
            User.findOne({
              oid: profile.oid
            })
              .then(() => {
                // If user does not exist in database, automatically register as customer (not admin, not supplier, auto increment keypad ID)
                if (!profile._json.email) {
                  logger.error(
                    `server.functions.azurepassport__User [${profile.oid}] does not contain email parameter. Cannot register user.`,
                    {
                      metadata: {
                        profile
                      }
                    }
                  )
                  return done(null, false, {
                    message: 'User needs e-mail attribute.'
                  })
                }
                const newUser = new User()
                newUser.oid = profile.oid
                newUser.displayName = profile.displayName
                newUser.email = profile._json.email
                newUser.admin =
                  process.env.NODE_ENV.toLowerCase() === 'development'
                newUser.supplier =
                  process.env.NODE_ENV.toLowerCase() === 'development'
                // Async function to find highest keypad ID and increment it by one.
                const latestUser = function (callback) {
                  User.find()
                    .sort({
                      keypadId: -1
                    })
                    .limit(1)
                    .then((res) => {
                      if (!res[0]) {
                        callback(err, 1)
                      } else {
                        callback(null, res[0].keypadId + 1)
                      }
                    })
                    .catch((err) => {
                      callback(err, 1)
                    })
                }
                // Call function from above and handle user creation in callback
                latestUser(function (err, res) {
                  if (err) {
                    logger.error(
                      'server.functions.azurepassport__Failed to fetch user with highest keypadId.',
                      {
                        metadata: {
                          error: err.message
                        }
                      }
                    )
                    return done(err)
                  }
                  newUser.keypadId = res
                  logger.info(
                    `server.functions.azurepassport__Assigned keypadId [${res}] to user [${profile._json.email}]`
                  )
                  newUser
                    .save()
                    .then((result) => {
                      logger.info(
                        `server.functions.azurepassport__Created user [${profile._json.email}].`,
                        {
                          metadata: {
                            result
                          }
                        }
                      )
                      const subject = 'Potvrzení registrace nového zákazníka'
                      const mailPreview = `Zákazník ${newUser.displayName} registrován s ID ${newUser.keypadId}.`

                      sendMail(newUser.email, 'newUserWelcome', {
                        subject,
                        mailPreview,
                        keypadId: newUser.keypadId
                      })
                    })
                    .catch((err) => {
                      logger.error(
                        'server.functions.azurepassport__Failed to create user.',
                        {
                          metadata: {
                            error: err.message
                          }
                        }
                      )
                    })
                })
              })
              .catch((err) => {
                logger.error(
                  'server.functions.azurepassport__Failed to query database for user OID. Error:',
                  {
                    metadata: {
                      error: err.message
                    }
                  }
                )
                return done(err)
              })
            return done(null, profile)
          }
          if (user.disabled) {
            logger.warn(
              `server.functions.azurepassport__User [${user._id}] is disabled, but tried to login anyways.`,
              {
                metadata: {
                  user
                }
              }
            )
            return done(null, false, {
              message: 'User is disabled.'
            })
          }
          return done(null, user)
        })
      })
    }
  )
)
