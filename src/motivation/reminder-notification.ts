import { Notification } from 'electron'
import type { ReminderNotificationCallbacks, ReminderNotificationHandle, ReminderNotificationPort } from './reminder-service'

export class ElectronReminderNotificationPort implements ReminderNotificationPort {
  isSupported(): boolean {
    return Notification.isSupported()
  }

  show(callbacks: ReminderNotificationCallbacks): ReminderNotificationHandle {
    const notification = new Notification({
      title: 'Morrow',
      body: '有一条本地目标提醒。打开 Morrow 查看。',
      silent: true
    })
    notification.once('show', () => callbacks.onShown())
    notification.once('failed', () => callbacks.onFailed())
    notification.once('click', () => callbacks.onClick())
    notification.once('close', () => callbacks.onClosed())
    notification.show()
    return { close: () => notification.close() }
  }
}
