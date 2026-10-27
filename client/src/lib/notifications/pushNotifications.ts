/**
 * Zero-Knowledge Client-Side Web Push & Local Reminders Manager
 *
 * Runs entirely in the client browser:
 * - Does not send bill details, merchant names, or amounts to remote push servers.
 * - Prompts for notification permission and registers the Service Worker (/sw.js).
 * - Fires native notifications for due/upcoming bills when user has opted in.
 */

export interface NotificationStatus {
  isSupported: boolean;
  permission: NotificationPermission;
}

export function checkNotificationSupport(): NotificationStatus {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return {
      isSupported: false,
      permission: "default",
    };
  }

  return {
    isSupported: true,
    permission: Notification.permission,
  };
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return reg;
  } catch (err) {
    console.warn("Service worker registration failed:", err);
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }

  try {
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      await registerServiceWorker();
    }
    return perm;
  } catch (err) {
    console.warn("Error requesting notification permission:", err);
    return "denied";
  }
}

/**
 * Triggers a native notification for an upcoming or due bill via ServiceWorkerRegistration.
 * Plaintext details remain strictly inside the local browser instance.
 */
export async function sendLocalBillNotification(title: string, body: string): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  try {
    const reg = await registerServiceWorker();
    if (reg && reg.showNotification) {
      await reg.showNotification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        data: { url: "/bills" },
        tag: `bill-reminder-${Date.now()}`,
      });
      return true;
    } else {
      new Notification(title, {
        body,
        icon: "/favicon.ico",
      });
      return true;
    }
  } catch (err) {
    console.warn("Failed to fire native notification:", err);
    return false;
  }
}
