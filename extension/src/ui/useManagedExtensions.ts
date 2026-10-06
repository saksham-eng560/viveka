import { useCallback, useEffect, useRef, useState } from "react";

export type ExtPermission = "checking" | "granted" | "denied";

export interface ManagedExtension {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  mayDisable: boolean;
  mayEnable: boolean;
  installType: "admin" | "development" | "normal" | "sideload" | "other";
  iconUrl: string | null;
}

export interface UseManagedExtensions {
  permission: ExtPermission;
  extensions: ManagedExtension[];
  installedIds: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  notice: string | null;
  busyId: string | null;
  requestAccess: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const MANAGEMENT: chrome.permissions.Permissions = { permissions: ["management"] };
const EMPTY: ReadonlySet<string> = new Set();

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function toManaged(info: chrome.management.ExtensionInfo): ManagedExtension {
  const icons = [...(info.icons ?? [])].sort((a, b) => b.size - a.size);
  return {
    id: info.id,
    name: info.name,
    version: info.version,
    enabled: info.enabled,
    mayDisable: info.mayDisable,
    mayEnable: info.mayEnable ?? true,
    installType: info.installType,
    iconUrl: icons[0]?.url ?? null,
  };
}

/**
 * Installed-extension list with on/off control. chrome.management is an optional permission, so it
 * is undefined until the user grants it; every access is guarded and happens inside this page
 * (permissions.request needs the click's user gesture, which does not survive runtime.sendMessage).
 */
export function useManagedExtensions(): UseManagedExtensions {
  const [permission, setPermission] = useState<ExtPermission>("checking");
  const [extensions, setExtensions] = useState<ManagedExtension[]>([]);
  const [installedIds, setInstalledIds] = useState<ReadonlySet<string>>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mounted = useRef(true);
  const seq = useRef(0);
  const namesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const api = chrome.management;
    if (!api) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const all = await api.getAll();
      if (!mounted.current || mine !== seq.current) return;
      const exts = all.filter((i) => i.type === "extension");
      const list = exts
        .filter((i) => i.id !== chrome.runtime.id)
        .map(toManaged)
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
      namesRef.current = new Map(list.map((x) => [x.id, x.name]));
      setExtensions(list);
      setInstalledIds(new Set(exts.map((i) => i.id)));
      setError(null);
    } catch (e) {
      if (mounted.current && mine === seq.current) setError(message(e));
    } finally {
      if (mounted.current && mine === seq.current) setLoading(false);
    }
  }, []);

  // Initial permission check.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let has = false;
      try {
        has = await chrome.permissions.contains(MANAGEMENT);
      } catch {
        has = false;
      }
      if (cancelled) return;
      setPermission(has ? "granted" : "denied");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While granted: load the list and follow install/enable changes.
  useEffect(() => {
    if (permission !== "granted") return;
    void refresh();
    const api = chrome.management;
    const onChange = () => void refresh();
    const onRemoved = (removed: chrome.permissions.Permissions) => {
      if (removed.permissions?.includes("management")) {
        seq.current++;
        setPermission("denied");
        setExtensions([]);
        setInstalledIds(EMPTY);
        setError(null);
        setLoading(false);
      }
    };
    const events = api ? [api.onInstalled, api.onUninstalled, api.onEnabled, api.onDisabled] : [];
    for (const ev of events) ev?.addListener(onChange);
    chrome.permissions.onRemoved?.addListener(onRemoved);
    return () => {
      for (const ev of events) ev?.removeListener(onChange);
      chrome.permissions.onRemoved?.removeListener(onRemoved);
    };
  }, [permission, refresh]);

  // Must be called synchronously from the click handler: permissions.request is the first call.
  const requestAccess = useCallback(async () => {
    const pending = chrome.permissions.request(MANAGEMENT);
    setNotice(null);
    let granted = false;
    try {
      granted = await pending;
    } catch {
      granted = false;
    }
    if (!mounted.current) return;
    if (granted) setPermission("granted");
    else {
      setPermission("denied");
      setNotice("Access was not granted. Quick add still works.");
    }
  }, []);

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const api = chrome.management;
      if (!api) return;
      setNotice(null);
      setBusyId(id);
      try {
        await api.setEnabled(id, enabled);
      } catch (e) {
        if (mounted.current) setNotice(`Could not change ${namesRef.current.get(id) ?? "that extension"}: ${message(e)}`);
      }
      await refresh();
      if (mounted.current) setBusyId(null);
    },
    [refresh],
  );

  return { permission, extensions, installedIds, loading, error, notice, busyId, requestAccess, setEnabled, refresh };
}
