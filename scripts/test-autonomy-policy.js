import assert from 'node:assert/strict';
import { AutonomyPolicy, createBlocker, buildTaskPrompt } from '../src/index.js';
import { attachWeComNotifier } from '../ai-bots/wecom/src/notify.js';

const policy = new AutonomyPolicy();
assert.equal(policy.assess({ missingInformation: [{ kind: 'discoverable', description: 'test config' }] }).action, 'continue');
assert.equal(policy.assess({ missingInformation: [{ kind: 'defaultable', description: 'test name', default: 'feature.spec.js' }], risk: { level: 'low' } }).action, 'continue_with_assumption');
assert.equal(policy.assess({ missingInformation: [{ kind: 'blocking', question: 'login' }], currentStep: { independentSteps: ['inspect source'] } }).action, 'execute_independent_steps');
assert.equal(policy.assess({ missingInformation: [{ kind: 'blocking', question: 'allow push' }], risk: { requiresApproval: true } }).action, 'request_approval');
assert.equal(policy.assess({ missingInformation: [{ kind: 'blocking', question: 'expected result' }] }).action, 'request_input');
assert.equal(createBlocker({ taskId: 't1', stepId: 'login', requirement: ' Need Login ' }).id,
  createBlocker({ taskId: 't1', stepId: 'login', requirement: 'need   login' }).id);
const prompt = buildTaskPrompt({ id: 't1', goal: 'fix', provider: 'cursor' }, { intent: { kind: 'code' } });
assert.match(prompt, /AUTONOMOUS EXECUTION POLICY/);
assert.match(prompt, /execute every independent step first/i);

let listener; let sent = 0;
const blockedTask = { id: 't-wait', status: 'waiting_user', requirement: 'fix', updatedAt: '2026-09-15T00:00:00.000Z',
  blocker: createBlocker({ taskId: 't-wait', requirement: 'login' }), source: { type: 'wecom', conversationId: 'chat-1', chatType: 'group' },
  result: { text: '请完成登录' } };
const manager = { subscribe(fn) { listener = fn; return () => {}; }, get: async () => blockedTask };
attachWeComNotifier({ manager, supportsTemplateCard: () => false, sendMessage: async () => { sent += 1; } });
listener({ type: 'task.blocked', taskId: blockedTask.id, task: blockedTask });
listener({ type: 'task.blocked', taskId: blockedTask.id, task: blockedTask });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(sent, 1);
console.log('autonomy policy tests passed');
