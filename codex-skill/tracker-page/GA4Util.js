(function (window) {
  // 1. 将原先写死的常量改为可变变量
  let MEASUREMENT_ID = null

  const SESSION_TTL = 4 * 60 * 1000
  const SESSION_REFRESH_AHEAD = 30 * 1000
  const GTAG_TIMEOUT = 500

  let clientId = null
  let sessionId = null
  let sessionFetchedAt = 0

  const inflight = {}

  let readyResolve
  const readyPromise = new Promise(r => { readyResolve = r })

  // 2. 新增：自动探测 GA4 Measurement ID 的核心函数
  function detectMeasurementId () {
    // 策略 A: 从 script 标签读取 (适用于标准的 gtag.js 部署)
    const scripts = document.querySelectorAll('script[src*="googletagmanager.com/gtag/js?id=G-"]')
    for (let i = 0; i < scripts.length; i++) {
      try {
        const url = new URL(scripts[i].src)
        const id = url.searchParams.get('id')
        if (id && id.startsWith('G-')) return id
      } catch (e) { /* ignore URL parse error */ }
    }

    // 策略 B: 从 dataLayer 中读取配置命令
    if (window.dataLayer && Array.isArray(window.dataLayer)) {
      for (let i = 0; i < window.dataLayer.length; i++) {
        const item = window.dataLayer[i]
        // 寻找 ['config', 'G-XXXXXXXX'] 的记录
        if (item[0] === 'config' && typeof item[1] === 'string' && item[1].startsWith('G-')) {
          return item[1]
        }
      }
    }

    // 策略 C: 终极兜底，从 Cookie 中反向推导 (极其稳定，适用于 GTM 部署)
    // 寻找 _ga_XXXXXX 格式的 Cookie，并拼上 G-
    const cookieMatch = document.cookie.match(/(?:^|;\s*)_ga_([A-Z0-9]+)=/i)
    if (cookieMatch && cookieMatch[1]) {
      return 'G-' + cookieMatch[1].toUpperCase()
    }

    return null // 如果真的没找到，返回 null
  }

  function gtagGet (field) {
    if (inflight[field]) return inflight[field]

    // 如果没有获取到 ID，直接返回 null 避免报错
    if (!MEASUREMENT_ID) return Promise.resolve(null)

    const p = Promise.race([
      new Promise(resolve => {
        try {
          gtag('get', MEASUREMENT_ID, field, value => {
            resolve(value ?? null)
          })
        } catch {
          resolve(null)
        }
      }),
      new Promise(resolve => setTimeout(() => resolve(null), GTAG_TIMEOUT))
    ]).finally(() => {
      delete inflight[field]
    })

    inflight[field] = p
    return p
  }

  async function ensureClientId () {
    if (clientId) return
    const val = await gtagGet('client_id')
    if (val) clientId = val
  }

  async function refreshSessionId (forceRefresh = false) {
    const age = Date.now() - sessionFetchedAt
    const isStale = age > SESSION_TTL

    if (!isStale && sessionId && !forceRefresh) {
      if (age > SESSION_TTL - SESSION_REFRESH_AHEAD) {
        gtagGet('session_id').then(val => {
          if (val) { sessionId = val; sessionFetchedAt = Date.now() }
        })
      }
      return
    }

    const val = await gtagGet('session_id')
    if (val) {
      sessionId = val
      sessionFetchedAt = Date.now()
    }
  }

  async function init () {
    // 3. 在初始化时，第一件事就是去抓取 ID
    MEASUREMENT_ID = detectMeasurementId()

    if (!MEASUREMENT_ID) {
      console.warn('[GA4 Tracker] Measurement ID 未找到，GA 参数获取功能将被跳过。')
      // 如果没找到，解除阻塞，让外部依赖的 getGAParamsAsync 不会死锁
      readyResolve()
      return
    }

    await Promise.all([
      ensureClientId(),
      refreshSessionId(true)
    ])
    readyResolve()

    setInterval(() => refreshSessionId(false), 30 * 1000)
  }

  window.getGAParams = function () {
    return {
      client_id: clientId,
      session_id: sessionId,
      measurement_id: MEASUREMENT_ID // 可选：把获取到的 ID 也暴露出去，方便排查
    }
  }

  window.getGAParamsAsync = async function () {
    await readyPromise
    refreshSessionId(false)
    return {
      client_id: clientId,
      session_id: sessionId,
      measurement_id: MEASUREMENT_ID
    }
  }

  window.gaReady = readyPromise

  if (document.readyState === 'complete') {
    init()
  } else {
    window.addEventListener('load', init)
  }
})(window)