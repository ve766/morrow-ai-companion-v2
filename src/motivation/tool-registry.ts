import type { MemoryService } from '../memory/memory-service'
import {
  GOAL_ACTION_TIMEOUT_MS,
  MEMORY_COUNT_RESOURCE_SCOPE,
  MEMORY_COUNT_TOOL_DEFINITION,
  MEMORY_COUNT_TOOL_ID,
  MEMORY_COUNT_TOOL_VERSION,
  ToolExecutionError
} from './goals'

export interface ReadOnlyToolAdapter {
  readonly definition: typeof MEMORY_COUNT_TOOL_DEFINITION
  execute(parameters: unknown, signal: AbortSignal): Promise<unknown> | unknown
  verify(parameters: unknown, signal: AbortSignal): Promise<unknown> | unknown
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  return Reflect.ownKeys(value).length === 0
}

export class MemoryCountTool implements ReadOnlyToolAdapter {
  readonly definition = MEMORY_COUNT_TOOL_DEFINITION

  constructor(private readonly memories: MemoryService) {}

  execute(parameters: unknown, signal: AbortSignal): { count: number } {
    if (!isEmptyObject(parameters) || signal.aborted) throw new ToolExecutionError(signal.aborted)
    return { count: this.memories.countActive() }
  }

  verify(parameters: unknown, signal: AbortSignal): { count: number } {
    if (!isEmptyObject(parameters) || signal.aborted) throw new ToolExecutionError(signal.aborted)
    return { count: this.memories.countActiveForVerification() }
  }
}

export class ToolRegistry {
  constructor(private readonly memoryCount: ReadOnlyToolAdapter) {
    const definition = memoryCount.definition
    if (
      definition.id !== MEMORY_COUNT_TOOL_ID ||
      definition.version !== MEMORY_COUNT_TOOL_VERSION ||
      definition.allowedResources.length !== 1 ||
      definition.allowedResources[0] !== MEMORY_COUNT_RESOURCE_SCOPE ||
      definition.risk !== 'read-only' ||
      definition.sideEffect !== 'none' ||
      definition.timeoutMs !== GOAL_ACTION_TIMEOUT_MS
    ) {
      throw new Error('The fixed read-only tool registration is invalid.')
    }
  }

  get(toolId: string): ReadOnlyToolAdapter | null {
    return toolId === MEMORY_COUNT_TOOL_ID ? this.memoryCount : null
  }
}
