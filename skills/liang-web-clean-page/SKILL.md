---
name: liang-web-clean-page
description: 清洗本地化页面的业务代码，保证页面是一个干净的模版页面，只有dom相关的代码
arguments: \[page-dir]
---

帮我分析下 `${CLAUDE_ROOT}/templates/${page-dir}` 这个网页目录，我想把跟dom无关的js，link 代码都剔除掉，只保留一个干净的静态模版页面，其他的业务代码都剔除。

## 清理步骤

### 1. 分析标签用途

读取 `${CLAUDE_ROOT}/templates/${page-dir}/scripts.json`、`styles.json`、`links.json`，确定每个 uuid 对应的标签内容用途。

**标签用途分类：**

| 类型 | 处理方式 | 示例 |
|------|---------|------|
| 广告/追踪/分析 | 移除 | Google Analytics, Facebook Pixel, Hotjar, GTM |
| WP Rocket 延迟加载/预加载 | 移除 | RocketLazyLoadScripts, RocketElementorPreload, preload/dns-prefetch |
| 空标签 | 移除 | hasContent: false |
| **页面样式** | **保留** | 所有 css 文件 |
| **UI 交互脚本** | **保留** | sticky header、导航栏、手风琴、轮播等 |

**注意：不确定用途的 script 优先保留，不要因为它是 Elementor/WordPress 生成的就移除。**

### 2. 使用 clean-tags.js 精准移除

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/clone-web/src/clean-tags.js ${CLAUDE_ROOT}/templates/${page-dir}/page.html --remove-uuid=uuid1,uuid2,...
```

### 3. 验证

先用 npx 启动本地 Web 服务器，服务存在的话需要先关掉然后重新启动：

```bash
cd ${CLAUDE_ROOT}/templates/${page-dir}
npx http-server -p 8888
```

打开 `http://localhost:8888/page.html`，截图对比目标网页，检查：

* 是否有模块/字体图标/图片缺失
* UI 交互是否正常（滚动吸附、导航菜单等）
* 直到检测通过

验证完成后，需要关掉服务
