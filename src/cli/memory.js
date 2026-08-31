import { MemoryStore } from '../memory/MemoryStore.js';
import { MemoryRuntime } from '../memory/MemoryRuntime.js';
import { loadMemoryConfig } from '../memory/config.js';
import { scanProjectMemory } from '../memory/CodeScanner.js';

export async function runMemoryCommand(root, args) {
  const action = args[0] ?? 'help';
  const options = parseMemoryOptions(args.slice(1));
  const config = await loadMemoryConfig(root);
  const store = new MemoryStore(root, { memoryDir: config.memoryDir });

  if (action === 'init') {
    await store.init();
    console.log('AAFE memory initialized.');
    return;
  }

  if (action === 'add') {
    const content = options.content || options.rest.join(' ');
    if (!content) throw new Error('Missing memory content. Usage: aafe memory add <content> --type=design --tags=a,b');
    const record = await store.add({
      type: options.type ?? 'learning',
      title: options.title,
      content,
      tags: options.tags,
      source: 'cli'
    });
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (action === 'list') {
    const records = await store.list({ type: options.type, tag: options.tag });
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (action === 'search') {
    const query = options.query || options.rest.join(' ');
    const records = await store.search(query);
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (action === 'context') {
    const query = options.query || options.rest.join(' ');
    console.log(await store.context(query, Number(options.limit ?? 8)));
    return;
  }

  if (action === 'summary') {
    console.log(await store.summarize());
    return;
  }

  if (action === 'compact') {
    console.log(JSON.stringify(await store.compact(), null, 2));
    return;
  }

  if (action === 'remote-status') {
    const runtime = new MemoryRuntime(root, { config });
    console.log(JSON.stringify(await runtime.remoteStatus(), null, 2));
    return;
  }

  if (action === 'sync' || action === 'upload') {
    const runtime = new MemoryRuntime(root, { config });
    const direction = action === 'upload' || options.push ? 'push' : 'pull';
    console.log(JSON.stringify(await runtime.sync({ direction, cursor: options.cursor }), null, 2));
    return;
  }

  if (action === 'scan') {
    const memories = await scanProjectMemory(root, { target: options.target, limit: Number(options.limit ?? 300) });
    const written = [];
    for (const memory of memories) written.push(await store.add(memory));
    console.log(JSON.stringify({ scanned: memories.length, written: written.filter((item) => !item.duplicate).length, duplicates: written.filter((item) => item.duplicate).length }, null, 2));
    return;
  }

  printMemoryHelp();
}

function parseMemoryOptions(args) {
  const options = { rest: [] };
  for (const arg of args) {
    if (arg.startsWith('--type=')) options.type = arg.slice('--type='.length);
    else if (arg.startsWith('--title=')) options.title = arg.slice('--title='.length);
    else if (arg.startsWith('--tags=')) options.tags = arg.slice('--tags='.length);
    else if (arg.startsWith('--tag=')) options.tag = arg.slice('--tag='.length);
    else if (arg.startsWith('--query=')) options.query = arg.slice('--query='.length);
    else if (arg.startsWith('--content=')) options.content = arg.slice('--content='.length);
    else if (arg.startsWith('--limit=')) options.limit = arg.slice('--limit='.length);
    else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
    else if (arg.startsWith('--cursor=')) options.cursor = arg.slice('--cursor='.length);
    else if (arg === '--push') options.push = true;
    else if (arg === '--pull') options.pull = true;
    else options.rest.push(arg);
  }
  return options;
}

function printMemoryHelp() {
  console.log(`aafe memory <command>

Commands:
  init                         Initialize project memory files
  add <content>                Add a memory entry
  list [--type=design]         List memory entries
  search <query>               Search memory entries
  context <query>              Print compact memory context
  summary                      Regenerate and print memory summary
  compact                      Remove duplicate memories and rebuild topics
  scan [--target=src]          Learn components and conventions from code
  remote-status                 Show configured Memory remote status
  sync --push|--pull            Sync memory through a configured future MCP adapter
  upload                        Alias for sync --push

Types:
  design | component | habit | convention | decision | experience | project-architecture | learning
`);
}
