// Config, modules and functions require
var config = require('../config/config');
var mailer = require('./sendMail');
var passport = require('passport');
var OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

// Mongoose Data object
var User = require('../models/user');

// array to hold logged in users
//var users = []; // using array like this really

// Helper function to find user in database
var findByOid = function (oid, fn) {
  User.findOne({
    'oid': oid
  }, function (err, user) {
    if (err) {
      return fn(err);
    }
    return fn(null, user);
  });
};

// Helper function to work with user object
passport.serializeUser(function (user, done) {
  done(null, user.oid);
});

// Helper function to work with user object
passport.deserializeUser(function (oid, done) {
  findByOid(oid, function (err, user) {
    done(err, user);
  });
});

// Define passport strategy using variables from config
passport.use(new OIDCStrategy({
    identityMetadata: config.creds.identityMetadata,
    clientID: config.creds.clientID,
    responseType: config.creds.responseType,
    responseMode: config.creds.responseMode,
    redirectUrl: config.creds.redirectUrl,
    allowHttpForRedirectUrl: config.creds.allowHttpForRedirectUrl,
    clientSecret: config.creds.clientSecret,
    validateIssuer: config.creds.validateIssuer,
    isB2C: config.creds.isB2C,
    issuer: config.creds.issuer,
    passReqToCallback: config.creds.passReqToCallback,
    scope: config.creds.scope,
    loggingLevel: config.creds.loggingLevel,
    nonceLifetime: config.creds.nonceLifetime,
    nonceMaxAmount: config.creds.nonceMaxAmount,
    useCookieInsteadOfSession: config.creds.useCookieInsteadOfSession,
    cookieEncryptionKeys: config.creds.cookieEncryptionKeys,
    clockSkew: config.creds.clockSkew,
  },
  function (iss, sub, profile, accessToken, refreshToken, done) {
    if (!profile.oid) {
      return done(new Error("No oid found"), null);
    }
    // asynchronous verification
    process.nextTick(function () {
      findByOid(profile.oid, function (err, user) {
        if (err) {
          return done(err);
        }
        if (!user) {
          // Auto-registration
          //users.push(profile); Original placement of users push to array
          User.findOne({
            'oid': profile.oid
          }, function (err, user) {
            if (err) {
              return done(err);
            }
            // If user does not exist in database, automatically register as customer (not admin, not supplier, auto increment keypad ID)
            if (!user) {
              console.log('Triggered no user, creating new.');
              var newUser = new User();
              newUser.oid = profile.oid;
              newUser.displayName = profile.displayName;
              newUser.email = profile._json.email;
              profile.admin = false;
              profile.supplier = false;
              // Async function to find highest keypad ID and increment it by one.
              var latestUser = function (callback) {
                User.find().sort({
                  keypadId: -1
                }).limit(1).exec(function (err, res) {
                  if (!res[0]) {
                    callback(err, 1);
                  } else {
                    callback(err, res[0].keypadId + 1);
                  }
                });
              };
              // Call function from above and handle user creation in callback
              latestUser(function (err, res) {
                if (err) {
                  return done(err);
                }
                newUser.keypadId = res;
                newUser.save(function (err, res) {
                  if (err) {
                    console.log(err);
                  } else {
                    //console.log(`New User ${newUser.displayName} inserted into database.`);
                    var subject = `Welcome to our fridge ${newUser.displayName}`;
                    var body = `<h1>Welcome abord!</h1><p>Hope you will like it here</p><p>Your keypad ID is: ${newUser.keypadID}</p>`;
                    mailer.sendMail(newUser.email, subject, body);
                  }
                });
              });
            }
            /*else {
                         console.log('Profile found in database.');
                         profile.admin = user.admin;
                         profile.supplier = user.supplier;
                       }*/
          });
          //users.push(profile); in case you want to use in-memory array instead of querying database
          return done(null, profile);
        }
        return done(null, user);
      });
    });
  }
));