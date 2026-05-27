const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const prettier = require('prettier');
const parse5 = require('parse5');
const crypto = require('crypto');

// 直接资源文件扩展名（这些 URL 走直接下载，不经过浏览器渲染）
const RESOURCE_EXTENSIONS = new Set([
  // 视频
  '.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.wmv',
  // 音频
  '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a',
  // 图片
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico',
  // 文档
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 字体
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // 压缩包
  '.wasm',
]);

// 所有资源文件扩展名（包括 JS/CSS/HTML/JSON 等页面资源）
// 用于区分资源 URL 和 API URL
const RESOURCE_FILE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.css', '.scss', '.less', '.sass',
  '.html', '.htm',
  '.json', '.xml',
  '.map',
  '.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.wmv',
  '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
  '.pdf',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.wasm',
]);

/**
 * 判断 URL 是否为资源文件（而非 API 端点）
 * 通过检查 URL pathname 是否有已知的文件扩展名
 */
function isResourceUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    // 去掉查询参数和 hash 后的路径
    const cleanPath = pathname.split('?')[0].split('#')[0];
    const dotIndex = cleanPath.lastIndexOf('.');
    if (dotIndex === -1) return false;
    const ext = cleanPath.slice(dotIndex).toLowerCase();
    // 排除无扩展名的路径
    if (ext === '.' || ext === '') return false;
    return RESOURCE_FILE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}
function isDirectResourceUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const dotIndex = pathname.lastIndexOf('.');
    if (dotIndex === -1) return false;
    const ext = pathname.slice(dotIndex).toLowerCase();
    if (ext === '.htm' || ext === '.html') return false;
    return RESOURCE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

/**
 * 直接下载资源文件（不经过浏览器渲染），适用于 MP4/PDF/图片等
 */
