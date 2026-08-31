# UI Performance Rules

UI-PERF-001

Rows > 1000 require virtualization. Rows > 10000 require virtualization + windowing.

UI-PERF-002

Payload > 1MB requires lazy or chunked rendering.

UI-PERF-003

Avoid layout thrashing and whole-tree reactive updates on large DOM.

UI-PERF-004

Images are sized, lazy where offscreen, and never used as CSS layout hacks.

UI-PERF-005

Animation MUST NOT run continuously on large lists.

UI-PERF-006

Coordinate with the AAFE performance pipeline when the bottleneck is render/DOM, not the network.
