import { Router } from "express";
import moment from "moment";
import Product from "../models/product.js";
import Order from "../models/order.js";
import Delivery from "../models/delivery.js";
import Category from "../models/category.js";
import User from "../models/user.js";
import { sendMail } from "../functions/sendMail.js";
import { ensureAuthenticated } from "../functions/ensureAuthenticated.js";
import csrf from "csurf";
import logger from "../functions/logger.js";
const router = Router();
const csrfProtection = csrf();
router.use(csrfProtection);
moment.locale("cs");

function renderPage(req, res, alert, customer) {
  // Get products in stock and all categories.
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
        as: "category",
      },
    },
    {
      $match: {
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
            // We filter only the stock object from array where ammount left is greater than 0
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
            `server.routes.kioskshop.get__Successfully loaded ${categories?.length} categories.`,
            {
              metadata: {
                result: categories,
              },
            }
          );

          // Populate favorites if user has any
          if (customer.favorites?.length > 0) {
            logger.debug(
              `server.routes.shop.get__User has set favorites, populating products.`,
              {
                metadata: {
                  result: customer.favorites,
                },
              }
            );

            // Add favorite parameter to products object
            customer.favorites.forEach((elFav) => {
              docs.forEach((elProd) => {
                if (elFav._id.equals(elProd._id)) {
                  elProd.favorite = true;
                }
              });
            });
          }

          res.render("shop/kiosk_shop", {
            title: "Kiosek | Lednice IT",
            products: docs,
            categories: categories,
            user: req.user,
            customer,
            alert,
            csrfToken: req.csrfToken(),
          });
        })
        .catch((err) => {
          logger.error(
            `server.routes.kioskshop.get__Failed to find categories.`,
            {
              metadata: {
                error: err.message,
              },
            }
          );
        });
    })
    .catch((err) => {
      logger.error(
        "server.routes.kioskshop.get__Failed to query products from database.",
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

/* GET kiosk shop page. */
router.get("/", ensureAuthenticated, function (req, res) {
  // If user is not kiosk, return to home page
  if (!req.user.kiosk) {
    logger.warn(
      "server.routes.kioskshop.get__User does not have kiosk role. Redirecting back to home page.",
      {
        metadata: {
          result: req.user,
        },
      }
    );
    res.redirect("/");
    return;
  }
  // If customer id is not defined, alert and route back to keypad
  let alert;
  if (!req.query.customer_id) {
    req.session.alert = {
      type: "danger",
      component: "web",
      message: "Je nutné zadat platné číslo zákazníka.",
      danger: 1,
    };
    res.redirect("/kiosk_keypad");
    return;
  } else if (req.query.customer_id === "666") {
    // Log off kiosk function
    res.redirect("/logout");
    return;
  }
  // Find user by keypadId
  User.findOne({
    keypadId: req.query.customer_id,
    keypadDisabled: { $in: [null, false] },
  })
    .then((customer) => {
      if (!customer) {
        logger.debug(
          `server.routes.kioskshop.get__Failed to find user by keypadId ${req.query.customer_id}.`,
          {
            metadata: {
              object: req.query.customer_id,
            },
          }
        );
        req.session.alert = {
          type: "danger",
          component: "web",
          message: `Nepodařilo se dohledat zákazníka s ID ${req.query.customer_id}.`,
          danger: 1,
        };
        res.redirect("/kiosk_keypad");
        return;
      }
      logger.debug(
        `server.routes.kioskshop.get__Found user:[${customer.email}] by keypadId:[${req.query.customer_id}].`,
        {
          metadata: {
            object: customer,
          },
        }
      );
      if (req.session.alert) {
        alert = req.session.alert;
        delete req.session.alert;
      }
      renderPage(req, res, alert, customer);
    })
    .catch((err) => {
      logger.error(
        `server.routes.kioskshop.get__Failed to find user by keypadId:[${req.query.customer_id}].`,
        {
          metadata: {
            error: err.message,
          },
        }
      );
      req.session.alert = {
        type: "danger",
        component: "web",
        message:
          "Došlo k chybě při komunikaci s databází. Zkuste to prosím znovu.",
        danger: 1,
      };
      res.redirect("/kiosk_keypad");
      return;
    });
});

router.post("/", ensureAuthenticated, function (req, res) {
  if (req.user.id !== req.body.user_id) {
    logger.warn(
      "server.routes.kioskshop.post__User identity does not match with request body. No product has been purchased.",
      {
        metadata: {
          userIdentity: req.user.id,
          bodyIdentity: req.body.user_id,
        },
      }
    );
    req.session.alert = {
      type: "danger",
      component: "web",
      message:
        "Při zpracování objednávky došlo k chybě. Zkuste to prosím znovu.",
      danger: 1,
    };
    res.redirect("/kiosk_keypad");
    return;
  }

  const newOrder = new Order({
    deliveryId: req.body.product_id,
  });

  // Find user by keypadId
  User.findOne({
    keypadId: req.body.customer_id,
    keypadDisabled: { $in: [null, false] },
  })
    .then((user) => {
      if (!user) {
        logger.error(
          `server.routes.kioskshop.post__Failed to find user by keypadId ${req.body.customer_id}.`,
          {
            metadata: {
              error: req.body.customer_id,
            },
          }
        );
        req.session.alert = {
          type: "danger",
          component: "web",
          message: `Nepodařilo se dohledat zákazníka s ID ${req.body.customer_id}.`,
          danger: 1,
        };
        res.redirect("/kiosk_keypad");
        return;
      }

      newOrder.buyerId = user._id;
      newOrder.keypadOrder = true;

      Delivery.findOne({
        _id: req.body.product_id,
      })
        .then((delivery) => {
          delivery.amount_left--;
          delivery
            .save()
            .then(() => {
              logger.debug(
                `server.routes.kioskshop.post__Purchased product stock amount decremented from delivery [${delivery._id}].`,
                {
                  metadata: {
                    object: delivery,
                  },
                }
              );
              newOrder
                .save()
                .then((order) => {
                  req.session.alert = {
                    type: "success",
                    message: `Zákazník ${user.displayName} zakoupil ${req.body.display_name} za ${delivery.price} Kč.`,
                    success: 1,
                  };

                  const subject = `Potvrzení objednávky - ${req.body.display_name}`;
                  const mailPreview = `Zakoupili jste ${req.body.display_name} za ${delivery.price} Kč na kiosku.`;
                  sendMail(
                    user.email,
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

                  res.redirect("/kiosk_keypad");
                })
                .catch((err) => {
                  logger.error(
                    "server.routes.kioskshop.post__Failed to create order in the database, but stock amount has been already decremented!",
                    {
                      metadata: {
                        error: err.message,
                        delivery: delivery,
                      },
                    }
                  );
                  req.session.alert = {
                    type: "danger",
                    component: "db",
                    message: err.message,
                    danger: 1,
                  };
                  res.redirect("/kiosk_keypad");

                  const subject =
                    "[SYSTEM ERROR] Chyba při zápisu do databáze!";
                  const message = `Potenciálně se nepodařilo zapsat novou objednávku do databáze, ale již došlo k ponížení skladové zásoby v dodávce ID [${delivery._id}]. Zákazník ID [${user._id}], zobrazované jméno [${user.displayName}] se pokusil koupit produkt ID [${delivery.productId}], zobrazované jméno [${req.body.display_name}] za [${delivery.price}] Kč. Zkontrolujte konzistenci databáze.`;
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
                "server.routes.kioskshop.post__Failed to decrement stock amount from the delivery.",
                {
                  metadata: {
                    error: err.message,
                  },
                }
              );
              req.session.alert = {
                type: "danger",
                component: "db",
                message: err.message,
                danger: 1,
              };
              res.redirect("/kiosk_keypad");

              const subject = "[SYSTEM ERROR] Chyba při zápisu do databáze!";
              const message = `Potenciálně se nepodařilo snížit skladovou zásobu v dodávce ID [${delivery._id}] a následně vystavit objednávku. Zákazník ID [${user._id}], zobrazované jméno [${user.displayName}] se pokusil koupit produkt ID [${delivery.productId}], zobrazované jméno [${req.body.display_name}] za [${delivery.price}] Kč. Zkontrolujte konzistenci databáze.`;
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
            `server.routes.kioskshop.post__Failed to find delivery for product ${req.body.product_id}.`,
            {
              metadata: {
                error: err.message,
              },
            }
          );
          req.session.alert = {
            type: "danger",
            component: "db",
            message: err.message,
            danger: 1,
          };
          res.redirect("/kiosk_keypad");
          return;
        });
    })
    .catch((err) => {
      logger.error(
        "server.routes.kioskshop.post__Failed to communicate with database.",
        {
          metadata: {
            error: err.message,
          },
        }
      );
      req.session.alert = {
        type: "danger",
        component: "web",
        message:
          "Došlo k chybě při komunikaci s databází. Zkuste to prosím znovu.",
        danger: 1,
      };
      res.redirect("/kiosk_keypad");
      return;
    });
});

export default router;
