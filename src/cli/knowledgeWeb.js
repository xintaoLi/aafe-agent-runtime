import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeProjectArchitecture } from './analyze.js';

export async function runKnowledgeWebCommand(root, args = []) {
  const options = parseOptions(args);
  const report = await analyzeProjectArchitecture(root, options);
  const outputDir = path.join(root, options.output ?? '.docs/aafe-generated/knowledge-web');
  const generated = options.dryRun ? plannedFiles(outputDir) : await generateSite(outputDir, report, root);
  const result = { status: 'pass', command: 'aafe knowledge-web', outputDir, generated, counts: report.counts, summary: options.dryRun ? 'Would generate modular Knowledge Web pages.' : 'Modular Knowledge Web generated.' };
  if (!options.dryRun && options.serve) await serveSite(outputDir, options, result);
  else console.log(JSON.stringify(result, null, 2));
}

async function generateSite(outputDir, report, root) {
  await mkdir(path.join(outputDir, 'diagrams'), { recursive: true });
  const pages = {
    'index.html': renderShell('总览', renderOverview(report), report),
    'modules.html': renderShell('模块关系', renderModules(report), report),
    'routes.html': renderShell('路由与页面', renderRoutes(report), report),
    'components.html': renderShell('组件关系', renderComponents(report), report),
    'sources.html': renderShell('架构来源', renderSources(report, outputDir, root), report),
    'impact.html': renderShell('影响与测试', renderImpact(report), report)
  };
  const results = {};
  for (const [file, content] of Object.entries(pages)) results[file] = await writeIfChanged(path.join(outputDir, file), content);
  for (const source of report.architectureSources.filter((item) => item.kind === 'diagram')) {
    const sourcePath = path.join(root, source.file);
    const content = await safeRead(sourcePath);
    const file = `diagrams/${path.basename(source.file, path.extname(source.file))}.html`;
    results[file] = await writeIfChanged(path.join(outputDir, file), renderDiagram(source, content, report));
  }
  results['site.json'] = await writeIfChanged(path.join(outputDir, 'site.json'), JSON.stringify({ project: report.projectName, generatedAt: report.generatedAt, pages: Object.keys(pages), diagrams: report.architectureSources.filter((item) => item.kind === 'diagram').map((item) => item.file) }, null, 2) + '\n');
  return results;
}

async function serveSite(outputDir, options, result) {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    if (!/^[\w./-]+$/.test(relative) || relative.includes('..')) { response.writeHead(400); response.end('Bad request'); return; }
    const filePath = path.join(outputDir, relative);
    const content = await safeRead(filePath);
    if (!content) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'content-type': relative.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8' });
    response.end(content);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host, resolve); });
  const address = server.address();
  result.url = `http://${options.host}:${address.port}/`;
  result.summary = 'Modular Knowledge Web generated and served.';
  console.log(JSON.stringify(result, null, 2));
  if (!options.background) await new Promise(() => {});
}

