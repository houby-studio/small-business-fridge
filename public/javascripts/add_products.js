/*global json_data*/

function loadProductImage() {
  var imageId = document.getElementById('product_id').value
  var newImg = new Image()
  newImg.onload = function () {
    document.getElementById('product_img').src = this.src
  }
  if (imageId === '') {
    newImg.src = '/static_images/preview.png'
  } else {
    newImg.src = json_data[imageId].product_image
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('product_id').value) {
    loadProductImage()
  }
})
