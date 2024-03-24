const myModal = new bootstrap.Modal("#confirm-modal");

const modalProductName = document.getElementById("product_name");
const modalProductPrice = document.getElementById("product_price");
const modalProductImage = document.getElementById("product_image");

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

document.addEventListener("DOMContentLoaded", function () {
  var interval;
  const backgroundMusic = new Audio("/audio/kiosk_shop_theme.mp3");

  // Play background theme music
  backgroundMusic.volume = 0.3;
  backgroundMusic.play();

  // Make whole product card clickable for touch screens
  const _forms = document.querySelectorAll("form").forEach((element) => {
    element.addEventListener("click", async function (event) {
      event.preventDefault();
      if (element.id === "back-button") this.submit();
      showConfirm(
        this.id,
        this.dataset.productname,
        this.dataset.productprice,
        this.dataset.productimage
      );
    });
  });

  // Set the date we're counting down to
  var countDownDate = addMinutes(new Date(), 3);

  // Update the count down every 1 second
  interval = setInterval(function () {
    // Get today's date and time
    var now = new Date().getTime();

    // Find the distance between now and the count down date
    var distance = countDownDate - now;

    var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    var seconds = Math.floor((distance % (1000 * 60)) / 1000);

    // Display the result in the element with id="timer"
    document.getElementById("timer").value = minutes + "m " + seconds + "s";

    // If the count down is finished, redirect to keypad to reset page state
    if (distance < 1000) {
      clearInterval(interval);
      window.location.href = "/kiosk_keypad?timeout=1";
    }
  }, 1000);
});

let backgroundInput = "";
document.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    const form = document.querySelector(
      "form[data-code='" + backgroundInput + "']"
    );
    if (form) {
      // TODO: Show modal instead
      form.action = form.action + "?return=kiosk_shop";
      form.submit();
    } else {
      console.log("Invalid code", backgroundInput);
      let backgroundInput = "";
    }
  } else if (e.key.length === 1) {
    backgroundInput = backgroundInput + e.key;
  }
  console.log("Key pressed", e);
  e.preventDefault();
});

// Display confirmation dialog
async function showConfirm(
  form_id,
  product_name,
  product_price,
  product_image
) {
  const submit = document.getElementById("modal_confirm");
  const submitContinue = document.getElementById("modal_confirm_continue");
  submit.dataset.submit_id = form_id;
  submitContinue.dataset.submit_id = form_id;
  modalProductName.innerText = product_name;
  modalProductPrice.innerText = product_price;
  modalProductImage.src = product_image;
  myModal.show();
}

// Submit form from modal to confirm purchase - optionally keep shopping
function submitFromModal(ctx, keepShopping) {
  const form = document.getElementById(ctx.dataset.submit_id);
  if (keepShopping) {
    form.action += "?return=kiosk_shop";
  }
  form.submit();
}

// TODO: Clarify varabile names
var modalCountDownDate;
var modalInterval;

document
  .getElementById("confirm-modal")
  .addEventListener("shown.bs.modal", function () {
    console.log("Modal shown");

    document.getElementById("modal_confirm").innerHTML = "Dokončit nákup (3s)";

    // Set the date we're counting down to
    modalCountDownDate = addSeconds(new Date(), 4);

    // Update the count down every 1 second
    modalInterval = setInterval(function () {
      // Get today's date and time
      var now = new Date().getTime();

      // Find the distance between now and the count down date
      var distance = modalCountDownDate - now;

      // var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      var seconds = Math.floor((distance % (1000 * 60)) / 1000);

      // If the count down is finished, redirect to keypad to reset page state
      if (distance < 1000) {
        clearInterval(modalInterval);
        document.getElementById("modal_confirm").click();
      }

      // Display the result in the element with id="timer"
      document.getElementById("modal_confirm").innerHTML =
        "Dokončit nákup (" + seconds + "s)";
    }, 1000);
  });

document
  .getElementById("confirm-modal")
  .addEventListener("hidden.bs.modal", function () {
    console.log("Modal hidden");
    clearInterval(modalInterval);
  });
