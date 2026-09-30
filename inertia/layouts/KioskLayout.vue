<script setup lang="ts">
import Toast from 'primevue/toast'
</script>

<template>
  <div class="kiosk-layout min-h-screen bg-gray-900 text-white" data-theme="dark">
    <Toast position="top-center" class="sbf-kiosk-toast" />
    <slot />
  </div>
</template>

<!--
  Not scoped: PrimeVue teleports the toast to <body>, outside this component, so scoped
  :deep() rules never reached it and the kiosk showed the small default toast. The class on
  <Toast> keeps these rules kiosk-only.
-->
<style>
/* Kiosk toast — larger, wider, high-contrast, readable from a step away on a touchscreen */
.sbf-kiosk-toast.p-toast {
  width: min(44rem, calc(100vw - 2rem));
}
.sbf-kiosk-toast .p-toast-message {
  border-radius: 1rem;
}
.sbf-kiosk-toast .p-toast-message-content {
  background: #1f2937 !important;
  border: 1px solid #4b5563 !important;
  border-radius: 1rem !important;
  padding: 1.25rem 1.5rem !important;
  gap: 1rem !important;
}
.sbf-kiosk-toast .p-toast-summary {
  font-size: 1.375rem !important;
  font-weight: 700 !important;
  line-height: 1.35 !important;
  color: white !important;
}
.sbf-kiosk-toast .p-toast-detail {
  font-size: 1rem !important;
  color: #d1d5db !important;
}
.sbf-kiosk-toast .p-toast-message-icon {
  font-size: 1.875rem !important;
}
.sbf-kiosk-toast .p-toast-message-success .p-toast-message-content {
  border-left: 4px solid #16a34a !important;
}
.sbf-kiosk-toast .p-toast-message-error .p-toast-message-content {
  border-left: 4px solid #dc2626 !important;
}
.sbf-kiosk-toast .p-toast-message-warn .p-toast-message-content {
  border-left: 4px solid #d97706 !important;
}
.sbf-kiosk-toast .p-toast-message-info .p-toast-message-content {
  border-left: 4px solid #2563eb !important;
}
</style>
