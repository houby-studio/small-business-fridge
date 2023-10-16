var express = require('express')
var router = express.Router()
var User = require('../models/user')
var ensureAuthenticated =
  require('../functions/ensureAuthenticated').ensureAuthenticated
var checkKiosk = require('../functions/checkKiosk').checkKiosk

/* GET profile page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res, next) {
  res.render('shop/profile', {
    title: 'Profil | Lednice IT',
    user: req.user
  })
})

router.post('/', ensureAuthenticated, function (req, res, next) {
  var newValue = req.body.value === 'true'
  if (req.body.name === 'checkAllProducts') {
    User.findByIdAndUpdate(
      req.user.id,
      {
        showAllProducts: newValue
      },
      {
        upsert: true
      }
    )
      .then(() => {
        res.status(200).send()
        return
      })
      .catch((err) => {
        console.log(err)
        res.status(400).send()
      })
  } else if (req.body.name === 'checkSendEmailEshop') {
    User.findByIdAndUpdate(req.user.id, {
      sendMailOnEshopPurchase: newValue
    })
      .then(() => {
        res.status(200).send()
        return
      })
      .catch((err) => {
        console.log(err)
        res.status(400).send()
        return
      })
  } else if (req.body.name === 'checkSendDailyReport') {
    User.findByIdAndUpdate(req.user.id, {
      sendDailyReport: newValue
    })
      .then(() => {
        res.status(200).send()
        return
      })
      .catch((err) => {
        console.log(err)
        res.status(400).send()
        return
      })
  } else if (req.body.name === 'realtime-iban') {
    if (/^CZ\d{22}$/.test(req.body.value)) {
      User.findByIdAndUpdate(req.user.id, {
        IBAN: req.body.value
      })
        .then(() => {
          res.status(200).send()
          return
        })
        .catch((err) => {
          console.log(err)
          res.status(400).send()
          return
        })
    } else {
      res.status(400).send()
      return
    }
  }
})

module.exports = router
