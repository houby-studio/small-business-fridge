<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import Message from 'primevue/message'

defineProps<{
  oidcEnabled?: boolean
}>()

const form = useForm({
  username: '',
  password: '',
})

function submit() {
  form.post('/login', {
    onFinish: () => form.reset('password'),
  })
}
</script>

<template>
  <GuestLayout>
    <Head title="Přihlášení" />

    <Card>
      <template #content>
        <form @submit.prevent="submit" class="space-y-5">
          <Message v-if="form.errors.username || form.errors.password" severity="error" :closable="false">
            {{ form.errors.username || form.errors.password }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="username" class="text-sm font-medium text-gray-700">
              Uživatelské jméno
            </label>
            <InputText
              id="username"
              v-model="form.username"
              :invalid="!!form.errors.username"
              autocomplete="username"
              autofocus
              placeholder="Zadejte uživatelské jméno"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="password" class="text-sm font-medium text-gray-700">
              Heslo
            </label>
            <Password
              id="password"
              v-model="form.password"
              :invalid="!!form.errors.password"
              :feedback="false"
              toggleMask
              autocomplete="current-password"
              placeholder="Zadejte heslo"
              inputClass="w-full"
              class="w-full"
            />
          </div>

          <Button
            type="submit"
            label="Přihlásit se"
            icon="pi pi-sign-in"
            :loading="form.processing"
            class="w-full"
          />

          <template v-if="oidcEnabled">
            <Divider align="center">
              <span class="text-sm text-gray-400">nebo</span>
            </Divider>

            <Button
              as="a"
              href="/auth/oidc/redirect"
              label="Přihlásit přes Microsoft"
              icon="pi pi-microsoft"
              severity="secondary"
              outlined
              class="w-full"
            />
          </template>
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
