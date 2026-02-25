'use strict'

// Preload runs in an isolated world (contextIsolation: true, sandbox: true).
// No Node.js APIs are exposed to the renderer — this file only patches DOM
// behaviour that would be inappropriate in kiosk mode.

window.addEventListener('DOMContentLoaded', () => {
  // Suppress right-click context menu
  document.addEventListener('contextmenu', (event) => event.preventDefault())
})
