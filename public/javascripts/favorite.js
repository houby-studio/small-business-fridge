async function set_favorite(element) {
  // Instantly change UI, call database update in the background
  var productCard = document.getElementById(element.value)
  element.checked
    ? productCard.classList.add('order-first')
    : productCard.classList.remove('order-first')

  // Write preference to database
  await fetch('/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'favorite',
      value: {
        product: element.value,
        state: element.checked
      }
    })
  })
}
