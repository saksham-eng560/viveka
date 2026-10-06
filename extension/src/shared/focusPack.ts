export interface FocusPackItem {
  id: string;
  name: string;
  purpose: string;
  url: string;
  optional?: boolean;
}

export function storeUrl(slug: string, id: string): string {
  return `https://chromewebstore.google.com/detail/${slug}/${id}`;
}

function item(name: string, slug: string, id: string, purpose: string, optional?: boolean): FocusPackItem {
  return { id, name, purpose, url: storeUrl(slug, id), ...(optional ? { optional: true } : {}) };
}

/** Curated Chrome Web Store extensions that suit focused work. Ids are hardcoded on purpose. */
export const FOCUS_PACK: readonly FocusPackItem[] = [
  item("ActivityWatch Web Watcher", "activitywatch-web-watcher", "nglaklhklhcoonedhgnpgddginnjdadi", "Sends your browsing to ActivityWatch on this machine"),
  item("uBlock Origin Lite", "ublock-origin-lite", "ddkjiahejlhfcafbddmgiahcphecmpfh", "Blocks ads and trackers"),
  item("Unhook", "unhook-remove-youtube-rec", "khncfooichmfjbepaaaebmommgaepoid", "Hides YouTube recommendations and Shorts"),
  item("LeechBlock NG", "leechblock-ng", "blaaajhemilngeeffpbfkdjjoefldkok", "Blocks chosen sites on a schedule"),
  item("News Feed Eradicator", "news-feed-eradicator", "fjcldmjmjhkklehbacihaiopjklihlgg", "Replaces social feeds with calm"),
  item("Dark Reader", "dark-reader", "eimadpbcbfnmbkopoojfekhnkhdbieeh", "Eases eye strain", true),
];
