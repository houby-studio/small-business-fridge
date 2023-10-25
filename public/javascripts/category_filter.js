// Using custom data-category to filter cards based on category
// Using Bootstraps Collapse https://getbootstrap.com/docs/5.3/components/collapse/#methods
// Using Map to avoid regenerating array of objects multiple times and to do it only once clicked
const filterCategories = new Map()

function filter_categories(category) {
  if (!filterCategories.get(category)) {
    const elementsToHide = []
    document
      .querySelectorAll(`[data-category]:not([data-category="${category}"])`)
      .forEach((element) => {
        elementsToHide.push(new bootstrap.Collapse(element, { toggle: false }))
      })

    const elementsToShow = []
    document
      .querySelectorAll(`[data-category="${category}"]`)
      .forEach((element) => {
        elementsToShow.push(new bootstrap.Collapse(element, { toggle: false }))
      })

    filterCategories.set(category, {
      show: elementsToShow,
      hide: elementsToHide
    })
  }
  filterCategories.get(category).show.forEach(async (el) => {
    el.show()
  })
  filterCategories.get(category).hide.forEach(async (el) => {
    el.hide()
  })
}

function show_all_categories() {
  if (!filterCategories.get('all')) {
    const elementsToShow = []
    document.querySelectorAll(`[data-category]`).forEach((element) => {
      elementsToShow.push(new bootstrap.Collapse(element, { toggle: false }))
    })
    filterCategories.set('all', {
      show: elementsToShow
    })
  }
  filterCategories.get('all').show.forEach(async (el) => {
    el.show()
  })
}
