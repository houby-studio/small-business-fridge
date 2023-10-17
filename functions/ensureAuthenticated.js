export function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  console.log('redirecting')
  res.redirect('/login')
}
