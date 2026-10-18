import { createHash } from 'node:crypto';

export const SITE_IDS = Object.freeze(['appv4', 'main-ubutsu2', 'oyama-wsl']);
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_VAULTS = 1_000;

function safeSiteId(value) {
  return SITE_IDS.includes(value) ? value : 'unconfigured';
}

function safeRouteFingerprint(origin) {
  return createHash('sha256').update(origin, 'utf8').digest('hex').slice(0, 16);
}

function resolveConfig(env) {
  const siteId = safeSiteId(env.CONNECT_SITE_ID);
  if (siteId === 'unconfigured') return { siteId, status: 'configuration_invalid' };

  const host = env.OP_CONNECT_HOST;
  const token = env.OP_CONNECT_TOKEN;
  if (typeof host !== 'string' || host.trim() === '' ||
      typeof token !== 'string' || token.trim() === '') {
    return { siteId, status: 'configuration_missing' };
  }
  if (token !== token.trim() || /[\r\n\0]/u.test(token) || token.startsWith('Bearer ')) {
    return { siteId, status: 'configuration_invalid' };
  }

  let url;
  try {
    url = new URL(host);
  } catch {
    return { siteId, status: 'configuration_invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) {
    return { siteId, status: 'configuration_invalid' };
  }

  return {
    siteId,
    origin: url.origin,
    routeFingerprint: safeRouteFingerprint(url.origin),
    token,
  };
}

function publicMetadata(config, status, additional = {}) {
  return {
    siteId: config.siteId,
    ...(config.routeFingerprint ? { routeFingerprint: config.routeFingerprint } : {}),
    status,
    ...additional,
  };
}

async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The body is intentionally discarded; response details are never surfaced.
  }
}

function httpStatusName(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  return 'http_error';
}

function validVaultId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !/[\r\n\0]/u.test(value);
}

export function createConnectApiClient({ env = process.env, fetchImpl = fetch } = {}) {
  const config = resolveConfig(env);

  return {
    siteId: config.siteId,
    routeFingerprint: config.routeFingerprint,
    configured: typeof config.origin === 'string',

    async listVaults() {
      if (!config.origin) return publicMetadata(config, config.status);

      let response;
      try {
        response = await fetchImpl(new URL('/v1/vaults', config.origin), {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${config.token}`,
          },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        return publicMetadata(config, 'connect_unavailable');
      }

      if (!response.ok) {
        await discardBody(response);
        return publicMetadata(config, httpStatusName(response.status), { httpStatus: response.status });
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        return publicMetadata(config, 'invalid_upstream_response');
      }
      if (!Array.isArray(payload) || payload.length > MAX_VAULTS ||
          payload.some((vault) => vault === null || typeof vault !== 'object' || !validVaultId(vault.id))) {
        return publicMetadata(config, 'invalid_upstream_response');
      }

      const vaultIds = [...new Set(payload.map((vault) => vault.id))].sort();
      return publicMetadata(config, 'ok', { vaultIds });
    },
  };
}
