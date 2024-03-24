import { Router } from "express";
import moment from "moment";
import Product from "../models/product.js";
import Order from "../models/order.js";
import Delivery from "../models/delivery.js";
import Category from "../models/category.js";
import { sendMail } from "../functions/sendMail.js";
import { ensureAuthenticated } from "../functions/ensureAuthenticated.js";
import { checkKiosk } from "../functions/checkKiosk.js";
import csrf from "csurf";
import logger from "../functions/logger.js";
const router = Router();
const csrfProtection = csrf();
router.use(csrfProtection);
moment.locale("cs");

function renderPage(req, res, alert) {
  // Get all products, optionally only products in stock and all categories.
  Product.aggregate([
    {
      $lookup: {
        from: "deliveries",
        localField: "_id",
        foreignField: "productId",
        as: "stock",
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        pipeline: [{ $match: { disabled: { $in: [null, false] } } }],
        as: "category",
      },
    },
    {
      // Depending on user preferences, get either all products or only ones in stock
      $match: req.user.showAllProducts
        ? {}
        : {
            "stock.amount_left": {
              $gt: 0,
            },
          },
    },
    {
      $project: {
        keypadId: "$keypadId",
        displayName: "$displayName",
        description: "$description",
        imagePath: "$imagePath",
        category: "$category",
        stock: {
          $filter: {
            // We filter only the stock object from array where amount left is greater than 0
            input: "$stock",
            as: "stock",
            cond: {
              $gt: ["$$stock.amount_left", 0],
            },
          },
        },
        stockSum: {
          $sum: "$stock.amount_left",
        },
      },
    },
    {
      $sort: {
        displayName: 1,
      },
    },
  ])
    .then((docs) => {
      Category.find({ disabled: { $in: [null, false] } })
        .sort([["name", 1]])
        .then((categories) => {
          logger.debug(
            `server.routes.shop.get__Successfully loaded ${categories?.length} categories.`,
            {
              metadata: {
                result: categories,
              },
            }
          );

          // Populate favorites if user has any
          if (req.user.favorites?.length > 0) {
            logger.debug(
              `server.routes.shop.get__User has set favorites, populating products.`,
              {
                metadata: {
                  result: req.user.favorites,
                },
              }
            );

            // Add favorite parameter to products object
            req.user.favorites.forEach((elFav) => {
              docs.forEach((elProd) => {
                if (elFav._id.equals(elProd._id)) {
                  elProd.favorite = true;
                }
              });
            });
          }

          res.render("shop/shop", {
            title: "E-shop | Lednice IT",
            products: docs,
            categories: categories,
            user: req.user,
            alert,
            csrfToken: req.csrfToken(),
          });
        })
        .catch((err) => {
          logger.error(`server.routes.shop.get__Failed to find categories.`, {
            metadata: {
              error: err.message,
            },
          });
        });
    })
    .catch((err) => {
      logger.error(
        "server.routes.shop.get__Failed to query products from database.",
        {
          metadata: {
            error: err.message,
          },
        }
      );
      res.status(err.status || 500);
      res.render("error");
    });
}

/* GET shop page. */
router.get("/", ensureAuthenticated, checkKiosk, function (req, res) {
  let alert;
  if (req.session.alert) {
    alert = req.session.alert;
    delete req.session.alert;
  }
  renderPage(req, res, alert);
});

