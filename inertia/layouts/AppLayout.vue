<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { Link, usePage, router } from '@inertiajs/vue3'
import Toast from 'primevue/toast'
import Button from 'primevue/button'
import Menubar from 'primevue/menubar'
import { useFlash } from '~/composables/use_flash'
import { useI18n } from '~/composables/use_i18n'
import type { SharedProps } from '~/types'

useFlash()

const page = usePage<SharedProps>()
const { t } = useI18n()
const user = computed(() => page.props.user)
const impersonation = computed(() => page.props.impersonation)
const appName = computed(() => page.props.appName ?? 'Small Business Fridge')

const isSupplier = computed(() => user.value?.role === 'supplier' || user.value?.role === 'admin')
const isAdmin = computed(() => user.value?.role === 'admin')

// ─── Dark mode ───────────────────────────────────────────────────────────────
const localIsDark = ref(user.value?.colorMode === 'dark')

watch(
  () => user.value?.colorMode,
  (mode) => {
    localIsDark.value = mode === 'dark'
  }
)

watch(
  localIsDark,
  (dark) => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  },
  { immediate: false }
)

// ─── Scroll shadow ───────────────────────────────────────────────────────────
const isScrolled = ref(false)
function handleScroll() {
  isScrolled.value = window.scrollY > 8
}

// ─── Active nav link ─────────────────────────────────────────────────────────
const currentPath = computed(() => page.url.split('?')[0])

function isActive(url: string | undefined): boolean {
  if (!url) return false
  return currentPath.value === url || currentPath.value.startsWith(url + '/')
}

type NavItem = {
  label?: string | ((...args: any[]) => string)
  icon?: string
  url?: string
  items?: NavItem[]
  compactIconOnly?: boolean
}

function isSubmenuActive(item: NavItem): boolean {
  if (!item.items?.length) return false

  return item.items.some((child) => {
    if (isActive(child.url)) return true
    if (child.items?.length) {
      return isSubmenuActive(child)
    }
    return false
  })
}

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
  const items: NavItem[] = [
    { label: 'Obchod', icon: 'pi pi-shopping-cart', url: '/shop' },
    { label: 'Objednávky', icon: 'pi pi-list', url: '/orders' },
    { label: 'Faktury', icon: 'pi pi-file', url: '/invoices' },
    { label: 'Aktivita', icon: 'pi pi-history', url: '/audit', compactIconOnly: true },
  ]

  if (isSupplier.value) {
    items.push({
      label: 'Dodavatel',
      icon: 'pi pi-box',
      compactIconOnly: true,
      items: [
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
      compactIconOnly: true,
      items: [
        { label: 'Dashboard', icon: 'pi pi-chart-bar', url: '/admin/dashboard' },
        { label: 'Uživatelé', icon: 'pi pi-users', url: '/admin/users' },
        { label: 'Kategorie', icon: 'pi pi-palette', url: '/admin/categories' },
        { label: 'Alergeny', icon: 'pi pi-tags', url: '/admin/allergens' },
        { label: 'Hudba', icon: 'pi pi-volume-up', url: '/admin/music' },
        { label: 'Objednávky', icon: 'pi pi-list-check', url: '/admin/orders' },
        { label: 'Faktury', icon: 'pi pi-file-check', url: '/admin/invoices' },
        { label: 'Audit log', icon: 'pi pi-history', url: '/admin/audit' },
      ],
    })
  }

  return items
})

function logout() {
  window.location.assign('/logout')
}

function stopImpersonation() {
  router.post('/impersonate/stop')
}

const menubarBreakpoint = '960px'

function getItemLabel(item: NavItem): string | undefined {
  return typeof item.label === 'string' ? item.label : undefined
}

onMounted(() => {
  document.documentElement.setAttribute('data-theme', localIsDark.value ? 'dark' : 'light')
  window.addEventListener('scroll', handleScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div
    class="sbf-app-bg min-h-screen transition-colors duration-200"
    :data-theme="localIsDark ? 'dark' : 'light'"
  >
    <Toast position="top-right" :pt="{ root: { style: { top: '4.5rem' } } }" />

    <!-- Impersonation banner -->
    <div
      v-if="impersonation"
      class="flex items-center justify-between bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <span class="flex items-center gap-2">
        <span class="pi pi-user-edit" />
        {{ t('admin.impersonating_as') }}: <strong>{{ impersonation.asName }}</strong>
      </span>
      <Button
        :label="t('admin.impersonate_stop')"
        icon="pi pi-times"
        severity="contrast"
        size="small"
        @click="stopImpersonation"
      />
    </div>

    <!-- Sticky glassmorphism navbar -->
    <div
      class="sbf-nav sticky top-0 z-50 border-b border-slate-200/60 bg-white/85 dark:border-zinc-800/60 dark:bg-zinc-900/82"
      :class="{ 'sbf-nav-scrolled': isScrolled }"
    >
      <Menubar
        :model="menuItems"
        :breakpoint="menubarBreakpoint"
        class="rounded-none border-0 bg-transparent shadow-none"
        :pt="{
          root: { class: 'bg-transparent border-0 shadow-none rounded-none py-0' },
        }"
      >
        <template #start>
          <Link href="/shop" class="sbf-brand-link mr-6 flex items-center gap-2">
            <span class="sbf-brand text-xl font-bold tracking-tight"> {{ appName }} </span>
          </Link>
        </template>
        <template #item="{ item, props }">
          <Link
            v-if="item.url && !item.items"
            v-bind="props.action"
            :href="item.url"
            :title="item.compactIconOnly ? getItemLabel(item) : undefined"
            :aria-label="item.compactIconOnly ? getItemLabel(item) : undefined"
            :class="{
              'sbf-nav-active': isActive(item.url),
              'sbf-nav-compact-target': item.compactIconOnly,
            }"
          >
            <span :class="[item.icon, 'mr-2']" />
            <span class="sbf-nav-item-label">{{ item.label }}</span>
          </Link>
          <a
            v-else
            v-bind="props.action"
            :title="item.compactIconOnly ? getItemLabel(item) : undefined"
            :aria-label="item.compactIconOnly ? getItemLabel(item) : undefined"
            :class="{ 'sbf-nav-compact-target': item.compactIconOnly }"
          >
            <span :class="[item.icon, 'mr-2']" />
            <span class="sbf-nav-item-label">{{ item.label }}</span>
            <span
              v-if="item.items"
              class="pi pi-angle-down ml-2"
              :class="{
                'sbf-nav-active': isSubmenuActive(item),
              }"
            />
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
              <span class="sbf-nav-profile-name max-w-32 truncate">{{ user?.displayName }}</span>
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

    <!-- Main content with entrance animation -->
    <main class="sbf-main mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <slot />
    </main>
  </div>
</template>
