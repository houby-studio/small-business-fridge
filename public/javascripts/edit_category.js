// Handles category to edit selection
function loadCategoryInfo() {
  // Get selected category
  const categoryId = document.getElementById("category_id").value;

  // Reset form if category deselected
  if (categoryId === "") {
    document.getElementById("admin_edit_category").reset();
    return;
  }

  // Name
  document.getElementById("category_name").value =
    json_data[categoryId].category_name;

  // Color
  document.getElementById("category_color").value =
    json_data[categoryId].category_color;

  // Disable
  document.getElementById("category_disabled").checked =
    json_data[categoryId].category_disabled;
}
