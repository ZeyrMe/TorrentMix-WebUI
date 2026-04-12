<script setup lang="ts">
import { watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import UiOverlayHost from '@/components/ui/UiOverlayHost.vue'
import { useUiOverlay } from '@/composables/useUiOverlay'

const route = useRoute()
const uiOverlay = useUiOverlay()

watch(() => route.fullPath, () => {
  uiOverlay.resetOverlay()
})
</script>

<template>
  <RouterView />
  <UiOverlayHost />
</template>
