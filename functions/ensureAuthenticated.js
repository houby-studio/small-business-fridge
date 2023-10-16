module.exports = {
  // Uses passport functionality, which checks if user is logged in. If not, redirects to login page.
  ensureAuthenticated: function (req, res, next) {
    if (req.isAuthenticated()) {
      return next()
    }
    console.log('redirecting')
    res.redirect('/login')
  }
}
