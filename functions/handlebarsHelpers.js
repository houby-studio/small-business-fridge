const helpers = {
  gt: function (context, limitcount, options) {
    const array = Array.isArray(context) ? context : context[options.hash.var]
    if (array.length > limitcount) {
      return options.fn(this)
    }
    return options.inverse(this)
  },
  lt: function (context, limitcount, options) {
    const array = Array.isArray(context) ? context : context[options.hash.var]
    if (array.length < limitcount) {
      return options.fn(this)
    }
    return options.inverse(this)
  }
}

export default helpers