async function downloadDirectResource(url, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const urlObj = new URL(url);
  let filename = path.basename(urlObj.pathname.split('?')[0]);
  if (!filename || !filename.includes('.')) {
    filename = `download-${crypto.createHash('md5').update(url).digest('hex').substring(0, 8)}.bin`;
  }

  const outputPath = path.join(outputDir, filename);

  console.log(`\n[资源文件] 检测到直接资源文件: ${filename}`);
  console.log(`[资源文件] 下载中: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  const sizeKB = (buffer.length / 1024).toFixed(1);
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
  const sizeStr = buffer.length > 1048576 ? `${sizeMB} MB` : `${sizeKB} KB`;
  console.log(`[资源文件] 下载完成: ${outputPath} (${sizeStr}, ${contentType})`);

  // 写入资源信息文件
  const infoPath = path.join(outputDir, '_resource.json');
  fs.writeFileSync(infoPath, JSON.stringify({
    sourceUrl: url,
    filename,
    fileSize: buffer.length,
    contentType,
    downloadedAt: new Date().toISOString(),
  }, null, 2));

  return { filename, size: buffer.length, contentType };
}

// 生成 UUID
function generateUUID() {
  return crypto.randomUUID();
}

// 处理 HTML 中的 script、style、link 标签
function processHtmlTags(html, outputDir) {
  const cacheDir = path.join(outputDir, 'cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const ast = parse5.parse(html);
  const scriptRecords = [];
  const styleRecords = [];
  const linkRecords = [];

  // 遍历 AST 查找标签
  function traverse(node) {
    // 处理 script 标签
    if (node.nodeName === 'script') {
      const uuid = generateUUID();

      // 添加 uuid 属性
      if (!node.attrs) {
        node.attrs = [];
      }
      node.attrs.push({
        name: 'uuid',
        value: uuid,
      });

      // 获取 script src 属性（源 URL）
      const srcAttr = node.attrs.find((attr) => attr.name === 'src');
      const srcUrl = srcAttr ? srcAttr.value : null;

      // 获取 script 内容
      let content = '';
      if (node.childNodes && node.childNodes.length > 0) {
        content = node.childNodes
          .filter((child) => child.nodeName === '#text')
          .map((child) => child.value)
          .join('');
      }

      // 如果有内容，保存到 cache 目录
      if (content && content.trim()) {
        const scriptPath = path.join(cacheDir, `${uuid}.js`);
        fs.writeFileSync(scriptPath, content);

        scriptRecords.push({
          type: 'script',
          uuid,
          srcUrl,
          localPath: scriptPath,
          hasContent: true,
          hasSrc: !!srcAttr,
        });
      } else {
        scriptRecords.push({
          type: 'script',
          uuid,
          srcUrl,
          localPath: null,
          hasContent: false,
          hasSrc: !!srcAttr,
        });
      }
    }

    // 处理 style 标签
    if (node.nodeName === 'style') {
      const uuid = generateUUID();

      // 添加 uuid 属性
      if (!node.attrs) {
        node.attrs = [];
      }
      node.attrs.push({
        name: 'uuid',
        value: uuid,
      });

      // 获取 style 内容
      let content = '';
      if (node.childNodes && node.childNodes.length > 0) {
        content = node.childNodes
          .filter((child) => child.nodeName === '#text')
          .map((child) => child.value)
          .join('');
      }

      // 如果有内容，保存到 cache 目录
      if (content && content.trim()) {
        const stylePath = path.join(cacheDir, `${uuid}.css`);
        fs.writeFileSync(stylePath, content);

        styleRecords.push({
          type: 'style',
          uuid,
          localPath: stylePath,
          hasContent: true,
        });
      } else {
        styleRecords.push({
          type: 'style',
          uuid,
          localPath: null,
          hasContent: false,
        });
      }
    }

    // 处理 link 标签
    if (node.nodeName === 'link') {
      const uuid = generateUUID();

      // 添加 uuid 属性
      if (!node.attrs) {
        node.attrs = [];
      }
      node.attrs.push({
        name: 'uuid',
        value: uuid,
      });

      // 获取 link 属性信息
      const hrefAttr = node.attrs.find((attr) => attr.name === 'href');
      const relAttr = node.attrs.find((attr) => attr.name === 'rel');
      const typeAttr = node.attrs.find((attr) => attr.name === 'type');

      linkRecords.push({
        type: 'link',
        uuid,
        srcUrl: hrefAttr ? hrefAttr.value : null,
        rel: relAttr ? relAttr.value : null,
        linkType: typeAttr ? typeAttr.value : null,
      });
    }

    // 递归遍历子节点
    if (node.childNodes) {
      for (const child of node.childNodes) {
        traverse(child);
      }
    }

    // 遍历嵌套内容（如 template 标签）
    if (node.content) {
      traverse(node.content);
    }
  }

  traverse(ast);

  // 序列化回 HTML
  const processedHtml = parse5.serialize(ast);

  return { processedHtml, scriptRecords, styleRecords, linkRecords };
}

// 将 HTML 中的资源 URL 替换为本地路径
function localizeHtmlUrls(html, urlMapping, baseUrl) {
  const ast = parse5.parse(html);
  let replaceCount = 0;

  // 需要 URL 替换的属性列表
  const urlAttrs = ['href', 'src', 'data-src', 'data-srcset', 'poster', 'data-href', 'data-link', 'content'];

  // 解析 URL 并尝试匹配本地路径
  function resolveAndReplace(attrValue, baseUrl) {
    // 跳过空值、data:、blob:、javascript:、mailto:、# 等
    if (!attrValue ||
        attrValue.startsWith('data:') ||
        attrValue.startsWith('blob:') ||
        attrValue.startsWith('javascript:') ||
        attrValue.startsWith('mailto:') ||
        attrValue.startsWith('#') ||
        attrValue.startsWith('tel:')) {
      return attrValue;
    }

    // 尝试解析为完整 URL
    try {
      let fullUrl;
      if (attrValue.startsWith('//')) {
        fullUrl = baseUrl.protocol + attrValue;
      } else if (attrValue.startsWith('/')) {
        fullUrl = baseUrl.origin + attrValue;
      } else if (attrValue.startsWith('http://') || attrValue.startsWith('https://')) {
        fullUrl = attrValue;
      } else {
        // 相对路径
        fullUrl = new URL(attrValue, baseUrl.href).href;
      }

      // 清理 URL：通过 URL 构造函数正规化编码
      // Playwright 捕获的是百分号编码（如 %20），HTML 中是原始字符（如空格）
      // new URL() 会自动编码原始字符，使两者一致
      let normalizedUrl = fullUrl.split('#')[0];
      try {
        normalizedUrl = new URL(normalizedUrl).href.split('#')[0];
      } catch (e) {
        // 正规化失败，保持原始值
      }

      // 查找映射
      if (urlMapping[normalizedUrl]) {
        return urlMapping[normalizedUrl];
      }

      // 尝试带查询参数的各种变体
      for (const [originalUrl, localPath] of Object.entries(urlMapping)) {
        if (!isResourceUrl(originalUrl)) continue; // 跳过 API 条目
        if (originalUrl.startsWith(normalizedUrl)) {
          // 跳过以 = 或 & 结尾的匹配：这些是 JS 字符串拼接中的 URL 片段
          // 如 'https://gtm.js?id='+i+dl，如果替换为 'static/gtm.js'+i+dl 会导致路径错误
          if (normalizedUrl.endsWith('=') || normalizedUrl.endsWith('&')) {
            continue;
          }
          return localPath;
        }
      }

    } catch (e) {
      // URL 解析失败，保持原值
    }

    return attrValue;
  }

  // 处理 srcset 属性（多个 URL）
  function processSrcset(srcset, baseUrl) {
    if (!srcset) return srcset;

    const parts = srcset.split(',').map(part => {
      part = part.trim();
      const tokens = part.split(/\s+/);
      if (tokens.length >= 1) {
        const url = tokens[0];
        const descriptors = tokens.slice(1).join(' ');
        const newUrl = resolveAndReplace(url, baseUrl);
        if (newUrl !== url) {
          replaceCount++;
        }
        return newUrl + (descriptors ? ' ' + descriptors : '');
      }
      return part;
    });

    return parts.join(', ');
  }

  // 处理内联样式中的 url()
  function processInlineStyle(style, baseUrl) {
    if (!style) return style;

    return style.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi, (match, url) => {
      const newUrl = resolveAndReplace(url, baseUrl);
      if (newUrl !== url) {
        replaceCount++;
      }
      return `url('${newUrl}')`;
    });
  }

  // 遍历 AST 替换属性
  function traverseAndReplace(node) {
    if (node.attrs) {
      for (const attr of node.attrs) {
        // 处理普通 URL 属性
        if (urlAttrs.includes(attr.name)) {
          const newValue = resolveAndReplace(attr.value, baseUrl);
          if (newValue !== attr.value) {
            attr.value = newValue;
            replaceCount++;
          }
        }

        // 处理 srcset
        if (attr.name === 'srcset' || attr.name === 'data-srcset' || attr.name === 'imagesrcset') {
          const newValue = processSrcset(attr.value, baseUrl);
          if (newValue !== attr.value) {
            attr.value = newValue;
          }
        }

        // 处理内联样式
        if (attr.name === 'style') {
          const newValue = processInlineStyle(attr.value, baseUrl);
          if (newValue !== attr.value) {
            attr.value = newValue;
          }
        }
      }
    }

    // 处理 <style> 标签内容中的 url()（如 @font-face 的 src）
    if (node.nodeName === 'style' && node.childNodes) {
      for (const child of node.childNodes) {
        if (child.nodeName === '#text' && child.value) {
          const newValue = child.value.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi, (match, url) => {
            const newUrl = resolveAndReplace(url, baseUrl);
            if (newUrl !== url) {
              replaceCount++;
              return `url('${newUrl}')`;
            }
            return match;
          });
          if (newValue !== child.value) {
            child.value = newValue;
          }
        }
      }
    }

    // 处理 <script> 标签内容中的 URL（如 import()、fetch() 中的完整 URL）
    if (node.nodeName === 'script' && node.childNodes) {
      // 检查是否是 module 脚本（用于 bare specifier 修复）
      const isModuleScript = node.attrs && node.attrs.some(a => a.name === 'type' && a.value === 'module');

      for (const child of node.childNodes) {
        if (child.nodeName === '#text' && child.value) {
          let newValue = child.value.replace(/(["'`])(https?:\/\/[^"'`\s]+)(["'`])/g, (match, openQuote, url, closeQuote) => {
            const newUrl = resolveAndReplace(url, baseUrl);
            if (newUrl !== url) {
              replaceCount++;
              return openQuote + newUrl + closeQuote;
            }
            return match;
          });

          // 修复 ES Module bare specifier：import('static/xxx') → import('./static/xxx')
          if (isModuleScript) {
            const beforeFix = newValue;
            newValue = newValue.replace(
              /(import\s*\(\s*["'`])(?!\.\/|\/\/|https?:\/\/)([^"'`\s]+)(["'`]\s*\))/g,
              (match, prefix, path, suffix) => {
                return prefix + './' + path + suffix;
              }
            );
            if (newValue !== beforeFix) {
              replaceCount++;
            }
          }

          if (newValue !== child.value) {
            child.value = newValue;
          }
        }
      }
    }

    // 递归遍历子节点
    if (node.childNodes) {
      for (const child of node.childNodes) {
        traverseAndReplace(child);
      }
    }

    // 遍历嵌套内容
    if (node.content) {
      traverseAndReplace(node.content);
    }
  }

  traverseAndReplace(ast);

  // 修复 data-src：有些 JS 脚本（如 IntersectionObserver 懒加载）在运行时
  // 把 data-src 复制到 src 后删除 data-src。克隆后本地打开时 JS 再运行，
  // 发现 data-src 不存在会导致 src 被设为 "undefined"。
  // 这里给所有有 src 但无 data-src 的 <source> 补上 data-src=src。
  function fixDataSrc(node) {
    if (node.nodeName === 'source' && node.attrs) {
      const hasSrc = node.attrs.some(a => a.name === 'src');
      const hasDataSrc = node.attrs.some(a => a.name === 'data-src');
      if (hasSrc && !hasDataSrc) {
        const srcAttr = node.attrs.find(a => a.name === 'src');
        node.attrs.push({ name: 'data-src', value: srcAttr.value });
      }
    }
    if (node.childNodes) {
      for (const child of node.childNodes) {
        fixDataSrc(child);
      }
    }
    if (node.content) {
      fixDataSrc(node.content);
    }
  }
  fixDataSrc(ast);

  // 序列化回 HTML
  const localizedHtml = parse5.serialize(ast);

  return { localizedHtml, replaceCount };
}

// 替换 CSS 文件中的 url()
// cssOriginalUrl: CSS 文件的原始 URL，用于解析相对路径
function localizeCssUrls(cssContent, urlMapping, baseUrl, cssFilePath, cssOriginalUrl) {
  const newUrlsFound = [];

  // 创建 CSS 文件的 URL 对象，用于解析相对路径
  // 需要去掉文件名部分，只保留目录路径
  let cssBaseUrl;
  if (cssOriginalUrl) {
    const cssUrl = new URL(cssOriginalUrl);
    // 获取目录路径（去掉文件名）
    const pathParts = cssUrl.pathname.split('/');
    pathParts.pop(); // 去掉文件名
    cssUrl.pathname = pathParts.join('/') + '/';
    cssBaseUrl = cssUrl;
  } else {
    cssBaseUrl = baseUrl;
  }

  const result = cssContent.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi, (match, url) => {
    // 跳过 data: 和 blob:
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return match;
    }

    try {
      // 解析 URL（相对于 CSS 文件的位置）
      let fullUrl;
      if (url.startsWith('//')) {
        fullUrl = cssBaseUrl.protocol + url;
      } else if (url.startsWith('/')) {
        fullUrl = cssBaseUrl.origin + url;
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        fullUrl = url;
      } else {
        // 相对路径，相对于 CSS 文件的原始位置
        fullUrl = new URL(url, cssBaseUrl.href).href;
      }

      // 去掉 hash
      const normalizedUrl = fullUrl.split('#')[0];

      // 查找映射
      let localPath = urlMapping[normalizedUrl];

      // 尝试变体匹配（去掉查询参数等）
      if (!localPath) {
        const cleanNormalizedUrl = normalizedUrl.split('?')[0];
        for (const [originalUrl, mappedPath] of Object.entries(urlMapping)) {
          if (!isResourceUrl(originalUrl)) continue; // 跳过 API 条目
          const cleanOriginalUrl = originalUrl.split('?')[0];
          if (cleanOriginalUrl === cleanNormalizedUrl ||
              cleanOriginalUrl.startsWith(cleanNormalizedUrl) ||
              cleanNormalizedUrl.startsWith(cleanOriginalUrl)) {
            localPath = mappedPath;
            break;
          }
        }
      }

      if (localPath) {
        // 计算从 CSS 文件到本地资源的相对路径
        const cssDir = path.dirname(cssFilePath);
        const relativePath = path.relative(cssDir, localPath);
        return `url('${relativePath}')`;
      } else {
        // 记录需要下载的 URL（排除已下载但映射表中没找到的）
        if (isResourceUrl(normalizedUrl)) {
          newUrlsFound.push({
            srcUrl: normalizedUrl,
            cssFile: cssFilePath,
            cssOriginalUrl: cssOriginalUrl,
          });
        }
      }

    } catch (e) {
      // URL 解析失败
    }

    return match;
  });

  return { cssContent: result, newUrlsFound };
}

// 替换 JS 文件中的 URL（简单处理字符串中的 URL）
// jsOriginalUrl: JS 文件的原始 URL，用于解析相对路径
function localizeJsUrls(jsContent, urlMapping, baseUrl, jsOriginalUrl) {
  const newUrlsFound = [];

  // 创建 JS 文件的 URL 对象，用于解析相对路径
  // 需要去掉文件名部分，只保留目录路径
  let jsBaseUrl;
  if (jsOriginalUrl) {
    const jsUrl = new URL(jsOriginalUrl);
    // 获取目录路径（去掉文件名）
    const pathParts = jsUrl.pathname.split('/');
    pathParts.pop(); // 去掉文件名
    jsUrl.pathname = pathParts.join('/') + '/';
    jsBaseUrl = jsUrl;
  } else {
    jsBaseUrl = baseUrl;
  }

  // 匹配 JS 中真正的 URL 字符串
  // 只匹配 http:// 或 https:// 开头的 URL，或明确的资源路径（有扩展名）
  const urlPattern = /(?:["'`])(https?:\/\/[^"'`\s]+)(?:["'`])/g;

  let result = jsContent.replace(urlPattern, (match, url) => {
    // 跳过太短的 URL
    if (url.length < 10) {
      return match;
    }

    try {
      // 去掉 hash 和查询参数进行匹配
      const cleanUrl = url.split('#')[0].split('?')[0] || url;

      // 查找映射
      let localPath = null;
      for (const [originalUrl, mappedPath] of Object.entries(urlMapping)) {
        if (!isResourceUrl(originalUrl)) continue; // 跳过 API 条目
        const cleanOriginalUrl = originalUrl.split('#')[0].split('?')[0];
        if (cleanOriginalUrl === cleanUrl || cleanOriginalUrl.startsWith(cleanUrl) || cleanUrl.startsWith(cleanOriginalUrl)) {
          localPath = mappedPath;
          break;
        }
      }

      if (localPath) {
        // 保持原有的引号类型
        const quote = match[0];
        return quote + localPath + quote;
      } else {
        // 记录需要下载的 URL（只记录看起来像资源的 URL）
        if (isResourceUrl(url)) {
          newUrlsFound.push({
            srcUrl: url,
            jsFile: jsOriginalUrl,
          });
        }
      }

    } catch (e) {
      // URL 解析失败，保持原值
    }

    return match;
  });

  // 处理相对路径引用（如 fetch("components/navbar/navbar.html"）、import("./chunk.js")）
  // 优先尝试 resolved URL 精确匹配，再降级到 endsWith 后缀匹配
  try {
    result = result.replace(/(["'`])((?:\.?\/)?[^"'`\s]+\.(?:html?|css|js|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|mp4|webm|json))\1/g, (match, quote, path) => {
      // 跳过已经是绝对 URL 的
      if (/^https?:\/\//i.test(path)) return match;

      const cleanPath = path.split('?')[0].split('#')[0];
      let localPath = null;
      let resolvedUrl = null;

      // 尝试用 jsBaseUrl 解析（处理 import("./chunk.js") 这种 bundler 相对路径）
      if (!localPath && jsBaseUrl) {
        try {
          resolvedUrl = new URL(cleanPath.replace(/^\.\//, ''), jsBaseUrl).href.split('?')[0].split('#')[0];
          localPath = urlMapping[resolvedUrl] || null;
        } catch (e) {}
      }

      // 尝试用页面 baseUrl 解析（处理 fetch("components/navbar/navbar.html")）
      if (!localPath && baseUrl) {
        try {
          resolvedUrl = new URL(cleanPath.replace(/^\.\//, ''), baseUrl).href.split('?')[0].split('#')[0];
          localPath = urlMapping[resolvedUrl] || null;
        } catch (e) {}
      }

      // 降级：检查 urlMapping 中是否有原始 URL 以该路径结尾（处理根相对路径 /assets/file.js）
      if (!localPath) {
        for (const [origUrl, mappedPath] of Object.entries(urlMapping)) {
          if (origUrl.endsWith(cleanPath) && mappedPath) {
            localPath = mappedPath;
            break;
          }
        }
      }

      if (localPath) {
        return quote + localPath + quote;
      }

      // 如果解析出绝对 URL 且是资源类型但尚未下载，加入待下载队列
      if (resolvedUrl && isResourceUrl(resolvedUrl)) {
        newUrlsFound.push({
          srcUrl: resolvedUrl,
          jsFile: jsOriginalUrl,
        });
      }

      return match;
    });
  } catch (e) {
    // 相对路径替换失败，保持原值
  }

  // 修复 ES Module bare specifier：import("static/xxx") → import("./static/xxx")
  // 这些不会匹配 URL 映射，需要手动添加 ./ 前缀
  // 处理动态 import() 调用
  result = result.replace(
    /(import\s*\(\s*["'`])(?!\.\/|\/\/|https?:\/\/)([^"'`\s]+?\.(?:js|css|ts|mjs|json))(["'`]\s*\))/g,
    '$1./$2$3'
  );
  // 处理静态 import ... from 声明
  result = result.replace(
    /(import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'`])(?!\.\/|\/\/|https?:\/\/)([^"'`\s]+)(["'`])/g,
    '$1./$2$3'
  );

  return { jsContent: result, newUrlsFound };
}

// 处理 static 目录下的所有 CSS 和 JS 文件
// 返回新发现的 URL（需要额外下载的资源）
async function processStaticFiles(staticDir, urlMapping, baseUrl) {
  let cssReplaceCount = 0;
  let jsReplaceCount = 0;
  let htmlReplaceCount = 0;
  const allNewUrls = [];

  // 创建反向映射：localPath -> srcUrl
  const localToSrcMap = {};
  for (const [srcUrl, localPath] of Object.entries(urlMapping)) {
    localToSrcMap[localPath] = srcUrl;
  }

  function processDirectory(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        processDirectory(filePath);
      } else {
        const ext = path.extname(file).toLowerCase();
        const relativePath = path.relative(staticDir, filePath);
        const staticRelativePath = `static/${relativePath}`;

        // 获取该文件的原始 URL
        const originalUrl = localToSrcMap[staticRelativePath] || null;

        if (ext === '.css') {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const { cssContent: newContent, newUrlsFound } = localizeCssUrls(content, urlMapping, baseUrl, staticRelativePath, originalUrl);

            if (newContent !== content) {
              fs.writeFileSync(filePath, newContent);
              cssReplaceCount++;
            }

            // 收集新发现的 URL
            if (newUrlsFound.length > 0) {
              allNewUrls.push(...newUrlsFound);
            }
          } catch (e) {
            // 文件读取失败
          }
        } else if (ext === '.js') {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const { jsContent: newContent, newUrlsFound } = localizeJsUrls(content, urlMapping, baseUrl, originalUrl);

            let finalContent = newContent;

            if (finalContent !== content) {
              fs.writeFileSync(filePath, finalContent);
              jsReplaceCount++;
            }

            // 处理 SDK loader 脚本中的运行时 URL 构造模式
            // 如 ${PROD_HOST}/campaign-cart.css、PROD_HOST + PROD_ENTRY_PATH 等
            // 这些在运行时动态拼接 URL，localizeJsUrls 无法处理模板表达式
            // 注意：这部分不受 finalContent !== content 限制，即使 localizeJsUrls
            // 没有改动，也需要执行以修复 loader 脚本中的运行时路径
              // 替换 ${PROD_HOST}/path 模式（模板字符串）
              finalContent = finalContent.replace(
                /(["'`])\$\{PROD_HOST\}\/([^"'`\s]+?\.(?:css|js))(["'`])/g,
                (match, open, path, close) => {
                  for (const [origUrl, localPath] of Object.entries(urlMapping)) {
                    if (origUrl.endsWith('/' + path)) {
                      return open + localPath + close;
                    }
                  }
                  return match;
                }
              );

              // 修复 PROD_ENTRY_PATH 添加 ./ 前缀（避免 bare specifier）
              finalContent = finalContent.replace(
                /(const\s+PROD_ENTRY_PATH\s*=\s*['"`])\.?\/(static\/)/g,
                '$1./$2'
              );
              finalContent = finalContent.replace(
                /(const\s+PROD_ENTRY_PATH\s*=\s*['"`])(static\/)/g,
                '$1./$2'
              );

              // 修复 PROD_HOST + PROD_ENTRY_PATH 拼接 → 直接用 PROD_ENTRY_PATH
              // 因为 PROD_ENTRY_PATH 已替换为完整本地路径
              finalContent = finalContent.replace(
                /PROD_HOST\s*\+\s*PROD_ENTRY_PATH/g,
                'PROD_ENTRY_PATH'
              );

              // 修复 Hotjar 脚本中缺少 _hjSettings 声明导致的 ReferenceError
              // 注意：只排除 var _hjSettings，不排除 window._hjSettings
              // 因为 window._hjSettings 引用不会导致 ReferenceError，
              // 但裸 _hjSettings（在 IIFE 中）会触发 ReferenceError
              if (/\b_hjSettings\b/.test(finalContent) && !/var\s+_hjSettings\b/.test(finalContent)) {
                finalContent = 'var _hjSettings = window._hjSettings || {};\n' + finalContent;
              }

              if (finalContent !== newContent) {
                fs.writeFileSync(filePath, finalContent);
              }

            // 收集新发现的 URL
            if (newUrlsFound && newUrlsFound.length > 0) {
              allNewUrls.push(...newUrlsFound);
            }
          } catch (e) {
            // 文件读取失败
          }
        } else if (ext === '.html' || ext === '.htm') {
          // 处理异步加载的 HTML 片段（如 fetch("navbar.html")）
          // 这些文件中的 src/href 还是原始 URL，需要替换为本地路径
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const { localizedHtml, replaceCount } = localizeHtmlUrls(content, urlMapping, baseUrl);

            if (localizedHtml !== content) {
              fs.writeFileSync(filePath, localizedHtml);
              htmlReplaceCount++;
            }
          } catch (e) {
            // 文件读取失败
          }
        }
      }
    }
  }

  processDirectory(staticDir);

  // 如果发现新 URL，尝试下载并再次处理
  if (allNewUrls.length > 0) {
    console.log(`发现 ${allNewUrls.length} 个 CSS/JS 中引用但未下载的资源，尝试下载...`);

    // 去重
    const uniqueUrls = [...new Set(allNewUrls.map(u => u.srcUrl))];
    const newRecords = [];

    for (const url of uniqueUrls) {
      // 确保 URL 是绝对路径，防止相对路径传入 downloadFile
      let absUrl = url;
      try {
        new URL(absUrl);
      } catch {
        try {
          absUrl = new URL(absUrl, baseUrl.href).href;
        } catch {
          console.log(`  跳过无法解析的 URL: ${url}`);
          continue;
        }
      }
      const result = await downloadFile(absUrl, staticDir);
      if (result) {
        newRecords.push(result);
        urlMapping[result.srcUrl] = result.localPath;
        localToSrcMap[result.localPath] = result.srcUrl;
      }
    }

    // 再次处理 CSS/JS 文件（使用更新后的 urlMapping）
    if (newRecords.length > 0) {
      console.log(`下载了 ${newRecords.length} 个新资源，重新处理 CSS/JS 文件...`);
      processDirectory(staticDir);
    }
  }

  return { cssReplaceCount, jsReplaceCount, htmlReplaceCount, newUrlsFound: allNewUrls };
}

/**
 * 用 Node fetch 下载单个资源文件
 * 用于 processStaticFiles 中发现的 CSS/JS 内嵌 URL 的下载
 */
async function downloadFile(url, staticDir) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`  下载失败: ${url} - HTTP ${response.status}`);
      return null;
    }

    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    let originalFileName = pathParts[pathParts.length - 1] || 'file';
    const originalExt = path.extname(originalFileName);
    let baseFileName = originalFileName.replace(originalExt, '');
    if (!baseFileName || baseFileName === '') baseFileName = 'file';
    try { baseFileName = decodeURIComponent(baseFileName); } catch (e) {}
    baseFileName = baseFileName.replace(/[<>:"|*?\/\\%]/g, '_').replace(/\.\./g, '_').substring(0, 50);

    const contentType = response.headers.get('content-type') || '';
    const cleanContentType = contentType.split(';')[0].trim().toLowerCase();
    const contentTypeToExt = {
      'text/css': '.css', 'text/html': '.html',
      'application/javascript': '.js', 'text/javascript': '.js', 'application/x-javascript': '.js',
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
      'image/svg+xml': '.svg', 'image/x-icon': '.ico',
      'font/woff': '.woff', 'font/woff2': '.woff2', 'application/font-woff': '.woff', 'application/font-woff2': '.woff2',
      'video/mp4': '.mp4', 'video/webm': '.webm',
      'audio/mpeg': '.mp3',
      'application/pdf': '.pdf', 'application/json': '.json',
    };
    let ext = contentTypeToExt[cleanContentType] || '';
    if (originalExt && originalExt.length <= 6) ext = originalExt;
    if (!ext) ext = '.bin';

    const uuid = generateUUID();
    const finalFileName = `${baseFileName}-${uuid}${ext}`;
    const fullPath = path.join(staticDir, finalFileName);
    const relativePath = `static/${finalFileName}`;
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(fullPath, buffer);
    console.log(`  [下载] ${relativePath}`);
    return { srcUrl: url, localPath: relativePath };
  } catch (err) {
    console.log(`  下载失败: ${url} - ${err.message}`);
    return null;
  }
}

/**
 * 打开并克隆网页
 * @param {string} url - 目标网址
 * @param {object} options - 配置选项
 * @param {string} options.outputDir - 输出目录
 * @param {boolean} options.open - 是否打开可视化浏览器
 */
async function clonePage(url, options = {}) {
  const { outputDir = './output', open = false, liveDom = false, ai = false } = options;

  // 解析目标域名
  // 确保 baseUrl.href 以 / 结尾，否则相对路径解析会出错
  // 例如：https://example.com/path 解析 assets/styles.css 会变成 https://example.com/assets/styles.css（错误）
  // 而 https://example.com/path/ 解析 assets/styles.css 会变成 https://example.com/path/assets/styles.css（正确）
  let baseUrl = new URL(url);
  if (!baseUrl.href.endsWith('/')) {
    baseUrl = new URL(baseUrl.href + '/');
  }
  const baseDomain = baseUrl.hostname;

  const browser = await chromium.launch({
    headless: !open,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ],
  });

  const context = await browser.newContext({
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // 用于多视口滚动的响应式视口列表
  const RESPONSIVE_VIEWPORTS = [
    { width: 1920, height: 1080, label: 'Desktop (1920×1080)' },
    { width: 768, height: 1024, label: 'Tablet (768×1024)' },
    { width: 375, height: 667, label: 'Mobile (375×667)' },
  ];

  // 隐藏自动化特征，防止 Cloudflare 检测
  await page.addInitScript(() => {
    // 删除 navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // 删除 window.chrome.runtime
    window.chrome = {};
    // 删除 navigator.plugins 长度
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // 删除 navigator.languages 特殊值
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    // 删除 permissions 查询结果
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  // 创建输出目录和 static 目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const staticDir = path.join(outputDir, 'static');
  if (!fs.existsSync(staticDir)) {
    fs.mkdirSync(staticDir, { recursive: true });
  }

  // 数据容器：浏览器下载资源时直接保存到本地
  const urlMapping = {};
  let initialHtml = null; // 初始服务端 HTML（未被 JS 污染）
  const responseDetails = [];
  const failedRecords = [];
  const savedUrls = new Set();
  const responseSavePromises = [];

  // 监听响应，在浏览器下载资源时直接保存到 static 目录
  // 浏览器处理所有网络逻辑（重定向、cookie、CORS、认证），脚本只需保存 body
  page.on('response', (response) => {
    const request = response.request();
    const reqUrl = request.url();
    const method = request.method();
    const resourceType = request.resourceType();

    // 只处理 GET 请求
    if (method !== 'GET') return;

    // 跳过 blob、data、favicon
    if (reqUrl.startsWith('blob:') || reqUrl.startsWith('data:') || reqUrl.includes('favicon.ico')) return;

    // 跳过主页面请求
    const normalizedReqUrl = reqUrl.replace(/\/$/, '').replace(/^http:/, 'https:');
    const normalizedMainUrl = url.replace(/\/$/, '').replace(/^http:/, 'https:');
    if (normalizedReqUrl === normalizedMainUrl) return;

    // document 类型：捕获初始源代码，不保存为文件
    if (resourceType === 'document') {
      if (!initialHtml) {
        const htmlPromise = response.text()
          .then(text => { initialHtml = text; })
          .catch(e => console.log('获取初始 HTML 失败: ' + e.message));
        responseSavePromises.push(htmlPromise);
      }
      return;
    }

    // 回溯 redirect 链找到原始 URL（与 HTML src 属性值一致）
    let originalRequest = request;
    while (originalRequest.redirectedFrom()) {
      originalRequest = originalRequest.redirectedFrom();
    }
    const originalUrl = originalRequest.url();

    // 跳过 API 端点（URL 路径没有文件扩展名的非资源请求）
    // 避免 API 调用被误当成静态资源下载并加入 urlMapping
    // 必须在 originalUrl 声明之后，因为要用原始 URL（重定向前）来判断
    if (!isResourceUrl(originalUrl)) {
      return;
    }

    // 去重（基于原始 URL）
    if (savedUrls.has(originalUrl)) return;
    savedUrls.add(originalUrl);

    // 跳过失败响应
    if (!response.ok()) {
      failedRecords.push({ url: originalUrl, error: `HTTP ${response.status()}`, resourceType });
      return;
    }

    // 异步保存响应体到 static 目录
    const savePromise = (async () => {
      // 文件名计算（在 try 外部，catch 中回退时也需要访问）
      const urlObj = new URL(originalUrl);
      const pathParts = urlObj.pathname.split('/');
      let originalFileName = pathParts[pathParts.length - 1] || 'file';
      const originalExt = path.extname(originalFileName);
      let baseFileName = originalFileName.replace(originalExt, '');
      if (!baseFileName || baseFileName === '') baseFileName = 'file';
      try { baseFileName = decodeURIComponent(baseFileName); } catch (e) {}
      baseFileName = baseFileName.replace(/[<>:"|*?\/\\%]/g, '_').replace(/\.\./g, '_').substring(0, 50);

      const contentType = response.headers()['content-type'] || '';
      const cleanContentType = contentType.split(';')[0].trim().toLowerCase();
      const contentTypeToExt = {
        'text/css': '.css', 'text/html': '.html',
        'application/javascript': '.js', 'text/javascript': '.js', 'application/x-javascript': '.js',
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
        'image/svg+xml': '.svg', 'image/x-icon': '.ico',
        'font/woff': '.woff', 'font/woff2': '.woff2', 'application/font-woff': '.woff', 'application/font-woff2': '.woff2',
        'video/mp4': '.mp4', 'video/webm': '.webm',
        'audio/mpeg': '.mp3',
        'application/pdf': '.pdf', 'application/json': '.json',
      };
      let ext = contentTypeToExt[cleanContentType] || '';
      if (originalExt && originalExt.length <= 6) ext = originalExt;
      if (!ext) ext = '.bin';

      const uuid = generateUUID();
      const finalFileName = `${baseFileName}-${uuid}${ext}`;
      const fullPath = path.join(staticDir, finalFileName);
      const relativePath = `static/${finalFileName}`;

      try {
        const body = await response.body();
        fs.writeFileSync(fullPath, body);
        urlMapping[originalUrl] = relativePath;
        responseDetails.push({ srcUrl: originalUrl, localPath: relativePath, resourceType, contentType: cleanContentType, size: body.length });
        console.log(`[资源] ${relativePath}`);
      } catch (err) {
        // response.body() 对流式媒体（mp4 等）可能失败，回退到 Node fetch
        try {
          const fetchResp = await fetch(originalUrl);
          if (fetchResp.ok) {
            const buffer = Buffer.from(await fetchResp.arrayBuffer());
            fs.writeFileSync(fullPath, buffer);
            urlMapping[originalUrl] = relativePath;
            responseDetails.push({ srcUrl: originalUrl, localPath: relativePath, resourceType, contentType: cleanContentType, size: buffer.length });
            console.log(`[资源] ${relativePath} (Node fetch 回退)`);
            return;
          }
        } catch (fetchErr) {
          // Node fetch 也失败
        }
        failedRecords.push({ url: originalUrl, error: `保存失败: ${err.message}`, resourceType });
      }
    })();

    responseSavePromises.push(savePromise);
  });

  // 缓慢滚动页面以触发异步加载
  async function slowScrollToBottom(page) {
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const scrollSteps = Math.ceil(scrollHeight / viewportHeight);
    const scrollDelay = 500; // 每步滚动间隔 500ms

    console.log(`页面高度: ${scrollHeight}px, 需要滚动 ${scrollSteps} 步`);

    for (let i = 0; i < scrollSteps; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      await page.waitForTimeout(scrollDelay);
    }

    // 等待网络请求完成（增加等待时间）
    console.log('等待异步资源加载...');
    await page.waitForTimeout(3000);
  }

  // 回到页面顶部
  async function scrollToTop(page) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
  }

  console.log(`正在访问: ${url}`);
  await page.goto(url, {
    waitUntil: 'load',
    timeout: 120000,
  });

  // 等待额外时间确保 JS 渲染完成（Cloudflare 等 CDN 的 JS 渲染需要时间）
  console.log('等待 JS 渲染完成...');
  await page.waitForTimeout(10000);

  // 获取页面标题
  const title = await page.title();
  console.log(`页面标题: ${title}`);

  // 多视口滚动 — 在不同设备宽度下触发响应式资源加载
  for (const vp of RESPONSIVE_VIEWPORTS) {
    console.log(`[${vp.label}] 切换视口并滚动触发懒加载...`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1000);
    await slowScrollToBottom(page);
    await scrollToTop(page);
    await page.waitForTimeout(2000);
  }

  // 切回桌面视口捕获最终 HTML
  console.log('[Desktop] 切回桌面视口...');
  await page.setViewportSize({ width: RESPONSIVE_VIEWPORTS[0].width, height: RESPONSIVE_VIEWPORTS[0].height });
  await page.waitForTimeout(1000);

  // 等待所有 response 保存完成（与导航+滚动异步进行）
  console.log('等待所有资源保存完成...');
  await Promise.all(responseSavePromises);
  console.log(`资源保存完成: ${responseDetails.length} 个成功，${failedRecords.length} 个失败`);

  // 获取完整 HTML
  let html;
  if (liveDom) {
    // --live-dom 模式：始终使用浏览器实际渲染后的 DOM
    html = await page.evaluate(() => document.documentElement.outerHTML);
    console.log('使用 Live DOM（--live-dom 模式，共 ' + html.length + ' 字符）');
  } else if (initialHtml) {
    // 默认模式：优先使用服务器返回的初始源代码（未被 JS 污染，与原始页面一致）
    html = initialHtml;
    console.log('使用初始源代码（共 ' + initialHtml.length + ' 字符）');
  } else {
    // 初始源代码不可用时，回退到 Live DOM
    html = await page.evaluate(() => document.documentElement.outerHTML);
    console.log('初始源代码不可用，回退到 Live DOM');
  }

  // 先格式化 HTML
  let formattedHtml;
  try {
    formattedHtml = await prettier.format(html, { parser: 'html' });
  } catch (e) {
    console.log('Prettier 格式化失败，使用原始 HTML: ' + e.message.split('\n')[0]);
    formattedHtml = html;
  }

  // 处理 script、style、link 标签，添加 uuid 并保存内容
  const { processedHtml, scriptRecords, styleRecords, linkRecords } = processHtmlTags(formattedHtml, outputDir);

  // urlMapping 已在 response 处理器中填充完毕

  // 替换 HTML 中的资源 URL 为本地路径
  console.log('替换 HTML 中的资源 URL...');
  const { localizedHtml, replaceCount } = localizeHtmlUrls(processedHtml, urlMapping, baseUrl);
  console.log(`HTML URL 替换: ${replaceCount} 个`);

  // 格式化最终 HTML
  let finalHtml;
  try {
    finalHtml = await prettier.format(localizedHtml, { parser: 'html' });
  } catch (e) {
    console.log('Prettier 最终格式化失败，使用局部化后的原始 HTML');
    finalHtml = localizedHtml;
  }

  const htmlPath = path.join(outputDir, 'page.html');
  fs.writeFileSync(htmlPath, finalHtml);
  console.log(`HTML 已保存到: ${htmlPath}`);

  // 输出 script 处理信息
  const scriptsWithContent = scriptRecords.filter((r) => r.hasContent);
  console.log(`共处理 ${scriptRecords.length} 个 script 标签，${scriptsWithContent.length} 个已保存到 cache 目录`);

  // 输出 style 处理信息
  const stylesWithContent = styleRecords.filter((r) => r.hasContent);
  console.log(`共处理 ${styleRecords.length} 个 style 标签，${stylesWithContent.length} 个已保存到 cache 目录`);

  // 输出 link 处理信息
  console.log(`共处理 ${linkRecords.length} 个 link 标签`);

  // 保存 script 记录
  const scriptRecordPath = path.join(outputDir, 'scripts.json');
  fs.writeFileSync(scriptRecordPath, JSON.stringify(scriptRecords, null, 2));
  console.log(`Script 记录已保存到: ${scriptRecordPath}`);

  // 保存 style 记录
  const styleRecordPath = path.join(outputDir, 'styles.json');
  fs.writeFileSync(styleRecordPath, JSON.stringify(styleRecords, null, 2));
  console.log(`Style 记录已保存到: ${styleRecordPath}`);

  // 保存 link 记录
  const linkRecordPath = path.join(outputDir, 'links.json');
  fs.writeFileSync(linkRecordPath, JSON.stringify(linkRecords, null, 2));
  console.log(`Link 记录已保存到: ${linkRecordPath}`);

  // 确保回到主页面
  await page.bringToFront();
  await page.waitForTimeout(1000);

  let screenshotPcPath = null;
  let screenshotMobilePath = null;

  // 截图（PC 分辨率）
  try {
    screenshotPcPath = path.join(outputDir, 'screenshot-pc.png');
    await page.screenshot({ path: screenshotPcPath, fullPage: true });
    console.log(`PC 截图已保存到: ${screenshotPcPath}`);
  } catch (err) {
    console.log(`PC 截图失败: ${err.message}`);
  }

  // Mobile 截图
  try {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    screenshotMobilePath = path.join(outputDir, 'screenshot-mobile.png');
    await page.screenshot({ path: screenshotMobilePath, fullPage: true });
    console.log(`Mobile 截图已保存到: ${screenshotMobilePath}`);
  } catch (err) {
    console.log(`Mobile 截图失败: ${err.message}`);
  }

  // 保存资源记录
  const networkPath = path.join(outputDir, 'network.json');
  fs.writeFileSync(networkPath, JSON.stringify(responseDetails, null, 2));
  console.log(`资源记录已保存到: ${networkPath}`);
  console.log(`共收集 ${responseDetails.length} 个资源到 static 目录`);

  // 处理 static 目录下的 CSS 和 JS 文件中的 URL
  console.log('处理 static 目录下的 CSS 和 JS 文件...');
  const { cssReplaceCount, jsReplaceCount, htmlReplaceCount, newUrlsFound } = await processStaticFiles(staticDir, urlMapping, baseUrl);
  console.log(`CSS 文件 URL 替换: ${cssReplaceCount} 个`);
  console.log(`JS 文件 URL 替换: ${jsReplaceCount} 个`);
  console.log(`HTML 片段 URL 替换: ${htmlReplaceCount} 个`);
  if (newUrlsFound.length > 0) {
    console.log(`发现并处理了 ${newUrlsFound.length} 个额外引用的资源`);
  }

  if (open && !ai) {
    console.log('浏览器已打开，按 Ctrl+C 退出...');
    // 等待用户手动关闭
    await new Promise(() => {});
  } else {
    await browser.close();
  }

  // 输出最终结果摘要
  const totalResources = responseDetails.length + failedRecords.length;
  console.log('='.repeat(50));
  console.log('克隆完成!');
  console.log(`总资源: ${totalResources} 个`);
  const failedDetailsURL = path.join(outputDir, 'failed-resources.json');
  console.log(`下载成功: ${responseDetails.length} 个，失败: ${failedRecords.length} 个`);
  if (failedRecords.length > 0) {
    fs.writeFileSync(failedDetailsURL, JSON.stringify(failedRecords, null, 2));
    console.log(`失败资源列表已保存到: ${failedDetailsURL}`);
    console.log(`\n失败的资源 (${failedRecords.length} 个):`);
    for (const f of failedRecords) {
      console.log(`  [${f.resourceType || '?'}] ${f.url}`);
      console.log(`    原因: ${f.error}`);
    }
  }
  console.log('='.repeat(50));

  return {
    title,
    htmlPath,
    screenshotPcPath,
    screenshotMobilePath,
    networkPath,
    responseDetails,
    scriptRecords,
    scriptRecordPath,
    styleRecords,
    styleRecordPath,
    linkRecords,
    linkRecordPath,
  };
}

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    url: null,
    outputDir: './output',
    open: false,
    liveDom: false,
    ai: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-o' || arg === '--open') {
      result.open = true;
    } else if (arg === '--live-dom') {
      result.liveDom = true;
    } else if (arg === '--ai') {
      result.ai = true;
    } else if (arg.startsWith('--output=')) {
      result.outputDir = arg.split('=')[1];
    } else if (!arg.startsWith('-')) {
      if (!result.url) {
        result.url = arg;
      } else {
        result.outputDir = arg;
      }
    }
  }

  return result;
}

function printHelp() {
  console.log(`
用法: node src/clone.js <url> [options]

参数:
  url                      目标网址 或 直接资源链接（.mp4/.pdf/.png 等）

选项:
  -o, --open               打开可视化浏览器（仅对 HTML 页面有效）
  --live-dom               使用浏览器实际渲染后的 DOM（而非服务器端 HTML 源代码）
  --ai                     AI 模式：任务完成后自动关闭进程，不等待手动退出
  --output=<dir>           输出目录 (默认: ./output)
  -h, --help               显示帮助信息

示例:
  node src/clone.js https://example.com
  node src/clone.js https://example.com --live-dom --output=./my-page
  node src/clone.js https://example.com/video.mp4 --output=./my-video
`);
}

// 主入口
const config = parseArgs();

if (config.help) {
  printHelp();
  process.exit(0);
}

if (config.url) {
  if (isDirectResourceUrl(config.url)) {
    downloadDirectResource(config.url, config.outputDir).catch(console.error);
  } else {
    clonePage(config.url, {
      outputDir: config.outputDir,
      open: config.open,
      liveDom: config.liveDom,
      ai: config.ai,
    }).catch(console.error);
  }
} else {
  console.log('用法: node src/clone.js <url> [options]');
  console.log('使用 --help 查看更多信息');
  process.exit(0);
}