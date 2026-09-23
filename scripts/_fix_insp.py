from pathlib import Path

root = Path(r"D:\tool\SuQCanvas")

# Inspector: insert netease section after 名称
p = root / "src/components/InspectorPanel.tsx"
t = p.read_text(encoding="utf-8")
anchor = """          {selectedEditableNodes.length === 1 && firstNode.data.ai && <Section title="AI 生成信息">"""
insert = """          {selectedEditableNodes.length === 1 && firstNode.data.kind === 'netease' && (
            <Section title="网易云">
              <div className="space-y-2">
                <input
                  value={firstNode.data.neteaseId ?? ''}
                  onChange={(e) => updateNodeData(firstNode.id, { neteaseId: e.target.value.trim() })}
                  placeholder="歌曲/歌单 ID 或 music.163.com 链接"
                  className="w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-main outline-none focus:border-rose-500"
                />
                <input
                  value={firstNode.data.neteaseCoverUrl ?? ''}
                  onChange={(e) => updateNodeData(firstNode.id, { neteaseCoverUrl: e.target.value.trim() || undefined })}
                  placeholder="封面图 HTTPS 链接（可选）"
                  className="w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-main outline-none focus:border-rose-500"
                />
                <button
                  type="button"
                  className="w-full rounded-md bg-rose-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-rose-400"
                  onClick={() => {
                    void import('../store/neteaseStore').then(({ useNeteaseStore }) => {
                      void useNeteaseStore.getState().openPanel(firstNode.data.neteaseId || null)
                    })
                  }}
                >
                  在网易云面板中打开
                </button>
              </div>
            </Section>
          )}
"""
if "firstNode.data.kind === 'netease'" not in t:
    if anchor not in t:
        raise SystemExit("inspector anchor not found")
    t = t.replace(anchor, insert + anchor, 1)
    p.write_text(t, encoding="utf-8", newline="\n")
    print("inspector: inserted")
else:
    print("inspector: already present")

# remove temp script
tmp = root / "scripts/_wire_netease.py"
if tmp.exists():
    tmp.unlink()
    print("cleaned temp script")

# verification summary
for rel in [
    "desktop/netease.cjs",
    "desktop/netease.test.cjs",
    "src/media/netease.ts",
    "src/media/netease.test.ts",
    "src/store/neteaseStore.ts",
    "src/components/NeteasePanel.tsx",
    "src/canvas/nodes/NeteaseNode.tsx",
]:
    ok = (root / rel).exists()
    print(f"{rel}: {ok}")
    if not ok:
        raise SystemExit(f"missing {rel}")
print("files ok")
