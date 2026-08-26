// Notification system with auto-dismiss, stacking, and typed messages

let notificationId = 0;

export const createNotification = (message, type = "info", duration = 4000) => {
  const id = notificationId++;
  return { id, message, type, duration, createdAt: Date.now() };
};

export const notificationTypes = {
  success: "success",   // Green checkmark
  error: "error",       // Red warning
  info: "info",         // Blue info
  warning: "warning",   // Amber warning
  action: "action",     // Loading/action state
};

// Type-specific constructors with sensible defaults
export const notify = {
  success: (msg, duration = 3000) => createNotification(msg, "success", duration),
  error: (msg, duration = 5000) => createNotification(msg, "error", duration),
  info: (msg, duration = 4000) => createNotification(msg, "info", duration),
  warning: (msg, duration = 4000) => createNotification(msg, "warning", duration),
  action: (msg) => createNotification(msg, "action", 0), // No auto-dismiss
};
