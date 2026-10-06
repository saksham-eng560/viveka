import { vi } from "vitest";

type Store = Record<string, unknown>;

export interface MockTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  active?: boolean;
  audible?: boolean;
  pinned?: boolean;
  incognito?: boolean;
  lastAccessed?: number;
  groupId?: number;
}

export interface ChromeMock {
  store: Store;
  tabs: MockTab[];
  groups: { id: number; title: string; windowId: number }[];
  api: typeof chrome;
}

export interface MockEvent<F extends (...a: never[]) => void> {
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  listeners: Set<F>;
  fire: (...args: Parameters<F>) => void;
}

export function mockEvent<F extends (...a: never[]) => void>(): MockEvent<F> {
  const listeners = new Set<F>();
  return {
    listeners,
    addListener: vi.fn((fn: F) => void listeners.add(fn)),
    removeListener: vi.fn((fn: F) => void listeners.delete(fn)),
    fire: (...args) => listeners.forEach((fn) => fn(...args)),
  };
}

export interface MockExtensionInfo {
  id: string;
  name: string;
  version?: string;
  type?: string;
  enabled?: boolean;
  mayDisable?: boolean;
  mayEnable?: boolean;
  installType?: string;
  icons?: { size: number; url: string }[];
}

/** Install a fake chrome.management backed by a mutable list; returns handles for assertions. */
export function installManagement(initial: MockExtensionInfo[]) {
  const list = initial.map((i) => ({
    version: "1.0",
    type: "extension",
    enabled: true,
    mayDisable: true,
    mayEnable: true,
    installType: "normal",
    ...i,
  }));
  const events = {
    onInstalled: mockEvent<() => void>(),
    onUninstalled: mockEvent<() => void>(),
    onEnabled: mockEvent<() => void>(),
    onDisabled: mockEvent<() => void>(),
  };
  const management = {
    getAll: vi.fn(async () => list.map((x) => ({ ...x }))),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      const x = list.find((e) => e.id === id);
      if (x) x.enabled = enabled;
    }),
    ...events,
  };
  (globalThis as unknown as { chrome: { management: unknown } }).chrome.management = management;
  return { list, management, events };
}

/** Minimal in-memory chrome.* implementation for unit tests. */
export function createChromeMock(initialTabs: MockTab[] = []): ChromeMock {
  const store: Store = {};
  const tabs = [...initialTabs];
  const groups: ChromeMock["groups"] = [];
  let nextGroup = 100;

  const pick = (keys: string | string[] | null | undefined): Store => {
    if (keys == null) return { ...store };
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  };

  const api = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => pick(keys)),
        set: vi.fn(async (items: Store) => {
          for (const [k, v] of Object.entries(items)) store[k] = structuredClone(v);
        }),
      },
    },
    runtime: {
      id: "test-extension-id",
      sendMessage: vi.fn(async () => undefined),
      getURL: vi.fn((p: string) => `chrome-extension://test/${p}`),
      getManifest: vi.fn(() => ({ content_scripts: [{ js: ["content.js"] }] })),
      getContexts: vi.fn(async () => []),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
    },
    tabs: {
      query: vi.fn(async (q: { active?: boolean; windowId?: number } = {}) =>
        tabs.filter((t) => (q.active === undefined || !!t.active === q.active) && (q.windowId === undefined || t.windowId === q.windowId)),
      ),
      get: vi.fn(async (id: number) => {
        const t = tabs.find((x) => x.id === id);
        if (!t) throw new Error("No tab");
        return t;
      }),
      update: vi.fn(async (id: number, props: { active?: boolean }) => {
        if (props.active) tabs.forEach((t) => (t.active = t.id === id));
        return tabs.find((t) => t.id === id);
      }),
      sendMessage: vi.fn(async () => undefined),
      group: vi.fn(async (opts: { groupId?: number; tabIds: number[]; createProperties?: { windowId?: number } }) => {
        const id = opts.groupId ?? nextGroup++;
        if (opts.groupId === undefined) groups.push({ id, title: "", windowId: opts.createProperties?.windowId ?? 1 });
        for (const tid of opts.tabIds) {
          const t = tabs.find((x) => x.id === tid);
          if (t) t.groupId = id;
        }
        return id;
      }),
      remove: vi.fn(async () => undefined),
      create: vi.fn(async (props: { url?: string }) => ({ id: 999, ...props })),
    },
    // chrome.management is an optional permission: it is absent until a test installs it (see installManagement).
    permissions: {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => false),
      onRemoved: mockEvent<(p: { permissions?: string[] }) => void>(),
    },
    tabGroups: {
      update: vi.fn(async (id: number, props: { title?: string }) => {
        const g = groups.find((x) => x.id === id);
        if (g && props.title) g.title = props.title;
        return g;
      }),
      query: vi.fn(async (q: { windowId?: number; title?: string }) =>
        groups.filter((g) => (q.windowId === undefined || g.windowId === q.windowId) && (q.title === undefined || g.title === q.title)),
      ),
    },
    windows: {
      getCurrent: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => ({})),
      WINDOW_ID_NONE: -1,
    },
    tts: { speak: vi.fn(), stop: vi.fn() },
    alarms: { create: vi.fn(async () => undefined) },
    scripting: { executeScript: vi.fn(async () => []) },
  };

  return { store, tabs, groups, api: api as unknown as typeof chrome };
}

export function installChrome(initialTabs: MockTab[] = []): ChromeMock {
  const mock = createChromeMock(initialTabs);
  (globalThis as unknown as { chrome: typeof chrome }).chrome = mock.api;
  return mock;
}

/** Build a fetch Response-like object for mocked Ollama / ActivityWatch calls. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
