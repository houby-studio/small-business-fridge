<script setup lang="ts">
import { computed } from 'vue'
import { Link, usePage, router } from '@inertiajs/vue3'
import Toast from 'primevue/toast'
import Button from 'primevue/button'
import Menubar from 'primevue/menubar'
import { useFlash } from '~/composables/useFlash'
import type { SharedProps } from '~/types'

useFlash()

const page = usePage<SharedProps>()
const user = computed(() => page.props.user)

const isSupplier = computed(
  () => user.value?.role === 'supplier' || user.value?.role === 'admin'
)
const isAdmin = computed(() => user.value?.role === 'admin')

const menuItems = computed(() => {
  const items: any[] = [
    { label: 'Obchod', icon: 'pi pi-shopping-cart', url: '/shop' },
    { label: 'Objednávky', icon: 'pi pi-list', url: '/orders' },
    { label: 'Faktury', icon: 'pi pi-file', url: '/invoices' },
  ]

  if (isSupplier.value) {
    items.push({
      label: 'Dodavatel',
      icon: 'pi pi-box',
      items: [
        { label: 'Naskladnit', icon: 'pi pi-plus', url: '/supplier/deliveries' },
        { label: 'Sklad', icon: 'pi pi-warehouse', url: '/supplier/stock' },
        { label: 'Produkty', icon: 'pi pi-tags', url: '/supplier/products/new' },
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
  <div class="min-h-screen bg-gray-50">
    <Toast position="top-right" />

    <!-- Navigation -->
    <Menubar :model="menuItems" class="rounded-none border-x-0 border-t-0">
      <template #start>
        <Link href="/shop" class="mr-4 text-xl font-bold text-primary">
          Lednice IT
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
        <div class="flex items-center gap-3">
          <Link href="/profile" class="text-sm text-gray-600 hover:text-gray-900">
            <span class="pi pi-user mr-1" />
            {{ user?.displayName }}
          </Link>
          <Button
            icon="pi pi-sign-out"
            severity="secondary"
            text
            size="small"
            @click="logout"
          />
        </div>
      </template>
    </Menubar>

    <!-- Main content -->
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <slot />
    </main>
  </div>
</template>
