import { Controller, Get, Post, Query, Body, BadRequestException } from '@nestjs/common';
import { readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, sep, join } from 'path';
import { homedir } from 'os';

interface DirEntry {
  name: string;
  path: string;
  is_directory: boolean;
}

interface BrowseResponse {
  cwd: string;
  parent: string | null;
  entries: DirEntry[];
}

@Controller('filesystem')
export class FilesystemController {
  /**
   * GET /filesystem/browse?path=/some/dir
   * Defaults to user home if no path provided.
   * Returns directories only (and the parent for navigation).
   */
  @Get('browse')
  browse(@Query('path') path?: string): BrowseResponse {
    const target = path ? resolve(path) : homedir();

    if (!existsSync(target)) {
      throw new BadRequestException(`Path does not exist: ${target}`);
    }

    const stat = statSync(target);
    if (!stat.isDirectory()) {
      throw new BadRequestException(`Not a directory: ${target}`);
    }

    let entries: DirEntry[] = [];
    try {
      entries = readdirSync(target, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({
          name: d.name,
          path: resolve(target, d.name),
          is_directory: true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      throw new BadRequestException(`Cannot read directory: ${(err as Error).message}`);
    }

    const parent = target === sep ? null : dirname(target);

    return {
      cwd: target,
      parent: parent === target ? null : parent,
      entries,
    };
  }

  /**
   * GET /filesystem/home
   * Returns the user's home directory.
   */
  @Get('home')
  home(): { path: string } {
    return { path: homedir() };
  }

  /**
   * POST /filesystem/mkdir { parent, name }
   * Creates a new directory inside `parent` with `name`.
   */
  @Post('mkdir')
  mkdir(@Body() body: { parent: string; name: string }): { path: string } {
    if (!body.parent || !body.name) {
      throw new BadRequestException('parent and name are required');
    }
    // Sanitize folder name — no slashes, no traversal
    const safeName = body.name.trim();
    if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName === '.' || safeName === '..') {
      throw new BadRequestException('Invalid folder name');
    }

    const parent = resolve(body.parent);
    if (!existsSync(parent)) {
      throw new BadRequestException(`Parent does not exist: ${parent}`);
    }
    const stat = statSync(parent);
    if (!stat.isDirectory()) {
      throw new BadRequestException(`Parent is not a directory: ${parent}`);
    }

    const newPath = join(parent, safeName);
    if (existsSync(newPath)) {
      throw new BadRequestException(`Folder already exists: ${newPath}`);
    }

    try {
      mkdirSync(newPath);
    } catch (err) {
      throw new BadRequestException(`Failed to create folder: ${(err as Error).message}`);
    }

    return { path: newPath };
  }
}
