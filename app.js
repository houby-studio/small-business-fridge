// Require all neccesary modules
import logger from './functions/logger.js'
logger.info('server.app.startup__Importing root modules.')
import morgan from 'morgan'
import createError from 'http-errors' // Generating errors
import express, { json, urlencoded } from 'express' // Express
import methodOverride from 'method-override'
import path, { join } from 'path' // used for handling paths which held express files
import cookieParser from 'cookie-parser'
import expressSession from 'express-session'
import handlebars from 'handlebars'
import { engine } from 'express-handlebars' // extended handlebars functionality
import { allowInsecurePrototypeAccess } from '@handlebars/allow-prototype-access'
import mongoose from 'mongoose' // database
import connectMongo from 'connect-mongo' // (expressSession)
import passport from 'passport' // authentication method
import https from 'https' // Using HTTPS for debug
import fs from 'fs' // Loading certificate from file for debug
import { fileURLToPath } from 'url'
import 'dotenv/config'

// Emulate CommonJS variable
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Functions
logger.info('server.app.startup__Importing functions.')
import './functions/azure-passport.js'

// Import scheduled tasks
logger.info('server.app.startup__Importing scheduled tasks.')
import './tasks/daily-report.js'
import './tasks/daily-backup.js'
import './tasks/daily-unpaid-invoices.js'

// Load routes from routes folder to later app.use them.
// Access for all
logger.info('server.app.startup__Importing routes.')
import indexRouter from './routes/index.js'
import aboutRouter from './routes/about.js'
import changelogRouter from './routes/changelog.js'
// Access for logged in users
import shopRouter from './routes/shop.js'
import profileRouter from './routes/profile.js'
import ordersRouter from './routes/orders.js'
import invoicesRouter from './routes/invoices.js'
// Access for suppliers
import addProductsRouter from './routes/add_products.js'
import invoiceRouter from './routes/invoice.js'
import paymentsRouter from './routes/payments.js'
import stockRouter from './routes/stock.js'
import newProductRouter from './routes/new_product.js'
import editProductRouter from './routes/edit_product.js'
// Access for admins
import dashboardRouter from './routes/admin/admin_dashboard.js'
// Access for kiosk
import kioskKeypadRouter from './routes/kiosk_keypad.js'
import kioskShopRouter from './routes/kiosk_shop.js'
// Passport routes
import loginRouter from './routes/login.js'
import logoutRouter from './routes/logout.js'
import authOpenId from './routes/auth_openid.js'
import authOpenIdReturnGet from './routes/auth_openid_return.js'
import authOpenIdReturnPost from './routes/auth_openid_return_post.js'
// API routes
import keypadOrderRouter from './routes/api/keypadOrder.js'
import customerName from './routes/api/customerName.js'
// Middleware routes
import rateLimitRouter from './routes/middleware/rate_limit.js'

// Express app and database connection
logger.info('server.app.startup__Connecting to MongoDB server.')
mongoose.connect(process.env.DB_CONNECTION_STRING)
logger.info('server.app.startup__Creating and configuring Express.js server.')
const app = express()

// View engine setup
app.engine(
  '.hbs',
  engine({
    defaultLayout: 'layout',
    extname: '.hbs',
    handlebars: allowInsecurePrototypeAccess(handlebars)
  })
)
app.enable('trust proxy')
app.set('trust proxy', 1)
app.set('view engine', '.hbs')
app.enable('view cache')
// Stream logs to winston
app.use(
  morgan(
    'server.app.middleware__:remote-addr :remote-user :method :url :status :res[content-length] :referrer',
    { stream: logger.stream }
  )
)
app.use(methodOverride())
app.use(json())
app.use(express.static(join(__dirname, 'public')))
app.use(
  urlencoded({
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
    store: connectMongo.create({
      mongoUrl: process.env.DB_CONNECTION_STRING,
      mongooseConnection: mongoose.connection,
      ttl: 14 * 24 * 60 * 60,
      autoRemove: 'native'
    })
  })
)
app.use(passport.initialize())
app.use(passport.session())
app.use(rateLimitRouter)

// Application routes
// Access for all
logger.info('server.app.startup__Registering routes.')
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
app.use('/edit_product', editProductRouter)
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

if (process.env.NODE_ENV.toLowerCase() === 'development') {
  // When testing, we want to use self signed certificates for localhost website. In production we rely on reverse proxy (nginx/apache etc.)
  const options = {
    key: fs.readFileSync('./config/key.pem'),
    cert: fs.readFileSync('./config/cert.pem')
  }
  // Create an HTTPS service identical to the HTTP service.
  logger.warn(
    'server.app.startup__Creating HTTPS server for development - DO NOT use in PRODUCTION, use reverse proxy instead!'
  )
  https.createServer(options, app).listen(process.env.APP_PORT_SSL || 443)
  logger.info(
    `server.app.startup__HTTPS server listening on port ${
      process.env.APP_PORT_SSL || 443
    }`
  )
}

logger.info('server.app.startup__Application started!')

export default app
