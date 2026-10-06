import { lstatSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

/** @param {NodeJS.ProcessEnv} environment */
export function readConfiguration(environment) {
  /** @param {string} key */
  const flag = (key) => {
    const value = environment[key] ?? 'false';
    // 对齐后端 Pydantic bool 输入；显式空值与未知值不得退回默认。
    if (/^(1|true|on|yes|y|t)$/i.test(value)) return true;
    if (/^(0|false|off|no|n|f)$/i.test(value)) return false;
    throw new Error('BROWSER_CONFIGURATION_INVALID');
  };
  const monitoring = flag('GEO_MONITORING_ENABLED');
  const enabled = flag('GEO_BROWSER_COLLECTION_ENABLED');
  if (enabled && !monitoring) throw new Error('BROWSER_CONFIGURATION_INVALID');
  const controlFile = environment.GEO_BROWSER_KILL_SWITCH_FILE ?? '/run/control/STOP';
  if (!controlFile.startsWith('/')) throw new Error('BROWSER_CONFIGURATION_INVALID');
  return Object.freeze({ monitoring, enabled, controlFile });
}

/** @param {string} controlFile */
function stopped(controlFile) {
  try {
    // 控制目录缺失或不可读不能等同于“允许”；每次入口与健康请求均重新检查。
    const directory = statSync(dirname(controlFile));
    if (!directory.isDirectory()) return true;
    lstatSync(controlFile);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      try {
        return !statSync(dirname(controlFile)).isDirectory();
      } catch {
        return true;
      }
    }
    return true;
  }
}

/** @param {ReturnType<typeof readConfiguration>} configuration */
export function admissionCode(configuration) {
  if (!configuration.monitoring || !configuration.enabled || stopped(configuration.controlFile)) {
    return 'COLLECTOR_DISABLED';
  }
  return 'BROWSER_ADAPTER_NOT_IMPLEMENTED';
}

/**
 * 内部任务入口只接收稳定 Run UUID。GEO-801 没有批准 adapter/会话/发送授权，
 * 必须在取得业务 lease、读取问题或连接 Broker 之前拒绝，不消费或确认现有任务。
 * @param {unknown} runId
 * @param {ReturnType<typeof readConfiguration>} configuration
 */
export function claimRun(runId, configuration) {
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error('BROWSER_TASK_INVALID');
  }
  throw new Error(admissionCode(configuration));
}

/**
 * @param {ReturnType<typeof readConfiguration>} configuration
 * @param {() => Promise<string>} probeRuntime
 */
export function createHealthServer(configuration, probeRuntime) {
  // 仅容器回环健康端点；不暴露领取、登录、调试或任意 URL 导航 API。
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    try {
      const version = await probeRuntime();
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({
        status: 'ok', browser_runtime: version, collection: admissionCode(configuration),
        session_probe: 'NOT_IMPLEMENTED',
      }));
    } catch {
      // 浏览器异常可包含路径/正文；只返回固定失败，不打印第三方异常或 traceback。
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'error', code: 'BROWSER_RUNTIME_UNAVAILABLE' }));
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}
