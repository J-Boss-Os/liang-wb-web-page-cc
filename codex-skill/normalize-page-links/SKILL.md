---
name: normalize-page-links
description: 规范化克隆落地页或Thymeleaf模板中的政策/页脚链接，并替换页面可见文案里硬编码的原站域名。适用于处理About Us、Privacy Policy、Terms of Use、Contact Us、Disclosure等导航，或隐私、版权、条款描述中需要从当前URL自动显示域名的页面。
arguments: output-dir
---

# 页面链接规范化

## 处理范围

- 用于`output-dir`的入口html文件模板交付前的链接清理。
- 只处理政策/页脚导航链接和页面文案里的克隆来源域名，不处理商品字段提取。
- 不要把本技能处理的政策/页脚链接写入`lp_config.json`。
- 不要破坏已经存在的商品CTA绑定，例如`th:href="${ads + 'key'}"`、`th:href="${key}"`、`/ads`、跟踪脚本占位等。
- 除了政策/页脚导航的固定内部链接外，不要修改跳转类属性，例如`href`、`src`、`action`里的商品或跟踪链接。

## 政策/页脚链接

页面中如果存在页脚或政策类导航标签，如`About Us`、`About US`、`Privacy Policy`、`Terms of Use`、`Terms of Service`、`Contact Us`、`Contact US`、`Disclosure`等，统一替换为下面这组固定内部链接。

不要请求外部链接，不要保留外部政策链接，也不要保留或新增其它政策/页脚类链接。

如果页面上的政策/页脚标签不在上述示例中，但含义相近，也要替换成最接近的固定项。例如：

- `Company`、`Who We Are`、`Our Story`、`About`归到`About US`
- `Privacy`、`Privacy Notice`、`Data Policy`归到`Privacy Policy`
- `Terms`、`Terms & Conditions`、`Terms and Conditions`、`User Agreement`归到`Terms of Use`
- `Contact`、`Support`、`Help`、`Customer Service`归到`Contact US`
- `Affiliate Disclosure`、`Ads Disclosure`、`Disclaimer`归到`Disclosure`

```html
<a href="/disclosure/">Disclosure</a>
<a href="/privacy-policy/">Privacy Policy</a>
<a href="/about/">About US</a>
<a href="/contact-us/">Contact US</a>
<a href="/terms-of-service/">Terms of Use</a>
```

如果原页面有多个页脚导航区域，保持页面原有布局结构，只替换对应导航容器里的链接集合。

## 文案域名清理

最终模板的可见文案中不允许保留克隆来源站点的硬编码域名。

- 这里的域名指页面描述文字中的站点归属、隐私、条款、版权等文案，例如`Privacy belongs to example.com`、`© example.com`、`example.com owns this website`。
- **包括作为 logo 文字显示的域名**：网站可能把域名主体作为纯文字放在 header、nav 或 footer 中，起到品牌标识或 logo 的作用（例如 `<div class="logo">example.com</div>`、`<span class="brand-name">example.com</span>`）。
- 不要因为本规则修改商品CTA、图片资源、表单提交、跟踪跳转等链接属性。
- 使用两种占位符根据场景替换：
  - **`__SITE_NAME__`**：用于 logo、品牌标识区域，运行时显示域名主体（去掉 .com/.net 等后缀），例如 `example`
  - **`__SITE_DOMAIN__`**：用于版权、隐私、条款、站点归属等文案，运行时显示完整域名，例如 `example.com`
- 在页面底部注入轻量JS，从生产环境当前URL读取域名后替换占位符。
- 不要通过外部请求获取域名，不要写死新的域名。

```html
<script>
(function () {
  var hostname = window.location.hostname;
  var parts = hostname.split('.');
  var siteName = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  var siteDomain = hostname;
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var textNode;
  while ((textNode = walker.nextNode())) {
    var value = textNode.nodeValue;
    if (value.indexOf('__SITE_NAME__') !== -1 || value.indexOf('__SITE_DOMAIN__') !== -1) {
      textNode.nodeValue = value.replace(/__SITE_NAME__/g, siteName).replace(/__SITE_DOMAIN__/g, siteDomain);
    }
  }
  
  // 修复 <base> 标签影响锚点跳转
  if (document.querySelector('base[href]')) {
    document.addEventListener('click', function(e) {
      var target = e.target.closest('a[href^="#"]');
      if (target) {
        e.preventDefault();
        var id = target.getAttribute('href').slice(1);
        var element = document.getElementById(id);
        if (element) element.scrollIntoView({behavior: 'smooth'});
      }
    });
  }
})();
</script>
```

## 执行步骤

1. 扫描入口HTML和相关模板文件，找出政策/页脚导航区域、可见文案里的原站域名硬编码位置。
2. 将政策/页脚导航统一替换为固定内部链接集合。
3. 将隐私、条款、版权、站点归属等文案中的原站域名改为`__CURRENT_HOST__`占位。
4. 如页面中使用了`__SITE_NAME__`或者`__SITE_DOMAIN__`，在`</body>`前注入上面的运行时替换脚本；如果已经存在等价脚本，不要重复注入。
5. 复查最终文件，确认可见文案中不再包含克隆来源域名、不包含多余政策/页脚链接、不影响CTA和跟踪链接。
