---
name: liang-web-clone-page
description: 给目标网页地址和本地dir名字，实现克隆到本地
arguments: target-url output-dir args
---

- 使用浏览器打开目标网站，确认下这个网站是否被人机验证拦截

- **如果未被拦截**：直接克隆（`${args}` 会原样一比一拼接到命令末尾，不得修改、过滤或遗漏任何参数）

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/clone-web/src/clone.js ${target-url} --output=${CLAUDE_ROOT}/templates/${output-dir} --ai ${args}
  ```

  **clone.js 支持的参数（用户可能传入）：**
  - `--live-dom` — 使用浏览器实际渲染后的 DOM（而非服务器端 HTML 源代码）
  - `-o, --open` — 打开可视化浏览器
  - `--output=<dir>` — 输出目录

- **如果被 Cloudflare 等人机验证拦截**：停止克隆，告知用户该网站无法直接克隆

- 等待网页克隆完成后，使用SKILL(liang-web-clean-page)进行本地页面清洗

```skill
SKILL(liang-web-clean-page) output-dir
```

- 页面清洗过后，需要浏览器打开本地页面截长图，和目标网页截长图进行对比。
  主要关注，是否有模块缺失，字体图标缺失，图片缺失，如果有的话，需要进行修复。
- 直到检测通过后才算任务完成
