async function set_favorite(element) {
  // Instantly change UI, call database update in the background
  const productCard = document.getElementById(element.value)
  element.checked
    ? productCard?.classList.add('order-first')
    : productCard?.classList.remove('order-first')

  if (element.fromQueryParam)
    document.getElementById(`favorite_${element.value}`).checked = true

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

// If navigating from context aware link, add product to favorite
const favoriteParam = new URLSearchParams(location.search).get('addfavorite')
if (favoriteParam)
  set_favorite({ value: favoriteParam, checked: true, fromQueryParam: true })
