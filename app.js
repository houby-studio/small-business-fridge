// Require all neccesary modules
const createError = require('http-errors') // Generating errors
const express = require('express') // Express
const methodOverride = require('method-override')
const path = require('path') // used for handling paths which held express files
const cookieParser = require('cookie-parser')
const expressSession = require('express-session')
const handlebars = require('handlebars')
const expressHbs = require('express-handlebars') // extended handlebars functionality
const {
  allowInsecurePrototypeAccess
} = require('@handlebars/allow-prototype-access')
const mongoose = require('mongoose') // database
const MongoStore = require('connect-mongo') // (expressSession)
const passport = require('passport') // authentication method
require('dotenv').config()

let https
let fs
if (process.env.DEBUG.toLowerCase() === 'true') {
  https = require('https') // Using HTTPS for debug
  fs = require('fs') // Loading certificate from file for debug
}

// Functions
require('./functions/azure-passport')

// Import scheduled tasks
require('./tasks/daily-report')
require('./tasks/daily-backup')

// Load routes from routes folder to later app.use them.
// Access for all
const indexRouter = require('./routes/index')
const aboutRouter = require('./routes/about')
const changelogRouter = require('./routes/changelog')
// Access for logged in users
const shopRouter = require('./routes/shop')
const profileRouter = require('./routes/profile')
const ordersRouter = require('./routes/orders')
const invoicesRouter = require('./routes/invoices')
// Access for suppliers
const addProductsRouter = require('./routes/add_products')
const invoiceRouter = require('./routes/invoice')
const paymentsRouter = require('./routes/payments')
const stockRouter = require('./routes/stock')
const newProductRouter = require('./routes/new_product')
// Access for admins
const dashboardRouter = require('./routes/admin/admin_dashboard')
// Access for kiosk
const kioskKeypadRouter = require('./routes/kiosk_keypad')
const kioskShopRouter = require('./routes/kiosk_shop')
// Passport routes
const loginRouter = require('./routes/login')
const logoutRouter = require('./routes/logout')
const authOpenId = require('./routes/auth_openid')
const authOpenIdReturnGet = require('./routes/auth_openid_return')
const authOpenIdReturnPost = require('./routes/auth_openid_return_post')
// API routes
const keypadOrderRouter = require('./routes/api/keypadOrder')
const customerName = require('./routes/api/customerName')

// Express app and database connection
const app = express()
mongoose.connect(process.env.DB_CONNECTION_STRING)

// View engine setup
app.engine(
  '.hbs',
  expressHbs.engine({
    defaultLayout: 'layout',
    extname: '.hbs',
    handlebars: allowInsecurePrototypeAccess(handlebars)
  })
)
app.enable('trust proxy')
app.set('view engine', '.hbs')
app.enable('view cache')
app.use(methodOverride())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))
app.use(
  express.urlencoded({
    extended: true
  })
)
app.use(cookieParser(process.env.PARSER_SECRET))
app.use(
  expressSession({
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000
    },
    secret: process.env.COOKIE_SECRET,
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.DB_CONNECTION_STRING,
      mongooseConnection: mongoose.connection,
      ttl: 14 * 24 * 60 * 60,
      autoRemove: 'native'
    })
  })
)
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

if (process.env.DEBUG.toLowerCase() === 'true') {
  // When testing, we want to use self sign for localhost website. In production we rely on reverse proxy (nginx/apache etc.)
  const options = {
    key: fs.readFileSync('./config/key.pem'),
    cert: fs.readFileSync('./config/cert.pem')
  }
  // Create an HTTPS service identical to the HTTP service.
  https.createServer(options, app).listen(process.env.APP_PORT_SSL || 443)
}

module.exports = app
