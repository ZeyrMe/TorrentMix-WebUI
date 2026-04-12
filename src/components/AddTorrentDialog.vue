<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { AddTorrentParams } from '@/adapter/interface'
import { useBackendStore } from '@/store/backend'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'

interface Props {
  open: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'add', params: AddTorrentParams): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const backendStore = useBackendStore()

// 表单状态
const activeTab = ref<'url' | 'file'>('url')
const urlText = ref('')
const selectedFiles = ref<File[]>([])
const savePath = ref('')
const paused = ref(false)
const skipChecking = ref(false)
const category = ref('')
const tags = ref<string[]>([])
const tagInput = ref('')

// 可用分类列表（来自后端接口/列表聚合）
const availableCategories = computed(() =>
  Array.from(backendStore.categories.values()).map(c => c.name)
)

// 处理标签输入
function handleTagInput(e: KeyboardEvent) {
  if (e.key === 'Enter' && tagInput.value.trim()) {
    const newTag = tagInput.value.trim()
    if (!tags.value.includes(newTag)) {
      tags.value.push(newTag)
    }
    tagInput.value = ''
  }
}

function removeTag(index: number) {
  tags.value.splice(index, 1)
}

// 文件选择处理
const fileInput = ref<HTMLInputElement | null>(null)

function handleFileClick() {
  fileInput.value?.click()
}

function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) {
    selectedFiles.value = Array.from(target.files)
  }
}

function removeFile(index: number) {
  selectedFiles.value.splice(index, 1)
}

