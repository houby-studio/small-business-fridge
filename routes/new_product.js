import { Router } from 'express'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import Product from '../models/product.js'
import Category from '../models/category.js'
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
  Category.find()
    .sort([['name', 1]])
    .then((categories) => {
      logger.debug(
        `server.routes.newproduct.get__Successfully loaded ${categories?.length} categories.`,
        {
          metadata: {
            result: categories
          }
        }
      )

      res.render('shop/new_product', {
        title: 'Nový produkt | Lednice IT',
        categories: categories,
        user: req.user,
        alert: alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error(`server.routes.newproduct.get__Failed to find categories.`, {
        metadata: {
          error: err.message
        }
      })
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

    // If image was not uploaded, reject request
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

    Product.find()
      .sort({
        keypadId: -1
      })
      .limit(1)
      .then((product) => {
        var newProduct = new Product({
          keypadId: 1 + product[0]?.keypadId || 1,
          displayName: req.body.product_name,
          description: req.body.product_description,
          imagePath: './images/' + req.file.filename
        })
        if (req.body.product_category) {
          newProduct.category = req.body.product_category
        }
        newProduct
          .save()
          .then((result) => {
            logger.info(
              `server.routes.newproduct.post__User:[${req.user.email}] added new product:[${req.body.product_name}] to database.`,
              {
                metadata: {
                  result: result
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
      })
      .catch((err) => {
        logger.error(
          `server.routes.newproduct.post__Failed to find next keypad ID for new product from database.`,
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
