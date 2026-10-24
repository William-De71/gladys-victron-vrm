// -----------------------------------------------------------------------------
// HTTP client of the official Victron VRM API v2
// (https://vrm-api-docs.victronenergy.com, base
// https://vrmapi.victronenergy.com/v2). Read only: every request is a GET.
//
//   GET users/me                                   the user of the token (its id)
//   GET users/{idUser}/installations?extended=1    every installation of the user
//                                                  with its latest values, alarms
//                                                  and the time of its last data
//   GET installations/{idSite}/stats               type=kwh, interval=hours: the
//                                                  energy flows of today, per hour;
//                                                  type=forecast: solar and
//                                                  consumption forecasts (Wh/hour)
//   GET installations/{idSite}/alarm-log?count=N   the alarm log, active first
//
// Authentication: the personal access token of the user (VRM → Preferences →
// Integrations → Access tokens) in the header `x-authorization: Token <token>`
// (the Bearer tokens of a login are deprecated since June 2026). A wrong token
// answers HTTP 401 `{"success":false,"errors":"Invalid accesstoken
// received","error_code":"invalid_token"}` (checked live on 2026-10-24).
// Errors are `{ success: false, errors, error_code }` with an HTTP status;
// `errors` is not localized but is free text: only the status and
// `error_code` are read.
//
// Rate limit (documented): a rolling window of 200 requests, one leaving
// every 0.33 s (about 3 requests per second); past it, HTTP 429 with a
// Retry-After header in seconds. The client sends one request at a time, one
// second apart at least, and after a 429 holds every request until the
// Retry-After (30 s at least, one hour at most).
// -----------------------------------------------------------------------------

const BASE_URL = 'https://vrmapi.victronenergy.com/v2';
const TIMEOUT_MS = 30000;
const SPACING_MS = 1000;
const MIN_PAUSE_MS = 30 * 1000;
const MAX_PAUSE_MS = 60 * 60 * 1000;

// The kinds that are about the token itself, not one installation.
const ACCOUNT_KINDS = ['auth'];

/**
 * @description An error of the VRM API.
 */
