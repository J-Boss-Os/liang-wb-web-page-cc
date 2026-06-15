---
name: clone-page
description: 给目标网页地址和本地dir名字，实现克隆到本地
arguments: target-url output-dir refactor-type args
---

- 使用浏览器打开目标网站，确认下这个网站是否被人机验证拦截

- **如果未被拦截**：直接克隆

  ```bash
  node ../scripts/clone-web/src/clone.js ${target-url} --output=./${output-dir} {args 传给脚本的额外参数集}
  ```

- **如果被 Cloudflare 等人机验证拦截**：停止克隆，告知用户该网站无法直接克隆

- 等待网页克隆完成后，使用SKILL(clean-page)进行本地页面清洗

```skill
SKILL(clean-page) output-dir
```
```skill
SKILL(tracker-page) output-dir
```

- 根据 refactor-type 参数调用对应的 refactor skill：
  -  refactor-type 是 "anytrack"，调用 `SKILL(refactor-page-anytrack) output-dir`
  -  refactor-type 是 "default"，调用 `SKILL(refactor-page-default) output-dir`
  -  refactor-type 是 "details"，调用 `SKILL(refactor-page-details) output-dir`
  - 未指定 refactor-type，默认使用 `SKILL(refactor-page-default) output-dir`

```skill
SKILL(normalize-page-links) output-dir
```

```skill
SKILL(validate-thymeleaf-page) output-dir
```

- 页面清洗，替换完成之后，需要浏览器打开本地页面截长图，和目标网页截长图进行对比。
  主要关注，是否有模块缺失，字体图标缺失，图片缺失，如果有的话，需要进行修复。
- 直到检测通过后才算任务完成
