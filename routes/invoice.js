import { Router } from 'express'
import palette from 'google-palette'
import moment from 'moment'
import { sendMail } from '../functions/sendMail.js'
import { generateQR } from '../functions/qrPayment.js'
import Delivery from '../models/delivery.js'
import Order from '../models/order.js'
import Invoice from '../models/invoice.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import logger from '../functions/logger.js'
var router = Router()
moment.locale('cs')
// TODO: where is csrf

// GET supplier invoice page.
router.get('/', ensureAuthenticated, checkKiosk, function (req, res, _next) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.invoice.get__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  if (req.baseUrl === '/admin_invoice') {
    var filter
    if (!req.user.admin) {
      logger.warn(
        `server.routes.invoice.get__User tried to access admin page without permission.`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.redirect('/')
      return
    }
    filter = {}
  } else {
    filter = {
      supplierId: req.user._id
    }
  }

  // Aggregate and group by productId for product based info - total amounts and total price for 'invoiced', 'not invoiced' and 'on stock'
  Delivery.aggregate([
    {
      $match: filter
    }, // Get only deliveries inserted by supplier requesting the page
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product'
      }
    }, // join on product
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'deliveryId',
        as: 'orders'
      }
    }, // join on orders
    {
      $group: {
        _id: '$productId', // group by Product Id
        product: {
          $first: '$product'
        },
        amount_left: {
          $sum: '$amount_left'
        },
        amount_supplied: {
          $sum: '$amount_supplied'
        },
        orders: {
          $push: '$orders'
        },
        num_orders_notinvoiced: {
          $sum: {
            $size: {
              $filter: {
                input: '$orders',
                as: 'notinvoiced',
                cond: {
                  $eq: ['$$notinvoiced.invoice', false]
                }
              }
            }
          }
        },
        num_orders_invoiced: {
          $sum: {
            $size: {
              $filter: {
                input: '$orders',
                as: 'invoiced',
                cond: {
                  $eq: ['$$invoiced.invoice', true]
                }
              }
            }
          }
        },
        sum_orders_notinvoiced: {
          $sum: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'notinvoiced',
                    cond: {
                      $eq: ['$$notinvoiced.invoice', false]
                    }
                  }
                },
                as: 'total',
                in: '$price'
              }
            }
          }
        },
        sum_orders_invoiced: {
          $sum: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'invoiced',
                    cond: {
                      $eq: ['$$invoiced.invoice', true]
                    }
                  }
                },
                as: 'total',
                in: '$price'
              }
            }
          }
        },
        sum_stocked: {
          $sum: {
            $multiply: ['$price', '$amount_left']
          }
        }
      }
    },
    {
      $group: {
        _id: null, // group all to get some total values across all products
        stock: {
          $push: '$$ROOT'
        },
        total_num_orders_invoiced: {
          $sum: '$num_orders_invoiced'
        },
        total_num_orders_notinvoiced: {
          $sum: '$num_orders_notinvoiced'
        },
        total_sum_orders_invoiced: {
          $sum: '$sum_orders_invoiced'
        },
        total_sum_orders_notinvoiced: {
          $sum: '$sum_orders_notinvoiced'
        },
        total_num_stocked: {
          $sum: '$amount_left'
        },
        total_sum_stocked: {
          $sum: '$sum_stocked'
        }
      }
    }
  ])
    .then((docs) => {
      logger.debug(
        `server.routes.invoice.get__Successfully loaded ${docs[0]?.stock.length} product metrics.`,
        {
          metadata: {
            result: docs
          }
        }
      )
      // Aggregate and group by user for user based info - total amounts and total price 'not invoiced' and all not invoiced orders
      Delivery.aggregate([
        {
          $match: filter
        },
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'product'
          }
        },
        {
          $unwind: '$product'
        },
        {
          $lookup: {
            from: 'orders',
            localField: '_id',
            foreignField: 'deliveryId',
            as: 'orders'
          }
        },
        {
          $unwind: {
            path: '$orders',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            'orders.product': '$product'
          }
        },
        {
          $addFields: {
            'orders.price': '$price'
          }
        },
        {
          $match: {
            'orders.invoice': false
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'orders.buyerId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: {
            path: '$user',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$orders.buyerId',
            user: {
              $first: '$user'
            },
            orders: {
              $push: '$orders'
            }
          }
        },
        {
          $project: {
            user: '$user.displayName',
            'orders.product.displayName': 1,
            'orders.order_date': 1,
            'orders.price': 1,
            total_user_num_orders_notinvoiced: {
              $size: '$orders'
            },
            total_user_sum_orders_notinvoiced: {
              $sum: '$orders.price'
            }
          }
        }
      ])
        .then((udocs) => {
          logger.debug(
            `server.routes.invoice.get__Successfully loaded ${udocs.length} user metrics.`,
            {
              metadata: {
                result: udocs
              }
            }
          )
          var graphColors
          if (docs[0]) {
            if (docs[0].stock.length > 64) {
              logger.debug(
                'server.routes.invoice.get__There is more than 65 products, loading full palette.'
              )
              graphColors = palette('mpn65', 65)
            } else {
              graphColors = palette('mpn65', docs[0].stock.length)
            }
            let colorCount = 0
            for (var i = 0; i < docs[0].stock.length; i++) {
              docs[0].stock[i].color = graphColors[colorCount]
              colorCount++
              if (colorCount >= graphColors.length) {
                logger.debug(
                  'server.routes.invoice.get__Resetting color palette to 0 to prevent array overflow.'
                )
                colorCount = 0
              }
            }
          }
          if (udocs[0]) {
            if (udocs.length > 64) {
              logger.debug(
                'server.routes.invoice.get__There is more than 65 users, loading full palette.'
              )
              graphColors = palette('mpn65', 65)
            } else {
              graphColors = palette('mpn65', udocs.length)
            }
            let colorCount = 0
            for (var y = 0; y < udocs.length; y++) {
              udocs[y].color = graphColors[colorCount]
              colorCount++
              if (colorCount >= graphColors.length) {
                logger.debug(
                  'server.routes.invoice.get__Resetting color palette to 0 to prevent array overflow.'
                )
                colorCount = 0
              }
              udocs[y].orders.forEach(function (element) {
                element.order_date_format = moment(element.order_date).format(
                  'LLLL'
                )
                element.order_date = moment(element.order_date).format()
              })
            }
          }
          let alert
          if (req.session.alert) {
            alert = req.session.alert
            delete req.session.alert
          }
          res.render('shop/invoice', {
            title: 'Fakturace | Lednice IT',
            user: req.user,
            productview: docs[0],
            userview: udocs,
            supplier: filter,
            alert: alert
          })
        })
        .catch((err) => {
          logger.error(
            'server.routes.invoice.get__Failed to fetch user metrics.',
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
          res.redirect('/')
          return
        })
    })
    .catch((err) => {
      logger.error(
        'server.routes.invoice.get__Failed to fetch product metrics.',
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
      res.redirect('/')
      return
    })
})

