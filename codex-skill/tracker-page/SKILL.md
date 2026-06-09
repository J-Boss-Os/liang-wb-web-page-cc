---
name: tracker-page
description: 为落地页添加跟踪脚本
arguments: output-dir
---

## 1. 准备和脚本

在 HTML 的 `</body>` 前添加一次，不要重复添加：

执行：在 HTML 的 `</head>` 前添加一次，不要重复添加：
```html
<base th:href="${baseHref}">
<th:block th:utext="${gaHead}"></th:block>
```

```html
<th:block th:utext="${gaBody}"></th:block>
<script type="text/javascript" src="/static/GA4Util.js"></script>
<script type="text/javascript" src="/static/ecommerce-ad-tracker.js"></script>
```