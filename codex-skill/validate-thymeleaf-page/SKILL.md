---
name: validate-thymeleaf-page
description: 校验克隆或重构后的 Thymeleaf 落地页模板，检查 index.html 语法、Thymeleaf 表达式、真实 Thymeleaf 引擎渲染、lp_config.json 配置、tracker 占位、CTA 绑定、本地静态资源缺失等问题。适用于执行 refactor-page/tracker-page 之后，或交付 Thymeleaf 模板之前做最终验证。
---

# 校验 Thymeleaf 页面

## 执行流程

对页面目录运行内置校验脚本：

```bash
python C:\Users\W'S\.codex\skills\validate-thymeleaf-page\scripts\validate_thymeleaf_page.py <output-dir>
```

只要输出中出现 `错误:`，就视为阻塞问题。修复模板后重新运行，直到脚本退出码为 `0`。其中“真实 Thymeleaf 渲染校验”必须通过；静态页面能打开但渲染校验失败时，也不能交付。

## 校验内容

脚本会检查：

- `index.html` 是否存在，并且是否能按 UTF-8 正常读取。
- Thymeleaf 属性里的 `${...}` 表达式是否括号平衡，是否存在反斜杠转义引号等高风险写法。
- 使用 Thymeleaf 官方引擎真实渲染一次 `index.html`，用 mock 变量填充 `lp_config.json`、`ads`、`baseHref`、`gaHead`、`gaBody`，捕获模板解析和表达式执行错误。
- `lp_config.json` 是否存在、JSON 是否合法、key 是否重复、必填字段是否完整。
- `lp_config.json` 中每个配置项是否被模板正确引用：
  - `IMAGE` -> `th:src="${key}"`
  - `TEXT` -> `th:text="${key}"`
  - `NEXT_LINK` -> `th:href="${ads + 'key'}"`
- tracker 占位是否存在且只出现一次：
  - `<base th:href="${baseHref}">`
  - `<th:block th:utext="${gaHead}"></th:block>`
  - `<th:block th:utext="${gaBody}"></th:block>`
  - `/static/GA4Util.js`
  - `/static/ecommerce-ad-tracker.js`
- HTML 中引用的本地 `static/...` 和 `/static/...` 资源是否真实存在于页面目录。
- 使用 `th:href="${ads + '...'}"` 的 CTA 是否同时保留 `href="/ads"`；如果存在 `data-at-href`，是否也被改为 `/ads`。

## 可选浏览器验证

脚本通过后，如果还需要视觉确认，再启动本地静态服务并打开页面截图。使用 `python -m http.server` 时可以忽略 tracker 对 `/api/track` 的 POST 报错，因为静态服务器没有后端跟踪接口。

## 运行依赖

真实渲染校验需要本机有 Java 和 Maven。脚本会调用技能目录下的 `scripts/thymeleaf-render-check/pom.xml`，首次运行可能需要 Maven 下载 Thymeleaf 依赖。
