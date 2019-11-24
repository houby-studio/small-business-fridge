function ensureAuthenticated (context) {
  return context.isAuthenticated()
}

module.exports = {
  ensureAuthenticated
}
