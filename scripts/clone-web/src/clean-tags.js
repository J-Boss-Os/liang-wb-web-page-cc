const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');

/**
 * 精准清理 HTML 中的业务标签
 * 根据 json 记录 + 内容匹配来移除指定 script/style/link 标签
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { input: null, removeUuids: [], removeTags: [], autoClean: false, help: false };

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg.startsWith('--remove-uuid=')) {
      result.removeUuids = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--remove-tags=')) {
      result.removeTags = arg.split('=')[1].split(',').map(s => s.trim().toLowerCase());
    } else if (arg === '--auto-clean') {
      result.autoClean = true;
    } else if (!arg.startsWith('-')) {
      result.input = arg;
    }
  }
  return result;
}

function getUuid(node) {
  if (!node.attrs) return null;
  const attr = node.attrs.find(a => a.name === 'uuid');
  return attr ? attr.value : null;
}

function getTagName(node) {
  return node.tagName ? node.tagName.toLowerCase() : '';
}

function getAttr(node, name) {
  if (!node.attrs) return null;
  const attr = node.attrs.find(a => a.name === name);
  return attr ? attr.value : null;
}

function getNodeText(node) {
  if (!node.childNodes) return '';
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') text += child.value;
  }
  return text;
}

function getNodeSrc(node) {
  return getAttr(node, 'src') || getAttr(node, 'href') || '';
}

// 加载 json 记录，建立 uuid -> 内容特征的映射
function loadRecords(dir, type) {
  const file = path.join(dir, type === 'link' ? 'links.json' : type === 'style' ? 'styles.json' : 'scripts.json');
  if (!fs.existsSync(file)) return {};
  const records = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const map = {};
  for (const r of records) {
    map[r.uuid] = {
      srcUrl: r.srcUrl || '',
      localPath: r.localPath || '',
      hasContent: r.hasContent !== undefined ? r.hasContent : true,
      rel: r.rel || ''
    };
  }
  return map;
}

// 判断节点是否应该移除
function shouldRemove(node, config, recordMap) {
  const tag = getTagName(node);
  const uuid = getUuid(node);

  // 方式1: 有 uuid 属性，直接按 uuid 匹配
  if (uuid && config.removeUuids.includes(uuid)) return true;

  // 方式2: 没有 uuid 属性，按内容特征匹配
  // 遍历 recordMap 中需要移除的 uuid，用内容匹配
  for (const [recUuid, rec] of Object.entries(recordMap)) {
    if (!config.removeUuids.includes(recUuid)) continue;

    if (tag === 'script' && rec.hasContent) {
      const text = getNodeText(node);
      if (text.length > 0 && rec.localPath) {
        // 加载本地缓存内容，对比
        if (fs.existsSync(rec.localPath)) {
          const cacheContent = fs.readFileSync(rec.localPath, 'utf-8').trim();
          if (text.trim() === cacheContent) return true;
          // 部分匹配（前100字符）
          if (cacheContent.length > 100 && text.trim().startsWith(cacheContent.substring(0, 100))) return true;
        }
      }
    }

    if (tag === 'script' && rec.srcUrl) {
      const src = getNodeSrc(node);
      if (src && src.includes(rec.srcUrl.replace(/^https?:\/\//, ''))) return true;
      // 匹配 rocketlazyloadscript 包装的
      const dataSrc = getAttr(node, 'data-rocket-src');
      if (dataSrc && dataSrc.includes(rec.srcUrl.replace(/^https?:\/\//, ''))) return true;
    }

    if (tag === 'style' && rec.hasContent) {
      const text = getNodeText(node);
      if (text.length > 0 && rec.localPath && fs.existsSync(rec.localPath)) {
        const cacheContent = fs.readFileSync(rec.localPath, 'utf-8').trim();
        if (text.trim() === cacheContent) return true;
        if (cacheContent.length > 100 && text.trim().startsWith(cacheContent.substring(0, 100))) return true;
      }
    }

    if (tag === 'link' && rec.srcUrl) {
      const href = getNodeSrc(node);
      if (href && (href === rec.srcUrl || href.includes(rec.srcUrl))) return true;
    }
    if (tag === 'link' && rec.rel) {
      const rel = getAttr(node, 'rel');
      if (rel === rec.rel) {
        const href = getNodeSrc(node);
        if (!href || href === rec.srcUrl || rec.srcUrl === '') return true;
      }
    }
  }

  // 方式3: 按标签名匹配（通用）
  if (config.removeTags.includes(tag)) return true;

  return false;
}

// 清理残留属性
function cleanAttrs(node) {
  if (!node.attrs) return;
  node.attrs = node.attrs.filter(attr => {
    if (attr.name === 'uuid') return false;
    if (attr.name === 'data-rocket-onclick') {
      attr.name = 'onclick';
      return true;
    }
    if (attr.name === 'data-rocket-prefetch') return false;
    return true;
  });
}

function traverse(node, config, recordMap) {
  if (!node || !node.childNodes) return;

  cleanAttrs(node);

  const toRemove = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];

    if (shouldRemove(child, config, recordMap)) {
      toRemove.push(i);
    } else if (config.autoClean) {
      if (getTagName(child) === 'noscript') {
        toRemove.push(i);
      } else if (getTagName(child) === 'meta' && getAttr(child, 'content') && getAttr(child, 'content').includes('WP Rocket')) {
        toRemove.push(i);
      } else if (getTagName(child) === 'script' && getAttr(child, 'type') && getAttr(child, 'type').includes('rocketlazyloadscript')) {
        toRemove.push(i);
      } else {
        traverse(child, config, recordMap);
      }
    } else {
      traverse(child, config, recordMap);
    }
  }

  for (let i = toRemove.length - 1; i >= 0; i--) {
    node.childNodes.splice(toRemove[i], 1);
  }
}

function traverseTemplateContent(node, config, recordMap) {
  if (!node) return;
  if (node.content) traverse(node.content, config, recordMap);
  if (node.childNodes) {
    for (const child of node.childNodes) {
      traverseTemplateContent(child, config, recordMap);
    }
  }
}

function printHelp() {
  console.log(`
用法: node src/clean-tags.js <page.html> [options]

参数:
  page.html                要清理的 HTML 文件路径

选项:
  --remove-uuid=uuid1,uuid2  移除指定 uuid 的标签（逗号分隔，会匹配内容）
  --remove-tags=script,link  移除指定标签名（逗号分隔）
  --auto-clean               开启自动清理：noscript / WPRocket meta / rocketlazyloadscript（默认关闭）
  -h, --help               显示帮助信息

匹配方式:
  - 有 uuid 属性的标签：直接按 uuid 属性匹配
  - 无 uuid 属性的标签：加载 json 记录，用缓存内容/srcUrl 反向匹配
`);
}

const config = parseArgs();

if (config.help || !config.input) {
  printHelp();
  process.exit(config.help ? 0 : 1);
}

if (config.removeUuids.length === 0 && config.removeTags.length === 0) {
  console.log('错误: 必须指定 --remove-uuid 或 --remove-tags');
  printHelp();
  process.exit(1);
}

const html = fs.readFileSync(config.input, 'utf-8');
const dir = path.dirname(config.input);

// 加载 json 记录
const scriptRecords = loadRecords(dir, 'script');
const styleRecords = loadRecords(dir, 'style');
const linkRecords = loadRecords(dir, 'link');
const recordMap = { ...scriptRecords, ...styleRecords, ...linkRecords };

const ast = parse5.parse(html);

traverse(ast, config, recordMap);
traverseTemplateContent(ast, config, recordMap);

if (ast.childNodes) {
  for (const child of ast.childNodes) {
    traverse(child, config, recordMap);
    traverseTemplateContent(child, config, recordMap);
  }
}

const output = parse5.serialize(ast);
fs.writeFileSync(config.input, output);

console.log(`清理完成: ${config.input}`);
console.log(`移除了 ${config.removeUuids.length} 个 uuid 匹配的标签`);
if (config.removeTags.length > 0) {
  console.log(`移除了所有 ${config.removeTags.join(', ')} 标签`);
}
if (config.autoClean) {
  console.log('自动清理: noscript / WPRocket meta / rocketlazyloadscript');
}
