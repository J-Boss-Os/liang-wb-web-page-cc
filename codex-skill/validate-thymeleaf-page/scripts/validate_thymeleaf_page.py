#!/usr/bin/env python3
"""校验克隆后的 Thymeleaf 落地页目录。"""

from __future__ import annotations

import argparse
import json
import locale
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Tuple


TH_ATTR_RE = re.compile(r"""\s(th:[\w-]+)\s*=\s*(['"])(.*?)\2""", re.DOTALL)
NORMAL_ATTR_RE = re.compile(r"""\s([:\w-]+)\s*=\s*(['"])(.*?)\2""", re.DOTALL)
EXPR_RE = re.compile(r"""\$\{([^}]*)\}""")
STATIC_REF_RE = re.compile(
    r"""(?:src|href)=["']((?:/)?static/[^"'>\s]+)["']""", re.IGNORECASE
)


class IssueBag:
    def __init__(self) -> None:
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.render_output = ""

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


class HTMLSyntaxProbe(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.tags: List[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # type: ignore[no-untyped-def]
        self.tags.append(tag)


def load_text(path: Path, issues: IssueBag) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        issues.error(f"{path.name} 不是合法的 UTF-8 文件: {exc}")
    except FileNotFoundError:
        issues.error(f"缺少必需文件: {path}")
    except OSError as exc:
        issues.error(f"无法读取 {path}: {exc}")
    return ""


def validate_html_syntax(html: str, issues: IssueBag) -> None:
    parser = HTMLSyntaxProbe()
    try:
        parser.feed(html)
        parser.close()
    except Exception as exc:  # HTMLParser can raise on malformed declarations.
        issues.error(f"HTML 解析失败: {exc}")

    if "<html" not in html.lower():
        issues.warn("没有找到 <html> 标签。")
    if "</body>" not in html.lower():
        issues.error("缺少闭合 </body> 标签。")
    if "</head>" not in html.lower():
        issues.error("缺少闭合 </head> 标签。")

    open_blocks = len(re.findall(r"<th:block\b", html, re.IGNORECASE))
    close_blocks = len(re.findall(r"</th:block>", html, re.IGNORECASE))
    if open_blocks != close_blocks:
        issues.error(f"th:block 标签数量不匹配: open={open_blocks}, close={close_blocks}")


def validate_thymeleaf_expressions(html: str, issues: IssueBag) -> List[Tuple[str, str]]:
    attrs = TH_ATTR_RE.findall(html)
    for name, _quote, value in attrs:
        if r"\'" in value or r'\"' in value:
            issues.error(f"{name} 包含反斜杠转义引号: {value}")
        if value.count("${") != value.count("}"):
            issues.error(f"{name} 表达式花括号不平衡: {value}")
        for expr in EXPR_RE.findall(value):
            if expr.count("'") % 2 != 0:
                issues.error(f"{name} 表达式中的单引号不平衡: ${{{expr}}}")
            if expr.count('"') % 2 != 0:
                issues.error(f"{name} 表达式中的双引号不平衡: ${{{expr}}}")
            if "\\" in expr:
                issues.error(f"{name} 表达式包含反斜杠: ${{{expr}}}")
    return [(name, value) for name, _quote, value in attrs]


def load_config(page_dir: Path, issues: IssueBag) -> List[Dict[str, object]]:
    config_path = page_dir / "lp_config.json"
    if not config_path.exists():
        issues.error("缺少 lp_config.json")
        return []
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        issues.error(f"lp_config.json 不是合法 JSON: {exc}")
        return []
    if not isinstance(data, list):
        issues.error("lp_config.json 必须是 JSON 数组。")
        return []

    required_fields = {"key", "label", "type", "required", "group"}
    seen = set()
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            issues.error(f"lp_config.json 第 {index} 项必须是对象。")
            continue
        missing = sorted(required_fields - set(item.keys()))
        if missing:
            issues.error(f"lp_config.json 第 {index} 项缺少字段: {', '.join(missing)}")
        key = item.get("key")
        if not isinstance(key, str) or not key:
            issues.error(f"lp_config.json 第 {index} 项的 key 无效。")
            continue
        if key in seen:
            issues.error(f"lp_config key 重复: {key}")
        seen.add(key)
        item_type = item.get("type")
        if item_type not in {"IMAGE", "TEXT", "NEXT_LINK"}:
            issues.error(f"lp_config key {key} 的 type 不受支持: {item_type}")
    return data


def validate_config_bindings(html: str, config: List[Dict[str, object]], issues: IssueBag) -> None:
    for item in config:
        key = item.get("key")
        item_type = item.get("type")
        if not isinstance(key, str):
            continue
        if item_type == "IMAGE":
            needle = f'th:src="${{{key}}}"'
        elif item_type == "TEXT":
            needle = f'th:text="${{{key}}}"'
        elif item_type == "NEXT_LINK":
            needle = f"""th:href="${{ads + '{key}'}}\""""
        else:
            continue
        if needle not in html:
            issues.error(f"缺少 {key} 对应的模板绑定: {needle}")

    known_vars = {str(item.get("key")) for item in config if isinstance(item.get("key"), str)}
    known_vars.update({"ads", "baseHref", "gaHead", "gaBody"})
    for expr in EXPR_RE.findall(html):
        for token in re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", expr):
            if token in {"true", "false", "null"}:
                continue
            if token not in known_vars:
                issues.warn(f"表达式 ${{{expr}}} 引用了未知变量: {token}")


def validate_tracker(html: str, issues: IssueBag) -> None:
    required_once = {
        '<base th:href="${baseHref}">': "baseHref base 标签",
        '<th:block th:utext="${gaHead}"></th:block>': "gaHead 占位块",
        '<th:block th:utext="${gaBody}"></th:block>': "gaBody 占位块",
        'src="/static/GA4Util.js"': "GA4Util 脚本",
        'src="/static/ecommerce-ad-tracker.js"': "ecommerce tracker 脚本",
    }
    for needle, label in required_once.items():
        count = html.count(needle)
        if count != 1:
            issues.error(f"{label} 应该只出现一次，实际出现 {count} 次。")

    head_pos = html.lower().find("</head>")
    base_pos = html.find('<base th:href="${baseHref}">')
    ga_head_pos = html.find('<th:block th:utext="${gaHead}"></th:block>')
    if head_pos != -1 and (base_pos > head_pos or ga_head_pos > head_pos):
        issues.error("baseHref/gaHead 必须插入在 </head> 之前。")

    body_pos = html.lower().rfind("</body>")
    ga_body_pos = html.find('<th:block th:utext="${gaBody}"></th:block>')
    if body_pos != -1 and ga_body_pos > body_pos:
        issues.error("gaBody 必须插入在 </body> 之前。")


def validate_static_assets(page_dir: Path, html: str, issues: IssueBag) -> None:
    refs = sorted(set(ref.split("?")[0].split("#")[0] for ref in STATIC_REF_RE.findall(html)))
    for ref in refs:
        local_ref = ref[1:] if ref.startswith("/") else ref
        if not (page_dir / local_ref).exists():
            issues.error(f"缺少本地静态资源: {ref}")


def attrs_from_tag(tag: str) -> Dict[str, str]:
    return {name: value for name, _quote, value in NORMAL_ATTR_RE.findall(tag)}


def validate_cta_fallbacks(html: str, issues: IssueBag) -> None:
    for match in re.finditer(r"<a\b[^>]*th:href=\"\$\{ads \+ '[^']+'\}\"[^>]*>", html):
        tag = match.group(0)
        attrs = attrs_from_tag(tag)
        if attrs.get("href") != "/ads":
            issues.error(f"带 th:href 的 CTA 缺少 href=\"/ads\": {tag[:160]}")
        if "data-at-href" in attrs and attrs.get("data-at-href") != "/ads":
            issues.error(f"CTA 的 data-at-href 必须是 /ads: {tag[:160]}")


def validate_real_thymeleaf_render(page_dir: Path, issues: IssueBag) -> None:
    mvn = shutil.which("mvn")
    if not mvn:
        issues.error("无法执行真实 Thymeleaf 渲染校验：未找到 Maven。")
        return

    project_dir = Path(__file__).resolve().parent / "thymeleaf-render-check"
    pom = project_dir / "pom.xml"
    if not pom.exists():
        issues.error(f"无法执行真实 Thymeleaf 渲染校验：缺少 {pom}")
        return

    command = [
        mvn,
        "-q",
        "-f",
        str(pom),
        "compile",
        "exec:java",
        f"-DpageDir={page_dir}",
    ]
    try:
        result = subprocess.run(
            command,
            cwd=str(project_dir),
            text=True,
            encoding=locale.getpreferredencoding(False),
            errors="replace",
            capture_output=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        issues.error("真实 Thymeleaf 渲染校验超时。")
        return
    except OSError as exc:
        issues.error(f"真实 Thymeleaf 渲染校验无法启动: {exc}")
        return

    output = "\n".join(part.strip() for part in [result.stdout or "", result.stderr or ""] if part.strip())
    if result.returncode != 0:
        summary = output[-3000:] if output else "无 Maven 输出"
        issues.error("真实 Thymeleaf 渲染校验失败:\n" + summary)
    elif output:
        ok_match = re.search(r"THYMELEAF_RENDER_OK length=(\d+)", output)
        if ok_match:
            issues.render_output = f"真实 Thymeleaf 渲染通过，输出长度: {ok_match.group(1)}"
        else:
            issues.render_output = output


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 Thymeleaf 落地页目录。")
    parser.add_argument("page_dir", help="包含 index.html 和 lp_config.json 的页面目录")
    args = parser.parse_args()

    page_dir = Path(args.page_dir).resolve()
    issues = IssueBag()
    if not page_dir.exists() or not page_dir.is_dir():
        print(f"错误: 页面目录不存在: {page_dir}")
        return 2

    html_path = page_dir / "index.html"
    html = load_text(html_path, issues)
    if html:
        validate_html_syntax(html, issues)
        validate_thymeleaf_expressions(html, issues)
        config = load_config(page_dir, issues)
        validate_config_bindings(html, config, issues)
        validate_tracker(html, issues)
        validate_static_assets(page_dir, html, issues)
        validate_cta_fallbacks(html, issues)
        validate_real_thymeleaf_render(page_dir, issues)

    print(f"校验目录: {page_dir}")
    if issues.render_output:
        print(issues.render_output)
    for message in issues.warnings:
        print(f"警告: {message}")
    for message in issues.errors:
        print(f"错误: {message}")
    if issues.errors:
        print(f"未通过: {len(issues.errors)} 个错误，{len(issues.warnings)} 个警告")
        return 1
    print(f"通过: 0 个错误，{len(issues.warnings)} 个警告")
    return 0


if __name__ == "__main__":
    sys.exit(main())
