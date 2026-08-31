import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeProjectArchitecture } from './analyze.js';
import { KnowledgeStore } from '../knowledge/store/KnowledgeStore.js';

export async function runKnowledgeCommand(root, args = []) {
  const subCommand = args[0] ?? 'help';
  const options = parseKnowledgeOptions(args.slice(1));
  if (subCommand === 'search' || subCommand === 'find') return runKnowledgeSearch(root, args.slice(1));
  if (subCommand === 'index') return runKnowledgeIndex(root, args.slice(1));
  if (!['init', 'update', 'sync'].includes(subCommand)) {
    printKnowledgeHelp();
    return;
  }
  const report = await analyzeProjectArchitecture(root, options);
  const generated = options.dryRun ? plannedArtifacts(root, options) : await writeKnowledgeArtifacts(root, report, options);
  console.log(JSON.stringify({
    status: 'pass',
    command: `aafe knowledge ${subCommand}`,
    project: report.projectName,
    counts: report.counts,
    generated,
    summary: options.dryRun ? 'Knowledge artifacts would be refreshed from current code and architecture sources.' : 'Knowledge artifacts refreshed from current code and architecture sources.'
  }, null, 2));
}

/**
 * `aafe knowledge search <query>` — ranked lookup over the analyze output.
 *
 * The point is to answer "where does X live" without an LLM call and without
 * reading the whole knowledge base, which is what both the impact analyzer and
 * an IDE agent need before they can do anything useful.
 */
