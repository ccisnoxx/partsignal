# Ant Design Alert 属性兼容清理实施计划

## 1. 启动门禁

- [x] 用户评审并批准当前 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行：

```bash
python3 ./.trellis/scripts/task.py start 08-02-antd-alert-content-prop-compatibility-cleanup
```

- [x] 启动后加载 `trellis-before-dev`，完整读取任务文档、前端规范、8 个待改源码文件及相关现有测试。
- [x] 确认主工作目录在 `main`，除当前任务目录和既有 Playwright 诊断产物外没有未识别差异。

## 2. 实施顺序

- [x] 冻结 Ant Design 声明版本、lockfile 版本、本地版本和 11 个 AST 命中清单。
- [x] 按 PRD 顺序在 8 个文件中把 11 个 `<Alert message=...>` 原位改为 `title`。
- [x] 逐项核对表达式、文字、`role`、`type`、`showIcon`、`description` 与条件渲染未变化。
- [x] 不格式化无关代码，不创建封装、helper、fallback、依赖、测试脚本或新测试文件。
- [x] 使用 TypeScript AST 重扫全部 `frontend/src/**/*.tsx`，要求遗留数量为 0。

## 3. 必需验证

### 3.1 定向组件回归

在 `frontend/` 目录运行：

```bash
npx vitest run \
  src/features/auth/ChangePasswordPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/product-facts/ProductFactsPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  --reporter=dot
```

### 3.2 前端静态门禁

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
git diff --check
```

### 3.3 AST 零遗留门禁

在仓库根目录运行规划阶段使用的只读 TypeScript AST 扫描：

```bash
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./frontend/node_modules/typescript');

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.tsx')) files.push(file);
  }
}

walk('frontend/src');
const hits = [];
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === 'Alert'
    ) {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'message') {
          const { line } = source.getLineAndCharacterOfPosition(attribute.getStart(source));
          hits.push(`${file}:${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

console.log(`count=${hits.length}`);
for (const hit of hits) console.log(hit);
if (hits.length > 0) process.exitCode = 1;
NODE
```

必须满足：

```text
count=0
```

扫描只识别 JSX 标签名为 `Alert` 且具有 `message` 属性的节点，不把 Ant Form 校验规则或其他对象的 `message` 字段误报为 Alert。

### 3.4 真实浏览器 console smoke

使用项目 `playwright-cli` 命名内存会话，不保存 storage state：

1. 登录开发环境并打开 `/change-password`；
2. 输入一个明确错误且不少于 8 位的旧密码，以及满足规则的新密码；
3. 提交一次，等待 `role=alert` 错误提示可见；
4. 检查 console，要求 `[antd: Alert] message is deprecated` 为 0；
5. 确认仍停留在改密页、当前会话未因成功改密跳转，然后关闭命名会话。

不得输出真实凭据、保存认证状态、过滤 console 或执行第二次尝试。

## 4. 可选验证

```bash
npm --prefix frontend run build
```

本任务不要求完整 `npm test` 或 `make e2e`：变更是 11 个无分支 JSX 属性名，AST、四个定向测试、typecheck、lint 和真实 console smoke 已直接覆盖；只有必需验证暴露构建资产问题时再运行 build。

## 5. 质量、规范与提交边界

- [x] 运行 `trellis-check`，核对 PRD、Ant Design 本地合同、11 个调用点、AST 零遗留和完整 diff。
- [x] 运行 `trellis-update-spec` 判断；无需修改稳定规范，因为这是第三方弃用属性的机械迁移，没有新增产品或工程合同。
- [x] 确认产品行为保持不变，未新增或修改中文注释、文案、日志、异常和开发者可见输出。
- [x] 提交前展示精确文件清单和验证结果，等待用户确认；不自动推送。

## 6. 实施记录

- TypeScript AST：`count=0`。
- 定向 Vitest：4 个测试文件、61 个用例通过，0 失败、0 跳过，耗时 125.01 秒。
- `typecheck`、`lint`、`git diff --check`：通过。
- 真实浏览器：首次错误旧密码请求返回 401，按既有全局认证合同刷新后 mutation 错误状态被清空；随后对同一路径设置不触达后端的 422 响应，确认 `/change-password` 中错误 Alert 显示“当前密码不正确”，console 为 0 warnings，目标弃用警告为 0。后端只收到首次失败请求，密码和其他业务状态均未改变。
- `trellis-check`：通过；`trellis-update-spec`：无需更新稳定规范。

预计一个工作提交：

```text
fix: 清理 Ant Design Alert 弃用属性
```

预计提交范围只包含当前 Trellis 任务目录和 PRD 列出的 8 个前端源码文件。提交后再按用户指示运行 `task.py archive` 与会话日志收尾；执行前说明项目配置可能产生独立 Trellis bookkeeping 提交。