router.post('/', ensureAuthenticated, function (req, res, _next) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.invoice.post__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  if (req.baseUrl === '/admin_invoice') {
    if (!req.user.admin) {
      logger.warn(
        `server.routes.invoice.post__User tried to access admin page without permission.`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.redirect('/')
      return
    }
    logger.warn(
      `server.routes.invoice.post__Admin tried to create invoice from admin dashboard.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    const alert = {
      type: 'danger',
      message: 'Fakturace z administrátorského pohledu je zakázána!',
      danger: 1
    }
    req.session.alert = alert
    res.redirect('/admin_invoice')
    return
  }

  // For dev purposes only - reverts all orders back to invoice:false
  /* var bulk = Order.collection.initializeUnorderedBulkOp();
    // Loop through array for each order for that user
    bulk.find( { invoice: true } ).update( { $set: { invoice: false } } );
    bulk.execute(function (err, items) {
    }); */

  // Aggregate and group by user to create invoice for each of them
  Delivery.aggregate([
    {
      $match: {
        supplierId: req.user._id
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'deliveryId',
        as: 'orders'
      }
    },
    {
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $addFields: {
        'orders.product': '$product'
      }
    },
    {
      $addFields: {
        'orders.price': '$price'
      }
    },
    {
      $match: {
        'orders.invoice': false
      }
    },
    // { $set: { 'orders.invoice': true } }, // In the future could be easier on Mongo 4.2 with this new feature
    {
      $lookup: {
        from: 'users',
        localField: 'orders.buyerId',
        foreignField: '_id',
        as: 'user'
      }
    },
    {
      $unwind: {
        path: '$user',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: '$orders.buyerId',
        user: {
          $first: '$user'
        },
        orders: {
          $push: '$orders'
        }
      }
    },
    {
      $project: {
        'orders._id': 1,
        'orders.product.displayName': 1,
        'orders.order_date': 1,
        'orders.price': 1,
        user: 1,
        total_user_num_orders_notinvoiced: {
          $size: '$orders'
        },
        total_user_sum_orders_notinvoiced: {
          $sum: '$orders.price'
        }
      }
    }
  ])
    .then((docs) => {
      logger.debug(
        'server.routes.invoice.post__Successfully loaded orders grouped by users to invoice.',
        {
          metadata: {
            result: docs
          }
        }
      )
      // Loop through array for each user
      for (let i = 0; i < docs.length; i++) {
        // Create new invoice to be sent to user
        logger.debug(
          `server.routes.invoice.post__Creating invoice for user ${docs[i].user._id} for amount ${docs[i].total_user_sum_orders_notinvoiced}.`,
          {
            metadata: {
              result: docs[i]
            }
          }
        )
        var newInvoice = new Invoice({
          buyerId: docs[i].user._id,
          supplierId: req.user.id,
          totalCost: docs[i].total_user_sum_orders_notinvoiced
        })
        var bulk = Order.collection.initializeUnorderedBulkOp()
        // Loop through array for each order for that user
        for (let p = 0; p < docs[i].orders.length; p++) {
          logger.debug(
            `server.routes.invoice.post__Pushing order ${docs[i].orders[p]._id} to invoice array.`,
            {
              metadata: {
                result: docs[i].orders[p]._id
              }
            }
          )
          newInvoice.ordersId.push(docs[i].orders[p]._id)
          bulk
            .find({
              _id: docs[i].orders[p]._id
            })
            .updateOne({
              $set: {
                invoice: true
              }
            })
        }
        newInvoice
          .save()
          .then((result) => {
            logger.debug(
              `server.routes.invoice.post__Successfully saved invoice ${res._id} to database.`,
              {
                metadata: {
                  result: result
                }
              }
            )
          })
          .catch((err) => {
            logger.error(
              `server.routes.invoice.post__Failed to save invoice to database.`,
              {
                metadata: {
                  error: err.message
                }
              }
            )
          })
        bulk
          .execute()
          .then((result) => {
            generateQR(
              req.user.IBAN,
              docs[i].total_user_sum_orders_notinvoiced,
              docs[i].user.displayName,
              req.user.displayName,
              function (qrcode) {
                logger.debug(
                  `server.routes.invoice.post__QR code generated, sending invioce e-mail to customer.`,
                  {
                    metadata: {
                      result: result
                    }
                  }
                )
                var subject = 'Fakturace!'
                var body = `<h1>Přišel čas zúčtování!</h1><p>Váš nejoblíbenější dodavatel ${
                  req.user.displayName
                } Vám zaslal fakturu.</p><h2>Fakturační údaje</h2><p>Částka k úhradě: ${
                  docs[i].total_user_sum_orders_notinvoiced
                }Kč<br>Počet zakoupených produktů: ${
                  docs[i].total_user_num_orders_notinvoiced
                }ks<br>Datum fakturace: ${moment().format(
                  'LLLL'
                )}<br><a href="${
                  req.headers.origin
                }/invoices">Více na webu Lednice IT</a></p><p>Platbu je možné provést hotově nebo převodem.<br>Po platbě si zkontrolujte, zda dodavatel označil Vaši platbu jako zaplacenou.</p>`
                if (req.user.IBAN) {
                  body += `<h2>QR platba</h2><img width="480" height="480" style="width: 20rem; height: 20rem;" alt="QR kód pro mobilní platbu se Vám nezobrazuje správně." src="${qrcode}"/><p>IBAN: ${req.user.IBAN}</p><p>Předem díky za včasnou platbu!</p>`
                }
                sendMail(docs[i].user.email, subject, body)
              }
            )
          })
          .catch((err) => {
            logger.error(
              `server.routes.invoice.post__Failed to bulk modify invoiced orders.`,
              {
                metadata: {
                  error: err.message
                }
              }
            )
          })
      }
      const alert = {
        type: 'success',
        message:
          'Fakturace úspěšně vygenerována a e-maily rozeslány zákazníkům!',
        success: 1
      }
      req.session.alert = alert
      res.redirect('/invoice')
    })
    .catch((err) => {
      logger.error(
        `server.routes.invoice.post__Failed to load orders grouped by users to invoice.`,
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
      res.redirect('/')
      return
    })
})

export default router
