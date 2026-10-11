<script setup lang="ts">
import { computed } from 'vue'
import type { Category } from '@/adapter/types'
import type { BackendSettingsTabId } from '@/utils/backendSettingsTabs'
import { buildDirectoryManagementModel } from '@/utils/directoryManagement'
import FolderTree from '@/components/FolderTree.vue'
import Icon from '@/components/Icon.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'

interface Props {
  categories: Map<string, Category>
  modelValue: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  'update:modelValue': [value: string]
  openSettings: [tab: BackendSettingsTabId]
}>()

const model = computed(() => buildDirectoryManagementModel(props.categories))

function handleSelect(value: string) {
  emit('update:modelValue', value)
  emit('close')
}

function openPathSettings() {
  emit('openSettings', 'paths')
}
</script>

<template>
  <BaseDialog title="目录管理" max-width="max-w-2xl" content-class="p-4 sm:p-6 space-y-4" @close="emit('close')">
    <template #title>
      <div class="min-w-0">
        <h2 class="text-lg font-semibold">目录管理</h2>
        <p class="text-xs text-slate-500 mt-1">Transmission 目录来自现有种子的下载位置。点击目录会应用筛选并关闭窗口。</p>
      </div>
    </template>

        <div class="card p-4 space-y-2">
          <div class="flex items-start gap-3">
            <Icon name="folder-open" :size="16" class="text-slate-500 mt-0.5" />
            <div class="space-y-1 text-sm text-slate-600">
              <p>Transmission 不支持全局预创建、重命名或删除目录分类。</p>
              <p>请使用“路径设置”修改默认下载目录，或在种子详情中移动单个种子的位置。</p>
            </div>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="card p-4">
            <div class="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">默认目录</div>
            <div class="text-sm text-slate-700 break-all">
              {{ model.defaultSavePath || '未设置默认目录' }}
            </div>
          </div>

          <div class="card p-4">
            <div class="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">目录来源</div>
            <div class="text-sm text-slate-700 space-y-1">
              <p>{{ model.paths.length > 0 ? `已发现 ${model.paths.length} 个目录节点` : '当前还没有可用目录节点' }}</p>
              <p v-if="model.hasExternalDirectories" class="text-slate-500">包含默认目录之外的“外部目录”分支。</p>
              <p v-else class="text-slate-500">当前目录都位于默认目录之下。</p>
            </div>
          </div>
        </div>

        <div class="card p-4">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 class="text-sm font-medium">目录树</h3>
              <p class="text-xs text-slate-500 mt-1">用于快速定位和筛选当前目录下的种子。</p>
            </div>
            <button
              type="button"
              class="btn"
              @click="openPathSettings"
            >
              前往路径设置
            </button>
          </div>

          <div v-if="model.paths.length === 0" class="text-sm text-slate-500 py-8 text-center">
            当前没有可展示的目录。添加种子或先配置默认下载目录后，这里会显示可筛选的目录树。
          </div>
          <FolderTree
            v-else
            :model-value="modelValue"
            :paths="model.paths"
            all-label="全部目录"
            root-label="默认目录"
            @update:model-value="handleSelect"
          />
        </div>

    <template #footer>
      <div class="flex justify-end">
        <button class="btn" @click="emit('close')">关闭</button>
      </div>
    </template>
  </BaseDialog>
</template>
