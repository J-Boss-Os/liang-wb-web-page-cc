---
name: liang-web-init
description: liang-wb-web-page-cc 插件初始化，查找浏览器内核路径并配置 Playwright 浏览器环境
arguments: [--force, 强制重新初始化，会覆盖已有配置]
user-invocable: true
---

# 功能概述

使用 `liang-wb-clone-page` 克隆网页之前，需要先执行此初始化技能。
此技能会完成：

1. 检查 `scripts/clone-web` 的 npm 依赖是否安装
2. 查找系统已安装的 Google Chrome 浏览器内核路径
3. 优先配置系统 Chrome 供 Playwright 使用
4. 若未找到 Chrome，询问用户是否自动安装 Playwright 内置 Chromium
5. 验证浏览器可用性并保存配置到 `${CLAUDE_ROOT}/.claude/cache/${CLAUDE_SESSION_ID}/browser-config.json`

# 执行步骤

## 1. 检查 npm 依赖

执行以下命令，确认 `scripts/clone-web` 目录的 node_modules 是否完整：

```bash
ls ${CLAUDE_PLUGIN_ROOT}/scripts/clone-web/node_modules/.package-lock.json 2>/dev/null && echo "DEP_OK" || echo "DEP_MISS"
```

如果输出 `DEP_MISS`，执行安装：

```bash
cd ${CLAUDE_PLUGIN_ROOT}/scripts/clone-web && npm install
```

## 2. 检查是否已有配置（--force 跳过此步）

读取现有配置（如果存在且未传 `--force` 参数）：

```bash
BROWSER_CONFIG="${CLAUDE_ROOT}/.claude/cache/${CLAUDE_SESSION_ID}/browser-config.json"
if [ -f "$BROWSER_CONFIG" ] && [ "${1}" != "--force" ]; then
  echo "CONFIG_EXISTS"
  cat "$BROWSER_CONFIG"
fi
```

如果已有配置且未传 `--force`，提示用户配置已存在，询问是否需要重新初始化。若不需要则结束。

## 3. 查找系统 Google Chrome

在 macOS 上查找 Google Chrome 浏览器：

```bash
# 检查常见安装位置
CHROME_PATH=""
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi
# 检查用户目录
if [ -z "$CHROME_PATH" ] && [ -x "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME_PATH="$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

if [ -n "$CHROME_PATH" ]; then
  echo "CHROME_FOUND:$CHROME_PATH"
else
  echo "CHROME_NOT_FOUND"
fi
```

## 4. 根据查找结果分路处理

### 情况 A：找到 Google Chrome

验证 Playwright 能否正常启动 Chrome 并获取浏览器版本：

```bash
cd ${CLAUDE_PLUGIN_ROOT}/scripts/clone-web && node -e "
(async () => {
  const { chromium } = require('playwright-core');
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const version = await browser.version();
    console.log('VERIFY_OK:' + version);
    await browser.close();
  } catch (err) {
    console.log('VERIFY_FAIL:' + err.message);
  }
})();
"
```

**如果验证通过**：告知用户找到的 Chrome 版本，并写入配置文件：

```bash
BROWSER_CONFIG="${CLAUDE_ROOT}/.claude/cache/${CLAUDE_SESSION_ID}/browser-config.json"
mkdir -p $(dirname "$BROWSER_CONFIG")
cat > "$BROWSER_CONFIG" << 'CONFIG_EOF'
{
  "browserSource": "system-chrome",
  "channel": "chrome",
  "initialized": true,
  "initializedAt": "REPLACE_DATE"
}
CONFIG_EOF
node -e "const fs=require('fs'); const p=process.env.BROWSER_CONFIG; const c=JSON.parse(fs.readFileSync(p,'utf-8')); c.initializedAt=new Date().toISOString(); fs.writeFileSync(p, JSON.stringify(c, null, 2));"
```

**如果验证失败**：Chrome 程序存在但 Playwright 无法驱动（如版本不兼容），此时跟用户说明情况并询问是否要卸载不兼容的 Chrome 或改用 Playwright 内置 Chromium。

### 情况 B：未找到 Google Chrome

告知用户系统未检测到 Google Chrome，询问用户是否希望自动安装 Playwright 内置的 Chromium 浏览器。

- **用户同意安装**：

  ```bash
  cd ${CLAUDE_PLUGIN_ROOT}/scripts/clone-web && npx playwright install chromium
  ```

  安装完成后验证：

  ```bash
  cd ${CLAUDE_PLUGIN_ROOT}/scripts/clone-web && node -e "
  (async () => {
    const { chromium } = require('playwright-core');
    try {
      const browser = await chromium.launch({ headless: true });
      const version = await browser.version();
      console.log('VERIFY_OK:' + version);
      await browser.close();
    } catch (err) {
      console.log('VERIFY_FAIL:' + err.message);
    }
  })();
  "
  ```

  验证通过后保存配置：

  ```bash
  BROWSER_CONFIG="${CLAUDE_ROOT}/.claude/cache/${CLAUDE_SESSION_ID}/browser-config.json"
  mkdir -p $(dirname "$BROWSER_CONFIG")
  node -e "const fs=require('fs'); const p=process.env.BROWSER_CONFIG; fs.writeFileSync(p, JSON.stringify({browserSource:'playwright-bundled',channel:null,initialized:true,initializedAt:new Date().toISOString()},null,2));"
  ```

- **用户拒绝安装**：告知用户后续使用克隆功能时需要确保本地已安装浏览器，否则克隆功能将不可用。

## 5. 输出初始化结果

读取最终配置并展示给用户：

```bash
BROWSER_CONFIG="${CLAUDE_ROOT}/.claude/cache/${CLAUDE_SESSION_ID}/browser-config.json"
echo "=== liang-wb-web-page-cc 初始化完成 ==="
cat "$BROWSER_CONFIG"
```

## 后续操作说明

- 初始化完成后，即可使用 `liang-wb-clone-page` 技能克隆网页
- 如需重新初始化，执行此技能时加上 `--force` 参数即可覆盖现有配置
