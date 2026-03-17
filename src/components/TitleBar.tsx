import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-9 px-3 bg-card border-b border-border select-none"
    >
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center">
          <span className="text-xs font-bold text-primary">A</span>
        </div>
        <span className="text-xs font-medium text-muted-foreground">AllMem</span>
      </div>

      <div className="flex items-center">
        <button
          onClick={() => appWindow.minimize()}
          className="w-8 h-8 flex items-center justify-center hover:bg-secondary rounded transition-colors"
        >
          <Minus size={12} className="text-muted-foreground" />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-8 h-8 flex items-center justify-center hover:bg-secondary rounded transition-colors"
        >
          <Square size={10} className="text-muted-foreground" />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-8 h-8 flex items-center justify-center hover:bg-red-500/10 rounded transition-colors group"
        >
          <X size={12} className="text-muted-foreground group-hover:text-red-500" />
        </button>
      </div>
    </div>
  );
}