function renderShell(title, body, report) {
  const nav = [['index.html', '总览'], ['modules.html', '模块关系'], ['routes.html', '路由与页面'], ['components.html', '组件关系'], ['sources.html', '架构来源'], ['impact.html', '影响与测试']].map(([href, label]) => `<a href="${href}">${label}</a>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - Knowledge Web</title><style>${styles()}</style></head><body><header><h1>Knowledge Web</h1><p>${escapeHtml(report.projectName)} · ${escapeHtml(title)}</p></header><div class="layout"><aside>${nav}</aside><main><div class="crumb">Knowledge Web / ${escapeHtml(title)}</div>${body}</main></div></body></html>`;
}

function renderOverview(report) { return `<h2>项目总览</h2><div class="cards">${[['扫描文件', report.counts.files], ['模块', report.counts.modules], ['路由', report.counts.routes], ['组件', report.counts.components], ['架构来源', report.counts.architectureSources]].map(([k, v]) => `<div class="card"><strong>${v}</strong><span>${k}</span></div>`).join('')}</div><section><h3>知识入口</h3><p>本站由项目源码、.docs 架构文档和 Mermaid 图动态生成。原始架构说明仍是事实来源。</p><ul><li>模块、路由和组件关系</li><li>架构来源与 Mermaid 在线预览</li><li>影响范围与测试预测</li></ul></section>`; }
function renderModules(report) { return `<h2>模块关系</h2><table><thead><tr><th>模块</th><th>文件数</th></tr></thead><tbody>${report.modules.map((x) => `<tr><td><code>${escapeHtml(x.name)}</code></td><td>${x.fileCount}</td></tr>`).join('')}</tbody></table>`; }
function renderRoutes(report) { return `<h2>路由与页面</h2><table><thead><tr><th>路由</th><th>组件</th><th>源码</th></tr></thead><tbody>${report.routes.map((x) => `<tr><td>${escapeHtml(x.path || '(unknown)')}</td><td>${escapeHtml(x.component || '')}</td><td><code>${escapeHtml(x.file)}</code></td></tr>`).join('')}</tbody></table>`; }
function renderComponents(report) { return `<h2>组件关系</h2><table><thead><tr><th>组件</th><th>类型</th><th>源码</th><th>Props / Emits</th></tr></thead><tbody>${report.components.map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.kind)}</td><td><code>${escapeHtml(x.file)}</code></td><td>${escapeHtml([...x.props, ...x.emits].join(', '))}</td></tr>`).join('')}</tbody></table>`; }
function renderSources(report, outputDir, root) { const list = report.architectureSources.map((x) => x.kind === 'diagram' ? `<li><b>图表</b> <code>${escapeHtml(x.file)}</code> <a href="${'diagrams/' + encodeURIComponent(path.basename(x.file, path.extname(x.file))) + '.html'}">本地预览</a> <a target="_blank" href="${mermaidLiveUrl(root, x.file)}">Mermaid Live</a></li>` : `<li><b>文档</b> <code>${escapeHtml(x.file)}</code> — ${escapeHtml(x.title)}</li>`).join(''); return `<h2>架构来源</h2><p>Mermaid 图支持本地源码预览，并可一键打开 Mermaid Live Editor。</p><ul class="sources">${list}</ul>`; }
function renderImpact(report) { return `<h2>影响范围与测试预测</h2><section><h3>当前基线</h3><p>扫描 ${report.counts.files} 个文件、${report.counts.routes} 个路由、${report.counts.components} 个组件，发现 ${report.counts.architectureSources} 个架构来源。</p></section><section><h3>直接影响</h3><p>变更文件所属模块、路由、组件和调用入口。</p><h3>间接影响</h3><p>相关 Store、API、Worker、缓存、存储和结果渲染链路。</p><h3>潜在影响</h3><p>共享组件、公共请求层、路由守卫、权限、降级和历史兼容路径。</p></section><section><h3>P0 · 必须测试</h3><p>变更模块的单元/组件测试和主用户路径。</p><h3>P1 · 推荐测试</h3><p>相关路由、Store、API、数据流、异常、取消、超时、竞态和降级路径。</p><h3>P2 · 回归测试</h3><p>共享组件、兼容版本、截图/流程回归和非核心模块。</p></section><p class="muted">此页面由 aafe knowledge-web 动态生成。它是预测基线，不代表测试已经执行或通过。实际任务完成后，AI 必须根据 diff 和 .docs 关系补充具体影响文件、测试命令和执行状态。</p>`; }
function renderDiagram(source, content, report) { const live = mermaidLiveUrlFromContent(content); return renderShell('Mermaid · ' + source.title, `<h2>${escapeHtml(source.title)}</h2><p><code>${escapeHtml(source.file)}</code></p><p><a class="button" target="_blank" href="${live}">在线打开 Mermaid Live Editor</a></p><pre class="diagram">${escapeHtml(content)}</pre>`, report); }
function mermaidLiveUrl(root, file) { return mermaidLiveUrlFromContent(''); }
function mermaidLiveUrlFromContent(content) { return `https://mermaid.live/edit#${Buffer.from(JSON.stringify({code: content || 'graph TD\nA[Open source file]'}, 'utf8')).toString('base64url')}`; }
function plannedFiles(outputDir) { return { outputDir, files: ['index.html', 'modules.html', 'routes.html', 'components.html', 'sources.html', 'impact.html', 'diagrams/*.html', 'site.json'] }; }
function parseOptions(args) { const options = { output: '.docs/aafe-generated/knowledge-web', host: '127.0.0.1', port: 4173, serve: false, background: false, dryRun: args.includes('--dry-run') }; for (const arg of args) { if (arg === '--serve') options.serve = true; if (arg === '--background') options.background = true; if (arg.startsWith('--output=')) options.output = arg.slice(9); if (arg.startsWith('--architecture-docs=')) options.architectureDocs = arg.slice(20); if (arg.startsWith('--port=')) options.port = Number.parseInt(arg.slice(7), 10) || options.port; if (arg.startsWith('--host=')) options.host = arg.slice(7); } return options; }
async function writeIfChanged(filePath, content) { const previous = await safeRead(filePath); if (previous === content) return 'unchanged'; await writeFile(filePath, content); return previous ? 'updated' : 'created'; }
async function safeRead(filePath) { try { return await readFile(filePath, 'utf8'); } catch { return ''; } }
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function styles() { return ':root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f4f7fb}*{box-sizing:border-box}body{margin:0}header{background:#101828;color:#fff;padding:25px 34px}header h1{margin:0 0 6px}header p{margin:0;color:#b8c4d6}.layout{display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 104px)}aside{background:#fff;border-right:1px solid #e5eaf1;padding:20px 14px}aside a{display:block;color:#475467;text-decoration:none;padding:10px 12px;border-radius:7px}aside a:hover{background:#eef4ff;color:#175cd3}main{padding:28px 36px;max-width:1500px}.crumb,.muted{color:#667085;font-size:13px}section{background:#fff;border:1px solid #e5eaf1;border-radius:12px;padding:20px;margin-top:20px}.cards{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:14px}.card{background:#fff;border:1px solid #e5eaf1;border-radius:12px;padding:18px}.card strong{display:block;font-size:28px;color:#175cd3}.card span{color:#667085;font-size:13px}table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #edf0f5;vertical-align:top}th{color:#667085;background:#f8fafc}code{font-family:ui-monospace,SFMono-Regular,monospace;color:#344054}.sources li{margin:0 0 14px}.button{display:inline-block;background:#175cd3;color:#fff;padding:9px 13px;border-radius:7px;text-decoration:none}.diagram{white-space:pre;overflow:auto;background:#101828;color:#d1e9ff;border-radius:10px;padding:18px;line-height:1.5}@media(max-width:850px){.layout{display:block}aside{border-right:0;border-bottom:1px solid #e5eaf1}.cards{grid-template-columns:repeat(2,1fr)}main{padding:20px}}'; }
