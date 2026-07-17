"use client";

import { useEffect, useRef } from "react";

const NAVIGATION_REQUEST_EVENT = "execution-lab-navigation-request";

type NavigationRequestDetail = {
  action: string;
  destination?: string;
};

type NavigationGuard = (action: string) => boolean;

type BrowserNavigationEvent = Event & {
  destination: { url: string };
};

type BrowserNavigation = EventTarget;

function browserNavigation() {
  return (window as Window & { navigation?: BrowserNavigation }).navigation;
}

function isSameDocumentAnchor(destination: URL) {
  return (
    destination.origin === window.location.origin &&
    destination.pathname === window.location.pathname &&
    destination.search === window.location.search &&
    destination.hash !== window.location.hash
  );
}

export function requestWorkstationNavigation(action: string, destination?: string) {
  if (typeof window === "undefined") return true;
  return window.dispatchEvent(
    new CustomEvent<NavigationRequestDetail>(NAVIGATION_REQUEST_EVENT, {
      cancelable: true,
      detail: { action, destination },
    }),
  );
}

export function useWorkstationNavigationGuard(guard: NavigationGuard) {
  const guardRef = useRef(guard);

  useEffect(() => {
    guardRef.current = guard;
  }, [guard]);

  useEffect(() => {
    let allowedDestination: { url: string | null; expiresAt: number } | null = null;

    const rememberAllowedNavigation = (destination?: string, durationMs = 500) => {
      allowedDestination = {
        url: destination ? new URL(destination, window.location.href).href : null,
        expiresAt: Date.now() + durationMs,
      };
    };

    const consumeAllowedNavigation = (destination: string) => {
      if (!allowedDestination || allowedDestination.expiresAt < Date.now()) {
        allowedDestination = null;
        return false;
      }
      if (allowedDestination.url && allowedDestination.url !== destination) return false;
      allowedDestination = null;
      return true;
    };

    const requestNavigation = (action: string, destination?: string, durationMs = 500) => {
      const allowed = guardRef.current(action);
      if (allowed) rememberAllowedNavigation(destination, durationMs);
      return allowed;
    };

    const handleRequest = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<NavigationRequestDetail>;
      if (!requestNavigation(
        event.detail?.action || "leave this page",
        event.detail?.destination,
        event.detail?.destination ? 500 : 5_000,
      )) {
        event.preventDefault();
      }
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (isSameDocumentAnchor(destination)) return;
      if (destination.href === window.location.href) return;

      const action = anchor.dataset.navigationAction || "leave this page";
      if (requestNavigation(action, destination.href)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    const navigation = browserNavigation();
    const handleBrowserNavigation = (rawEvent: Event) => {
      const event = rawEvent as BrowserNavigationEvent;
      const destination = event.destination?.url;
      if (!destination || consumeAllowedNavigation(destination)) return;
      if (isSameDocumentAnchor(new URL(destination))) return;
      if (!guardRef.current("use browser navigation")) event.preventDefault();
    };

    window.addEventListener(NAVIGATION_REQUEST_EVENT, handleRequest);
    document.addEventListener("click", handleDocumentClick, true);
    navigation?.addEventListener("navigate", handleBrowserNavigation);
    return () => {
      window.removeEventListener(NAVIGATION_REQUEST_EVENT, handleRequest);
      document.removeEventListener("click", handleDocumentClick, true);
      navigation?.removeEventListener("navigate", handleBrowserNavigation);
    };
  }, []);
}
