import type { BackupPreviewOutcome } from '../../shared/contracts'

interface UiElements {
  feedback: HTMLParagraphElement
  exportButton: HTMLButtonElement
  previewButton: HTMLButtonElement
  card: HTMLDivElement
  summary: HTMLDivElement
  ackRow: HTMLLabelElement
  ackCheckbox: HTMLInputElement
  confirmButton: HTMLButtonElement
  cancelButton: HTMLButtonElement
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error('Interface element unavailable.')
  return found
}

function unwrap<T>(result: { ok: boolean; error?: { message: string }; data?: T }): T {
  if (!result.ok) throw new Error(result.error?.message ?? '操作失败，请检查本地数据后重试。')
  return result.data as T
}

function formatTime(value: string): string {
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return '时间不可用'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function initializeBackup(): void {
  const controls: UiElements = {
    feedback: element<HTMLParagraphElement>('#backup-feedback'),
    exportButton: element<HTMLButtonElement>('#backup-export'),
    previewButton: element<HTMLButtonElement>('#backup-preview'),
    card: element<HTMLDivElement>('#backup-preview-card'),
    summary: element<HTMLDivElement>('#backup-preview-summary'),
    ackRow: element<HTMLLabelElement>('#backup-ack-row'),
    ackCheckbox: element<HTMLInputElement>('#backup-ack-journal'),
    confirmButton: element<HTMLButtonElement>('#backup-restore-confirm'),
    cancelButton: element<HTMLButtonElement>('#backup-restore-cancel')
  }

  let activePreview: Extract<BackupPreviewOutcome, { status: 'preview' }> | null = null

  function showFeedback(message: string, isError = false): void {
    controls.feedback.textContent = message
    controls.feedback.dataset.kind = isError ? 'error' : 'success'
    controls.feedback.hidden = false
  }

  function clearPreview(): void {
    activePreview = null
    controls.card.hidden = true
    controls.summary.textContent = ''
    controls.ackRow.hidden = true
    controls.ackCheckbox.checked = false
    controls.confirmButton.disabled = true
  }

  controls.exportButton.addEventListener('click', async () => {
    try {
      controls.exportButton.disabled = true
      const outcome = unwrap(await window.morrow.backups.export())
      if (outcome.status === 'cancelled') {
        showFeedback('已取消导出；未写入任何文件。')
        return
      }
      showFeedback(`备份已创建：${outcome.directory}（${outcome.counts.conversations} 个对话、${outcome.counts.messages} 条消息、${outcome.counts.memories} 条记忆）`)
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : '导出失败，请重试。', true)
    } finally {
      controls.exportButton.disabled = false
    }
  })

  controls.previewButton.addEventListener('click', async () => {
    try {
      controls.previewButton.disabled = true
      const outcome = unwrap(await window.morrow.backups.preview())
      if (outcome.status === 'cancelled') {
        showFeedback('已取消；本地数据未更改。')
        return
      }
      activePreview = outcome
      controls.summary.textContent = [
        `备份创建时间：${formatTime(outcome.createdAt)}`,
        `schema 版本：${outcome.schemaVersion}`,
        `内容：${outcome.counts.conversations} 个对话、${outcome.counts.messages} 条消息、${outcome.counts.memories} 条记忆（其中 ${outcome.counts.retractedMemories} 条已撤销）`,
        `删除记录：${outcome.counts.deletionJournalEntries} 条`,
        outcome.boundaryNotice
      ].join('\n')
      controls.ackRow.hidden = !outcome.missingDeletionJournal
      controls.ackCheckbox.checked = false
      controls.confirmButton.disabled = outcome.missingDeletionJournal
      controls.card.hidden = false
      showFeedback('已读取备份预览；尚未修改任何本地数据。')
    } catch (error) {
      clearPreview()
      showFeedback(error instanceof Error ? error.message : '无法读取该备份；本地数据未更改。', true)
    } finally {
      controls.previewButton.disabled = false
    }
  })

  controls.ackCheckbox.addEventListener('change', () => {
    if (!activePreview) return
    controls.confirmButton.disabled = activePreview.missingDeletionJournal && !controls.ackCheckbox.checked
  })

  controls.cancelButton.addEventListener('click', () => {
    clearPreview()
    showFeedback('已取消恢复；本地数据未更改。')
  })

  controls.confirmButton.addEventListener('click', async () => {
    if (!activePreview) return
    try {
      controls.confirmButton.disabled = true
      const outcome = unwrap(await window.morrow.backups.restore({
        token: activePreview.token,
        confirmed: true,
        ...(activePreview.missingDeletionJournal ? { acknowledgeMissingDeletionJournal: true as const } : {})
      }))
      if (outcome.status === 'cancelled') {
        showFeedback('已取消恢复；本地数据未更改。')
        controls.confirmButton.disabled = false
        return
      }
      clearPreview()
      showFeedback(`恢复完成（重新应用删除 ${outcome.reappliedDeletions} 项、撤销 ${outcome.reappliedRetractions} 项、恢复显示 ${outcome.reappliedUnretractions} 项）。应用即将重启以加载恢复后的数据。`)
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : '恢复失败；本地数据保持不变。', true)
      controls.confirmButton.disabled = false
    }
  })
}
