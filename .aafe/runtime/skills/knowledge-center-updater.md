# Skill: Knowledge Center Updater

After every feature, fix, refactor or architecture change:

1. Run aafe knowledge update in the target project.
2. Run aafe knowledge-web to refresh the modular visual Knowledge Web from `.aafe/analyze`.
3. Read the current .docs architecture sources and Mermaid diagrams.
4. Update generated relationship views under `.aafe/docs/`.
5. Preserve original .docs documents and only update generated views automatically.
6. Use the generated views as Knowledge Center input.
7. Update the modular impact.html page with the current impact scope and recommended tests.
8. Run the mandatory architecture impact and test forecast before reporting completion.

Generated views:
- .aafe/docs/knowledge-web/
- .aafe/docs/组件关系.md
- .aafe/docs/业务关系与数据流.md
- .aafe/docs/影响范围与测试预测.md

Knowledge Web reads analyze facts (`manifest.json` / `modules/` / `knowledge/`), not the legacy `.docs/aafe-generated` tree.

Do not claim that generated documentation is a complete business truth. Include source paths, scan version and unresolved conflicts.
