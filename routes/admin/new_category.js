import { Router } from 'express'
import { ensureAuthenticated } from '../../functions/ensureAuthenticated.js'
import Category from '../../models/category.js'
import csrf from 'csurf'
import logger from '../../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)

/* GET new category page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      'server.routes.newcategory.get__User tried to access admin page without permission.',
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
        `server.routes.newcategory.get__Successfully loaded ${categories?.length} categories.`,
        {
          metadata: {
            result: categories
          }
        }
      )

      res.render('admin/new_category', {
        title: 'Nová kategorie | Lednice IT',
        categories,
        user: req.user,
        alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error(
        'server.routes.newcategory.get__Failed to find categories.',
        {
          metadata: {
            error: err.message
          }
        }
      )
    })
})

/* POST new category form handle. */
router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      'server.routes.newcategory.post__User tried to access admin page without permission.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  const newCategory = new Category({
    name: req.body.category_name,
    color: req.body.category_color
  })
  newCategory
    .save()
    .then((category) => {
      logger.info(
        `server.routes.newcategory.post__User:[${req.user.email}] added new category:[${req.body.category_name}] to database.`,
        {
          metadata: {
            result: category
          }
        }
      )
      const alert = {
        type: 'success',
        message: `Kategorie ${req.body.category_name} přidána do databáze.`,
        success: 1
      }
      req.session.alert = alert
      res.redirect('/new_category')
    })
    .catch((err) => {
      logger.error(
        'server.routes.newcategory.post__Failed to add new category to database.',
        {
          metadata: {
            error: err.message
          }
        }
      )
      const alert = {
        type: 'danger',
        component: 'db',
        message: err.message,
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/new_category')
    })
})

export default router
