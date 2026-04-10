import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  cpSync,
  closeSync,
  openSync,
} from 'fs';
import { resolve, dirname, sep, join, extname, basename, relative } from 'path';
import { ProjectsService } from './projects.service.js';

const IGNORED_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'target',
  'vendor',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  '.mypy_cache',
  '.tox',
  'coverage',
  '.nyc_output',
  'tmp',
  '.DS_Store',
  'data',
]);

const IGNORED_FILE_EXTS = new Set(['.lock', '.log', '.pyc']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

const READ_LIMIT = 1024 * 1024; // 1MB
const WRITE_LIMIT = 5 * 1024 * 1024; // 5MB

interface DirEntry {
  name: string;
  is_directory: boolean;
  size: number | null;
  mtime: string;
}

interface BrowseResult {
  cwd: string;
  relative: string;
  parent: string | null;
  entries: DirEntry[];
}

function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}

function isIgnoredFile(name: string): boolean {
  if (IGNORED_FILES.has(name)) return true;
  const ext = extname(name);
  if (ext && IGNORED_FILE_EXTS.has(ext)) return true;
  return false;
}

/**
 * Checks if any segment of the resolved path (relative to root) is ignored.
 * Defense in depth — even if a user supplies an absolute path inside an ignored
 * dir, it will be rejected.
 */
function pathContainsIgnored(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (!rel) return false;
  const segments = rel.split(sep);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    if (isIgnoredDir(seg)) return true;
    // Last segment may be a file
    if (i === segments.length - 1 && isIgnoredFile(seg)) return true;
  }
  return false;
}

function detectBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

@Controller('projects/:id/files')
export class ProjectFilesController {
  constructor(private readonly projects: ProjectsService) {}

  private async getRoot(projectId: string): Promise<string> {
    const project = await this.projects.findOne(projectId);
    if (!project.repo_path) {
      throw new BadRequestException('Project has no repo_path configured');
    }
    const root = resolve(project.repo_path);
    if (!existsSync(root)) {
      throw new NotFoundException(`Project workspace not found: ${root}`);
    }
    return root;
  }

  /**
   * Resolves a user-supplied path against the project root.
   * The path may be absolute (must be inside root) or relative (joined to root).
   * Throws ForbiddenException if the resolved path escapes the root or hits an
   * ignored segment.
   */
  private ensureInProject(root: string, userPath: string | undefined): string {
    const target = userPath ? resolve(root, userPath) : root;
    if (target !== root && !target.startsWith(root + sep)) {
      throw new ForbiddenException('Path escape blocked');
    }
    if (pathContainsIgnored(root, target)) {
      throw new ForbiddenException('Path is in an ignored directory');
    }
    return target;
  }

