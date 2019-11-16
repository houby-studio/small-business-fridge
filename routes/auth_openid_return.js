var express = require('express');
var router = express.Router();
var passport = require('passport');

// 'GET returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// query (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
router.get('/',
    function (req, res, next) {
        passport.authenticate('azuread-openidconnect', {
            response: res,
            failureRedirect: '/'
        })(req, res, next);
    },
    function (req, res) {
        res.redirect('/');
    }
);

module.exports = router;