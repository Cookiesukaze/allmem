import { useEffect, useState } from "react";
import { Save, Pencil } from "lucide-react";
import { loadUserMemory, saveUserMemory, loadUserInstructions, saveUserInstructions } from "../core/storage";
import { MarkdownView } from "../components/MarkdownView";

export function UserPage() {
  const [memory, setMemory] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");

  useEffect(() => {
    loadUserMemory().then((m) => setMemory(m ?? "")).catch(console.error);
    loadUserInstructions().then(setInstructions).catch(console.error);
  }, []);

  const handleSaveMemory = async () => {
    await saveUserMemory(editContent, "手动编辑");
    setMemory(editContent);
    setEditing(false);
  };

  const handleSaveInstructions = async () => {
    await saveUserInstructions(instructionsDraft);
    setInstructions(instructionsDraft);
    setEditingInstructions(false);
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-semibold">用户</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          自动提取的画像 + 你希望所有AI记住的全局信息
        </p>
      </div>

      {/* Global Instructions */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-medium">全局使用说明</h3>
            <p className="text-[10px] text-muted-foreground">你希望模型始终记住的信息，注入上下文时会一起加载</p>
          </div>
          {editingInstructions ? (
            <div className="flex gap-1.5">
              <button
                onClick={handleSaveInstructions}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                <Save size={10} />
                保存
              </button>
              <button
                onClick={() => setEditingInstructions(false)}
                className="px-2 py-0.5 text-xs rounded border border-border hover:bg-secondary"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setInstructionsDraft(instructions);
                setEditingInstructions(true);
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil size={10} />
              编辑
            </button>
          )}
        </div>

        {editingInstructions ? (
          <textarea
            value={instructionsDraft}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            className="w-full h-40 bg-transparent text-sm font-mono resize-none outline-none"
            placeholder="例如：我习惯用 TypeScript + React，回答请用中文，代码注释用英文..."
          />
        ) : (
          <div className="min-h-[2rem]">
            {instructions ? (
              <MarkdownView content={instructions} />
            ) : (
              <p className="text-sm text-muted-foreground">
                暂无。点击编辑添加你希望AI始终记住的信息。
              </p>
            )}
          </div>
        )}
      </div>

      {/* Auto-generated Profile */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-medium">用户画像</h3>
            <p className="text-[10px] text-muted-foreground">自动从对话中提取的个人信息</p>
          </div>
          {editing ? (
            <div className="flex gap-1.5">
              <button
                onClick={handleSaveMemory}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                <Save size={10} />
                保存
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-2 py-0.5 text-xs rounded border border-border hover:bg-secondary"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setEditContent(memory);
                setEditing(true);
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil size={10} />
              编辑
            </button>
          )}
        </div>

        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-96 bg-transparent text-sm font-mono resize-none outline-none"
            placeholder="输入用户画像..."
          />
        ) : (
          <div>
            {memory ? (
              <MarkdownView content={memory} />
            ) : (
              <p className="text-sm text-muted-foreground">
                暂无用户画像。请先执行同步，系统会自动从你的AI对话中提取个人信息。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
