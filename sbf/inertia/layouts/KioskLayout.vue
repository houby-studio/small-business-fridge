<script setup lang="ts">
import Toast from 'primevue/toast'
</script>

<template>
  <div class="kiosk-layout min-h-screen bg-gray-900 text-white" data-theme="dark">
    <Toast position="top-center" />
    <slot />
  </div>
</template>

<style scoped>
/* Kiosk toast — larger, high-contrast, readable on dark bg */
:deep(.p-toast-message) {
  min-width: 460px;
  border-radius: 1rem;
}
:deep(.p-toast-message-content) {
  background: #1f2937 !important;
  border: 1px solid #4b5563 !important;
  border-radius: 1rem !important;
  padding: 1.25rem 1.5rem !important;
  gap: 1rem !important;
}
:deep(.p-toast-summary) {
  font-size: 1.375rem !important;
  font-weight: 700 !important;
  color: white !important;
}
:deep(.p-toast-detail) {
  font-size: 1rem !important;
  color: #d1d5db !important;
}
:deep(.p-toast-message-icon) {
  font-size: 1.875rem !important;
}
:deep(.p-toast-message-success .p-toast-message-content) {
  border-left: 4px solid #16a34a !important;
}
:deep(.p-toast-message-error .p-toast-message-content) {
  border-left: 4px solid #dc2626 !important;
}
:deep(.p-toast-message-warn .p-toast-message-content) {
  border-left: 4px solid #d97706 !important;
}
:deep(.p-toast-message-info .p-toast-message-content) {
  border-left: 4px solid #2563eb !important;
}

/* Kiosk confirm dialogs — larger, touch-friendly */
:deep(.p-dialog) {
  min-width: 580px;
  border-radius: 1.5rem !important;
  overflow: hidden;
}
:deep(.p-dialog-header) {
  padding: 1.75rem 2rem !important;
}
:deep(.p-dialog-title) {
  font-size: 1.5rem !important;
  font-weight: 700 !important;
}
:deep(.p-dialog-content) {
  padding: 1rem 2rem 1.5rem !important;
  font-size: 1.25rem !important;
}
:deep(.p-dialog-footer) {
  padding: 1rem 2rem 2rem !important;
  gap: 1rem !important;
  display: flex !important;
}
:deep(.p-dialog-footer .p-button) {
  min-height: 4rem !important;
  padding: 0.75rem 2rem !important;
  font-size: 1.25rem !important;
  font-weight: 600 !important;
  border-radius: 1rem !important;
  flex: 1 !important;
  justify-content: center !important;
}
:deep(.p-confirm-dialog-message) {
  font-size: 1.25rem !important;
  line-height: 1.6 !important;
}
</style>
