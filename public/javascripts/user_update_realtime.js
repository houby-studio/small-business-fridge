$('.realtime-checkbox').change(function () {
  $.post('/profile', {
    name: this.id,
    value: $(`#${this.id}`).is(':checked')
  })
})

$('#realtime-iban').on('paste keyup', function () {
  this.value = this.value.replace(/\s/g, '')
  if ($('#realtime-iban')[0].checkValidity()) {
    $('#iban-status').css({
      color: 'green'
    }).removeClass('fa-times-circle').addClass('fa-check-circle')
    $(this).css({
      color: 'green'
    })
    $.post('/profile', {
      name: this.id,
      value: $('#realtime-iban').val()
    })
  } else {
    $('#iban-status').css({
      color: 'red'
    }).removeClass('fa-check-circle').addClass('fa-times-circle')
    $(this).css({
      color: 'red'
    })
  }
})