async function runKnowledgeSearch(root, args) {
  const options = parseSearchOptions(args);
  if (!options.query) {
    console.error('Usage: aafe knowledge search "<query>" [--kind=module,route,symbol] [--limit=20] [--output=.aafe]');
    process.exitCode = 1;
    return null;
  }

  const store = new KnowledgeStore({ root, output: options.output });
  if (!(await store.exists())) {
    console.error(`No analyze output under ${options.output}. Run: aafe analyze`);
    process.exitCode = 1;
    return null;
  }

  const index = await store.searchIndex({ rebuild: options.rebuild });
  const results = index.search(options.query, { limit: options.limit, kinds: options.kinds });
  const payload = {
    status: results.length > 0 ? 'pass' : 'empty',
    command: 'aafe knowledge search',
    query: options.query,
    indexed: index.size,
    count: results.length,
    results
  };
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function runKnowledgeIndex(root, args) {
  const options = parseSearchOptions(args);
  const store = new KnowledgeStore({ root, output: options.output });
  if (!(await store.exists())) {
    console.error(`No analyze output under ${options.output}. Run: aafe analyze`);
    process.exitCode = 1;
    return null;
  }

  const index = await store.searchIndex({ rebuild: true });
  const ref = await index.save();
  const payload = { status: 'pass', command: 'aafe knowledge index', entries: index.size, ref };
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function parseSearchOptions(args) {
  const options = { limit: 20, kinds: null, output: '.aafe', rebuild: false };
  const words = [];
  for (const arg of args) {
    if (arg === '--rebuild') { options.rebuild = true; continue; }
    if (arg.startsWith('--kind=')) {
      options.kinds = arg.slice('--kind='.length).split(',').map((value) => value.trim()).filter(Boolean);
      continue;
    }
    if (arg.startsWith('--limit=')) { options.limit = Number.parseInt(arg.slice('--limit='.length), 10) || 20; continue; }
    if (arg.startsWith('--output=')) { options.output = arg.slice('--output='.length); continue; }
    if (arg.startsWith('--')) continue;
    words.push(arg);
  }
  options.query = words.join(' ').trim();
  return options;
}

export async function syncKnowledgeArtifacts(root, options = {}) {
  const report = await analyzeProjectArchitecture(root, options);
  return writeKnowledgeArtifacts(root, report, options);
}

async function writeKnowledgeArtifacts(root, report, options) {
  const directory = path.join(root, options.knowledgeDocs ?? '.docs/aafe-generated');
  await mkdir(directory, { recursive: true });
  const artifacts = { index: 'README.md', componentRelations: '组件关系.md', dataFlows: '业务关系与数据流.md', impactTests: '影响范围与测试预测.md' };
  const results = {};
  for (const [key, file] of Object.entries(artifacts)) {
    const filePath = path.join(directory, file);
    const content = renderArtifact(key, report);
    const previous = await safeRead(filePath);
    if (previous === content) results[key] = 'unchanged';
    else {
      await writeFile(filePath, content);
      results[key] = previous ? 'updated' : 'created';
    }
  }
  return { directory: path.relative(root, directory), files: results };
}

function plannedArtifacts(root, options) {
  return { directory: path.relative(root, path.join(root, options.knowledgeDocs ?? '.docs/aafe-generated')), files: ['README.md', '组件关系.md', '业务关系与数据流.md', '影响范围与测试预测.md'] };
}

function renderArtifact(type, report) {
  const sources = sourceList(report);
  if (type === 'componentRelations') return `# 组件关系\n\nGenerated by aafe knowledge sync. 当前源码和架构文档是事实来源。\n\n## 组件与页面\n\n${report.components.map((item) => '- **' + item.name + '** (' + item.kind + ') -> ' + item.file).join('\n') || '- 未发现组件。'}\n\n## 模块关系\n\n${report.modules.map((item) => '- ' + item.name + '：' + item.fileCount + ' 个文件').join('\n') || '- 未发现模块。'}\n\n## 证据来源\n\n${sources}\n`;
  if (type === 'dataFlows') return `# 业务关系与数据流\n\nGenerated by aafe knowledge sync。这是面向 AI 项目管理的关系索引，不替代业务架构原文。\n\n## 路由与页面\n\n${report.routes.map((item) => '- ' + (item.path || '(unknown)') + ' -> ' + (item.component || item.file) + ' (' + item.file + ')').join('\n') || '- 未发现路由。'}\n\n## 架构文档与图表\n\n${report.architectureSources.map((item) => '- [' + item.kind + '] ' + item.file + '：' + item.title).join('\n') || '- 未发现架构来源。'}\n\n## AI 使用规则\n\n- 先读取相关 .docs 文档和 Mermaid 图，再定位源码。\n- 文档与源码冲突时，以当前源码为事实并记录冲突。\n- 变更路由、Store、API、Worker、缓存或存储时，必须重新计算影响范围与测试范围。\n`;
  if (type === 'impactTests') return `# 影响范围与测试预测\n\nGenerated by aafe knowledge sync。本文件记录当前架构可推导的测试范围，不是测试通过证明。\n\n## 当前变更基线\n\n- 项目：${report.projectName}\n- 扫描文件：${report.counts.files}\n- 路由：${report.counts.routes}\n- 组件：${report.counts.components}\n- 架构来源：${report.counts.architectureSources}\n\n## 默认影响范围\n\n- 直接影响：变更文件所属模块、路由、组件和调用入口。\n- 间接影响：相关 Store、API、Worker、缓存、存储和结果渲染链路。\n- 潜在影响：共享组件、公共请求层、路由守卫、权限、降级和历史兼容路径。\n\n## 默认测试预测\n\n- P0：变更模块的单元/组件测试，以及主用户路径。\n- P1：相关路由、Store、API、数据流和集成路径。\n- P1：异常、取消、超时、竞态、权限和降级路径（若架构关系涉及）。\n- P2：共享组件、兼容版本、截图/流程回归和非核心模块。\n\n## 依据\n\n${sources}\n\n## 使用要求\n\n每次功能修复后，由 AI 根据实际 diff 替换本文件中的泛化预测，补充具体文件、关系、测试命令和已执行状态。\n`;
  return `# Knowledge Center Generated Index\n\nGenerated by aafe knowledge sync。请勿手工修改；项目架构原文位于 .docs，本目录是 AI Knowledge 的同步视图。\n\n## Project\n\n- ${report.projectName}\n- Scanned files: ${report.counts.files}\n- Routes: ${report.counts.routes}\n- Components: ${report.counts.components}\n- Modules: ${report.counts.modules}\n- Architecture sources: ${report.counts.architectureSources}\n\n## Files\n\n- 组件关系.md\n- 业务关系与数据流.md\n- 影响范围与测试预测.md\n\n## Update\n\nRun aafe knowledge init for first setup, or aafe knowledge update after code fixes and feature changes.\n`;
}

function sourceList(report) {
  return report.architectureSources.map((item) => '- [' + item.kind + '] ' + item.file + '：' + item.title).join('\n') || '- 无架构文档来源。';
}

function parseKnowledgeOptions(args) {
  const options = { dryRun: args.includes('--dry-run'), maxFiles: 6000, maxEntries: 120 };
  for (const arg of args) {
    if (arg.startsWith('--architecture-docs=')) options.architectureDocs = arg.slice('--architecture-docs='.length);
    if (arg.startsWith('--knowledge-docs=')) options.knowledgeDocs = arg.slice('--knowledge-docs='.length);
    if (arg.startsWith('--max-files=')) options.maxFiles = Number.parseInt(arg.slice('--max-files='.length), 10) || options.maxFiles;
    if (arg.startsWith('--max-entries=')) options.maxEntries = Number.parseInt(arg.slice('--max-entries='.length), 10) || options.maxEntries;
  }
  return options;
}

async function safeRead(filePath) {
  try { return await readFile(filePath, 'utf8'); } catch { return ''; }
}

function printKnowledgeHelp() {
  console.log('aafe knowledge <command>\n\nCommands:\n  init       Initialize and publish Knowledge views into .docs\n  update     Refresh Knowledge views after a feature or fix\n  sync       Alias of update\n  search     Ranked lookup over the analyze output (symbols, files, modules, routes, components, features)\n  index      Rebuild and persist the retrieval index\n\nOptions:\n  --architecture-docs=<path>  Architecture source directory, defaults to .docs\n  --knowledge-docs=<path>     Generated output directory, defaults to .docs/aafe-generated\n  --dry-run                   Preview without writing\n\nSearch options:\n  --kind=module,route,symbol  Restrict to entry kinds\n  --limit=<n>                 Max results, defaults to 20\n  --output=<path>             Analyze output directory, defaults to .aafe\n  --rebuild                   Ignore the persisted index and rebuild it\n');
}
