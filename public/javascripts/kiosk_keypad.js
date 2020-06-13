$('.numberBtn').click(function () {
  var currentValue = $('.customer-screen').val()
  $('.customer-screen').val(currentValue + $(this).val())
})
