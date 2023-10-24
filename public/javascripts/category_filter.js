const filterCategories = new Map()

function filter_categories(category) {
  const elementsToShow = document.querySelectorAll(
    `[data-category]:not([data-category="${category}"])`
  )

  filterCategories.set(category, elements)

  elements.forEach(async (element) => {
    new bootstrap.Collapse(element)
  })
}
