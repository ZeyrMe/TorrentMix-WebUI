<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import { detectBackendTypeOnly } from '@/adapter/detect'
import type { BackendType } from '@/adapter/detect'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const detecting = ref(true)
const backendType = ref<BackendType | null>(null)

const isTransmission = computed(() => backendType.value === 'trans')

// 页面加载时检测后端类型（使用缓存）
onMounted(async () => {
  try {
    backendType.value = await detectBackendTypeOnly()
  } catch {
    backendType.value = null
  } finally {
    detecting.value = false
  }
})

async function handleSubmit() {
  loading.value = true
  error.value = ''
  try {
    await authStore.login(username.value, password.value)
    password.value = ''
    await router.push('/')
  } catch {
    error.value = isTransmission.value
      ? '连接失败，请检查连接地址或凭证配置'
      : '登录失败，请检查用户名和密码'
    password.value = ''
  } finally {
    loading.value = false
  }
}

// 获取后端显示名称
function getBackendName(): string {
  if (backendType.value === 'qbit') return 'qBittorrent'
  if (backendType.value === 'trans') return 'Transmission'
  return '种子管理器'
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm">
      <!-- Logo 区域 -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-12 h-12 bg-black rounded-xl mb-4">
          <Icon name="download-cloud" :size="24" class="text-white" />
        </div>
        <h1 class="text-2xl font-semibold text-gray-900 mb-2">{{ isTransmission ? '连接' : '登录' }}</h1>
        <p class="text-gray-500 text-sm">
          <span v-if="detecting">正在检测后端…</span>
          <span v-else>访问 {{ getBackendName() }}</span>
        </p>
      </div>

      <!-- 登录表单 -->
      <div class="card p-6">
        <form @submit.prevent="handleSubmit" class="space-y-4">
          <!-- 用户名 -->
          <div class="space-y-2">
            <label for="login-username" class="block text-sm font-medium text-gray-700">
              {{ isTransmission ? '用户名（可选）' : '用户名' }}
            </label>
            <input
              id="login-username"
              v-model="username"
              name="username"
              type="text"
              class="input"
              placeholder="输入用户名…"
              :required="!isTransmission"
              autocomplete="username"
              :spellcheck="false"
              :disabled="detecting"
            />
          </div>

          <!-- 密码 -->
          <div class="space-y-2">
            <label for="login-password" class="block text-sm font-medium text-gray-700">
              {{ isTransmission ? '密码（可选）' : '密码' }}
            </label>
            <input
              id="login-password"
              v-model="password"
              name="current-password"
              type="password"
              class="input"
              placeholder="输入密码…"
              :required="!isTransmission"
              autocomplete="current-password"
              :disabled="detecting"
            />
          </div>

          <!-- 错误提示 -->
          <div v-if="error" class="p-3 bg-red-50 border border-red-200 rounded-lg" aria-live="polite">
            <div class="flex items-center gap-2">
              <Icon name="alert-triangle" color="red" :size="16" />
              <p class="text-sm text-red-500 font-medium">{{ error }}</p>
            </div>
          </div>

          <!-- 登录按钮 -->
          <button
            type="submit"
            :disabled="loading || detecting"
            class="btn btn-primary w-full py-2.5 font-medium"
          >
            <span class="flex items-center justify-center gap-2">
              <Icon v-if="loading" name="loader-2" :size="16" class="animate-spin text-white" />
              {{
                loading
                  ? (isTransmission ? '连接中…' : '登录中…')
                  : detecting
                    ? '检测中…'
                    : (isTransmission ? '连接' : '登录')
              }}
            </span>
          </button>
        </form>
      </div>

      <!-- 底部信息 -->
      <div class="text-center mt-8">
        <p class="text-xs text-gray-400">
          <span v-if="detecting">正在检测后端类型…</span>
          <span v-else>{{ getBackendName() }} WebUI</span>
        </p>
      </div>
    </div>
  </div>
</template>
