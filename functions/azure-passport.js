// modules and functions require
import { sendMail } from './sendMail.js'
import passport from 'passport'
import { OIDCStrategy } from 'passport-azure-ad'
import logger from './logger.js'
import model from '../models/user.js'

const cookieEncryptionKeys = [
  {
    key: process.env.CREDS_COOKIE_ENCRYPTION_KEY,
    iv: process.env.CREDS_COOKIE_ENCRYPTION_VALUE
  }
]

// Helper function to find user in database
const findByOid = function (oid, fn) {
  model
    .findOne({
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
        process.env.CREDS_ALLOW_HTTP_FOR_REDIRECT_URL === 'true' || false,
      clientSecret: process.env.CREDS_CLIENT_SECRET,
      validateIssuer:
        process.env.CREDS_VALIDATE_ISSUER.toLowerCase() === 'true' || false,
      isB2C: process.env.CREDS_ISB2C.toLowerCase() === 'true' || false,
      issuer: process.env.CREDS_ISSUER,
      passReqToCallback:
        process.env.CREDS_PASS_REQ_TO_CALLBACK.toLowerCase() === 'true' ||
        false,
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
          `server.functions.azurepassport__User profile does not contain OID.`,
          {
            metadata: {
              profile: profile
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
            model
              .findOne({
                oid: profile.oid
              })
              .then(() => {
                // If user does not exist in database, automatically register as customer (not admin, not supplier, auto increment keypad ID)
                if (!profile._json.email) {
                  logger.error(
                    `server.functions.azurepassport__User [${profile.oid}] does not contain email parameter. Cannot register user.`,
                    {
                      metadata: {
                        profile: profile
                      }
                    }
                  )
                  return done(1)
                }
                const newUser = new model()
                newUser.oid = profile.oid
                newUser.displayName = profile.displayName
                newUser.email = profile._json.email
                profile.admin = false
                profile.supplier = false
                // Async function to find highest keypad ID and increment it by one.
                const latestUser = function (callback) {
                  model
                    .find()
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
                            result: result
                          }
                        }
                      )
                      const subject = `Lednice IT je pyšná, že ji navštívila osoba jménem ${newUser.displayName}`
                      const body = `<h1>Lednice IT Vás vítá!</h1><p>Snad se Vám zde bude líbit.</p><p>Vaše ID pro objednávání skrze kiosek: ${newUser.keypadId}</p><h2>Jak to funguje</h2><p>Do Lednice IT dodává produkty více dodavatelů. Zákazník si přes e-shop či přes kiosek zakoupí vybraný produkt. Až se dodavateli nashromáždí dostatek prodaného zboží, vytvoří hromadnou fakturaci. Každý zákazník, který si u daného dodavatele něco zakoupil obdrží e-mail s QR kódem, který uhradí. Platbu obě strany potvrdí v rozhraní e-shopu.</p><p>Pokud se budete chtít stát dodavatelem, kontaktujte správce Lednice IT.</p>`
                      sendMail(newUser.email, subject, body)
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
          return done(null, user)
        })
      })
    }
  )
)
