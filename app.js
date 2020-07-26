// Require all neccesary modules
var createError = require('http-errors') // Generating errors
var express = require('express') // Express
var methodOverride = require('method-override')
var path = require('path') // used for handling paths which held express files
var cookieParser = require('cookie-parser')
var expressSession = require('express-session')
var handlebars = require('handlebars')
var expressHbs = require('express-handlebars') // extended handlebars functionality
const { allowInsecurePrototypeAccess } = require('@handlebars/allow-prototype-access')
var mongoose = require('mongoose') // database
mongoose.set('useNewUrlParser', true)
mongoose.set('useFindAndModify', false)
mongoose.set('useCreateIndex', true)
mongoose.set('useUnifiedTopology', true)
var MongoStore = require('connect-mongo')(expressSession)
var passport = require('passport') // authentication method
var config = require('./config/config.js') // configuration file
if (config.config.debug) {
  var https = require('https') // Using HTTPS for debug
  var fs = require('fs') // Loading certificate from file for debug
}

// Functions
require('./functions/azure-passport')

// Import scheduled tasks
require('./tasks/daily-report')
require('./tasks/daily-backup')

// Load routes from routes folder to later app.use them.
// Access for all
var indexRouter = require('./routes/index')
var aboutRouter = require('./routes/about')
var changelogRouter = require('./routes/changelog')
// Access for logged in users
var shopRouter = require('./routes/shop')
var profileRouter = require('./routes/profile')
var ordersRouter = require('./routes/orders')
var invoicesRouter = require('./routes/invoices')
// Access for suppliers
var addProductsRouter = require('./routes/add_products')
var invoiceRouter = require('./routes/invoice')
var paymentsRouter = require('./routes/payments')
var stockRouter = require('./routes/stock')
var newProductRouter = require('./routes/new_product')
// Access for admins
var dashboardRouter = require('./routes/admin/admin_dashboard')
// Access for kiosk
var kioskKeypadRouter = require('./routes/kiosk_keypad')
var kioskShopRouter = require('./routes/kiosk_shop')
// Passport routes
var loginRouter = require('./routes/login')
var logoutRouter = require('./routes/logout')
var authOpenId = require('./routes/auth_openid')
var authOpenIdReturnGet = require('./routes/auth_openid_return')
var authOpenIdReturnPost = require('./routes/auth_openid_return_post')
// API routes
var keypadOrderRouter = require('./routes/api/keypadOrder')
var customerName = require('./routes/api/customerName')

// Express app and database connection
var app = express()
mongoose.connect(config.config.db.connstr, {
  useNewUrlParser: true
})

// View engine setup
app.engine('.hbs', expressHbs({
  defaultLayout: 'layout',
  extname: '.hbs',
  handlebars: allowInsecurePrototypeAccess(handlebars)
}))
app.enable('trust proxy')
app.set('view engine', '.hbs')
app.enable('view cache')
app.use(methodOverride())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.urlencoded({
  extended: true
}))
app.use(cookieParser(config.config.parser_secret))
app.use(expressSession({
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000
  },
  secret: config.config.cookie_secret,
  httpOnly: true,
  secure: true,
  sameSite: 'None',
  resave: false,
  saveUninitialized: false,
  store: new MongoStore({
    mongooseConnection: mongoose.connection,
    ttl: 14 * 24 * 60 * 60,
    autoRemove: 'native'
  })
}))
app.use(passport.initialize())
app.use(passport.session())

// Application routes
// Access for all
app.use('/', indexRouter)
app.use('/about', aboutRouter)
app.use('/changelog', changelogRouter)
// Access for logged in users
app.use('/shop', shopRouter)
app.use('/profile', profileRouter)
app.use('/orders', ordersRouter)
app.use('/invoices', invoicesRouter)
// Access for suppliers
app.use('/add_products', addProductsRouter)
app.use('/invoice', invoiceRouter)
app.use('/payments', paymentsRouter)
app.use('/stock', stockRouter)
app.use('/new_product', newProductRouter)
// Access for admins
app.use('/dashboard', dashboardRouter)
app.use('/admin_orders', ordersRouter)
app.use('/admin_invoice', invoiceRouter)
app.use('/admin_payments', paymentsRouter)
// Access for kiosk
app.use('/kiosk_keypad', kioskKeypadRouter)
app.use('/kiosk_shop', kioskShopRouter)
// Passport routes
app.use('/login', loginRouter)
app.use('/logout', logoutRouter)
app.use('/auth/openid', authOpenId)
app.use('/auth/openid/return', authOpenIdReturnGet)
app.use('/auth/openid/return', authOpenIdReturnPost)
// API routes
app.use('/api/keypadOrder', keypadOrderRouter)
app.use('/api/customerName', customerName)

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404))
})

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message
  res.locals.error = req.app.get('env') === 'development' ? err : {}

  // render the error page
  res.status(err.status || 500)
  res.render('error')
})

if (config.config.debug) {
  // When testing, we want to use self sign for localhost website. In production we rely on reverse proxy (nginx/apache etc.)
  var options = {
    key: fs.readFileSync('./config/key.pem'),
    cert: fs.readFileSync('./config/cert.pem')
  }
  // Create an HTTPS service identical to the HTTP service.
  https.createServer(options, app).listen(config.config.app.portSsl || 443)
}

module.exports = app
