import { findOne } from '../models/product.js'
import { findOne as _findOne } from '../models/user.js'
import Delivery from '../models/delivery.js'
import { connect, disconnect } from 'mongoose'

connect(process.env.DB_CONNECTION_STRING, {
  useNewUrlParser: true
})

function exit() {
  disconnect()
}

_findOne({})
  .then((dbuser) => {
    findOne({})
      .then((dbproduct) => {
        const deliveries = [
          new Delivery({
            supplierId: dbuser,
            productId: dbproduct,
            amount_supplied: 5,
            amount_left: 5,
            price: 25
          })
        ]

        let done = 0
        for (let i = 0; i < deliveries.length; i++) {
          deliveries[i].save().then(() => {
            done++
            if (done === deliveries.length) {
              exit()
            }
          })
        }
      })
      .catch((err) => {
        console.log(err)
        exit(1)
      })
  })
  .catch((err) => {
    console.log(err)
    exit(1)
  })
