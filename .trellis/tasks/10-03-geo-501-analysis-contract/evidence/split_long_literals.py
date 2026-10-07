"""只拆分本任务长字符串字面量，不改变运行时 SQL 文本。"""
import ast
import io
import sys
import textwrap
import tokenize
from pathlib import Path

for name in sys.argv[1:]:
    path = Path(name)
    source = path.read_text()
    lines = source.splitlines(keepends=True)
    changes = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type != tokenize.STRING or token.start[0] != token.end[0]:
            continue
        row, col = token.start
        if len(lines[row - 1].rstrip()) <= 100 or len(token.string) < 76:
            continue
        value = ast.literal_eval(token.string)
        if not isinstance(value, str) or '\n' in value:
            continue
        indent = ' ' * col
        replacement = ('\n' + indent).join(repr(part) for part in textwrap.wrap(value, width=70, drop_whitespace=False, break_long_words=False, break_on_hyphens=False))
        changes.append((row - 1, col, token.end[1], replacement))
    for row, start, end, replacement in reversed(changes):
        lines[row] = lines[row][:start] + replacement + lines[row][end:]
    path.write_text(''.join(lines))
