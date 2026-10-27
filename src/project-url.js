// Linear project pages live at /<workspace>/project/<name>-<id>[/<view>].
// `key` is the stable id after the final hyphen; the name part changes on rename.
export function parseProjectPath(pathname) {
  const match = /^\/([^/]+)\/project\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  if (!match) return null;
  let workspace, slug;
  try {
    workspace = decodeURIComponent(match[1]);
    slug = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  const key = slug.slice(slug.lastIndexOf('-') + 1);
  if (!/^[\w-]{1,64}$/.test(workspace) || slug.length > 200 || !/^[a-z0-9]{4,64}$/i.test(key)) return null;
  return { workspace, slug, key, view: match[3] ?? null };
}

export function parseProjectURL(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://linear.app' ? parseProjectPath(parsed.pathname) : null;
  } catch {
    return null;
  }
}
