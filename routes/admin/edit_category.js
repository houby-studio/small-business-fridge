import { Router } from 'express'
import { ensureAuthenticated } from '../../functions/ensureAuthenticated.js'
import Category from '../../models/category.js'
import csrf from 'csurf'
import logger from '../../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)

/* GET edit category page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      'server.routes.editcategory.get__User tried to access admin page without permission.',
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
        `server.routes.editcategory.get__Successfully loaded ${categories?.length} categories.`,
        {
          metadata: {
            result: categories
          }
        }
      )

      res.render('admin/edit_category', {
        title: 'Upravit kategorii | Lednice IT',
        categories,
        user: req.user,
        alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error(
        'server.routes.editcategory.get__Failed to find categories.',
        {
          metadata: {
            error: err.message
          }
        }
      )
    })
})

/* POST edit category form handle. */
router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      'server.routes.editcategory.post__User tried to access admin page without permission.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  Category.findById(req.body.category_id)
    .then((category) => {
      // Handle name change
      if (category.name !== req.body.category_name) {
        logger.info(
          `server.routes.editcategory.post__Changing category's name:[${category.name}] to new name:[${req.body.category_name}].`
        )
        category.name = req.body.category_name
      }

      // Handle color change
      if (category.color !== req.body.category_color) {
        logger.info(
          `server.routes.editcategory.post__Changing category's color:[${category.color}] to new color:[${req.body.category_color}].`
        )
        category.color = req.body.category_color
      }

      // Handle disabled state change - either sets disabled to true or false
      // Filter for other pages should use Category.find({ disabled: { $in: [null, false] } })
      if (category.disabled !== req.body.category_disabled) {
        const category_state = !!req.body.category_disabled
        logger.info(
          `server.routes.editcategory.post__Changing category's state:[${category.disabled}] to :[${category_state}].`
        )
        category.disabled = category_state
      }

      // Save changes
      category
        .save()
        .then((category) => {
          logger.info(
            `server.routes.editcategory.post__User:[${req.user.email}] updated category:[${req.body.category_name}] .`,
            {
              metadata: {
                result: category
              }
            }
          )
          const alert = {
            type: 'success',
            message: `Kategorie ${req.body.category_name} upravena v databázi.`,
            success: 1
          }
          req.session.alert = alert
          res.redirect('/edit_category')
        })
        .catch((err) => {
          logger.error(
            'server.routes.editcategory.post__Failed to save edited category to database.',
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
          res.redirect('/edit_category')
        })
    })
    .catch((err) => {
      // Handle Category.FindById error
      logger.error(
        `server.routes.editcategory.post__Failed to find category to edit by ID:[${req.body.category_id}] in the database.`,
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
      res.redirect('/edit_category')
    })
})

export default router
