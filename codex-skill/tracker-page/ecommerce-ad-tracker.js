;(function (window, document) {
  "use strict";

  var VERSION = "20260522-auto";
  var DEFAULT_CONFIG = {
    endpoint: "",
    endpointPath: "/api/track",
    adId: "",
    pageId: "",
    productSelector: "[data-product-id], .js-product-card",
    productIdAttr: "data-product-id",
    scrollThresholds: [25, 50, 75, 90, 100],
    clickThrottleMs: 300,
    visitIdParamName: "visitid",
    visitIdParamNames: ["visitid", "visit_id"],
    clickIdParamNames: ["ttclid", "fbclid", "gclid", "tbclickid", "click_id"],
    collectFingerprint: true,
    respectPrivacySignals: true,
    debug: false
  };

  var config = {};
  var sessionId = getOrCreateSessionId();
  var pageViewId = createId("pv");
  var startTime = Date.now();
  var maxScrollPercent = 0;
  var reportedScrollMarks = {};
  var lastClickAt = 0;
  var lastVisibleAt = Date.now();
  var visitorInfo = null;
  var trackingIds = null;
  var initialized = false;

  function init(userConfig) {
    if (initialized) return;
    initialized = true;

    config = assign({}, DEFAULT_CONFIG, userConfig || {});
    config.endpoint = normalizeEndpoint(config.endpoint, config.endpointPath);
    logInfo("init", config.endpoint);
    visitorInfo = buildVisitorInfo();
    trackingIds = getUrlTrackingIds();

    track("page_enter", {
      referrer: document.referrer || "",
      url: location.href,
      title: document.title || ""
    });

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", throttle(onScroll, 200), { passive: true });
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onHistoryChange);
    window.addEventListener("hashchange", onHistoryChange);
  }

  function onLoad() {
    var nav = getNavigationTiming();

    track("page_load_complete", {
      load_ms: nav.loadMs,
      dom_ready_ms: nav.domReadyMs,
      url: location.href
    });
  }

  function onClick(event) {
    var now = Date.now();
    if (now - lastClickAt < config.clickThrottleMs) return;
    lastClickAt = now;

    var target = event.target;
    var productEl = closest(target, config.productSelector);
    var clickData = {
      x: event.clientX,
      y: event.clientY,
      page_x: event.pageX,
      page_y: event.pageY,
      element: getElementPath(target),
      text: safeText(target),
      href: getClosestHref(target)
    };

    if (productEl) {
      var products = toArray(document.querySelectorAll(config.productSelector));
      var index = products.indexOf(productEl);

      track("product_click", assign(clickData, {
        product_index: index >= 0 ? index + 1 : null,
        product_id: productEl.getAttribute(config.productIdAttr) || "",
        product_name: productEl.getAttribute("data-product-name") || safeText(productEl)
      }));
      return;
    }

    track("page_click", clickData);
  }

  function onScroll() {
    var percent = getScrollPercent();
    if (percent > maxScrollPercent) {
      maxScrollPercent = percent;
    }

    config.scrollThresholds.forEach(function (mark) {
      if (percent >= mark && !reportedScrollMarks[mark]) {
        reportedScrollMarks[mark] = true;
        track("scroll_percent", {
          percent: mark,
          max_percent: maxScrollPercent
        });
      }
    });
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      track("page_hidden", {
        stay_ms: Date.now() - startTime,
        max_scroll_percent: maxScrollPercent,
        current_url: location.href
      }, true);
      return;
    }

    lastVisibleAt = Date.now();
    track("page_visible", {
      hidden_return_url: location.href,
      referrer: document.referrer || ""
    });
  }

  function onPageShow(event) {
    track("page_return", {
      return_type: event.persisted ? "bfcache" : "normal",
      returned_to: location.href,
      hidden_ms: Date.now() - lastVisibleAt,
      referrer: document.referrer || ""
    });
  }

  function onPageHide() {
    track("page_leave", {
      leave_from: location.href,
      stay_ms: Date.now() - startTime,
      max_scroll_percent: maxScrollPercent
    }, true);
  }

  function onHistoryChange() {
    track("route_change", {
      returned_to: location.href,
      referrer: document.referrer || ""
    });
  }

  function track(eventName, payload, useBeacon) {
    var body = assign({
      event: eventName,
      ad_id: config.adId,
      page_id: config.pageId,
      visitid: trackingIds.visitid,
      clickid: trackingIds.clickid,
      clickid_source: trackingIds.clickidSource,
      session_id: sessionId,
      page_view_id: pageViewId,
      visitor_id: visitorInfo.visitorId,
      browser_fingerprint: visitorInfo.fingerprint,
      privacy_signal: visitorInfo.privacySignal,
      browser: visitorInfo.browser,
      os: visitorInfo.os,
      device: visitorInfo.device,
      language: visitorInfo.language,
      timezone: visitorInfo.timezone,
      screen_w: visitorInfo.screenW,
      screen_h: visitorInfo.screenH,
      color_depth: visitorInfo.colorDepth,
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent,
      viewport_w: window.innerWidth,
      viewport_h: window.innerHeight,
      url: location.href
    }, payload || {});

    if (config.debug) {
      console.log("[track]", body);
    }

    send(body, useBeacon);
  }

  function getUrlTrackingIds() {
    var visitid = getVisitId();
    var clickid = "";
    var clickidSource = "";

    config.clickIdParamNames.some(function (name) {
      var value = getSearchParam(name);
      if (!value) return false;

      clickid = value;
      clickidSource = name;
      return true;
    });

    return {
      visitid: visitid || "",
      clickid: clickid || "",
      clickidSource: clickidSource || ""
    };
  }

  function getVisitId() {
    var names = [];
    if (config.visitIdParamName) {
      names.push(config.visitIdParamName);
    }
    if (config.visitIdParamNames && config.visitIdParamNames.length) {
      config.visitIdParamNames.forEach(function (name) {
        if (names.indexOf(name) === -1) {
          names.push(name);
        }
      });
    }

    for (var i = 0; i < names.length; i += 1) {
      var value = getSearchParam(names[i]);
      if (value) return value;
    }
    return "";
  }

  function getSearchParam(name) {
    var targetName = String(name).toLowerCase();
    var query = window.location.search ? window.location.search.substring(1) : "";
    var pairs = query ? query.split("&") : [];

    for (var i = 0; i < pairs.length; i += 1) {
      var pair = pairs[i];
      if (!pair) continue;
      var eqIndex = pair.indexOf("=");
      var rawKey = eqIndex >= 0 ? pair.substring(0, eqIndex) : pair;
      var rawValue = eqIndex >= 0 ? pair.substring(eqIndex + 1) : "";
      var key = decodeQueryValue(rawKey);
      if (String(key).toLowerCase() === targetName) {
        return decodeQueryValue(rawValue);
      }
    }
    return "";
  }

  function decodeQueryValue(value) {
    try {
      return decodeURIComponent(String(value).replace(/\+/g, " "));
    } catch (err) {
      return value;
    }
  }

  function buildVisitorInfo() {
    var privacySignal = getPrivacySignal();
    var canCollectFingerprint = config.collectFingerprint &&
      !(config.respectPrivacySignals && privacySignal);
    var components = {
      ua: navigator.userAgent || "",
      platform: navigator.platform || "",
      vendor: navigator.vendor || "",
      language: navigator.language || "",
      languages: navigator.languages ? navigator.languages.join(",") : "",
      timezone: getTimezone(),
      screen: [screen.width, screen.height, screen.colorDepth, screen.pixelDepth].join("x"),
      viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio || 1].join("x"),
      touch: String(("ontouchstart" in window) || navigator.maxTouchPoints || 0),
      cookies: String(navigator.cookieEnabled),
      hardware: [navigator.hardwareConcurrency || "", navigator.deviceMemory || ""].join("|")
    };
    var fingerprint = canCollectFingerprint ? hashString(stableStringify(components)) : "";
    var visitorId = getOrCreateVisitorId(fingerprint);

    return {
      visitorId: visitorId,
      fingerprint: fingerprint,
      privacySignal: privacySignal || "",
      browser: getBrowserName(navigator.userAgent),
      os: getOSName(navigator.userAgent),
      device: getDeviceType(navigator.userAgent),
      language: navigator.language || "",
      timezone: components.timezone,
      screenW: screen.width || null,
      screenH: screen.height || null,
      colorDepth: screen.colorDepth || null
    };
  }

  function getOrCreateVisitorId(fingerprint) {
    var key = "__ecom_ad_vid";
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var id = fingerprint ? "v_" + fingerprint : createId("vid");
      localStorage.setItem(key, id);
      return id;
    } catch (err) {
      return fingerprint ? "v_" + fingerprint : createId("vid");
    }
  }

  function getPrivacySignal() {
    if (navigator.globalPrivacyControl) return "gpc";
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return "dnt";
    return "";
  }

  function getTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (err) {
      return "";
    }
  }

  function stableStringify(obj) {
    return Object.keys(obj).sort().map(function (key) {
      return key + "=" + String(obj[key]);
    }).join("&");
  }

  function hashString(input) {
    var hash = 2166136261;
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return ("0000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  function getBrowserName(ua) {
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/MSIE|Trident/.test(ua)) return "IE";
    return "Unknown";
  }

  function getOSName(ua) {
    if (/Windows NT/.test(ua)) return "Windows";
    if (/Android/.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/Linux/.test(ua)) return "Linux";
    return "Unknown";
  }

  function getDeviceType(ua) {
    if (/iPad|Tablet/.test(ua)) return "tablet";
    if (/Mobi|Android|iPhone|iPod/.test(ua)) return "mobile";
    return "desktop";
  }

  function send(data, useBeacon) {
    var json = JSON.stringify(data);
    logInfo("send", config.endpoint, data.event);

    if (useBeacon && navigator.sendBeacon) {
      var blob = new Blob([json], { type: "application/json" });
      if (navigator.sendBeacon(config.endpoint, blob)) {
        return;
      }
    }

    if (window.fetch) {
      fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
        keepalive: true,
        credentials: "include"
      }).catch(function () {
        sendByXhr(json);
      });
      return;
    }

    sendByXhr(json);
  }

  function sendByXhr(json) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", config.endpoint, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(json);
    } catch (err) {
      logError("send failed", err);
    }
  }

  function normalizeEndpoint(endpoint, endpointPath) {
    if (endpoint) {
      return toAbsoluteUrl(endpoint);
    }

    return toAbsoluteUrl(endpointPath || "/api/track");
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, getOrigin()).toString();
    } catch (err) {
      var link = document.createElement("a");
      link.href = url;
      return link.href;
    }
  }

  function getOrigin() {
    if (window.location.origin && window.location.origin !== "null") {
      return window.location.origin;
    }
    return window.location.protocol + "//" + window.location.host;
  }

  function getScrollPercent() {
    var doc = document.documentElement;
    var body = document.body;
    var scrollTop = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
    var scrollHeight = Math.max(
      body.scrollHeight,
      doc.scrollHeight,
      body.offsetHeight,
      doc.offsetHeight,
      body.clientHeight,
      doc.clientHeight
    );
    var viewport = window.innerHeight || doc.clientHeight;
    var distance = scrollHeight - viewport;

    if (distance <= 0) return 100;
    return Math.min(100, Math.round((scrollTop / distance) * 100));
  }

  function getNavigationTiming() {
    var nav = performance.getEntriesByType &&
      performance.getEntriesByType("navigation") &&
      performance.getEntriesByType("navigation")[0];

    if (nav) {
      return {
        loadMs: Math.round(nav.loadEventEnd),
        domReadyMs: Math.round(nav.domContentLoadedEventEnd)
      };
    }

    var timing = performance.timing || {};
    return {
      loadMs: timing.loadEventEnd ? timing.loadEventEnd - timing.navigationStart : null,
      domReadyMs: timing.domContentLoadedEventEnd ? timing.domContentLoadedEventEnd - timing.navigationStart : null
    };
  }

  function getOrCreateSessionId() {
    var key = "__ecom_ad_sid";
    try {
      var existing = sessionStorage.getItem(key);
      if (existing) return existing;
      var id = createId("sid");
      sessionStorage.setItem(key, id);
      return id;
    } catch (err) {
      return createId("sid");
    }
  }

  function createId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function closest(el, selector) {
    while (el && el !== document) {
      if (el.matches && el.matches(selector)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function getClosestHref(el) {
    var link = closest(el, "a[href]");
    return link ? link.href : "";
  }

  function getElementPath(el) {
    var path = [];
    while (el && el.nodeType === 1 && path.length < 5) {
      var name = el.nodeName.toLowerCase();
      if (el.id) name += "#" + el.id;
      if (el.className && typeof el.className === "string") {
        name += "." + el.className.trim().split(/\s+/).slice(0, 3).join(".");
      }
      path.unshift(name);
      el = el.parentNode;
    }
    return path.join(">");
  }

  function safeText(el) {
    if (!el || !el.textContent) return "";
    return el.textContent.replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function throttle(fn, wait) {
    var last = 0;
    var timer = null;

    return function () {
      var now = Date.now();
      var args = arguments;

      if (now - last >= wait) {
        last = now;
        fn.apply(null, args);
        return;
      }

      clearTimeout(timer);
      timer = setTimeout(function () {
        last = Date.now();
        fn.apply(null, args);
      }, wait - (now - last));
    };
  }

  function toArray(list) {
    return Array.prototype.slice.call(list);
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i += 1) {
      var source = arguments[i] || {};
      Object.keys(source).forEach(function (key) {
        target[key] = source[key];
      });
    }
    return target;
  }

  window.EcomAdTracker = {
    init: init,
    track: track,
    version: VERSION
  };

  window.__ECOM_AD_TRACKER_LOADED__ = VERSION;
  logInfo("loaded", VERSION);
  scheduleAutoInit();

  function scheduleAutoInit() {
    window.setTimeout(function () {
      if (initialized || window.__ECOM_AD_TRACKER_DISABLE_AUTO_INIT__) {
        return;
      }
      try {
        init();
      } catch (err) {
        initialized = false;
        logError("init failed", err);
      }
    }, 0);
  }

  function logError(message, err) {
    if (window.console && console.error) {
      console.error("[EcomAdTracker] " + message, err);
    }
  }

  function logInfo() {
    if (window.console && console.info) {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[EcomAdTracker]");
      console.info.apply(console, args);
    }
  }
})(window, document);