/* POST shop page. */
router.post("/", ensureAuthenticated, checkKiosk, function (req, res) {
  if (req.user.id !== req.body.user_id) {
    logger.warn(
      "server.routes.shop.post__User identity does not match with request body. No product has been purchased.",
      {
        metadata: {
          userIdentity: req.user.id,
          bodyIdentity: req.body.user_id,
        },
      }
    );
    const alert = {
      type: "danger",
      component: "web",
      message:
        "Při zpracování objednávky došlo k chybě. Zkuste to prosím znovu.",
      danger: 1,
    };
    req.session.alert = alert;
    res.redirect("/shop");
    return;
  }

  const newOrder = new Order({
    buyerId: req.user.id,
    deliveryId: req.body.product_id,
  });

  Delivery.findOne({
    _id: req.body.product_id,
  })
    .then((delivery) => {
      delivery.amount_left--;
      delivery
        .save()
        .then(() => {
          logger.debug(
            `server.routes.shop.post__Purchased product stock amount decremented from delivery [${delivery._id}].`,
            {
              metadata: {
                object: delivery,
              },
            }
          );
          newOrder
            .save()
            .then((order) => {
              logger.info(
                `server.routes.shop.post__User [${req.user.id}] succesfully purchased product [${req.body.display_name}] for [${delivery.price}] via e-shop.`,
                {
                  metadata: {
                    order: order,
                  },
                }
              );
              const alert = {
                type: "success",
                message: `Zakoupili jste ${req.body.display_name} za ${delivery.price} Kč.`,
                success: 1,
              };
              req.session.alert = alert;
              res.redirect("/shop");
              if (req.user.sendMailOnEshopPurchase) {
                const subject = `Potvrzení objednávky - ${req.body.display_name}`;
                const mailPreview = `Zakoupili jste ${req.body.display_name} za ${delivery.price} Kč na e-shopu.`;
                sendMail(
                  req.user.email,
                  "productPurchased",
                  {
                    subject,
                    mailPreview,
                    orderId: order._id,
                    productId: delivery.productId,
                    productName: req.body.display_name,
                    productPrice: delivery.price,
                    purchaseDate: moment(order.order_date).format("LLLL"),
                  },
                  req.body.image_path
                );
              }
              return;
            })
            .catch((err) => {
              logger.error(
                "server.routes.shop.post__Failed to create order in the database, but stock amount has been already decremented!",
                {
                  metadata: {
                    error: err.message,
                    delivery: delivery,
                  },
                }
              );
              const alert = {
                type: "danger",
                component: "db",
                message: err.message,
                danger: 1,
              };
              req.session.alert = alert;
              res.redirect("/shop");

              const subject = "[SYSTEM ERROR] Chyba při zápisu do databáze!";
              const message = `Potenciálně se nepodařilo zapsat novou objednávku do databáze, ale již došlo k ponížení skladové zásoby v dodávce ID [${delivery._id}]. Zákazník ID [${req.user._id}], zobrazované jméno [${req.user.displayName}] se pokusil koupit produkt ID [${delivery.productId}], zobrazované jméno [${req.body.display_name}] za [${delivery.price}] Kč. Zkontrolujte konzistenci databáze.`;
              sendMail("system@system", "systemMessage", {
                subject,
                message,
                messageTime: moment().toISOString(),
                errorMessage: err.message,
              });

              return;
            });
        })
        .catch((err) => {
          logger.error(
            "server.routes.shop.post__Failed to decrement stock amount from the delivery.",
            {
              metadata: {
                error: err.message,
              },
            }
          );
          const alert = {
            type: "danger",
            component: "db",
            message: err.message,
            danger: 1,
          };
          req.session.alert = alert;
          res.redirect("/shop");

          const subject = "[SYSTEM ERROR] Chyba při zápisu do databáze!";
          const message = `Potenciálně se nepodařilo snížit skladovou zásobu v dodávce ID [${delivery._id}] a následně vystavit objednávku. Zákazník ID [${req.user._id}], zobrazované jméno [${req.user.displayName}] se pokusil koupit produkt ID [${delivery.productId}], zobrazované jméno [${req.body.display_name}] za [${delivery.price}] Kč. Zkontrolujte konzistenci databáze.`;
          sendMail("system@system", "systemMessage", {
            subject,
            message,
            messageTime: moment().toISOString(),
            errorMessage: err.message,
          });

          return;
        });
    })
    .catch((err) => {
      logger.error(
        "server.routes.shop.post__Failed to query deliveries from database.",
        {
          metadata: {
            error: err.message,
          },
        }
      );
      const alert = {
        type: "danger",
        component: "db",
        message: err.message,
        danger: 1,
      };
      req.session.alert = alert;
      res.redirect("/shop");
      return;
    });
});

export default router;
