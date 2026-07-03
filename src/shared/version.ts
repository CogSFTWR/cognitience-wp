/**
 * Cognitience WP — App version from package.json (single source of truth).
 */

import * as fs from 'fs';
import * as path from 'path';

let cachedVersion: string | null = null;

/** Read version from package.json (works in main process and Node tests). */
export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    cachedVersion = pkg.version || '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion!;
}