// 重置表单
function reset() {
  activeTab.value = 'url'
  urlText.value = ''
  selectedFiles.value = []
  savePath.value = ''
  paused.value = false
  skipChecking.value = false
  category.value = ''
  tags.value = []
  tagInput.value = ''
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// 对话框关闭时重置
watch(() => props.open, (isOpen) => {
  if (!isOpen) reset()
})

// 提交
async function handleSubmit() {
  const params: AddTorrentParams = {}

  if (activeTab.value === 'url') {
    if (!urlText.value.trim()) return
    params.urls = urlText.value
  } else {
    if (selectedFiles.value.length === 0) return
    params.files = selectedFiles.value
  }

  if (savePath.value.trim()) {
    params.savepath = savePath.value.trim()
  }
  if (paused.value) {
    params.paused = true
  }
  if (skipChecking.value) {
    params.skip_checking = true
  }
  if (backendStore.isQbit && category.value.trim()) {
    params.category = category.value.trim()
  }
  if (tags.value.length > 0) {
    params.tags = tags.value
  }

  emit('add', params)
  reset()
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        @click.self="$emit('close')"
      >
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="open"
            class="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
            @click.stop
          >
            <!-- 头部 -->
            <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-gray-900">添加种子</h2>
              <button
                type="button"
                @click="$emit('close')"
                class="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="关闭添加种子对话框"
              >
                <Icon name="x" :size="20" class="text-gray-500" />
              </button>
            </div>

            <!-- 内容 -->
            <div class="p-6">
              <!-- Tab 切换 -->
              <div class="flex gap-2 mb-6">
                <button
                  type="button"
                  @click="activeTab = 'url'"
                  :class="`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'url'
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`"
                >
                  Magnet 链接 / URL
                </button>
                <button
                  type="button"
                  @click="activeTab = 'file'"
                  :class="`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'file'
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`"
                >
                  种子文件
                </button>
              </div>

              <!-- URL 输入 -->
              <div v-if="activeTab === 'url'" class="space-y-4">
                <label for="add-torrent-url" class="block text-sm font-medium text-gray-700">
                  Magnet 链接或 torrent URL
                </label>
                <textarea
                  id="add-torrent-url"
                  v-model="urlText"
                  name="torrentUrl"
                  class="input w-full h-32 resize-none font-mono text-sm"
                  placeholder="magnet:?xt=urn:btih:…&#10;（支持多个链接，每行一个）"
                  autocomplete="off"
                  spellcheck="false"
                />
                <p class="text-xs text-gray-500">
                  支持 magnet 链接和 HTTP(S) torrent URL，每行一个
                </p>
              </div>

              <!-- 文件上传 -->
              <div v-else class="space-y-4">
                <label for="add-torrent-file" class="block text-sm font-medium text-gray-700">
                  选择 .torrent 文件
                </label>
                <button
                  type="button"
                  @click="handleFileClick"
                  class="w-full border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors"
                  aria-label="选择 torrent 文件"
                >
                  <Icon name="upload-cloud" :size="40" class="text-gray-400 mx-auto mb-3" />
                  <p class="text-sm text-gray-600">点击选择文件或拖拽到此处</p>
                  <p class="text-xs text-gray-500 mt-1">支持多个文件</p>
                </button>
                <input
                  id="add-torrent-file"
                  ref="fileInput"
                  name="torrentFiles"
                  type="file"
                  accept=".torrent"
                  multiple
                  class="hidden"
                  @change="handleFileChange"
                />

                <!-- 已选文件列表 -->
                <div v-if="selectedFiles.length > 0" class="space-y-2">
                  <p class="text-sm font-medium text-gray-700">已选择 {{ selectedFiles.length }} 个文件：</p>
                  <div class="space-y-1">
                    <div
                      v-for="(file, index) in selectedFiles"
                      :key="index"
                      class="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm"
                    >
                      <span class="truncate flex-1">{{ file.name }}</span>
                      <span class="text-xs text-gray-500 mr-2">{{ (file.size / 1024 / 1024).toFixed(2) }} MB</span>
                      <button
                        type="button"
                        @click="removeFile(index)"
                        class="p-1 hover:bg-gray-200 rounded transition-colors"
                        :aria-label="`移除文件 ${file.name}`"
                      >
                        <Icon name="x" :size="16" class="text-gray-500" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 选项 -->
              <div class="mt-6 space-y-4 pt-6 border-t border-gray-200">
                <!-- 分类（可选） -->
                <div v-if="backendStore.isQbit">
                  <label for="add-torrent-category" class="block text-sm font-medium text-gray-700 mb-1">
                    分类（可选）
                  </label>
                  <select
                    id="add-torrent-category"
                    v-model="category"
                    name="category"
                    class="input w-full"
                  >
                    <option value="">默认分类</option>
                    <option v-for="cat in availableCategories" :key="cat" :value="cat">
                      {{ cat }}
                    </option>
                  </select>
                </div>

                <!-- 标签输入 -->
                <div>
                  <label for="add-torrent-tag-input" class="block text-sm font-medium text-gray-700 mb-1">
                    标签（可选）
                  </label>
                  <div class="space-y-2">
                    <div class="flex flex-wrap gap-2">
                      <span
                        v-for="(tag, index) in tags"
                        :key="index"
                        class="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-sm"
                      >
                        <SafeText as="span" :text="tag" />
                        <button
                          type="button"
                          @click="removeTag(index)"
                          class="hover:text-red-500 transition-colors"
                          :aria-label="`移除标签 ${tag}`"
                        >
                          <Icon name="x" :size="14" />
                        </button>
                      </span>
                    </div>
                    <input
                      id="add-torrent-tag-input"
                      v-model="tagInput"
                      @keydown="handleTagInput"
                      name="tagInput"
                      type="text"
                      class="input w-full"
                      placeholder="输入标签后按回车添加…"
                      autocomplete="off"
                      spellcheck="false"
                    />
                  </div>
                  <p v-if="backendStore.isTrans" class="text-xs text-gray-500 mt-1">
                    Transmission：标签会作为 labels 存储
                  </p>
                </div>

                <div>
                  <label for="add-torrent-save-path" class="block text-sm font-medium text-gray-700 mb-1">
                    {{ backendStore.isTrans ? '下载目录（可选）' : '保存路径（可选）' }}
                  </label>
                  <input
                    id="add-torrent-save-path"
                    v-model="savePath"
                    name="savePath"
                    type="text"
                    class="input w-full"
                    placeholder="默认下载目录…"
                    autocomplete="off"
                    spellcheck="false"
                  />
                </div>

                <label class="flex items-center gap-3 cursor-pointer">
                  <input
                    v-model="paused"
                    name="paused"
                    type="checkbox"
                    class="w-4 h-4 rounded border-gray-300 text-black focus:ring-black"
                  />
                  <span class="text-sm text-gray-700">添加后暂停</span>
                </label>

                <label class="flex items-center gap-3 cursor-pointer">
                  <input
                    v-model="skipChecking"
                    name="skipChecking"
                    type="checkbox"
                    class="w-4 h-4 rounded border-gray-300 text-black focus:ring-black"
                  />
                  <span class="text-sm text-gray-700">跳过校验</span>
                </label>
              </div>
            </div>

            <!-- 底部按钮 -->
            <div class="px-6 py-4 bg-gray-50 flex justify-end gap-3">
              <button
                type="button"
                @click="$emit('close')"
                class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                @click="handleSubmit"
                :disabled="(!urlText.trim() && selectedFiles.length === 0)"
                class="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                添加
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
