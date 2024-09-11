// eslint-disable-next-line no-unused-vars
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

// eslint-disable-next-line no-unused-vars
async function promptGptForDescription() {
  console.log('getting called')
  const product_name = document.getElementById('product_name')
  if (product_name.value) {
    // Fetch Product description
    const response = await fetch('/api/promptGpt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        product_name: product_name.value
      })
    })
    const description = await response.json()
    console.log(description)
  }
}
