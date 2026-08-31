# Component Performance

```text
rows > 1000   → virtualization
rows > 10000  → virtualization + windowing
payload > 1MB → lazy / chunked render
complex DOM   → avoid whole-tree reactive
```

List and table primitives own this decision. Do not render 10k nodes to "keep it simple".
