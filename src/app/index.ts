import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC_CHANNELS, type AppInfo, type BackupExportOutcome, type BackupPreviewOutcome, type BackupRestoreOutcome } from '../shared/contracts'
import type { ApprovalChallenge } from '../motivation/goals'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SafeStorageSecretStore } from '../security/secrets'
import { GoalService } from '../motivation/goal-service'
import { ElectronReminderNotificationPort } from '../motivation/reminder-notification'
import { ReminderService } from '../motivation/reminder-service'
import { BackupService, RESTORE_BOUNDARY_NOTICE } from '../persistence/backup-service'
import { EventLogService } from '../persistence/event-log'
import { SqliteGoalRepository } from '../persistence/goal-repository'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { SqliteReminderRepository } from '../persistence/reminder-repository'
import { createLogger } from '../observability/logger'
import { registerIpcHandlers } from './register-ipc'
import { observeRendererLoad, reportStartupFailure } from './startup-error'
import { createSecureWindowOptions, isTrustedRendererUrl, resolveTrustedRendererUrl } from '../security/security'

const logger = createLogger({ minimumLevel: 'info' })

let mainWindow: BrowserWindow | undefined
let unregisterIpc: (() => void) | undefined
let database: SqliteDatabase | undefined
let reminderService: ReminderService | undefined
let companionService: CompanionService | undefined
let eventLog: EventLogService | undefined

function relaunchAfterDataReplacement(): void {
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 500)
}

