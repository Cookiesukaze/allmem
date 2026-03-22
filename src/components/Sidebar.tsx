import { LayoutDashboard, FolderOpen, User, Settings, MessageSquare, Lightbulb, Github } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useAppStore } from "../store";
import { clsx } from "clsx";

const NAV_ITEMS = [
  { id: "dashboard" as const, label: "概览", icon: LayoutDashboard },
  { id: "projects" as const, label: "项目", icon: FolderOpen },
  { id: "experiences" as const, label: "经验 / 技能", icon: Lightbulb },
  { id: "chat" as const, label: "对话", icon: MessageSquare },
  { id: "user" as const, label: "用户", icon: User },
  { id: "settings" as const, label: "设置", icon: Settings },
];

export function Sidebar() {
  const { activePage, setActivePage } = useAppStore();

  return (
    <aside className="w-52 flex-shrink-0 bg-card/50 border-r border-border flex flex-col">
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={clsx(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
              activePage === item.id
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-border space-y-1.5">
        <button
          onClick={() => open("https://github.com/Cookiesukaze/allmem")}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground/60 hover:text-primary rounded transition-colors"
        >
          <Github size={12} />
          <span>GitHub</span>
        </button>
        <p className="text-[10px] text-muted-foreground/60 text-center">
          AllMem v0.1.0
        </p>
      </div>
    </aside>
  );
}
