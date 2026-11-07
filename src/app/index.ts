import { app, BrowserWindow, dialog, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC_CHANNELS, type AppInfo, type BackupExportOutcome, type BackupPreviewOutcome, type BackupRestoreOutcome } from '../shared/contracts'
import type { ApprovalChallenge } from '../motivation/goals'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'
import { presentProviderConsent } from '../providers/consent-presentation'
import { ConsentGrantService, SqliteConsentGrantRepository, consentScopeForPreview, consentScopeFingerprint } from '../providers/consent-grants'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { ARCHIVE_THRESHOLD } from '../memory/memory-importance'
import { MemoryMaintenanceScheduler } from '../memory/memory-maintenance'
import { RelationshipThreadService } from '../relationship/relationship-threads'
import { SafeStorageSecretStore } from '../security/secrets'
import { GoalService } from '../motivation/goal-service'
import { ElectronReminderNotificationPort } from '../motivation/reminder-notification'
import { ReminderService } from '../motivation/reminder-service'
import { BackupService, RESTORE_BOUNDARY_NOTICE } from '../persistence/backup-service'
import { EventLogService } from '../persistence/event-log'
import { SqliteGoalRepository } from '../persistence/goal-repository'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteReminderRepository } from '../persistence/reminder-repository'
import { createLogger } from '../observability/logger'
import { PersonalizationService } from '../personalization/personalization-service'
import { PersonalityGrowthService } from '../personalization/personality-growth'
import { composeStartupReflectionServices, runStartupReflection } from './startup-composition'
import { PersonalityService } from './companion-service'
import { ExplorationService } from '../self-model/exploration-policy'
import { CompanionGoalService } from '../motivation/companion-goal'
import { UserInteractionProfileService } from '../personalization/interaction-profile'
import { PendingSchemaUnavailableError, runBounded } from '../cognition/pending-items'
import { SqliteTurnContextRepository, SqliteTurnFinalizationRepository } from '../persistence/cognitive-context-repository'
import { SqliteTurnStateRepository } from '../persistence/turn-state-repository'
import { IntentReadingRepository } from '../persistence/intent-reading-repository'
import { ApplicationError } from '../shared/errors'
import { registerIpcHandlers } from './register-ipc'
import { observeRendererLoad, reportStartupFailure } from './startup-error'
import { createSecureWindowOptions, isTrustedRendererUrl, resolveTrustedRendererUrl } from '../security/security'
import { resolveAcceptanceUserData } from './acceptance-data-path'
import { WindowLifecycle, type WindowLifecycleEvent } from './window-lifecycle'
import { normalizeWindowBounds } from './window-bounds'

const acceptanceUserData = resolveAcceptanceUserData(process.env.MORROW_LOCAL_ACCEPTANCE_USER_DATA)
if (acceptanceUserData) {
  app.setPath('userData', acceptanceUserData)
  app.setPath('sessionData', acceptanceUserData)
}

const logger = createLogger({ minimumLevel: 'info' })

let consentGrants: ConsentGrantService | undefined
let mainWindow: BrowserWindow | undefined
let windowLifecycle = new WindowLifecycle()
let unregisterIpc: (() => void) | undefined
let innerCognitionTimer: ReturnType<typeof setInterval> | undefined
let database: SqliteDatabase | undefined
let memoryMaintenance: MemoryMaintenanceScheduler | undefined
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

if (process.env.MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX === '1') {
  // Acceptance-only switch for the Windows 26200 sandbox startup crash.
  // The default build keeps app.enableSandbox() and ships sandboxed.
  app.commandLine.appendSwitch('no-sandbox')
} else {
  app.enableSandbox()
}
app.setAppUserModelId('com.morrow.ai-companion')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  const trusted = resolveTrustedRendererUrl(
    process.env.ELECTRON_RENDERER_URL,
    pathToFileURL(join(__dirname, '../renderer/index.html')).href
  )
  focusMainWindow(trusted)
})

function getAppInfo(): AppInfo {
  return {
    name: 'Morrow',
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron ?? 'unknown',
    dataPolicy: 'local-first-consented-provider-egress-memory-goals-reminders'
  }
}