  // -----------------------------------------------------------------------
  // GET /projects/:id/files?path=
  // -----------------------------------------------------------------------
  @Get()
  async browse(
    @Param('id') id: string,
    @Query('path') path?: string,
  ): Promise<BrowseResult> {
    const root = await this.getRoot(id);
    const target = this.ensureInProject(root, path);

    if (!existsSync(target)) {
      throw new NotFoundException(`Path does not exist: ${target}`);
    }
    const stat = statSync(target);
    if (!stat.isDirectory()) {
      throw new BadRequestException(`Not a directory: ${target}`);
    }

    let entries: DirEntry[] = [];
    try {
      entries = readdirSync(target, { withFileTypes: true })
        .filter((d) => {
          if (d.isDirectory()) return !isIgnoredDir(d.name);
          if (d.isFile()) return !isIgnoredFile(d.name);
          return false;
        })
        .map((d) => {
          const full = join(target, d.name);
          let size: number | null = null;
          let mtime = '';
          try {
            const s = statSync(full);
            size = d.isDirectory() ? null : s.size;
            mtime = s.mtime.toISOString();
          } catch {
            // ignore
          }
          return {
            name: d.name,
            is_directory: d.isDirectory(),
            size,
            mtime,
          };
        })
        .sort((a, b) => {
          if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch (err) {
      throw new BadRequestException(
        `Cannot read directory: ${(err as Error).message}`,
      );
    }

    const rel = relative(root, target);
    const parent = target === root ? null : dirname(target);
    return {
      cwd: target,
      relative: rel,
      parent,
      entries,
    };
  }

  // -----------------------------------------------------------------------
  // GET /projects/:id/files/read?path=
  // -----------------------------------------------------------------------
  @Get('read')
  async read(@Param('id') id: string, @Query('path') path?: string) {
    if (!path) throw new BadRequestException('path is required');
    const root = await this.getRoot(id);
    const target = this.ensureInProject(root, path);

    if (!existsSync(target)) {
      throw new NotFoundException(`File does not exist: ${target}`);
    }
    const stat = statSync(target);
    if (stat.isDirectory()) {
      throw new BadRequestException(`Path is a directory: ${target}`);
    }
    if (stat.size > READ_LIMIT) {
      throw new HttpException(
        { error: 'file_too_large', size: stat.size, limit: READ_LIMIT },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const buf = readFileSync(target);
    const isBinary = detectBinary(buf);
    return {
      path: target,
      content: isBinary ? '' : buf.toString('utf8'),
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      is_binary: isBinary,
    };
  }

  // -----------------------------------------------------------------------
  // GET /projects/:id/files/stat?path=
  // -----------------------------------------------------------------------
  @Get('stat')
  async stat(@Param('id') id: string, @Query('path') path?: string) {
    if (!path) throw new BadRequestException('path is required');
    const root = await this.getRoot(id);
    const target = this.ensureInProject(root, path);
    if (!existsSync(target)) {
      throw new NotFoundException(`Path does not exist: ${target}`);
    }
    const s = statSync(target);
    return {
      mtime: s.mtime.toISOString(),
      size: s.size,
      is_directory: s.isDirectory(),
    };
  }

  // -----------------------------------------------------------------------
  // POST /projects/:id/files/write
  // -----------------------------------------------------------------------
  @Post('write')
  async write(
    @Param('id') id: string,
    @Body()
    body: { path: string; content: string; expected_mtime?: string },
  ) {
    if (!body.path) throw new BadRequestException('path is required');
    if (typeof body.content !== 'string')
      throw new BadRequestException('content must be a string');

    const root = await this.getRoot(id);
    const target = this.ensureInProject(root, body.path);

    const byteLen = Buffer.byteLength(body.content, 'utf8');
    if (byteLen > WRITE_LIMIT) {
      throw new HttpException(
        { error: 'file_too_large', size: byteLen, limit: WRITE_LIMIT },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    if (existsSync(target)) {
      const s = statSync(target);
      if (s.isDirectory()) {
        throw new BadRequestException(`Path is a directory: ${target}`);
      }
      if (body.expected_mtime) {
        const currentMtime = s.mtime.toISOString();
        if (currentMtime !== body.expected_mtime) {
          throw new HttpException(
            {
              error: 'conflict',
              message: 'File was modified externally',
              current_mtime: currentMtime,
            },
            HttpStatus.CONFLICT,
          );
        }
      }
    } else {
      // Make sure parent dir exists
      const parent = dirname(target);
      if (!existsSync(parent)) {
        throw new BadRequestException(`Parent directory does not exist: ${parent}`);
      }
    }

    try {
      writeFileSync(target, body.content, 'utf8');
    } catch (err) {
      throw new BadRequestException(
        `Failed to write: ${(err as Error).message}`,
      );
    }
    const s = statSync(target);
    return {
      path: target,
      mtime: s.mtime.toISOString(),
      size: s.size,
    };
  }

  // -----------------------------------------------------------------------
  // POST /projects/:id/files/mkdir
  // -----------------------------------------------------------------------
  @Post('mkdir')
  async mkdir(
    @Param('id') id: string,
    @Body() body: { parent: string; name: string },
  ) {
    if (!body.parent || !body.name)
      throw new BadRequestException('parent and name are required');
    const safe = body.name.trim();
    if (
      !safe ||
      safe.includes('/') ||
      safe.includes('\\') ||
      safe === '.' ||
      safe === '..'
    ) {
      throw new BadRequestException('Invalid folder name');
    }
    if (isIgnoredDir(safe)) {
      throw new ForbiddenException(`Folder name '${safe}' is reserved`);
    }
    const root = await this.getRoot(id);
    const parent = this.ensureInProject(root, body.parent);
    if (!existsSync(parent)) {
      throw new BadRequestException(`Parent does not exist: ${parent}`);
    }
    const newPath = join(parent, safe);
    if (existsSync(newPath)) {
      throw new BadRequestException(`Already exists: ${newPath}`);
    }
    try {
      mkdirSync(newPath);
    } catch (err) {
      throw new BadRequestException(
        `Failed to create folder: ${(err as Error).message}`,
      );
    }
    return { path: newPath };
  }

  // -----------------------------------------------------------------------
  // POST /projects/:id/files/touch
  // -----------------------------------------------------------------------
  @Post('touch')
  async touch(
    @Param('id') id: string,
    @Body() body: { parent: string; name: string },
  ) {
    if (!body.parent || !body.name)
      throw new BadRequestException('parent and name are required');
    const safe = body.name.trim();
    if (
      !safe ||
      safe.includes('/') ||
      safe.includes('\\') ||
      safe === '.' ||
      safe === '..'
    ) {
      throw new BadRequestException('Invalid file name');
    }
    if (isIgnoredFile(safe)) {
      throw new ForbiddenException(`File name '${safe}' is reserved`);
    }
    const root = await this.getRoot(id);
    const parent = this.ensureInProject(root, body.parent);
    if (!existsSync(parent)) {
      throw new BadRequestException(`Parent does not exist: ${parent}`);
    }
    const newPath = join(parent, safe);
    if (existsSync(newPath)) {
      throw new BadRequestException(`Already exists: ${newPath}`);
    }
    try {
      closeSync(openSync(newPath, 'w'));
    } catch (err) {
      throw new BadRequestException(
        `Failed to create file: ${(err as Error).message}`,
      );
    }
    return { path: newPath };
  }

  // -----------------------------------------------------------------------
  // DELETE /projects/:id/files?path=
  // -----------------------------------------------------------------------
  @Delete()
  async remove(@Param('id') id: string, @Query('path') path?: string) {
    if (!path) throw new BadRequestException('path is required');
    const root = await this.getRoot(id);
    const target = this.ensureInProject(root, path);
    if (target === root) {
      throw new ForbiddenException('Cannot delete project root');
    }
    if (!existsSync(target)) {
      throw new NotFoundException(`Path does not exist: ${target}`);
    }
    try {
      rmSync(target, { recursive: true, force: true });
    } catch (err) {
      throw new BadRequestException(
        `Failed to delete: ${(err as Error).message}`,
      );
    }
    return { deleted: true, path: target };
  }

  // -----------------------------------------------------------------------
  // POST /projects/:id/files/copy
  // -----------------------------------------------------------------------
  @Post('copy')
  async copy(
    @Param('id') id: string,
    @Body() body: { from: string; to: string },
  ) {
    if (!body.from || !body.to)
      throw new BadRequestException('from and to are required');
    const root = await this.getRoot(id);
    const from = this.ensureInProject(root, body.from);
    const to = this.ensureInProject(root, body.to);
    if (!existsSync(from)) {
      throw new NotFoundException(`Source does not exist: ${from}`);
    }
    if (existsSync(to)) {
      throw new BadRequestException(`Destination already exists: ${to}`);
    }
    // Validate destination basename isn't ignored
    const destName = basename(to);
    const fromStat = statSync(from);
    if (fromStat.isDirectory() && isIgnoredDir(destName)) {
      throw new ForbiddenException(`Destination name '${destName}' is reserved`);
    }
    if (!fromStat.isDirectory() && isIgnoredFile(destName)) {
      throw new ForbiddenException(`Destination name '${destName}' is reserved`);
    }
    try {
      cpSync(from, to, { recursive: true });
    } catch (err) {
      throw new BadRequestException(
        `Failed to copy: ${(err as Error).message}`,
      );
    }
    return { from, to };
  }

  // -----------------------------------------------------------------------
  // POST /projects/:id/files/move
  // -----------------------------------------------------------------------
  @Post('move')
  async move(
    @Param('id') id: string,
    @Body() body: { from: string; to: string },
  ) {
    if (!body.from || !body.to)
      throw new BadRequestException('from and to are required');
    const root = await this.getRoot(id);
    const from = this.ensureInProject(root, body.from);
    const to = this.ensureInProject(root, body.to);
    if (from === root) {
      throw new ForbiddenException('Cannot move project root');
    }
    if (!existsSync(from)) {
      throw new NotFoundException(`Source does not exist: ${from}`);
    }
    if (existsSync(to)) {
      throw new BadRequestException(`Destination already exists: ${to}`);
    }
    const destName = basename(to);
    const fromStat = statSync(from);
    if (fromStat.isDirectory() && isIgnoredDir(destName)) {
      throw new ForbiddenException(`Destination name '${destName}' is reserved`);
    }
    if (!fromStat.isDirectory() && isIgnoredFile(destName)) {
      throw new ForbiddenException(`Destination name '${destName}' is reserved`);
    }
    try {
      renameSync(from, to);
    } catch (err) {
      throw new BadRequestException(
        `Failed to move: ${(err as Error).message}`,
      );
    }
    return { from, to };
  }
}
