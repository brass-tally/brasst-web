import React, { useEffect, useState } from "react";
import { Check, AlertCircle, Info, AlertTriangle, Loader2, X } from "lucide-react";

export function Toast({ notification, onDismiss, palette }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onDismiss(notification.id), 150);
      }, notification.duration);
      return () => clearTimeout(timer);
    }
  }, [notification.duration, notification.id, onDismiss]);

  const typeConfig = {
    success: {
      icon: Check,
      bg: palette.credit,
      text: "#fff",
    },
    error: {
      icon: AlertCircle,
      bg: palette.debit,
      text: "#fff",
    },
    warning: {
      icon: AlertTriangle,
      bg: palette.brass,
      text: palette.bg,
    },
    info: {
      icon: Info,
      bg: palette.line,
      text: palette.text,
    },
    action: {
      icon: Loader2,
      bg: palette.surface,
      text: palette.text,
      spin: true,
    },
  };

  const config = typeConfig[notification.type] || typeConfig.info;
  const Icon = config.icon;

  return (
    <div
      className={`toast-notification ${isExiting ? "toast-exit" : "toast-enter"}`}
      style={{
        background: config.bg,
        color: config.text,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div className="flex items-center gap-2">
        <Icon
          size={18}
          className={config.spin ? "animate-spin" : ""}
          style={{ flexShrink: 0 }}
        />
        <span className="text-sm font-medium flex-1">{notification.message}</span>
        <button
          onClick={() => {
            setIsExiting(true);
            setTimeout(() => onDismiss(notification.id), 150);
          }}
          className="p-1 hover:opacity-70 transition-opacity"
          style={{ display: "flex", alignItems: "center" }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function ToastContainer({ notifications, onDismiss, palette }) {
  return (
    <div className="fixed z-50 left-1/2 bottom-20 pointer-events-none" style={{ transform: "translateX(-50%)", maxWidth: "calc(100vw - 24px)" }}>
      <div className="flex flex-col gap-2 items-center" style={{ pointerEvents: "auto" }}>
        {notifications.map((notif) => (
          <Toast
            key={notif.id}
            notification={notif}
            onDismiss={onDismiss}
            palette={palette}
          />
        ))}
      </div>
    </div>
  );
}
