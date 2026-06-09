---
name: clone-page
description: 给目标网页地址和本地dir名字，实现克隆到本地
arguments: target-url output-dir args
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

```skill
SKILL(refactor-page) output-dir
```

- 页面清洗，替换完成之后，需要浏览器打开本地页面截长图，和目标网页截长图进行对比。
  主要关注，是否有模块缺失，字体图标缺失，图片缺失，如果有的话，需要进行修复。
- 直到检测通过后才算任务完成
