const Product = require('../models/product')
const User = require('../models/user')
const Delivery = require('../models/delivery')
const mongoose = require('mongoose')

mongoose.connect(process.env.DB_CONNECTION_STRING, {
  useNewUrlParser: true
})

function exit() {
  mongoose.disconnect()
}

User.findOne({})
  .then((dbuser) => {
    Product.findOne({})
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
