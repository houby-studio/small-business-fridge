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
const router = Router()
moment.locale('cs')
// TODO: where is csrf

// GET supplier invoice page.
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      'server.routes.invoice.get__User tried to access supplier page without permission.',
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
        'server.routes.invoice.get__User tried to access admin page without permission.',
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
    .then((groupByProduct) => {
      logger.debug(
        `server.routes.invoice.get__Successfully loaded ${groupByProduct[0]?.stock.length} product metrics.`,
        {
          metadata: {
            result: groupByProduct
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
            'orders.product._id': 1,
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
        .then((groupByUser) => {
          logger.debug(
            `server.routes.invoice.get__Successfully loaded ${groupByUser.length} user metrics.`,
            {
              metadata: {
                result: groupByUser
              }
            }
          )
          let graphColors
          if (groupByProduct[0]) {
            if (groupByProduct[0].stock.length > 64) {
              logger.debug(
                'server.routes.invoice.get__There is more than 65 products, loading full palette.'
              )
              graphColors = palette('mpn65', 65)
            } else {
              graphColors = palette('mpn65', groupByProduct[0].stock.length)
            }
            let colorCount = 0
            for (let i = 0; i < groupByProduct[0].stock.length; i++) {
              groupByProduct[0].stock[i].color = graphColors[colorCount]
              colorCount++
              if (colorCount >= graphColors.length) {
                logger.debug(
                  'server.routes.invoice.get__Resetting color palette to 0 to prevent array overflow.'
                )
                colorCount = 0
              }
            }
          }
          if (groupByUser[0]) {
            if (groupByUser.length > 64) {
              logger.debug(
                'server.routes.invoice.get__There is more than 65 users, loading full palette.'
              )
              graphColors = palette('mpn65', 65)
            } else {
              graphColors = palette('mpn65', groupByUser.length)
            }
            let colorCount = 0
            for (let y = 0; y < groupByUser.length; y++) {
              groupByUser[y].color = graphColors[colorCount]
              colorCount++
              if (colorCount >= graphColors.length) {
                logger.debug(
                  'server.routes.invoice.get__Resetting color palette to 0 to prevent array overflow.'
                )
                colorCount = 0
              }
              groupByUser[y].orders.forEach(function (element) {
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
            title:
              req.baseUrl === '/admin_invoice'
                ? 'Vše k fakturaci | Lednice IT'
                : 'Fakturace | Lednice IT',
            user: req.user,
            productview: groupByProduct[0],
            userview: groupByUser,
            supplier: filter,
            alert
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
    })
})

router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      'server.routes.invoice.post__User tried to access supplier page without permission.',
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
        'server.routes.invoice.post__User tried to access admin page without permission.',
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
      'server.routes.invoice.post__Admin tried to create invoice from admin dashboard.',
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
    .then((groupByUser) => {
      logger.debug(
        'server.routes.invoice.post__Successfully loaded orders grouped by users to invoice.',
        {
          metadata: {
            result: groupByUser
          }
        }
      )

      // Loop through array for each user
      for (let i = 0; i < groupByUser.length; i++) {
        // Create new invoice to be sent to user
        logger.debug(
          `server.routes.invoice.post__Creating invoice for user ${groupByUser[i].user._id} for amount ${groupByUser[i].total_user_sum_orders_notinvoiced}.`,
          {
            metadata: {
              result: groupByUser[i]
            }
          }
        )
        // var newInvoice = new Invoice // Former placement of new invoice - cannot be here when saved inside bulkWrite

        // Create command to update property 'invoice' on all orders pushed to new invoice
        const writeOperations = [
          {
            updateMany: {
              filter: {
                _id: { $in: groupByUser[i].orders.map((order) => order._id) }
              },
              update: {
                invoice: true
              }
            }
          }
        ]

        // Write all changes at once, then save new invoice and send e-mail
        Order.bulkWrite(writeOperations)
          .then((bulkResult) => {
            // bulkWrite uses some dark magic which causes same Invoice to be created twice if defined outside its scope

            const selfInvoice = req.user._id.equals(groupByUser[i].user._id)

            new Invoice({
              buyerId: groupByUser[i].user._id,
              supplierId: req.user._id,
              totalCost: groupByUser[i].total_user_sum_orders_notinvoiced,
              ordersId: groupByUser[i].orders.map((order) => order._id),
              paid: selfInvoice,
              requestPaid: selfInvoice
            })
              .save()
              .then((invoice) => {
                logger.debug(
                  `server.routes.invoice.post__Successfully saved invoice ${invoice._id} to database.`,
                  {
                    metadata: {
                      result: invoice
                    }
                  }
                )
                generateQR(
                  req.user.IBAN,
                  groupByUser[i].total_user_sum_orders_notinvoiced,
                  groupByUser[i].user.displayName,
                  req.user.displayName,
                  function (qrImageData, qrText) {
                    logger.debug(
                      'server.routes.invoice.post__QR code generated, sending invioce e-mail to customer.',
                      {
                        metadata: {
                          result: bulkResult
                        }
                      }
                    )
                    const friendlyInvoiceDate = moment(
                      invoice.invoiceDate
                    ).format('LLLL')
                    const subject = `Hromadná fakturace - ${req.user.displayName} - ${invoice.totalCost} Kč`
                    const mailPreview = `Detaily faktury - Datum: ${friendlyInvoiceDate} - Počet produktů: ${invoice.ordersId.length} Celková částka: ${invoice.totalCost} Kč.`

                    sendMail(groupByUser[i].user.email, 'newInvoiceNotice', {
                      subject,
                      mailPreview,
                      invoiceId: invoice._id,
                      invoiceDate: friendlyInvoiceDate,
                      invoiceTotalCost: invoice.totalCost,
                      invoiceTotalCount: invoice.ordersId.length,
                      supplierDisplayName: req.user.displayName,
                      customerDisplayName: groupByUser[i].user.displayName,
                      supplierIBAN: req.user.IBAN,
                      qrImageData,
                      qrText,
                      selfInvoiced: selfInvoice,
                      invoiceDueDays: () => {
                        const dueDays =
                          process.env.TASKS_DAILY_INCOMPLETE_INVOICE_NET_DAYS ||
                          14
                        switch (true) {
                          case dueDays === 0:
                            return 'Okamžitá'
                          case dueDays === 1:
                            return `${dueDays} den`
                          case dueDays < 5:
                            return `${dueDays} dny`
                          default:
                            return `${dueDays} dní`
                        }
                      }
                    })
                  }
                )
              })
              .catch((err) => {
                logger.error(
                  'server.routes.invoice.post__Failed to save invoice to database.',
                  {
                    metadata: {
                      error: err.message
                    }
                  }
                )
              })
          })
          .catch((err) => {
            logger.error(
              'server.routes.invoice.post__Failed to bulk modify invoiced orders.',
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
        'server.routes.invoice.post__Failed to load orders grouped by users to invoice.',
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
    })
})

export default router
