<script setup lang="ts">
import { computed } from 'vue'

/**
 * A product's photo, or — the photo is optional — a neutral placeholder: an image icon on
 * a tint of the category colour, so a photoless product still reads as "drinks" or
 * "snacks" at a glance. Fills its container; size it from the outside.
 */
const props = withDefaults(
  defineProps<{
    src: string | null | undefined
    alt: string
    /** Category colour (any CSS colour); without it the placeholder is plain grey. */
    color?: string | null
    iconClass?: string
    imgClass?: string
    lazy?: boolean
  }>(),
  { color: null, iconClass: 'text-2xl', imgClass: 'object-contain', lazy: false }
)

const placeholderStyle = computed(() =>
  props.color
    ? {
        backgroundColor: `color-mix(in srgb, ${props.color} 18%, transparent)`,
        color: props.color,
      }
    : undefined
)
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="alt"
    class="h-full w-full"
    :class="imgClass"
    :loading="lazy ? 'lazy' : undefined"
  />
  <div
    v-else
    class="flex h-full w-full items-center justify-center rounded-[inherit]"
    :class="color ? '' : 'bg-gray-100 text-gray-400 dark:bg-zinc-800 dark:text-zinc-500'"
    :style="placeholderStyle"
    role="img"
    :aria-label="alt"
    data-testid="product-image-placeholder"
  >
    <span class="pi pi-image" :class="iconClass" aria-hidden="true" />
  </div>
</template>
