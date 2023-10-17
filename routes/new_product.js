import { Router } from 'express'
var router = Router()
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import Product from '../models/product.js'
import multer, { diskStorage } from 'multer'
import csrf from 'csurf'
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
      res.redirect('/')
      return
    }

    // If image was not uploaded, use preview dummy image
    if (!req.file) {
      req.file = { filename: 'preview.png' }
    }

    var newProduct = new Product({
      keypadId: req.body.product_keypadid,
      displayName: req.body.product_name,
      description: req.body.product_description,
      imagePath: './images/' + req.file.filename
    })
    newProduct
      .save()
      .then(() => {
        alert = {
          type: 'success',
          message: `Produkt ${req.body.product_name} přidán do databáze.`,
          success: 1
        }
        req.session.alert = alert
        res.redirect('/new_product')
      })
      .catch((err) => {
        console.log(err)
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
