import { ref } from 'vue'

export function useEditableBox(options: {
  label: () => string | undefined
  description: () => string | undefined
  canEdit?: () => boolean
  onRename: (label: string) => void
  onDescriptionChange: (description: string) => void
}) {
  const editing = ref(false)
  const draftLabel = ref('')
  const draftDescription = ref('')

  function startEditing() {
    if (editing.value) return
    if (options.canEdit && !options.canEdit()) return
    draftLabel.value = String(options.label() ?? '')
    draftDescription.value = String(options.description() ?? '')
    editing.value = true
  }

  function commitEdit() {
    if (!editing.value) return
    const newLabel = draftLabel.value.trim()
    if (newLabel && newLabel !== String(options.label() ?? '')) {
      options.onRename(newLabel)
    }
    const newDesc = draftDescription.value
    if (newDesc !== String(options.description() ?? '')) {
      options.onDescriptionChange(newDesc)
    }
    editing.value = false
  }

  function cancelEdit() {
    editing.value = false
  }

  return {
    editing,
    draftLabel,
    draftDescription,
    startEditing,
    commitEdit,
    cancelEdit,
  }
}
