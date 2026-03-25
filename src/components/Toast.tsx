import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Toast {
  id: number;
  message: string;
  type: "error" | "success" | "info";
}

let toastId = 0;
const listeners: Array<(toast: Toast) => void> = [];

export function showToast(message: string, type: "error" | "success" | "info" = "error") {
  const toast: Toast = { id: ++toastId, message, type };
  listeners.forEach((fn) => fn(toast));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 6000);
    };
    listeners.push(handler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 space-y-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-2 rounded-lg border p-3 shadow-lg backdrop-blur-sm animate-in slide-in-from-top ${
            toast.type === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : toast.type === "success"
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-blue-500/30 bg-blue-500/10 text-blue-400"
          }`}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p className="text-xs flex-1">{toast.message}</p>
          <button
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            className="shrink-0 opacity-50 hover:opacity-100"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
