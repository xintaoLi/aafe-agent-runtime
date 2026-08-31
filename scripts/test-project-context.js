import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentRuntime } from '../src/agent-platform/skill-runtime/AgentRuntime.js';
import { discoverProjectContext } from '../src/project/projectContext.js';

const runtimeRoot = path.resolve(import.meta.dirname, '..');
const context = await discoverProjectContext('/root/workspace/github/bk-monitor/bklog/web');

assert.equal(context.root, '/root/workspace/github/bk-monitor/bklog/web');
assert.equal(context.projectName, 'blueking-log');
assert.ok(context.rules.some((entry) => entry.source.endsWith('.aafe/rules/git-workflow.md')));
assert.ok(context.skills.some((entry) => entry.source.endsWith('.aafe/skills/tapd-git-pr/SKILL.md')));
assert.ok(context.layers.some((layer) => layer.scope === 'workspace'));
assert.equal((await discoverProjectContext(runtimeRoot)).projectName, '@aafe/agent-runtime');

const fixture = await mkdtemp(path.join(os.tmpdir(), 'aafe-project-context-'));
try {
  const project = path.join(fixture, 'project');
  const sibling = path.join(fixture, 'sibling');
  await mkdir(path.join(project, '.aafe/rules'), { recursive: true });
  await mkdir(path.join(project, '.aafe/skills/demo'), { recursive: true });
  await mkdir(path.join(sibling, '.aafe/rules'), { recursive: true });
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'single-project' }));
  await writeFile(path.join(sibling, 'package.json'), JSON.stringify({ name: 'sibling-project' }));
  await writeFile(path.join(project, '.aafe/rules/project.md'), '# project rule');
  await writeFile(path.join(project, '.aafe/skills/demo/SKILL.md'), '# project skill');
  await writeFile(path.join(sibling, '.aafe/rules/sibling.md'), '# sibling rule');

  const isolated = await discoverProjectContext(project);
  assert.equal(isolated.root, project);
  assert.equal(isolated.projectName, 'single-project');
  assert.ok(isolated.rules.some((entry) => entry.source.endsWith('project.md')));
  assert.ok(isolated.skills.some((entry) => entry.source.endsWith('SKILL.md')));
  assert.ok(!isolated.rules.some((entry) => entry.source.includes('sibling')));

  let observed;
  const runtime = new AgentRuntime({
    root: project,
    projectContext: isolated,
    router: { routes: { feature: { pipeline: 'feature' } } },
    gates: {},
    pipelines: { feature: { steps: [{ skill: 'project-context-probe' }] } },
    skills: {
      'project-context-probe': {
        async run(ctx) {
          observed = ctx.projectContext;
          return { status: 'pass', summary: 'project context observed' };
        }
      }
    },
    memory: false
  });
  const result = await runtime.execute({ prompt: 'implement a feature' });
  assert.equal(result.trace[0].name, 'project-context-probe');
  assert.equal(observed.root, project);
  assert.ok(observed.skills.some((entry) => entry.source.endsWith('SKILL.md')));
  assert.ok(!observed.rules.some((entry) => entry.source.includes('sibling')));
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log('project context tests passed');
