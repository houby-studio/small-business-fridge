var responseJson

module.exports = {
  // Checks if request contains expected API secret. If it does, proceed without problem, otherwise respond with error JSON.
  ensureAuthenticatedAPI: function (req, res, next) {
    // Check if request header contains API secret key
    if (req.get('sbf-API-secret') !== process.env.API_SECRET) {
      res.status(401)
      res.set('Content-Type', 'application/problem+json')
      responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#api-protection',
        title: 'Your request does not contain secret key.',
        status: 401,
        'detail:':
          'This is not a public function. To use this API, you need to supply secret key in the header. More details can be found in documentation https://git.io/Jeodr'
      }
      res.json(responseJson)
      return
    }
    return next()
  }
}
