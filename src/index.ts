#!/usr/bin/env node
import { Command } from 'commander'
import {
  getConfigPath,
  readConfigFile,
  resolveRuntimeConfig,
  writeConfigFile,
  type GlobalOptions,
} from './config.js'
import {
  doctor,
  getApp,
  getDataColumns,
  getModel,
  listApps,
  listAppVersions,
  listModels,
  listPreitems,
  rawRequest,
  searchEvents,
} from './commands.js'
import { loginWithMemHub } from './auth.js'
import { printError, printResult } from './output.js'

const program = new Command()

program
  .name('risk-cli')
  .description('VVICAT 风控项目配套 CLI')
  .option('--json', '输出稳定 JSON')
  .option('--base-url <url>', '风控统一网关基础地址')
  .option('--token <token>', 'x-auth-token，仅用于本次调用')

program
  .command('login')
  .description('使用 MemHub OAuth 在浏览器登录并保存 token')
  .option('--port <port>', '本地 OAuth 回调端口，默认随机可用端口')
  .option('--timeout <seconds>', '等待登录超时时间，秒', '300')
  .option('--no-open', '只打印授权链接，不自动打开浏览器')
  .action(async (options) => {
    await run('login', async (config) =>
      loginWithMemHub(config, {
        port: options.port === undefined ? undefined : toNumber(options.port, '--port'),
        timeoutSeconds: toNumber(options.timeout, '--timeout'),
        openBrowser: Boolean(options.open),
      }))
  })

program
  .command('doctor')
  .description('检查 CLI 配置、鉴权来源和服务可达性')
  .option('--full', '执行完整诊断，检查模型、应用和名单列表等业务资源')
  .action(async (options) => {
    await run('doctor', async (config) => doctor(config, { full: Boolean(options.full) }))
  })

program
  .command('init')
  .description('写入本地配置文件')
  .option('--base-url <url>', '风控统一网关基础地址')
  .option('--token <token>', 'x-auth-token')
  .action(async (options) => {
    await run('init', async () => {
      const current = readConfigFile()
      const globals = program.opts<GlobalOptions & { json?: boolean }>()
      const next = {
        baseUrl: options.baseUrl ?? globals.baseUrl ?? current.baseUrl,
        token: options.token ?? globals.token ?? current.token,
      }
      writeConfigFile(next)
      return {
        configPath: getConfigPath(),
        saved: {
          baseUrl: next.baseUrl ?? null,
          tokenConfigured: Boolean(next.token),
        },
      }
    })
  })

const models = program.command('models').description('模型查询')
models.command('list').description('列模型').action(async () => {
  await run('models list', async (config) => listModels(config))
})
models.command('get').requiredOption('--id <id>', '模型 ID').action(async (options) => {
  await run('models get', async (config) => getModel(config, toNumber(options.id, '--id')))
})

const preitems = program.command('preitems').description('预处理项查询')
preitems.command('list').requiredOption('--model-id <id>', '模型 ID').action(async (options) => {
  await run('preitems list', async (config) => listPreitems(config, toNumber(options.modelId, '--model-id')))
})

const datacolumns = program.command('datacolumns').description('条件字段树查询')
datacolumns
  .command('get')
  .requiredOption('--model-id <id>', '模型 ID')
  .option('--display', '读取展示字段树')
  .action(async (options) => {
    await run('datacolumns get', async (config) =>
      getDataColumns(config, toNumber(options.modelId, '--model-id'), Boolean(options.display)))
  })

const apps = program.command('apps').description('应用查询')
apps.command('list').action(async () => {
  await run('apps list', async (config) => listApps(config))
})
apps.command('get').requiredOption('--id <id>', '应用 ID').action(async (options) => {
  await run('apps get', async (config) => getApp(config, toNumber(options.id, '--id')))
})

const appVersions = program.command('app-versions').description('应用版本查询')
appVersions.command('list').requiredOption('--app-id <id>', '应用 ID').action(async (options) => {
  await run('app-versions list', async (config) =>
    listAppVersions(config, toNumber(options.appId, '--app-id')))
})

const events = program.command('events').description('事件搜索')
events
  .command('search')
  .requiredOption('--model-id <id>', '模型 ID')
  .requiredOption('--begin <time>', '开始时间，格式 yyyy-MM-dd HH:mm:ss')
  .requiredOption('--end <time>', '结束时间，格式 yyyy-MM-dd HH:mm:ss')
  .option('--field <field>', '查询字段')
  .option('--value <value>', '查询值')
  .option('--page-no <n>', '页码', '1')
  .option('--page-size <n>', '每页条数', '10')
  .action(async (options) => {
    await run('events search', async (config) =>
      searchEvents(config, {
        modelId: toNumber(options.modelId, '--model-id'),
        field: options.field,
        value: options.value,
        begin: options.begin,
        end: options.end,
        pageNo: toNumber(options.pageNo, '--page-no'),
        pageSize: toNumber(options.pageSize, '--page-size'),
      }))
  })

const request = program.command('request').description('原始接口逃生口')
for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
  request
    .command(method)
    .argument('<path>', '接口路径，如 /services/v1/model/list')
    .option('--body <json>', 'JSON 请求体')
    .option('--allow-write', '允许非 GET/HEAD 写请求')
    .action(async (path, options) => {
      await run(`request ${method}`, async (config) =>
        rawRequest(config, {
          method: method.toUpperCase(),
          path,
          body: options.body ? JSON.parse(options.body) : undefined,
          allowWrite: Boolean(options.allowWrite),
        }))
    })
}

await program.parseAsync(process.argv)

async function run(commandName: string, handler: (config: ReturnType<typeof resolveRuntimeConfig>) => Promise<unknown>) {
  const globals = program.opts<GlobalOptions & { json?: boolean }>()
  const config = resolveRuntimeConfig(globals)
  try {
    const result = await handler(config)
    printResult(Boolean(globals.json), commandName, result)
  } catch (error) {
    printError(Boolean(globals.json), error)
  }
}

function toNumber(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} 需要是数字，收到: ${value}`)
  }
  return parsed
}
