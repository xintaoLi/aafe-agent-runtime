# Component Selection

Do not jump to a component name. Walk the decision tree.

Picker / 选择器:

```text
选择数量？
     │
     ├── 2~5 个 → Radio / Toggle
     ├── 5~20 个 → Select
     ├── 20+ 个 → Combobox
     ├── 多选 → MultiSelect
     ├── 层级 → Cascader
     └── 大量 / 异步数据 → Async Combobox
```

Also weigh: data volume, frequency, search, multi-select, async, mobile, keyboard.

Compose > Create. If the project already has a matching primitive, use it.
