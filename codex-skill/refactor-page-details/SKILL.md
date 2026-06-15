---
name: refactor-page-details
description: 将presela或者product页重构为Thymeleaf模板
arguments: output-dir
---

- 扫描`output-dir`的入口html文件，**只提取以下一个核心字段**（跳过标题、日期、评分、功能介绍等所有装饰性内容）,除了内容每个字段还需要记录当时的x-path路径:
    - CTA跳转链接（产品点击跳转地址）
- 同一个产品在多个位置重复出现时，使用同样的字段映射
- 把提取的数据展示到md的`产品映射table表`中，含XPath路径
- 生成`lp_config.json`：
    - `key`：`product_{序号}_{类型}`，如`product_1_cta`
    - `label`：如`产品1跳转链接`
    - `type`：跳转链接用`URL`，文本用`TEXT`
    - `required`：默认为`true`
    - `group`：`跳转区域`、`商品区域`
    ```json
    [
      { "key": "product_1_cta", "label": "产品1跳转链接", "type": "URL", "required": true, "group": "跳转区域" }
    ]
    ```
- 拷贝一份html为`original.html`，将原html转为Thymeleaf模板,替换的内容就是根据`lp_config.json`文件和`产品映射table表`中对应的`x-path`dom上：
    - CTA替换：`th:href="${key}"`（替换时不要使用 \' 转义字符，原href替换为/ads，如果有data-at-href等自定义data跳转属性就去掉）
