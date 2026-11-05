/**
 * Consent presentation for provider egress.
 *
 * The dialog is the user's authorization surface, so every label must come
 * from the same verified preview that carries the endpoint, model and payload
 * hash. Vendor names and prices are never inherited from a hardcoded default:
 * an official profile may name only its own vendor, a custom relay is always
 * "自定义服务端", and a local profile is always "本地模型服务".
 */
import type { ProviderConsentPreview } from './provider-policy'

export interface ConsentPresentation {
  actionLabel: string
  providerLabel: string
  providerKindLabel: string
  target: string
  model: string
  pricing: string
  egress: string
  title: string
  message: string
  warning: string | null
}

/** Display form: origin + path, with credentials, query and fragment removed. */
export function sanitizeConsentEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return `${url.origin}${url.pathname}`.replace(/\/+$/u, '')
  } catch {
    return '无法解析的端点'
  }
}

function actionLabel(action: ProviderConsentPreview['action']): string {
  if (action === 'chat') return '发送对话'
  if (action === 'connection-test') return '测试连接'
  if (action === 'model-discovery') return '获取模型列表'
  return '生成记忆候选'
}

export function presentProviderConsent(preview: ProviderConsentPreview): ConsentPresentation {
  const target = sanitizeConsentEndpoint(preview.endpoint)
  const host = (() => {
    try { return new URL(preview.endpoint).host } catch { return '未知主机' }
  })()
  const kind = preview.providerSourceKind
  if (kind === 'official') {
    const label = preview.providerDisplayName || '官方服务'
    return {
      actionLabel: actionLabel(preview.action),
      providerLabel: label,
      providerKindLabel: `官方服务 · ${host}`,
      target,
      model: preview.model,
      pricing: '计费信息未验证；请以服务商控制台的实际价格为准，Morrow 不继承其他厂商的价格。',
      egress: `请求将离开本机并发送到 ${label} 的官方端点。`,
      title: `确认向${label}发送数据`,
      message: `以下内容将离开本机并发送到${label}。每次请求都需要单独确认。`,
      warning: null
    }
  }
  if (kind === 'local') {
    return {
      actionLabel: actionLabel(preview.action),
      providerLabel: '本地模型服务',
      providerKindLabel: `本地模型服务 · ${host}`,
      target,
      model: preview.model,
      pricing: '请求不会离开本机，不产生 API 费用。',
      egress: '目标端点是本机回环地址；请求不会离开这台电脑。',
      title: '确认发送数据到本地模型',
      message: '以下内容将发送到你配置的本地模型服务（本机回环地址）。每次请求都需要单独确认。',
      warning: null
    }
  }
  return {
    actionLabel: actionLabel(preview.action),
    providerLabel: '自定义服务端',
    providerKindLabel: `自定义服务端 · ${host}`,
    target,
    model: preview.model,
    pricing: '该服务由你自行配置；请自行核验服务商的隐私政策与计费，Morrow 无法验证价格。',
    egress: `请求将离开本机并发送到自定义服务端 ${host}。`,
    title: '确认向自定义模型服务发送数据',
    message: '以下内容将离开本机并发送到你配置的自定义服务端。每次请求都需要单独确认。',
    warning: '自定义服务端不是 Morrow 官方厂商；数据去向、隐私与费用由该服务商决定。'
  }
}
