import { Router } from "express";
import { ensureAuthenticatedAPI } from "../../functions/ensureAuthenticatedAPI.js";
import Product from "../../models/product.js";
import Order from "../../models/order.js";
import Delivery from "../../models/delivery.js";
import Category from "../../models/category.js";
var router = Router();
let responseJson;

// GET /api/scannerProduct - accepts customer's keypadId or card and returns customer basic information
router.get("/", ensureAuthenticatedAPI, function (req, res, _next) {
  // Check if request contains 'customer' parameter
  if (!req.query.product) {
    res.status(400);
    res.set("Content-Type", "application/problem+json");
    responseJson = {
      type: "https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerProduct",
      title: "Your request does not contain parameter 'product'.",
      status: 400,
      "detail:": "This function requires parameter 'product'.",
      "invalid-params": [
        {
          name: "product",
          reason: "must be specified",
        },
      ],
    };
    res.json(responseJson);
    return;
  }

  Product.aggregate([
    [
      {
        $match: {
          code: req.query.product,
        },
      },
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
        $project: {
          code: "$code",
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
    ],
  ])
    .then((product) => {
      // If database doesn't contain user with supplied keypadId or card, database returns empty object, which doesn't contain user object.
      res.set("Content-Type", "application/json");
      if (!product) {
        res.status(404);
        res.json("NOT_FOUND");
      } else {
        res.status(200);
        product = product[0];
        const response = {
          _id: product._id,
          code: product.code,
          displayName: product.displayName,
          description: product.description,
          imagePath: new URL(
            product.imagePath,
            `${req.protocol}://${req.hostname}:${req.port ? req.port : ""}`
          ),
          category: product.category.map((category) => {
            return {
              name: category.name,
              color: category.color,
            };
          })[0],
          stock: product.stock.map((stock) => {
            return {
              amount_left: stock.amount_left,
              price: stock.price,
            };
          }),
          stockSum: product.stockSum,
        };
        res.json(response);
      }
    })
    .catch((_err) => {
      console.log(_err);
      res.status(400);
      res.set("Content-Type", "application/problem+json");
      const responseJson = {
        type: "https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerProduct",
        title: "Your parameter 'product' is wrong type.",
        status: 400,
        "detail:": "Parameter 'product' must be either a 'Number' or 'String'.",
        "invalid-params": [
          {
            name: "product",
            reason: "must be number or string",
          },
        ],
      };
      res.json(responseJson);
      return;
    });
});

export default router;
