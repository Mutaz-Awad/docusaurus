/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import fs from 'fs-extra';
import {createHash} from 'crypto';
import {simpleHash, docuHash} from './hashUtils';
import {findAsyncSequential} from './jsUtils';

const fileHash = new Map<string, string>();

/**
 * Outputs a file to the generated files directory. Only writes files if content
 * differs from cache (for hot reload performance).
 *
 * @param generatedFilesDir Absolute path.
 * @param file Path relative to `generatedFilesDir`.
 * @param content String content to write.
 * @param skipCache If `true` (defaults as `true` for production), file is
 * force-rewritten, skipping cache.
 */
export async function generate(
  generatedFilesDir: string,
  file: string,
  content: string,
  skipCache: boolean = process.env.NODE_ENV === 'production',
): Promise<void> {
  const filepath = path.join(generatedFilesDir, file);

  if (skipCache) {
    await fs.outputFile(filepath, content);
    // Cache still needs to be reset, otherwise, writing "A", "B", and "A" where
    // "B" skips cache will cause the last "A" not be able to overwrite as the
    // first "A" remains in cache. But if the file never existed in cache, no
    // need to register it.
    if (fileHash.get(filepath)) {
      fileHash.set(filepath, createHash('md5').update(content).digest('hex'));
    }
    return;
  }

  let lastHash = fileHash.get(filepath);

  // If file already exists but it's not in runtime cache yet, we try to
  // calculate the content hash and then compare. This is to avoid unnecessary
  // overwriting and we can reuse old file.
  if (!lastHash && (await fs.pathExists(filepath))) {
    const lastContent = await fs.readFile(filepath, 'utf8');
    lastHash = createHash('md5').update(lastContent).digest('hex');
    fileHash.set(filepath, lastHash);
  }

  const currentHash = createHash('md5').update(content).digest('hex');

  if (lastHash !== currentHash) {
    await fs.outputFile(filepath, content);
    fileHash.set(filepath, currentHash);
  }
}

const chunkNameCache = new Map<string, string>();

/**
 * Generate unique chunk name given a module path.
 */
export function genChunkName(
  modulePath: string,
  prefix?: string,
  preferredName?: string,
  shortId: boolean = process.env.NODE_ENV === 'production',
): string {
  let chunkName = chunkNameCache.get(modulePath);
  if (!chunkName) {
    if (shortId) {
      chunkName = simpleHash(modulePath, 8);
    } else {
      let str = modulePath;
      if (preferredName) {
        const shortHash = simpleHash(modulePath, 3);
        str = `${preferredName}${shortHash}`;
      }
      const name = str === '/' ? 'index' : docuHash(str);
      chunkName = prefix ? `${prefix}---${name}` : name;
    }
    chunkNameCache.set(modulePath, chunkName);
  }
  return chunkName;
}

/**
 * @param permalink The URL that the HTML file corresponds to, without base URL
 * @param outDir Full path to the output directory
 * @param trailingSlash The site config option. If provided, only one path will
 * be read.
 * @returns This returns a buffer, which you have to decode string yourself if
 * needed. (Not always necessary since the output isn't for human consumption
 * anyways, and most HTML manipulation libs accept buffers)
 * @throws Throws when the HTML file is not found at any of the potential paths.
 * This should never happen as it would lead to a 404.
 */
export async function readOutputHTMLFile(
  permalink: string,
  outDir: string,
  trailingSlash: boolean | undefined,
): Promise<Buffer> {
  const withTrailingSlashPath = path.join(outDir, permalink, 'index.html');
  const withoutTrailingSlashPath = path.join(
    outDir,
    `${permalink.replace(/\/$/, '')}.html`,
  );
  if (trailingSlash) {
    return fs.readFile(withTrailingSlashPath);
  } else if (trailingSlash === false) {
    return fs.readFile(withoutTrailingSlashPath);
  }
  const HTMLPath = await findAsyncSequential(
    [withTrailingSlashPath, withoutTrailingSlashPath],
    fs.pathExists,
  );
  if (!HTMLPath) {
    throw new Error(
      `Expected output HTML file to be found at ${withTrailingSlashPath}`,
    );
  }
  return fs.readFile(HTMLPath);
}