async function requestProviderConsent(preview: ProviderConsentPreview): Promise<ProviderConsent | undefined> {
  const window = mainWindow
  if (!window || window.isDestroyed()) return undefined
  const scope = consentScopeForPreview(preview)
  if (preview.action === 'chat' && preview.maximumSensitivity !== 'sensitive' && consentGrants) {
    const grant = consentGrants.find(scope)
    logger.info('app', 'provider consent scope', { action: preview.action, sensitivity: preview.maximumSensitivity, scope: consentScopeFingerprint(scope).slice(0, 12), grant: Boolean(grant) })
    if (grant) {
      const approvedAt = new Date().toISOString()
      return { providerId: preview.providerId, payloadSha256: preview.payloadSha256, approvedAt, expiresAt: new Date(Math.min(Date.parse(grant.expiresAt), Date.now() + 120_000)).toISOString(), includeSensitive: false }
    }
  }
  const presentation = presentProviderConsent(preview)
  const sensitivityLabel = preview.maximumSensitivity === 'sensitive'
    ? '敏感（仅在本次明确确认后发送）'
    : preview.maximumSensitivity === 'personal'
      ? '个人信息'
      : '普通'
  const memories = preview.includedMemories.length === 0
    ? '本次不包含已保存记忆。'
    : preview.includedMemories.map((memory, index) => `${index + 1}. [${memory.sensitivity}] ${memory.excerpt}`).join('\n')
  const detail = [
    `操作：${presentation.actionLabel}`,
    `目标：${presentation.providerKindLabel}`,
    `端点：${presentation.target}`,
    `模型：${presentation.model}`,
    `数据敏感度：${sensitivityLabel}`,
    `请求大小：${preview.payloadBytes} 字节`,
    `请求摘要：${preview.payloadSha256}`,
    presentation.egress,
    `计费：${presentation.pricing}`,
    ...(presentation.warning ? [`注意：${presentation.warning}`] : []),
    'API 密钥仅在 Windows 安全存储中加密保存；请求时通过 Authorization Bearer 标头发送（远程 HTTPS；本机回环可为 HTTP），不进入请求正文或 SQLite。',
    `已选记忆：\n${memories}`,
    `精确请求正文：\n${preview.exactPayload}`
  ].join('\n\n')
  const result = await dialog.showMessageBox(window, {
    type: preview.maximumSensitivity === 'sensitive' || presentation.warning ? 'warning' : 'question',
    title: presentation.title,
    message: presentation.message,
    detail,
    buttons: ['取消', '允许并发送'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  if (result.response !== 1) return undefined
  const approvedAt = new Date().toISOString()
  if (preview.action === 'chat') consentGrants?.grant(scope)
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

function transitionWindow(event: WindowLifecycleEvent): void {
  try {
    const state = windowLifecycle.apply(event)
    logger.info('app', 'window state', { event, state })
  } catch (error) {
    logger.warn('app', 'window transition rejected', { event, error: error instanceof Error ? error.name : 'unknown' })
  }
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function readSavedWindowBounds(): unknown {
  try {
    return existsSync(windowStatePath()) ? JSON.parse(readFileSync(windowStatePath(), 'utf8')) : null
  } catch {
    return null
  }
}

function saveWindowBounds(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  try {
    const bounds = window.getNormalBounds()
    writeFileSync(windowStatePath(), JSON.stringify(bounds), 'utf8')
  } catch {
    // Bounds persistence is best effort; a read-only profile must still run.
  }
}

function createMainWindow(trustedRendererUrl: string): void {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const bounds = normalizeWindowBounds(
    readSavedWindowBounds(),
    screen.getAllDisplays().map((display) => display.workArea),
    primaryWorkArea
  )
  const window = new BrowserWindow({
    ...createSecureWindowOptions(join(__dirname, '../preload/index.js')),
    ...bounds
  })

  mainWindow = window
  windowLifecycle = new WindowLifecycle()
  let rendererRecoveryAttempts = 0
  let boundsTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleBoundsSave = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => saveWindowBounds(window), 300)
  }
  window.once('ready-to-show', () => {
    transitionWindow('ready')
    window.show()
    transitionWindow('show')
  })
  window.on('minimize', () => transitionWindow('minimize'))
  window.on('restore', () => transitionWindow('restore'))
  window.on('hide', () => transitionWindow('hide'))
  window.on('moved', scheduleBoundsSave)
  window.on('resized', scheduleBoundsSave)
  window.on('close', () => {
    saveWindowBounds(window)
    transitionWindow('close')
  })
  window.on('closed', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    transitionWindow('closed')
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('app', 'renderer process gone', { reason: details.reason, exitCode: details.exitCode })
    if (details.reason !== 'clean-exit' && rendererRecoveryAttempts < 1) {
      rendererRecoveryAttempts += 1
      setTimeout(() => {
        if (!window.isDestroyed()) window.reload()
      }, 250)
    }
  })
  window.on('unresponsive', () => logger.warn('app', 'window unresponsive'))
  window.on('responsive', () => logger.info('app', 'window responsive again'))

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
  if (!window.isVisible()) window.show()
  if (windowLifecycle.can('show')) transitionWindow('show')
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
    consentGrants = new ConsentGrantService(new SqliteConsentGrantRepository(database))
    eventLog = new EventLogService(database)
    eventLog.tryRecord({ sourceModule: 'app', eventType: 'app.started', actor: 'system', subjectType: 'application', subjectId: null, correlationId: null, payload: { version: app.getVersion() } })
    // Issue #43: the reflection dependency graph is composed by the same
    // production function the startup integration test calls. This is the real
    // bootstrap boundary, not a test-only copy.
    const startup = composeStartupReflectionServices(database, eventLog)
    const { memoryImportance, factMemory, memories, interests, selfModel, innerCognition, reflection, pendingItems, findingRouter } = startup
    // P0-A: the addressable fact layer, rebuilt from the memories at start
    // (idempotent) and kept current by the MemoryService lifecycle hooks.
    try {
      factMemory.reindexAll()
    } catch {
      logger.warn('memory', 'fact index catch-up failed; attribute lookups degrade until the next pass')
    }
    // D-12: a lifecycle-controlled scheduler replaces the startup-only pass.
    // It catches up now (the old behaviour), then runs on an interval decided
    // by absolute time — a long-running process keeps its importance scores
    // fresh, and no tick can double-apply decay.
    memoryMaintenance = new MemoryMaintenanceScheduler({
      database,
      importance: memoryImportance,
      archiveThreshold: ARCHIVE_THRESHOLD,
      archiveOlderThanDays: 180,
      onPass: (outcome) => {
        logger.debug('memory', 'maintenance pass', { groups: outcome.groups, archived: outcome.archived, status: outcome.status })
      }
    })
    memoryMaintenance.start()
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const personalization = new PersonalizationService(database)
    // Stage 3: bounded personality drift and constrained self-initiated topics.
    // Both are evidence-led and reversible; neither can write the baseline the
    // user edited, and neither can contact the user outside a turn.
    const growth = new PersonalityGrowthService(database)
    const exploration = new ExplorationService(database)
    // How this user asked Morrow to speak, kept apart from her identity: the
    // baseline comes from the profile the user edited, and only presentation
    // dimensions move.
    const interactionDatabase = database
    const interaction = new UserInteractionProfileService(
      interactionDatabase,
      () => {
        const profile = new PersonalityService(interactionDatabase).get()
        return { warmth: profile.warmth, directness: profile.directness, humor: profile.humor }
      }
    )
    // §2D: companionship goals live beside the task-execution GoalService, not
    // inside it; see the migration comment for why the two are not merged.
    const companionGoals = new CompanionGoalService(database, eventLog)
    // Phase 2.4: the turn context and the open internal items are persisted
    // beside the conversation, so continuity survives a restart.
    const turnContexts = new SqliteTurnContextRepository(database)
    const finalizations = new SqliteTurnFinalizationRepository(database)
    // Stage 5: relationship continuity threads (user-stated continuity notes).
    const relationships = new RelationshipThreadService({ database, events: eventLog })
    // F1: migrations have run and no conversational reader exists yet. Erase
    // evidence and thread content whose source message is gone, then let the
    // chat service start. This is fail-closed on purpose: if privacy cleanup
    // cannot complete, the app must not serve a prompt built from uncleaned
    // relationship data. Backup restore replays the deletion journal and then
    // relaunches, so this is also the post-restore boundary.
    //
    // A degraded database below v46 lacks tombstoned_at; reconcile cannot run
    // there. Skipping it keeps core chat usable while the migration remains
    // the only path to full relationship cleanup.
    if (database.schemaVersion >= 46) {
      const reconciledOrphans = relationships.reconcile()
      if (reconciledOrphans > 0) {
        console.warn(`Relationship reconcile removed ${reconciledOrphans} orphan evidence row(s) before startup.`)
      }
    } else {
      console.warn(`Relationship reconcile skipped: schema v${database.schemaVersion} is below v46.`)
    }
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets: new SafeStorageSecretStore(app.getPath('userData')),
      authorize: requestProviderConsent,
      selfModelLoop: { events: eventLog, interests, selfModel, innerCognition, reflection, personalization, growth, exploration, interaction, goals: companionGoals, memories, findingRouter, relationships },
      continuity: {
        contexts: turnContexts,
        pending: pendingItems,
        finalizations,
        states: new SqliteTurnStateRepository(database),
        readings: new IntentReadingRepository(database, eventLog)
      }
    })
    // Settle any turn that was interrupted between its finalization intent and
    // the assistant-message commit. Safe to run on every start.
    try {
      const recovered = companion.recoverInterruptedTurns()
      if (recovered.completed > 0 || recovered.interrupted > 0) {
        eventLog.tryRecord({
          sourceModule: 'cognition',
          eventType: 'turn.recovered',
          actor: 'system',
          subjectType: 'application',
          subjectId: null,
          correlationId: null,
          payload: recovered
        })
      }
    } catch {
      console.warn('Interrupted turns could not be recovered at startup; the conversation data is unaffected.')
    }
    // Post-turn cognition that was committed but never applied (a crash between
    // the assistant-message commit and the projections). Idempotent, and it runs
    // after the interrupted-turn recovery so the same turn is not processed by
    // two paths at once.
    try {
      const drained = companion.drainCognition()
      if (drained.done > 0 || drained.failed > 0) {
        eventLog.tryRecord({
          sourceModule: 'cognition',
          eventType: 'cognition.outbox_replayed',
          actor: 'system',
          subjectType: 'application',
          subjectId: null,
          correlationId: null,
          payload: drained
        })
      }
    } catch {
      console.warn('Queued post-turn cognition could not be replayed; it stays queued for the next start.')
    }
    companionService = companion
    innerCognitionTimer = setInterval(() => {
      try { innerCognition.reviewDue(new Date().toISOString(), 3) } catch { logger.warn('cognition', 'inner cognition review failed; normal chat is unaffected') }
    }, 5 * 60 * 1000)
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
    // Bounded startup reflection: rate-limited inside the service, findings
    // only, never auto-executed actions.
    // The production startup function (also used by the composition test)
    // runs reflection and routes findings through the durable ingestion path.
    const startupReflection = runStartupReflection({ reflection, findingRouter, logger })
    if (startupReflection.status !== 'ran') {
      logger.warn('self-model', 'startup reflection did not complete cleanly', {
        status: startupReflection.status,
        reason: startupReflection.reason ?? null,
        recovered: startupReflection.recovered ?? 0
      })
    }
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
    unregisterIpc = registerIpcHandlers({ getAppInfo }, trustedRendererUrl, {
      memories,
      goals,
      companionGoals,
      reminders,
      companion,
      backup: backupActions,
      // Phase 2.4: the shell can read what the subject is holding open and what
      // each turn actually read. Marking an item done is the only mutation.
      continuity: {
        listPendingItems: () => pendingItems.listOpen(),
        decidePendingItem: (request) => pendingItems.decide(request.itemId, request.decision),
        readTurnContext: (request) => turnContexts.get(request.turnId)
      },
      selfModel: {
        listInterests: () => interests.list(),
        setInterestStatus: (request) => interests.setUserStatus(request.interestId, request.status),
        listEntries: (request) => selfModel.list(request ?? {}),
        correctEntry: (request) => selfModel.correct(request.entryId, request.statement),
        retractEntry: (request) => selfModel.retract(request.entryId),
        // A reflection run is bounded: the service rate-limits runs per hour,
        // caps the events it examines and the findings it emits, and the
        // wrapper refuses to start a pass when its own budget is already gone.
        // The pass itself is synchronous, so it cannot be interrupted
        // mid-flight — that limitation is stated, not hidden behind a signal.
        // Its findings become open internal items, deduplicated by concern so
        // repeated runs do not pile up duplicates.
        runReflection: async () => {
          const outcome = await runBounded(() => {
            const summary = reflection.run('manual')
            if (!('skipped' in summary)) {
              findingRouter.ingestRun(summary.id, reflection.findings(summary.id))
            }
            const recovered = findingRouter.recoverUnrouted()
            if (recovered.failed > 0) throw new Error('REFLECTION_RECOVERY_INCOMPLETE')
            return summary
          }, { budgetMs: 2_000 })
          if (outcome.status === 'completed' && outcome.value) return outcome.value
          // The pass never started, so reporting it as completed would be a lie.
          if (outcome.status === 'skipped') return { skipped: 'budget_exhausted' as const }
          if (outcome.status === 'failed' && outcome.error instanceof PendingSchemaUnavailableError) {
            throw new ApplicationError('SCHEMA_UPGRADE_REQUIRED')
          }
          throw new ApplicationError('STORAGE_ERROR')
        },
        listReflectionRuns: () => reflection.listRuns(),
        listReflectionFindings: (request) => reflection.findings(request.runId)
      }
    })
    createMainWindow(trustedRendererUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(trustedRendererUrl)
    })
  }).catch((error: unknown) => {
    logger.error('app', 'startup failed', { error: error instanceof Error ? error.name : 'unknown', ...(error instanceof ApplicationError ? { code: error.code } : {}), ...(process.env.MORROW_STARTUP_DIAGNOSTIC === '1' && error instanceof Error ? { stack: (error.stack ?? '').slice(0, 3000) } : {}) })
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
  if (innerCognitionTimer) { clearInterval(innerCognitionTimer); innerCognitionTimer = undefined }
  eventLog?.tryRecord({ sourceModule: 'app', eventType: 'app.closing', actor: 'system', subjectType: 'application', subjectId: null, correlationId: null, payload: {} })
  memoryMaintenance?.stop()
  memoryMaintenance = undefined
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
