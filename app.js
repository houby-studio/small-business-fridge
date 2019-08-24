// Require all neccesary modules
var createError = require('http-errors'); // Generating errors
var express = require('express'); // Express
var methodOverride = require('method-override');
var path = require('path'); // used for handling paths which held express files
var cookieParser = require('cookie-parser');
var expressSession = require('express-session');
//var logger = require('morgan');
var expressHbs = require('express-handlebars'); // extended handlebars functionality
var mongoose = require('mongoose'); // database
var mongoStore = require('connect-mongo')(expressSession);
var https = require('https'); // Using HTTPS for debug
var fs = require('fs'); // Loading certificate from file for debug
var passport = require('passport'); // authentication method
var config = require('./config/config.js'); // configuration file

// Functions
require('./functions/azure-passport');

// Load routes from routes folder to later app.use them.
var indexRouter = require('./routes/index');
var shopRouter = require('./routes/shop');
var aboutRouter = require('./routes/about');
var accountRouter = require('./routes/account');
var loginRouter = require('./routes/login');
var logoutRouter = require('./routes/logout');
var authOpenId = require('./routes/auth_openid');
var authOpenIdReturnGet = require('./routes/auth_openid_return');
var authOpenIdReturnPost = require('./routes/auth_openid_return_post');

// Database models
var User = require('./models/user');

// Express app and database connection
var app = express();
mongoose.connect(config.config.db.connstr,{ useNewUrlParser: true });

// View engine setup
app.engine('.hbs', expressHbs({defaultLayout: 'layout', extname: '.hbs'}));
app.set('view engine', '.hbs');
app.use(methodOverride());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(expressSession({ cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, secret: config.config.cookie_secret, resave: false, saveUninitialized: false, store: new mongoStore({ mongooseConnection: mongoose.connection, ttl: 14 * 24 * 60 * 60, autoRemove: 'native' }) }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(passport.initialize());
app.use(passport.session())

// Application routes
app.use('/', indexRouter);
app.use('/shop', shopRouter);
app.use('/about', aboutRouter);
app.use('/account', accountRouter);
app.use('/login', loginRouter);
app.use('/logout', logoutRouter);
app.use('/auth/openid', authOpenId);
app.use('/auth/openid/return', authOpenIdReturnGet);
app.use('/auth/openid/return', authOpenIdReturnPost);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
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