import { useState } from "react";
import { FOCUS_PACK, type FocusPackItem } from "../shared/focusPack";
import { quoteFor } from "../shared/quotes";
import { Button, Card, ErrorBlock, Notice, QuoteBlock, SectionTitle, Switch } from "../ui/Controls";
import { useManagedExtensions, type ManagedExtension } from "../ui/useManagedExtensions";

function ExtensionIcon({ ext }: { ext: ManagedExtension }) {
  const [failed, setFailed] = useState(false);
  const dim = { filter: ext.enabled ? undefined : "grayscale(1)", opacity: ext.enabled ? undefined : 0.6 };
  if (!ext.iconUrl || failed) {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-tint-saffron font-serif text-sm font-semibold text-heading"
        style={dim}
        data-testid="ext-avatar"
        aria-hidden="true"
      >
        {(ext.name.trim()[0] ?? "?").toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={ext.iconUrl}
      width={28}
      height={28}
      alt=""
      className="h-7 w-7 shrink-0 rounded-[6px]"
      style={dim}
      onError={() => setFailed(true)}
    />
  );
}

function QuickAddRow({
  item,
  permissionGranted,
  installed,
  enabled,
  onAdd,
}: {
  item: FocusPackItem;
  permissionGranted: boolean;
  installed: boolean;
  enabled: boolean;
  onAdd: (item: FocusPackItem) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2" data-testid={`pack-${item.id}`}>
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold leading-5 text-ink">
          <span className="truncate">{item.name}</span>
          {item.optional && (
            <span className="shrink-0 rounded-full bg-bg px-1.5 text-[11px] font-medium leading-[15px] text-muted ring-1 ring-line-strong">
              Optional
            </span>
          )}
        </p>
        <p className="m-0 text-xs leading-[17px] text-muted">{item.purpose}</p>
      </div>
      {permissionGranted && installed ? (
        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-ink">
          <span style={{ color: "var(--lh-ok)" }} aria-hidden="true">✓</span> Installed{enabled ? "" : " · off"}
        </span>
      ) : (
        <Button
          className="shrink-0 py-1! text-xs"
          aria-label={`Add ${item.name} from the Chrome Web Store`}
          onClick={() => onAdd(item)}
        >
          Add
        </Button>
      )}
    </li>
  );
}

function ExtensionRow({
  ext,
  busy,
  onToggle,
}: {
  ext: ManagedExtension;
  busy: boolean;
  onToggle: (id: string, next: boolean) => void;
}) {
  const locked = ext.enabled ? !ext.mayDisable : !ext.mayEnable;
  const reason = ext.installType === "admin" ? "Managed by your administrator" : "Can't be changed";
  const reasonId = `ext-reason-${ext.id}`;
  return (
    <li className="flex items-center gap-3 py-1.5" data-testid="ext-row">
      <ExtensionIcon ext={ext} />
      <div className="min-w-0 flex-1">
        <p className={`m-0 flex items-center gap-1.5 text-sm font-medium leading-5 ${ext.enabled ? "text-ink" : "text-muted"}`}>
          <span className="truncate">{ext.name}</span>
          {ext.installType === "admin" && (
            <span className="shrink-0 rounded-full bg-bg px-1.5 text-[11px] font-medium leading-[15px] text-muted ring-1 ring-line-strong">
              Managed
            </span>
          )}
        </p>
        <p className="m-0 text-[11px] leading-[15px] text-muted">v{ext.version}</p>
      </div>
      {locked && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
      <Switch
        checked={ext.enabled}
        label={`Turn ${ext.name} ${ext.enabled ? "off" : "on"}`}
        disabled={busy || locked}
        describedBy={locked ? reasonId : undefined}
        title={locked ? reason : undefined}
        onChange={(next) => onToggle(ext.id, next)}
      />
    </li>
  );
}

export function ExtensionsView() {
  const m = useManagedExtensions();
  const [filter, setFilter] = useState("");
  const [storeNotice, setStoreNotice] = useState<string | null>(null);
  const granted = m.permission === "granted";

  const addFromStore = (item: FocusPackItem) => {
    setStoreNotice(null);
    try {
      Promise.resolve(chrome.tabs.create({ url: item.url })).catch(() => setStoreNotice("Could not open the store page."));
    } catch {
      setStoreNotice("Could not open the store page.");
    }
  };

  const onCount = m.extensions.filter((e) => e.enabled).length;
  const q = filter.trim().toLowerCase();
  const visible = q ? m.extensions.filter((e) => e.name.toLowerCase().includes(q)) : m.extensions;
  const notice = m.notice ?? storeNotice;

  return (
    <div className="flex flex-col gap-3" data-testid="extensions-view">
      <Card>
        <SectionTitle>Quick add</SectionTitle>
        <p className="m-0 text-xs text-muted">
          A few quiet tools that help you stay with one thing. Each opens its Chrome Web Store page.
        </p>
        {!granted && (
          <p className="m-0 mt-1 text-xs text-muted" data-testid="pack-hint">
            Allow access below to see which of these you already have.
          </p>
        )}
        <ul className="m-0 mt-1 list-none divide-y divide-line p-0">
          {FOCUS_PACK.map((item) => (
            <QuickAddRow
              key={item.id}
              item={item}
              permissionGranted={granted}
              installed={m.installedIds.has(item.id)}
              enabled={m.extensions.find((e) => e.id === item.id)?.enabled ?? true}
              onAdd={addFromStore}
            />
          ))}
        </ul>
      </Card>

      <Card>
        {m.permission === "checking" && <p className="m-0 text-sm text-muted">Loading…</p>}

        {m.permission === "denied" && (
          <>
            <SectionTitle>Your extensions</SectionTitle>
            <p className="m-0 text-sm text-ink">
              To list your extensions and switch them on or off, Lighthouse asks Chrome for permission to manage extensions. It never
              reads your pages, and nothing leaves your device.
            </p>
            <Button variant="primary" className="mt-3 w-full" onClick={() => void m.requestAccess()}>
              Allow access
            </Button>
            <p className="m-0 mt-2 text-xs text-muted">Chrome will ask you to confirm.</p>
          </>
        )}

        {granted && (
          <>
            <SectionTitle>{`Your extensions · ${onCount} on`}</SectionTitle>
            {m.error ? (
              <div className="space-y-2">
                <ErrorBlock>Could not read your extensions: {m.error}</ErrorBlock>
                <Button onClick={() => void m.refresh()}>Try again</Button>
              </div>
            ) : m.loading && m.extensions.length === 0 ? (
              <p className="m-0 text-sm text-muted">Loading…</p>
            ) : m.extensions.length === 0 ? (
              <div className="space-y-3">
                <QuoteBlock quote={quoteFor("emptyList")} size="sm" />
                <p className="m-0 text-sm text-ink">No other extensions are installed. Your browser is already quiet.</p>
              </div>
            ) : (
              <>
                {m.extensions.length > 8 && (
                  <input
                    aria-label="Filter extensions"
                    placeholder="Filter by name"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="mb-1 w-full rounded-[8px] border border-line-strong bg-bg px-3 py-2 text-sm text-ink"
                  />
                )}
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {visible.map((ext) => (
                    <ExtensionRow key={ext.id} ext={ext} busy={m.busyId === ext.id} onToggle={(id, next) => void m.setEnabled(id, next)} />
                  ))}
                </ul>
                {visible.length === 0 && <p className="m-0 text-sm text-muted">No extension matches that name.</p>}
              </>
            )}
          </>
        )}
      </Card>

      {notice && <Notice>{notice}</Notice>}
    </div>
  );
}