class VrmError extends Error {
  /**
   * @param {string} kind - `auth`, `forbidden`, `not_found`, `rate_limit`,
   * `server`, `http`, `unreachable`, `failed`.
   * @param {string} message - What went wrong (never the token).
   * @param {object} [extra] - `{ status, code, endpoint, retryAfter }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'VrmError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description The kind of an HTTP status.
 * @param {number} status - The status.
 * @returns {string} The kind.
 */
function kindOfStatus(status) {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'http';
}

/**
 * @description Read a token pasted by the user: "Token abc", "abc", with spaces.
 * @param {unknown} raw - The value.
 * @returns {string} The token alone ('' when empty).
 * @example
 * readToken(' Token abc123 '); // -> 'abc123'
 */
function readToken(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return (text.replace(/^(token|bearer)\s+/i, '').split(/\s+/)[0] ?? '').trim();
}

/**
 * @description The seconds of a Retry-After header (a number or an HTTP date).
 * @param {string|null} header - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Seconds, null when absent or unreadable.
 */
function retryAfterSeconds(header, now) {
  if (header === null || header === undefined || header === '') {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : null;
}

/**
 * @description The VRM client.
 * @param {object} options - Options.
 * @param {Function} options.getToken - `() => string`, the access token.
 * @param {string} options.userAgent - The User-Agent of every request.
 * @param {Function} [options.fetch] - The fetch implementation (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {number} [options.spacingMs] - Minimum time between two requests.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @returns {object} The client.
 */
function createVrmClient({
  getToken,
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  baseUrl = BASE_URL,
  spacingMs = SPACING_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let chain = Promise.resolve();
  let lastEnd = 0;
  let pausedUntil = 0;
  let requests = 0;
  let waiting = 0;

  /**
   * @description Send one request now.
   * @param {string} endpoint - The path, without the base.
   * @param {object} [params] - The query.
   * @returns {Promise<object>} The JSON body.
   */
  async function send(endpoint, params = {}) {
    const token = getToken();
    if (!token) {
      throw new VrmError('auth', 'No access token', { endpoint });
    }
    if (pausedUntil > now()) {
      throw new VrmError('rate_limit', 'VRM asked to wait (429)', {
        endpoint,
        retryAfter: Math.ceil((pausedUntil - now()) / 1000),
      });
    }
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.append(key, String(value));
    }
    const url = `${baseUrl}/${endpoint}${query.size ? `?${query}` : ''}`;
    requests += 1;
    let response;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: {
          'x-authorization': `Token ${token}`,
          accept: 'application/json',
          'user-agent': userAgent,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new VrmError('unreachable', `VRM unreachable: ${err.message}`, { endpoint });
    }
    const text = await response.text().catch(() => '');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const code = typeof body?.error_code === 'string' ? body.error_code.slice(0, 60) : null;
    if (!response.ok) {
      const kind = kindOfStatus(response.status);
      let retryAfter = null;
      if (kind === 'rate_limit') {
        retryAfter = retryAfterSeconds(response.headers.get('retry-after'), now());
        const pause = Math.min(Math.max((retryAfter ?? 0) * 1000, MIN_PAUSE_MS), MAX_PAUSE_MS);
        pausedUntil = Math.max(pausedUntil, now() + pause);
      }
      throw new VrmError(
        kind,
        `HTTP ${response.status} on ${endpoint.split('/')[0]}${code ? ` (${code})` : ''}`,
        { status: response.status, code, endpoint, retryAfter },
      );
    }
    if (!body || typeof body !== 'object') {
      throw new VrmError('failed', `Unexpected answer of ${endpoint.split('/')[0]}`, {
        endpoint,
      });
    }
    return body;
  }

  /**
   * @description Queue a request: one at a time, spaced.
   * @param {string} endpoint - The path.
   * @param {object} [params] - The query.
   * @returns {Promise<object>} The JSON body.
   */
  function get(endpoint, params) {
    waiting += 1;
    const run = chain.then(async () => {
      const wait = lastEnd + spacingMs - now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await send(endpoint, params);
      } finally {
        lastEnd = now();
        waiting -= 1;
      }
    });
    chain = run.catch(() => {});
    return run;
  }

  /**
   * @description A success answer, or an error for `success: false`.
   * @param {object} body - The body.
   * @param {string} endpoint - The path.
   * @returns {object} The body.
   */
  function ok(body, endpoint) {
    if (body.success === false) {
      const code = typeof body.error_code === 'string' ? body.error_code.slice(0, 60) : null;
      throw new VrmError(
        'failed',
        `VRM refused ${endpoint.split('/')[0]}${code ? ` (${code})` : ''}`,
        {
          code,
          endpoint,
        },
      );
    }
    return body;
  }

  const site = (idSite) => `installations/${encodeURIComponent(String(idSite))}`;

  return {
    /**
     * @description The user of the token.
     * @returns {Promise<object>} `{ success, user: { id, name, … } }`.
     */
    me: async () => ok(await get('users/me'), 'users/me'),
    /**
     * @description Every installation of a user, with their latest values.
     * @param {number} idUser - The user id.
     * @returns {Promise<object>} `{ success, records: [...] }`.
     */
    installations: async (idUser) => {
      const endpoint = `users/${encodeURIComponent(String(idUser))}/installations`;
      return ok(await get(endpoint, { extended: 1 }), endpoint);
    },
    /**
     * @description Statistics of an installation.
     * @param {number} idSite - The installation id.
     * @param {object} params - `{ type, interval, start, end }` (start / end in seconds).
     * @returns {Promise<object>} `{ success, records, totals }`.
     */
    stats: async (idSite, params) => {
      const endpoint = `${site(idSite)}/stats`;
      return ok(await get(endpoint, params), endpoint);
    },
    /**
     * @description The alarm log of an installation, active alarms first. "No
     * alarm log found" (`success: false`, `no_results_found`) is an empty log.
     * @param {number} idSite - The installation id.
     * @param {number} [count] - How many entries.
     * @returns {Promise<object>} `{ success, records: [...] }`.
     */
    alarmLog: async (idSite, count = 25) => {
      const endpoint = `${site(idSite)}/alarm-log`;
      let body;
      try {
        body = await get(endpoint, { count });
      } catch (err) {
        // The documented "no result" answer, should it come with an HTTP error.
        if (err.code === 'no_results_found') return { success: true, records: [] };
        throw err;
      }
      if (body.success === false && body.error_code === 'no_results_found') {
        return { success: true, records: [] };
      }
      return ok(body, endpoint);
    },
    /**
     * @description Until when VRM asked to wait (0: not paused).
     * @returns {number} The instant (ms).
     */
    pausedUntil: () => (pausedUntil > now() ? pausedUntil : 0),
    /**
     * @description How many requests were sent since the start.
     * @returns {number} The count.
     */
    requests: () => requests,
    /**
     * @description How many requests wait.
     * @returns {number} The count.
     */
    backlog: () => waiting,
  };
}

export {
  BASE_URL,
  SPACING_MS,
  MIN_PAUSE_MS,
  MAX_PAUSE_MS,
  ACCOUNT_KINDS,
  VrmError,
  kindOfStatus,
  readToken,
  retryAfterSeconds,
  createVrmClient,
};
