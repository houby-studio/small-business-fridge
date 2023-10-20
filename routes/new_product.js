import { Router } from 'express'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import Product from '../models/product.js'
import multer, { diskStorage } from 'multer'
import csrf from 'csurf'
import logger from '../functions/logger.js'
var router = Router()
var csrfProtection = csrf()
router.use(csrfProtection)

// Multer options - Save to public/images and keep original name
const storage = diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/')
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname)
  }
})
const upload = multer({ storage: storage })

/* GET new product page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.newproduct.get__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }
  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  res.render('shop/new_product', {
    title: 'Nový produkt | Lednice IT',
    user: req.user,
    alert: alert,
    csrfToken: req.csrfToken()
  })
})

/* POST new product form handle. */
router.post(
  '/',
  ensureAuthenticated,
  upload.single('product_image'),
  function (req, res) {
    if (!req.user.supplier) {
      logger.warn(
        `server.routes.newproduct.post__User tried to access supplier page without permission.`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.redirect('/')
      return
    }

    // If image was not uploaded, use preview dummy image
    if (!req.file) {
      logger.warn('server.routes.newproduct.post__No product image uploaded.')
      var alert = {
        type: 'danger',
        message: 'Musíte přidat obrázek produktu!',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/new_product')
    }

    var newProduct = new Product({
      keypadId: req.body.product_keypadid,
      displayName: req.body.product_name,
      description: req.body.product_description,
      imagePath: './images/' + req.file.filename
    })
    newProduct
      .save()
      .then((res) => {
        logger.info(
          `server.routes.newproduct.post__User:[${req.user.email}] added new product:[${req.body.product_name}] to database.`,
          {
            metadata: {
              result: res
            }
          }
        )
        alert = {
          type: 'success',
          message: `Produkt ${req.body.product_name} přidán do databáze.`,
          success: 1
        }
        req.session.alert = alert
        res.redirect('/new_product')
      })
      .catch((err) => {
        logger.error(
          `server.routes.newproduct.post__Failed to add new product to database.`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        var alert = {
          type: 'danger',
          component: 'db',
          message: err.message,
          danger: 1
        }
        req.session.alert = alert
        res.redirect('/new_product')
        return
      })
  }
)

export default router