async function chooseDirectory(title: string, buttonLabel: string): Promise<string | null> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const result = window
    ? await dialog.showOpenDialog(window, { title, buttonLabel, properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ title, buttonLabel, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
}

app.enableSandbox()
app.setAppUserModelId('com.morrow.ai-companion')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function getAppInfo(): AppInfo {
  return {
    name: 'Morrow',
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron ?? 'unknown',
    dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders'
  }
}

async function requestProviderConsent(preview: ProviderConsentPreview): Promise<ProviderConsent | undefined> {
  const window = mainWindow
  if (!window || window.isDestroyed()) return undefined
  const actionLabel = preview.action === 'chat'
    ? '发送对话'
    : preview.action === 'connection-test'
      ? '测试连接'
      : '生成记忆候选'
  const sensitivityLabel = preview.maximumSensitivity === 'sensitive'
    ? '敏感（仅在本次明确确认后发送）'
    : preview.maximumSensitivity === 'personal'
      ? '个人信息'
      : '普通'
  const memories = preview.includedMemories.length === 0
    ? '本次不包含已保存记忆。'
    : preview.includedMemories.map((memory, index) => `${index + 1}. [${memory.sensitivity}] ${memory.excerpt}`).join('\n')
  const detail = [
    `操作：${actionLabel}`,
    `目标：${preview.endpoint}`,
    `模型：${preview.model}`,
    `数据敏感度：${sensitivityLabel}`,
    `请求大小：${preview.payloadBytes} 字节`,
    `请求摘要：${preview.payloadSha256}`,
    '费用：DeepSeek API 按 token 计费，本次请求或连接测试可能产生费用；价格会随模型、缓存与时段变化，请以 https://api-docs.deepseek.com/quick_start/pricing 为准。',
    'API 密钥仅在 Windows 安全存储中加密保存；请求时通过 HTTPS Authorization Bearer 标头发送，不进入请求正文或 SQLite。',
    `已选记忆：\n${memories}`,
    `精确请求正文：\n${preview.exactPayload}`
  ].join('\n\n')
  const result = await dialog.showMessageBox(window, {
    type: preview.maximumSensitivity === 'sensitive' ? 'warning' : 'question',
    title: '确认向 DeepSeek 发送数据',
    message: '以下内容将离开本机并发送到 DeepSeek。每次请求都需要单独确认。',
    detail,
    buttons: ['取消', '允许并发送'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  if (result.response !== 1) return undefined
  const approvedAt = new Date().toISOString()
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

function createMainWindow(trustedRendererUrl: string): void {
  const window = new BrowserWindow(
    createSecureWindowOptions(join(__dirname, '../preload/index.js'))
  )

  mainWindow = window
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, trustedRendererUrl)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const session = window.webContents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)

  const loaded = process.env.ELECTRON_RENDERER_URL
    ? window.loadURL(trustedRendererUrl)
    : window.loadFile(join(__dirname, '../renderer/index.html'))
  observeRendererLoad(loaded, () => mainWindow === window, {
    report: (code) => logger.error('app', 'window load failed', { code }),
    showError: (title, message) => {
      void dialog.showMessageBox({ type: 'error', title, message, buttons: ['确定'] })
    },
    quit: () => app.quit()
  })
}

function focusMainWindow(trustedRendererUrl: string): void {
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    createMainWindow(trustedRendererUrl)
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    const trustedRendererUrl = resolveTrustedRendererUrl(
      process.env.ELECTRON_RENDERER_URL,
      pathToFileURL(join(__dirname, '../renderer/index.html')).href
    )
    const databasePath = join(app.getPath('userData'), 'morrow.sqlite3')
    database = SqliteDatabase.open(databasePath)
    eventLog = new EventLogService(database)
    eventLog.tryRecord({ sourceModule: 'app', eventType: 'app.started', actor: 'system', subjectType: 'application', subjectId: null, correlationId: null, payload: { version: app.getVersion() } })
    const memories = new MemoryService(new SqliteMemoryRepository(database))
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets: new SafeStorageSecretStore(app.getPath('userData')),
      authorize: requestProviderConsent
    })
    companionService = companion
    const goalRepository = new SqliteGoalRepository(database)
    const reminders = new ReminderService(
      new SqliteReminderRepository(database),
      goalRepository,
      new ElectronReminderNotificationPort(),
      {
        featureEnabled: process.env.MORROW_ENABLE_LOCAL_REMINDERS === 'true',
        notifyUser: () => focusMainWindow(trustedRendererUrl),
        notifyChanged: () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.remindersChanged)
        }
      }
    )
    reminderService = reminders
    const goals = new GoalService(goalRepository, memories, {
      reminderLifecycle: reminders,
      approvalGate: async (challenge: ApprovalChallenge) => {
        const window = mainWindow
        if (!window || window.isDestroyed()) return false
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: '请确认本地只读操作',
          message: '批准这一次只读记忆数量核对？',
          detail: [
            `目标：${challenge.goalIntent}`,
            `约束：${challenge.goalConstraints}`,
            `工具：${challenge.toolId} v${challenge.toolVersion}`,
            `资源：${challenge.resourceScope}`,
            `参数：${JSON.stringify(challenge.parameters)}`,
            `风险：${challenge.risk}`,
            `影响：${challenge.expectedEffect}`,
            `有效至：${challenge.expiresAt}`,
            '授权仅一次；拒绝、取消或过期后不会复用。'
          ].join('\n'),
          buttons: ['拒绝', '批准并执行'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        return result.response === 1
      }
    })

    reminders.startScheduler()
    const backup = new BackupService(database, databasePath)
    const backupActions = {
      exportBackup: async (): Promise<BackupExportOutcome> => {
        const target = await chooseDirectory('选择导出备份的位置', '导出到此文件夹')
        if (!target) return { status: 'cancelled' }
        return backup.export(target)
      },
      previewBackup: async (): Promise<BackupPreviewOutcome> => {
        const source = await chooseDirectory('选择包含 Morrow 备份的文件夹', '选择备份')
        if (!source) return { status: 'cancelled' }
        return backup.preview(source)
      },
      restoreBackup: async (request: { token: string; confirmed: true; acknowledgeMissingDeletionJournal?: true }): Promise<BackupRestoreOutcome> => {
        const summary = await backup.describeRestore(request.token)
        if (!summary) return { status: 'cancelled' }
        const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
        if (!window) return { status: 'cancelled' }
        const detail = [
          `备份创建时间：${summary.createdAt}`,
          `备份 schema 版本：${summary.schemaVersion}（当前 ${database?.schemaVersion ?? '未知'}）`,
          `内容：${summary.counts.conversations} 个对话、${summary.counts.messages} 条消息、${summary.counts.memories} 条记忆`,
          `备份包含 ${summary.counts.deletionJournalEntries} 条删除记录`,
          RESTORE_BOUNDARY_NOTICE,
          '恢复成功后应用会自动重启以加载恢复后的数据；恢复失败时本地数据保持不变。'
        ].join('\n\n')
        const confirmation = await dialog.showMessageBox(window, {
          type: 'warning',
          title: '确认恢复本地数据',
          message: '恢复将替换当前全部本地数据，确认继续？',
          detail,
          buttons: ['取消', '恢复并重启应用'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        if (confirmation.response !== 1) return { status: 'cancelled' }
        reminderService?.shutdown()
        reminderService = undefined
        companionService?.shutdown()
        companionService = undefined
        // After the scheduled services stop, a failed restore still leaves the
        // original database file intact but the running process half-bound, so
        // the app restarts either way; the IPC result/error reaches the
        // renderer before the delayed relaunch.
        try {
          const outcome = await backup.restore(request)
          relaunchAfterDataReplacement()
          return outcome
        } catch (error) {
          relaunchAfterDataReplacement()
          throw error
        }
      }
    }
    unregisterIpc = registerIpcHandlers({ getAppInfo }, trustedRendererUrl, { memories, goals, reminders, companion, backup: backupActions })
    createMainWindow(trustedRendererUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(trustedRendererUrl)
    })
  }).catch((error: unknown) => {
    logger.error('app', 'startup failed', { error: error instanceof Error ? error.name : 'unknown' })
    reportStartupFailure('application', {
      report: (code) => logger.error('app', 'startup failure reported', { code }),
      showError: (title, message) => {
        try {
          dialog.showErrorBox(title, message)
        } catch {}
      },
      quit: () => app.quit()
    })
  })
}

app.on('before-quit', () => {
  eventLog?.tryRecord({ sourceModule: 'app', eventType: 'app.closing', actor: 'system', subjectType: 'application', subjectId: null, correlationId: null, payload: {} })
  reminderService?.shutdown()
  reminderService = undefined
  companionService?.shutdown()
  companionService = undefined
  unregisterIpc?.()
  unregisterIpc = undefined
  try {
    database?.close()
  } catch {
    logger.error('app', 'local data could not be closed cleanly')
  }
  database = undefined
  eventLog = undefined
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
