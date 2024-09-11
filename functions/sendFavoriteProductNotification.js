import logger from './logger.js'
import User from '../models/user.js'
import { sendMail } from '../functions/sendMail.js'

export async function sendFavoriteProductNotification (
  productId,
  productDisplayName,
  productImagePath,
  userDisplayName,
  deliveryAmountSupplied,
  deliveryPrice
) {
  logger.info(
    `server.functions.sendfavoriteproductnotification__Starting notification job after product:[${productDisplayName}] has been restocked.`
  )
  User.find({ favorites: productId })
    .then((users) => {
      if (users) {
        logger.info(
          `server.functions.sendfavoriteproductnotification__Found [${users.length}] users with product:[${productDisplayName}] in favorites.`
        )
        users.forEach((user) => {
          // Send e-mail to each user, who has this product in favorites
          const subject = `Váš oblíbený produkt ${productDisplayName} byl naskladněn`
          const mailPreview = `Dodavatel ${userDisplayName} dodal ${deliveryAmountSupplied} ks za ${deliveryPrice} Kč.`

          sendMail(
            user.email,
            'favoriteProductNotification',
            {
              subject,
              mailPreview,
              productDisplayName,
              productImagePath,
              userDisplayName,
              deliveryAmountSupplied,
              deliveryPrice
            },
            productImagePath
          )
        })
      } else {
        logger.info(
          `server.functions.sendfavoriteproductnotification__Found no users with favorite product:[${productDisplayName}].`
        )
      }
    })
    .catch((err) => {
      logger.error(
        `server.functions.sendfavoriteproductnotification__Failed to find users with favorite product:[${productDisplayName}] ID:[${productId}].`,
        {
          metadata: {
            result: err.message
          }
        }
      )
    })
}
