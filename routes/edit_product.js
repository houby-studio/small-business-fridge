import { Router } from 'express'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import Product from '../models/product.js'
import multer, { diskStorage } from 'multer'
import csrf from 'csurf'
import logger from '../functions/logger.js'
import { unlink } from 'node:fs'
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

/* GET edit product page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.editproduct.get__User tried to access supplier page without permission.`,
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
  Product.find()
    .sort([['displayName', 1]])
    .then((docs) => {
      logger.info(
        `server.routes.editproduct.get__Successfully loaded ${docs.length} products.`,
        {
          metadata: {
            result: docs
          }
        }
      )

      res.render('shop/edit_product', {
        title: 'Upravit produkt | Lednice IT',
        products: docs,
        user: req.user,
        alert: alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error(`server.routes.addproduct.get__Failed to load products.`, {
        metadata: {
          error: err.message
        }
      })
      res.status(err.status || 500)
      res.render('error')
    })
})

/* POST edit product form handle. */
router.post(
  '/',
  ensureAuthenticated,
  upload.single('product_image'),
  function (req, res) {
    if (!req.user.supplier) {
      logger.warn(
        `server.routes.editproduct.post__User tried to access supplier page without permission.`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.redirect('/')
      return
    }

    Product.findById(req.body.product_id)
      .then((product) => {
        // Handle Product.FindById result
        if (!product) {
          throw 'No product returned from database.'
        }

        // Handle display name change
        if (product.displayName !== req.body.product_name) {
          logger.info(
            `server.routes.editproduct.post__Changing product's display name:[${product.displayName}] to new name:[${req.body.product_name}].`
          )
          product.displayName = req.body.product_name
        }

        // Handle description change
        if (product.description !== req.body.product_description) {
          logger.info(
            `server.routes.editproduct.post__Changing product's description:[${product.description}] to new description:[${req.body.product_description}].`
          )
          product.description = req.body.product_description
        }

        // TODO: Handle categories change

        // If image was not uploaded, we do not change it
        if (req.file) {
          const imagePath = './images/' + req.file.filename
          if (product.imagePath !== imagePath) {
            unlink('./public/' + product.imagePath, (err) => {
              if (err) {
                // Handle fs.unlink error
                logger.error(
                  `server.routes.editproduct.post__Failed to delete old product's image:[${product.imagePath}] from disk.`,
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
                res.redirect('/edit_product')
                return
              }
            })
            logger.info(
              `server.routes.editproduct.post__Deleted old image:[${product.imagePath}] from disk.`
            )
          }

          logger.info(
            `server.routes.editproduct.post__Changing product's image:[${product.imagePath}] to new image:[${imagePath}].`
          )
          product.imagePath = imagePath
        }

        // Save changes
        product
          .save()
          .then((result) => {
            // Handle product.save result
            logger.info(
              `server.routes.editproduct.post__User:[${req.user.email}] updated product:[${req.body.product_id}].`,
              {
                metadata: {
                  result: result
                }
              }
            )
            var alert = {
              type: 'success',
              message: `Produkt ${req.body.product_name} upraven v databázi.`,
              success: 1
            }
            req.session.alert = alert
            res.redirect('/edit_product')
          })
          .catch((err) => {
            // Handle product.save error
            logger.error(
              `server.routes.editproduct.post__Failed to update product:[${req.body.product_id}].`,
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
            res.redirect('/edit_product')
            return
          })
      })
      .catch((err) => {
        // Handle Product.FindById error
        logger.error(
          `server.routes.editproduct.post__Failed to find product to edit by ID:[${req.body.product_id}] in the database.`,
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
        res.redirect('/edit_product')
        return
      })
  }
)

export default router
