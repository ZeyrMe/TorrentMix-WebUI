import type { Category } from '@/adapter/types'
import { isVirtualExternalPath } from '@/utils/folderTree'

export interface DirectoryManagementModel {
  paths: string[]
  defaultSavePath: string
  hasDefaultDirectory: boolean
  hasExternalDirectories: boolean
}

export function buildDirectoryManagementModel(
  categories: Map<string, Category>,
): DirectoryManagementModel {
  const values = Array.from(categories.values())
  const paths = values.map(category => category.name)
  const defaultDirectory = values.find(category => category.name === '')

  return {
    paths,
    defaultSavePath: defaultDirectory?.savePath ?? '',
    hasDefaultDirectory: paths.includes(''),
    hasExternalDirectories: paths.some(path => isVirtualExternalPath(path)),
  }
}
