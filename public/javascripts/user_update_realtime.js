$('input').change(function(){
    $.post("/profile", {
        name: this.id,
        value: $(`#${this.id}`).is(":checked")
    });
});