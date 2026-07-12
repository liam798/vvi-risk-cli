import type { RuntimeConfig } from './config.js'
import { requestJson } from './http.js'

type CommonResult = {
  success?: boolean
  code?: string
  msg?: string
  data?: Record<string, unknown>
}

type DoctorOptions = {
  full?: boolean
}

type CheckResult = {
  path: string
  ok: boolean
  skipped?: boolean
  reason?: string
  count?: number | null
  error?: string
  code?: string
  status?: number
}

export async function doctor(config: RuntimeConfig, options: DoctorOptions = {}): Promise<Record<string, unknown>> {
  let rootReachable = false
  let rootCheck: unknown = null
  try {
    const response = await fetch(config.baseUrl)
    rootReachable = response.ok
    rootCheck = { status: response.status, ok: response.ok }
  } catch (error) {
    rootCheck = { error: error instanceof Error ? error.message : String(error) }
  }
  const authCheck = await checkEndpoint(config, '/services/v1/auth/session/check', {
    skipWhenMissingToken: true,
  })
  const result: Record<string, unknown> = {
    nodeVersion: process.version,
    baseUrl: config.baseUrl,
    configPath: config.configPath,
    tokenConfigured: Boolean(config.token),
    tokenSource: config.tokenSource,
    rootReachable,
    rootCheck,
    authCheck,
    authReachable: authCheck.ok,
    full: Boolean(options.full),
  }
  if (options.full) {
    result.fullChecks = await runFullDoctor(config)
  }
  return result
}

export async function listModels(config: RuntimeConfig): Promise<unknown> {
  return pluckData(await requestJson(config, { path: '/services/v1/model/list' }), 'modelList')
}

export async function getModel(config: RuntimeConfig, id: number): Promise<unknown> {
  return pluckData(await requestJson(config, { path: `/services/v1/model/${id}` }), 'model')
}

export async function listPreitems(config: RuntimeConfig, modelId: number): Promise<unknown> {
  return pluckData(await requestJson(config, { path: `/services/v1/preitem/list/${modelId}` }), 'list')
}

export async function getDataColumns(config: RuntimeConfig, modelId: number, display = false): Promise<unknown> {
  return pluckData(
    await requestJson(config, {
      path: `/services/v1/event/${display ? 'display-datacolumns' : 'datacolumns'}/${modelId}`,
    }),
    'list',
  )
}

export async function listApps(config: RuntimeConfig): Promise<unknown> {
  return pluckData(await requestJson(config, { path: '/services/v1/app/list' }), 'list')
}

export async function listDataLists(config: RuntimeConfig, modelId: number): Promise<unknown> {
  return pluckData(await requestJson(config, { path: `/services/v1/datalist/list/${modelId}` }), 'list')
}

export async function getApp(config: RuntimeConfig, id: number): Promise<unknown> {
  return pluckData(await requestJson(config, { path: `/services/v1/app/${id}` }), 'app')
}

export async function listAppVersions(config: RuntimeConfig, appId: number): Promise<unknown> {
  return pluckData(await requestJson(config, { path: `/services/v1/app-version/list/${appId}` }), 'list')
}

export async function searchEvents(
  config: RuntimeConfig,
  input: {
    modelId: number
    field?: string
    value?: string
    begin: string
    end: string
    pageNo: number
    pageSize: number
  },
): Promise<unknown> {
  const body = {
    modelId: input.modelId,
    fieldName: input.field ?? '',
    fieldValue: input.value ?? '',
    beginTime: input.begin,
    endTime: input.end,
    pageNo: input.pageNo,
    pageSize: input.pageSize,
  }
  return pluckData(
    await requestJson(config, {
      method: 'POST',
      path: '/services/v1/event/search',
      body,
      allowWrite: true,
    }),
    'page',
  )
}

export async function rawRequest(
  config: RuntimeConfig,
  input: {
    method: string
    path: string
    body?: unknown
    allowWrite?: boolean
  },
): Promise<unknown> {
  return requestJson(config, {
    method: input.method,
    path: input.path,
    body: input.body,
    allowWrite: input.allowWrite,
  })
}

function pluckData(payload: unknown, key: string): unknown {
  const result = payload as CommonResult
  return result?.data?.[key] ?? payload
}

async function runFullDoctor(config: RuntimeConfig): Promise<Record<string, unknown>> {
  const modelsPayload = await checkEndpoint(config, '/services/v1/model/list', { countKey: 'modelList' })
  const appsPayload = await checkEndpoint(config, '/services/v1/app/list', { countKey: 'list' })
  const dataLists = await checkDataLists(config, modelsPayload.payload)
  return {
    session: await checkEndpoint(config, '/services/v1/auth/session/check'),
    models: withoutPayload(modelsPayload),
    apps: withoutPayload(appsPayload),
    dataLists,
  }
}

async function checkDataLists(config: RuntimeConfig, modelsPayload: unknown): Promise<Record<string, unknown>> {
  const models = extractList(modelsPayload, 'modelList')
  if (models.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: '模型列表为空，未检查名单列表',
      checkedModels: 0,
      totalCount: 0,
      perModel: [],
    }
  }

  const perModel = []
  let allOk = true
  let totalCount = 0
  for (const model of models) {
    const modelRecord = model as Record<string, unknown>
    const modelId = Number(modelRecord.id)
    if (!Number.isFinite(modelId)) {
      perModel.push({
        ok: false,
        error: '模型缺少有效 id，无法检查名单列表',
        model,
      })
      allOk = false
      continue
    }
    const check = await checkEndpoint(config, `/services/v1/datalist/list/${modelId}`, { countKey: 'list' })
    if (!check.ok) allOk = false
    totalCount += check.count ?? 0
    perModel.push({
      modelId,
      modelName: modelRecord.name ?? modelRecord.label ?? null,
      ...withoutPayload(check),
    })
  }
  return {
    ok: allOk,
    checkedModels: perModel.length,
    totalCount,
    perModel,
  }
}

async function checkEndpoint(
  config: RuntimeConfig,
  path: string,
  options: { countKey?: string; skipWhenMissingToken?: boolean } = {},
): Promise<CheckResult & { payload?: unknown }> {
  if (options.skipWhenMissingToken && !config.token) {
    return {
      path,
      ok: false,
      skipped: true,
      reason: '未配置 x-auth-token',
    }
  }
  try {
    const payload = await requestJson(config, { path })
    return {
      path,
      ok: true,
      count: options.countKey ? extractList(payload, options.countKey).length : null,
      payload,
    }
  } catch (error) {
    const normalized = normalizeCheckError(error)
    return {
      path,
      ok: false,
      ...normalized,
    }
  }
}

function withoutPayload<T extends CheckResult & { payload?: unknown }>(check: T): CheckResult {
  const { payload: _payload, ...rest } = check
  return rest
}

function extractList(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const direct = record[key]
  if (Array.isArray(direct)) return direct
  const data = record.data
  if (!data || typeof data !== 'object') return []
  const nested = (data as Record<string, unknown>)[key]
  return Array.isArray(nested) ? nested : []
}

function normalizeCheckError(error: unknown): { error: string; code?: string; status?: number } {
  if (error instanceof Error) {
    const result: { error: string; code?: string; status?: number } = { error: error.message }
    const record = error as Error & { code?: string; status?: number }
    if (record.code) result.code = record.code
    if (record.status) result.status = record.status
    return result
  }
  return { error: String(error) }
}
