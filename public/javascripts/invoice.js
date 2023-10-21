const tooltipTriggerList = document.querySelectorAll(
  '[data-bs-toggle="tooltip"]'
)
const tooltipList = [...tooltipTriggerList].map(
  (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl)
)

// User graph swapper - changes between 'Spent amount in Kč and bought amount'
$('#user-swap').click(function () {
  var clicks = $(this).data('clicks')
  $('#user-spin').addClass('spin')
  setTimeout(function () {
    $('#user-spin').removeClass('spin')
  }, 300)
  if (clicks) {
    $('#user-text').html('Uživatelé - k fakturaci v Kč')
    perUserSpent.data.datasets[0].data = userDatasetPriceSpent
    perUserSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'Kč'
      },
      fontColor: '#fff'
    }
    perUserSpent.update()
  } else {
    $('#user-text').html('Uživatelé - k fakturaci v ks')
    perUserSpent.data.datasets[0].data = userDatasetAmountBought
    perUserSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'ks'
      },
      fontColor: '#fff'
    }
    perUserSpent.update()
  }
  $(this).data('clicks', !clicks)
})

// User graph
var ctx = document.getElementById('perUserSpent').getContext('2d')
var perUserSpent = new Chart(ctx, {
  type: 'pie',
  data: {
    labels: userLabelUsernames,
    datasets: [
      {
        data: userDatasetPriceSpent,
        backgroundColor: userColorPalette
      }
    ]
  },
  options: {
    plugins: {
      legend: {
        display: false
      },
      labels: {
        render: function (args) {
          return args.value + 'Kč'
        },
        fontColor: '#fff'
      }
    }
  }
})

// Product graph swapper - changes between 'Spent amount in Kč and bought amount'
$('#prod-swap').click(function () {
  var clicks = $(this).data('clicks')
  $('#prod-spin').addClass('spin')
  setTimeout(function () {
    $('#prod-spin').removeClass('spin')
  }, 300)
  if (clicks) {
    $('#prod-text').html('Produkty - k fakturaci v Kč')
    perProductSpent.data.datasets[0].data = productDatasetPriceSpent
    perProductSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'Kč'
      },
      fontColor: '#fff'
    }
    perProductSpent.update()
  } else {
    $('#prod-text').html('Produkty - k fakturaci v ks')
    perProductSpent.data.datasets[0].data = productDatasetAmountBought
    perProductSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'ks'
      },
      fontColor: '#fff'
    }
    perProductSpent.update()
  }
  $(this).data('clicks', !clicks)
})

// Product graph
var ctx = document.getElementById('perProductSpent').getContext('2d')
var perProductSpent = new Chart(ctx, {
  type: 'pie',
  data: {
    labels: productLabelUsernames,
    datasets: [
      {
        data: productDatasetPriceSpent,
        backgroundColor: productColorPalette
      }
    ]
  },
  options: {
    plugins: {
      legend: {
        display: false
      },
      labels: {
        render: function (args) {
          return args.value + 'Kč'
        },
        fontColor: '#fff'
      }
    }
  }
})

// Bootstrap table customization
$(document).ready(function () {
  $('#table-orders').DataTable({
    columnDefs: [{ type: 'natural', targets: 3 }],
    language: {
      url: '//cdn.datatables.net/plug-ins/1.10.19/i18n/Czech.json',
      searchPlaceholder: 'Hledaný výraz'
    },
    fixedHeader: true,
    order: [[0, 'desc']],
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ]
  })
  $('.dataTables_length').addClass('bs-select')
  const someIsNotZero = perUserSpent.data.datasets[0].data.some(
    (item) => item !== 0
  )
  if (!someIsNotZero) {
    // No data is present
    $('#invoice_submit').attr('disabled', true)
  }
})
