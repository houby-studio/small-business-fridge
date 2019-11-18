function loadProductImage () {
  var imageId = document.getElementById('product_id').value
  var indexnumber = json_data.product_id.findIndex(id => id === imageId)
  var _img = document.getElementById('product_img')
  var newImg = new Image()
  newImg.onload = function () {
    _img.src = this.src
  }
  newImg.src = json_data.product_image[indexnumber]
}

window.onload = function (event) {
  if (document.getElementById('product_id').value) {
    loadProductImage()
  }
}
