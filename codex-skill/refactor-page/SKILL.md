---
name: refactor-page
description: 将克隆的落地页重构为Thymeleaf模板，仅提取logo、品牌名、CTA链接、产品主图四个核心字段
arguments: output-dir
---

- 扫描`output-dir`的入口html文件，**只提取以下四个核心字段**（跳过标题、日期、评分、功能介绍等所有装饰性内容）,除了内容每个字段还需要记录当时的x-path路径:
    - 网站logo（可能存在，且可能为多个(pc,mobile)，所有logo都记录图片尺寸,不存在则不存映射）
    - 产品品牌名（可能存在,文本类型或者图片类型,不存在则不存映射）
    - CTA跳转链接（产品点击跳转地址）
    - 产品主图（不记录图片尺寸）
- 同一个产品在多个位置重复出现时，使用同样的字段映射
- **如果有且仅有一种商品，且整个页面内容都在介绍这个商品，则只需要记录替换 CTA跳转链接，其余字段不记录**
- 把提取的数据展示到md的`产品映射table表`中，含XPath路径
- 生成`lp_config.json`：
    - `key`：`product_{序号}_{类型}`，如`product_1_image`、`product_1_cta`
    - `label`：如`产品1主图`、`产品1品牌`、`产品1跳转链接`
    - `type`：图片用`IMAGE`，跳转链接用`NEXT_LINK`，文本用`TEXT`
    - `required`：logo为`false`（可选），其余为`true`
    - `group`：`网站区域`、`商品区域`、`跳转区域`
    - `size`：仅IMAGE类型且记录logo图使用
    ```json
    [
      { "key": "site_logo", "label": "网站Logo", "type": "IMAGE", "required": false, "group": "网站区域", "size": "100*200" },
      { "key": "product_1_image", "label": "产品1主图", "type": "IMAGE", "required": true, "group": "商品区域" },
      { "key": "product_1_brand", "label": "产品1品牌", "type": "TEXT", "required": true, "group": "商品区域" },
      { "key": "product_1_cta", "label": "产品1跳转链接", "type": "NEXT_LINK", "required": true, "group": "跳转区域" }
    ]
    ```
- 拷贝一份html为`original.html`，将原html转为Thymeleaf模板,替换的内容就是根据`lp_config.json`文件和`产品映射table表`中对应的`x-path`dom上：
    - 图片替换：`th:src="${key}"`（删除所有图片相关标签上的响应式图片候选属性，但需保留th:src、src、width、height、class、alt 等基础属性）
    - 品牌替换：`th:text="${key}"`
    - CTA替换：`th:href="${ads + 'key'}"`（替换时不要使用 \' 转义字符，原href和data-at-href等响应式替换为/ads）
