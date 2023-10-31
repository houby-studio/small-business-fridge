// Handles product to edit selection
function loadProductInfo() {
  // Get selected product
  const productId = document.getElementById('product_id').value

  // Image should change no matter what
  const newImg = new Image()
  newImg.onload = function () {
    document.getElementById('product_img').src = this.src
  }

  // Reset form if product deselected
  if (productId === '') {
    document.getElementById('supplier_edit_product').reset()
    newImg.src = '/images/preview.png'
    return
  }

  // Load image
  newImg.src = json_data[productId].product_image

  // Display Name
  document.getElementById('product_name').value =
    json_data[productId].product_name

  // Description
  document.getElementById('product_description').value =
    json_data[productId].product_description

  // Category - optional parameter
  if (json_data[productId].product_category === '') {
    document.getElementById('product_category').value = ''
  } else {
    document.getElementById('product_category').value =
      json_data[productId].product_category
  }
}

// Handles new image to upload selection
function readURL(input) {
  if (input.files && input.files[0]) {
    var reader = new FileReader()

    reader.onload = function (e) {
      document
        .getElementById('product_img')
        .setAttribute('src', e.target.result)
    }

    reader.readAsDataURL(input.files[0])
  }
}

document.addEventListener('DOMContentLoaded', function () {
  // Load image when browser navigates back to this page
  if (document.getElementById('product_id').value) {
    loadProductInfo()
  }
})
