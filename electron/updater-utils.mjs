export const GITHUB_REPO_OWNER = "WangBens";
export const GITHUB_REPO_NAME = "NKUST_iAI_Note-tools";
export const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
export const GITHUB_RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;

/**
 * Parse a SemVer string like "v1.2.0" or "1.2.0-beta.1" into [major, minor, patch].
 */
export function parseSemver(version) {
  const cleaned = String(version ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/)[0];
  const parts = cleaned.split(".").map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Return 1 if `a > b`, -1 if `a < b`, 0 if equal.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Pick the best installer asset from a GitHub Release's `assets` list
 * for the given `platform` (`win32` | `darwin` | `linux`) and `arch` (`x64` | `arm64`).
 */
export function pickReleaseAsset(
  assets,
  platform = process.platform,
  arch = process.arch,
) {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const valid = assets.filter(
    (a) =>
      a &&
      typeof a.name === "string" &&
      typeof a.browser_download_url === "string" &&
      /^https:\/\//i.test(a.browser_download_url),
  );
  if (!valid.length) return null;

  const find = (re) => valid.find((a) => re.test(a.name)) ?? null;

  if (platform === "win32") {
    return (
      find(/setup.*\.exe$/i) ||
      find(/\.exe$/i) ||
      find(/win.*\.zip$/i)
    );
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return (
        find(/arm64.*\.dmg$/i) ||
        find(/\.dmg$/i) ||
        find(/arm64.*\.zip$/i) ||
        find(/mac.*\.zip$/i)
      );
    }
    return (
      find(/(?:x64|intel).*\.dmg$/i) ||
      find(/^(?!.*arm64).*\.dmg$/i) ||
      find(/\.dmg$/i) ||
      find(/^(?!.*arm64).*mac.*\.zip$/i)
    );
  }

  // Linux
  return find(/\.AppImage$/i) || find(/\.deb$/i);
}
