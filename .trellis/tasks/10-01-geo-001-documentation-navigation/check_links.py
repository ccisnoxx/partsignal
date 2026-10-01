"""GEO-001 文档导航校验；只访问本地文件，不请求外部链接。"""

from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/geo-monitoring"
TASK = Path(__file__).resolve().parent
INLINE_LINK = re.compile(r"!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)")
REFERENCE = re.compile(r"^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)", re.MULTILINE)


def prose(path):
    # 包内导航使用普通 Markdown 链接；排除代码示例中的伪链接。
    content = path.read_text(encoding="utf-8")
    content = re.sub(r"(?ms)^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1\s*$", "", content)
    return re.sub(r"(`+).*?\1", "", content)


def links(path):
    content = prose(path)
    return [match.group(1).strip("<>") for pattern in (INLINE_LINK, REFERENCE)
            for match in pattern.finditer(content)]


def anchors(path):
    result = set()
    counts = {}
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", prose(path), re.MULTILINE):
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(f"{slug}-{count}" if count else slug)
    return result


files = sorted(DOCS.rglob("*.md")) + [REPO / "README.md", REPO / "AGENTS.md"]
files += sorted(TASK.glob("*.md"))
errors = []
checked = 0
graph = {}
for source in files:
    graph[source.resolve()] = set()
    for destination in links(source):
        url = urlsplit(destination)
        if url.scheme or url.netloc:
            continue
        checked += 1
        target = (source.parent / unquote(url.path)).resolve() if url.path else source.resolve()
        if not target.exists():
            errors.append(f"{source.relative_to(REPO)}: 不存在 {destination}")
            continue
        graph[source.resolve()].add(target)
        if url.fragment and target.suffix == ".md" and unquote(url.fragment) not in anchors(target):
            errors.append(f"{source.relative_to(REPO)}: 不存在锚点 {destination}")

index = DOCS / "README.md"
index_text = index.read_text(encoding="utf-8")
tree = re.search(r"```text\n(.*?)\n```", index_text, re.DOTALL).group(1).splitlines()
if tree[0] != "docs/geo-monitoring/":
    errors.append("README 文档结构根路径不正确")
declared = set()
directory = ""
for row in tree[1:]:
    name = re.split(r"[├└]─ ", row)[-1].strip()
    if name.endswith("/"):
        directory = name
    else:
        declared.add(directory + name if row.startswith("│") or row.startswith("   ") else name)
actual = {path.relative_to(DOCS).as_posix() for path in DOCS.rglob("*") if path.is_file()}
if declared != actual:
    errors.append(f"README 清单差异：缺失={sorted(declared - actual)}，未声明={sorted(actual - declared)}")

reachable = set()
pending = [index.resolve()]
while pending:
    current = pending.pop()
    if current not in reachable:
        reachable.add(current)
        pending.extend(graph.get(current, set()) - reachable)
unreachable = sorted(path for path in actual if (DOCS / path).resolve() not in reachable)
if unreachable:
    errors.append(f"文档入口无法到达：{unreachable}")
required = {
    DOCS / "README.md",
    DOCS / "04-delivery/01-implementation-roadmap.md",
    DOCS / "04-delivery/02-work-breakdown-structure.md",
    DOCS / "04-delivery/task-manifest.yaml",
}
if not required <= graph[(REPO / "README.md").resolve()]:
    errors.append("根 README 缺少必需的 GEO 导航")
if errors:
    print("\n".join(errors))
    raise SystemExit(1)
print(f"通过：{len(files)} 个 Markdown 文件，{checked} 个本地链接，0 断链")
print(f"通过：README 清单与 {len(actual)} 个包内文件一致，全部可从单一入口到达")
print("通过：根 README 的 4 个 GEO 必需导航完整")
