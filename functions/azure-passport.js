// modules and functions require
var mailer = require('./sendMail')
var passport = require('passport')
var OIDCStrategy = require('passport-azure-ad').OIDCStrategy

// For each 
var cookieEncryptionKeys = {
  key: process.env.CREDS_COOKIE_ENCRYPTION_KEY,
  iv: process.env.CREDS_COOKIE_ENCRYPTION_VALUE
}

// Mongoose Data object
var User = require('../models/user')

// Helper function to find user in database
var findByOid = function (oid, fn) {
  User.findOne({
    oid: oid
  }, function (err, user) {
    if (err) {
      return fn(err)
    }
    return fn(null, user)
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
passport.use(new OIDCStrategy({
  identityMetadata: process.env.CREDS_IDENTITY_METADATA,
  clientID: process.env.CREDS_CLIENT_ID,
  responseType: process.env.CREDS_RESPONSE_TYPE,
  responseMode: process.env.CREDS_RESPONSE_MODE,
  redirectUrl: process.env.CREDS_REDIRECT_URL,
  allowHttpForRedirectUrl: process.env.CREDS_ALLOW_HTTP_FOR_REDIRECT_URL,
  clientSecret: process.env.CREDS_CLIENT_SECRET,
  validateIssuer: process.env.CREDS_VALIDATE_ISSUER,
  isB2C: process.env.CREDS_ISB2C,
  issuer: process.env.CREDS_ISSUER,
  passReqToCallback: process.env.CREDS_PASS_REQ_TO_CALLBACK,
  scope: ['profile', 'offline_access', 'email'],
  loggingLevel: process.env.CREDS_LOGGING_LEVEL,
  nonceLifetime: process.env.CREDS_NONCE_LIFETIME,
  nonceMaxAmount: parseInt(process.env.CREDS_NONCE_MAX_AMOUNT),
  useCookieInsteadOfSession: process.env.CREDS_USE_COOKIE_INSTEAD_OF_SESSION,
  cookieEncryptionKeys: cookieEncryptionKeys,
  cookieSameSite: process.env.CREDS_COOKIE_SAME_SITE,
  clockSkew: process.env.CREDS_CLOCK_SKEW
},
  function (iss, sub, profile, accessToken, refreshToken, done) {
    if (!profile.oid) {
      return done(new Error('No oid found'), null)
    }
    // asynchronous verification
    process.nextTick(function () {
      findByOid(profile.oid, function (err, user) {
        if (err) {
          return done(err)
        }
        if (!user) {
          // Auto-registration
          User.findOne({
            oid: profile.oid
          }, function (err, user) {
            if (err) {
              return done(err)
            }
            // If user does not exist in database, automatically register as customer (not admin, not supplier, auto increment keypad ID)
            if (!user) {
              if (!profile._json.email) {
                return done(1)
              }
              console.log('Triggered no user, creating new.')
              var newUser = new User()
              newUser.oid = profile.oid
              newUser.displayName = profile.displayName
              newUser.email = profile._json.email
              profile.admin = false
              profile.supplier = false
              // Async function to find highest keypad ID and increment it by one.
              var latestUser = function (callback) {
                User.find().sort({
                  keypadId: -1
                }).limit(1).exec(function (err, res) {
                  if (!res[0]) {
                    callback(err, 1)
                  } else {
                    callback(err, res[0].keypadId + 1)
                  }
                })
              }
              // Call function from above and handle user creation in callback
              latestUser(function (err, res) {
                if (err) {
                  return done(err)
                }
                newUser.keypadId = res
                newUser.save(function (err, res) {
                  if (err) {
                    console.log(err)
                  } else {
                    // console.log(`New User ${newUser.displayName} inserted into database.`);
                    var subject = `Welcome to our fridge ${newUser.displayName}`
                    var body = `<h1>Welcome abord!</h1><p>Hope you will like it here</p><p>Your keypad ID is: ${newUser.keypadID}</p>`
                    mailer.sendMail(newUser.email, subject, body)
                  }
                })
              })
            }
          })
          // users.push(profile); in case you want to use in-memory array instead of querying database
          return done(null, profile)
        }
        return done(null, user)
      })
    })
  }
))
