export function createTemplatePlan(detection, options = {}) {
  const frameworks = normalizeList(options.frameworks ?? detection.framework);
  const scenarios = normalizeList(options.scenarios ?? detection.scenarios);
  const editors = normalizeList(options.editors ?? detection.editors);
  return {
    framework: frameworks[0] ?? 'generic',
    frameworks,
    scenarios,
    editors,
    memory: options.memory !== false,
    packs: {
      frameworks: frameworks.filter((item) => item && item !== 'generic'),
      scenarios
    }
  };
}

export function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

export function packageRecommendations(plan) {
  const packages = ['@aafe/core'];
  for (const framework of plan.packs.frameworks) packages.push(`@aafe/${framework}`);
  for (const scenario of plan.packs.scenarios) packages.push(`@aafe/${scenario}`);
  for (const editor of plan.editors) packages.push(`@aafe/adapter-${editor}`);
  return [...new Set(packages)];
}
