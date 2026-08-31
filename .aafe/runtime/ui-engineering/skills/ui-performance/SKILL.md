# UI Performance

## Purpose

Render cost for large lists, tables, JSON and text.

## Thresholds

data > 1000 → virtualization
data > 10000 → virtualization + windowing
content > 1MB → lazy / chunking

## Link

When the bottleneck is network or JS parse, also use the AAFE performance pipeline. This skill owns DOM/render.

## Schema

`.aafe/runtime/ui-engineering/schemas/ui-ux.schema.json`
