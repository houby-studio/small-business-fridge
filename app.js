// Require all neccesary modules
var createError = require('http-errors'); // Generating errors
var express = require('express'); // Express
var methodOverride = require('method-override')
var path = require('path'); // used for handling paths which held express files
var cookieParser = require('cookie-parser');
var expressSession = require('express-session');
var logger = require('morgan');
var expressHbs = require('express-handlebars'); // extended handlebars functionality
var mongoose = require('mongoose'); // database
var mongoStore = require('connect-mongo')(expressSession);
var https = require('https'); // Using HTTPS
var fs = require('fs'); // Loading certificate from file
var passport = require('passport'); // authentication method
var config = require('./config/config.js'); // configuration file

// Routes for navigating website
var indexRouter = require('./routes/index');
var accountRouter = require('./routes/account');

// Database models
var User = require('./models/user');

// ------------- START PASSPORT block -------------
var OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

// array to hold logged in users
var users = [];

var findByOid = function(oid, fn) {
	for (var i = 0, len = users.length; i < len; i++) {
	  var user = users[i];
	  //console.log('we are using user: ', user);
	  if (user.oid === oid) {
		return fn(null, user);
	  }
	}
	return fn(null, null);
};


passport.serializeUser(function(user, done) {
	done(null, user.oid);
});

passport.deserializeUser(function(oid, done) {
	findByOid(oid, function (err, user) {
	  done(err, user);
	});
});

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
  function(iss, sub, profile, accessToken, refreshToken, done) {
    if (!profile.oid) {
      return done(new Error("No oid found"), null);
    }
    // asynchronous verification, for effect...
    process.nextTick(function () {
      findByOid(profile.oid, function(err, user) {
        if (err) {
          return done(err);
        }
        if (!user) {
          // "Auto-registration"
          users.push(profile);
          console.log(profile);
          User.findOne({'oid': profile.oid}, function (err, user) {
            if (err) {
              return done(err);
            }
            if (!user) {
              var newUser = new User();
              newUser.oid = profile.oid;
              newUser.displayName = profile.displayName;
              newUser.email = profile._json.email;
              newUser.admin = false;
              newUser.supplier = false;
              User.find({}).sort({keypadId:-1}).limit(1).exec(function (err, results) {
                console.log('Found' + results);
              });
              //newUser.save();
            }
          });
          return done(null, profile);
        }
        return done(null, user);
      });
    });
  }
));

// ------------- END PASSPORT block -------------

// Express app and database
var app = express();
mongoose.connect(config.config.db.connstr,{ useNewUrlParser: true });

// view engine setup
//app.set('views', path.join(__dirname, 'views'));
app.engine('.hbs', expressHbs({defaultLayout: 'layout', extname: '.hbs'}));
app.set('view engine', '.hbs');
//app.use(logger('dev'));
app.use(methodOverride());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(expressSession({ cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, secret: 'keyboard cat', resave: false, saveUninitialized: false, store: new mongoStore({ mongooseConnection: mongoose.connection }) }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(passport.initialize());
app.use(passport.session())

function ensureAuthenticated(req, res, next) {
	if (req.isAuthenticated()) { return next(); }
	res.redirect('/login');
};

app.get('/login',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect', 
      { 
        response: res,                      // required
        resourceURL: config.resourceURL,    // optional. Provide a value if you want to specify the resource.
        customState: 'my_state',            // optional. Provide a value if you want to provide custom state value.
        failureRedirect: '/' 
      }
    )(req, res, next);
  },
  function(req, res) {
    res.redirect('/');
});

app.get('/auth/openid',
  passport.authenticate('azuread-openidconnect', { failureRedirect: '/login' }),
  function (req, res) {
      console.log('Authentication was called in the Sample');
      res.redirect('/');
});
// 'GET returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// query (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
app.get('/auth/openid/return',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect', 
      { 
        response: res,                      // required
        failureRedirect: '/'  
      }
    )(req, res, next);
  },
  function(req, res) {
    res.redirect('/');
  });

// 'POST returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// body (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
app.post('/auth/openid/return',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect', 
      { 
        response: res,                      // required
        failureRedirect: '/'  
      }
    )(req, res, next);
  },
  function(req, res) {
    //console.log("did we get " + req.user.oid);
    if (req.user.oid)
    res.redirect('/');
  });

// 'logout' route, logout from passport, and destroy the session with AAD.
app.get('/logout', function(req, res){
  req.session.destroy(function(err) {
    req.logOut();
    res.redirect(config.creds.destroySessionUrl);
  });
});

// End passport crap


// Application routes
app.use('/', indexRouter);
app.use('/account', accountRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError('Stránka nenalezena',404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// Besides HTTP, we create also HTTPS server - debug only, later nginx will take care of that (or will it?)
var options = {
  key: fs.readFileSync('./config/key.pem'),
  cert: fs.readFileSync('./config/cert.pem')
};
// Create an HTTPS service identical to the HTTP service.
https.createServer(options, app).listen(443);

module.exports = app;