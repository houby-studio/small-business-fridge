<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { Link, usePage, router } from '@inertiajs/vue3'
import Toast from 'primevue/toast'
import Button from 'primevue/button'
import Menubar from 'primevue/menubar'
import { useFlash } from '~/composables/use_flash'
import type { SharedProps } from '~/types'

useFlash()

const page = usePage<SharedProps>()
const user = computed(() => page.props.user)

const isSupplier = computed(() => user.value?.role === 'supplier' || user.value?.role === 'admin')
const isAdmin = computed(() => user.value?.role === 'admin')

// ─── Dark mode ───────────────────────────────────────────────────────────────
// localIsDark mirrors user.colorMode but allows instant client-side toggle
const localIsDark = ref(user.value?.colorMode === 'dark')

watch(
  () => user.value?.colorMode,
  (mode) => {
    localIsDark.value = mode === 'dark'
  }
)

// Keep <html> data-theme in sync (PrimeVue reads from here too)
watch(
  localIsDark,
  (dark) => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  },
  { immediate: false }
)

onMounted(() => {
  // Set initial data-theme from persisted user preference
  document.documentElement.setAttribute('data-theme', localIsDark.value ? 'dark' : 'light')
})

function toggleColorMode() {
  localIsDark.value = !localIsDark.value
  router.post(
    '/profile/color-mode',
    { colorMode: localIsDark.value ? 'dark' : 'light' },
    { preserveScroll: true }
  )
}

// ─── Navigation ──────────────────────────────────────────────────────────────
const menuItems = computed(() => {
  const items: any[] = [
    { label: 'Obchod', icon: 'pi pi-shopping-cart', url: '/shop' },
    { label: 'Objednávky', icon: 'pi pi-list', url: '/orders' },
    { label: 'Faktury', icon: 'pi pi-file', url: '/invoices' },
    { label: 'Aktivita', icon: 'pi pi-history', url: '/audit' },
  ]

  if (isSupplier.value) {
    items.push({
      label: 'Dodavatel',
      icon: 'pi pi-box',
      items: [
        { label: 'Naskladnit', icon: 'pi pi-plus', url: '/supplier/deliveries' },
        { label: 'Sklad', icon: 'pi pi-warehouse', url: '/supplier/stock' },
        { label: 'Produkty', icon: 'pi pi-tags', url: '/supplier/products' },
        { label: 'Fakturace', icon: 'pi pi-file-export', url: '/supplier/invoice' },
        { label: 'Platby', icon: 'pi pi-credit-card', url: '/supplier/payments' },
      ],
    })
  }

  if (isAdmin.value) {
    items.push({
      label: 'Admin',
      icon: 'pi pi-cog',
      items: [
        { label: 'Dashboard', icon: 'pi pi-chart-bar', url: '/admin/dashboard' },
        { label: 'Uživatelé', icon: 'pi pi-users', url: '/admin/users' },
        { label: 'Kategorie', icon: 'pi pi-palette', url: '/admin/categories' },
        { label: 'Objednávky', icon: 'pi pi-list-check', url: '/admin/orders' },
        { label: 'Faktury', icon: 'pi pi-file-check', url: '/admin/invoices' },
        { label: 'Audit log', icon: 'pi pi-history', url: '/admin/audit' },
      ],
    })
  }

  return items
})

function logout() {
  router.post('/logout')
}
</script>

<template>
  <div
    class="min-h-screen bg-slate-50 transition-colors duration-200 dark:bg-zinc-950"
    :data-theme="localIsDark ? 'dark' : 'light'"
  >
    <Toast position="top-right" />

    <!-- Sticky glassmorphism navbar -->
    <div
      class="sbf-nav sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 dark:border-zinc-800/60 dark:bg-zinc-900/80"
    >
      <Menubar
        :model="menuItems"
        class="rounded-none border-0 bg-transparent shadow-none"
        :pt="{
          root: { class: 'bg-transparent border-0 shadow-none rounded-none py-0' },
        }"
      >
        <template #start>
          <Link href="/shop" class="mr-6 flex items-center gap-2">
            <span
              class="text-xl font-bold tracking-tight text-primary transition-opacity hover:opacity-80"
            >
              Lednice IT
            </span>
          </Link>
        </template>
        <template #item="{ item, props }">
          <Link v-if="item.url && !item.items" v-bind="props.action" :href="item.url">
            <span :class="item.icon" class="mr-2" />
            <span>{{ item.label }}</span>
          </Link>
          <a v-else v-bind="props.action">
            <span :class="item.icon" class="mr-2" />
            <span>{{ item.label }}</span>
            <span v-if="item.items" class="pi pi-angle-down ml-2" />
          </a>
        </template>
        <template #end>
          <div class="flex items-center gap-2">
            <!-- Dark mode toggle -->
            <Button
              :icon="localIsDark ? 'pi pi-sun' : 'pi pi-moon'"
              severity="secondary"
              text
              size="small"
              :aria-label="localIsDark ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim'"
              @click="toggleColorMode"
            />
            <Link
              href="/profile"
              class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <span class="pi pi-user text-xs" />
              {{ user?.displayName }}
            </Link>
            <Button
              icon="pi pi-sign-out"
              severity="secondary"
              text
              size="small"
              aria-label="Odhlásit se"
              @click="logout"
            />
          </div>
        </template>
      </Menubar>
    </div>

    <!-- Main content -->
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <slot />
    </main>
  </div>
</template>
