function loadProductImage() {
  var imageId = document.getElementById('product_id').value
  var _img = document.getElementById('product_img')
  var newImg = new Image()
  newImg.onload = function () {
    _img.src = this.src
  }
  if (imageId === '') {
    newImg.src = '/images/preview.png'
  } else {
    var indexnumber = json_data.product_id.findIndex((id) => id === imageId)
    newImg.src = json_data.product_image[indexnumber]
  }
}

window.onload = function (_event) {
  if (document.getElementById('product_id').value) {
    loadProductImage()
  }
}
