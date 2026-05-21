import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { auth } from '@clerk/nextjs/server';
import JSZip from 'jszip';
import { extract as tarExtract } from 'tar-stream';
import { PrismaClient } from '@/generated/prisma';
import { getSandbox } from '@/lib/sandbox-utils';

const prisma = new PrismaClient();

// Excluded from the archive — same boundaries the rest of the app uses.
const TAR_EXCLUDES = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.cache',
  // bun stores its install cache + metadata at /home/user/.bun. Often
  // hundreds of MB after `bun create next-app` + shadcn add. Excluding
  // it keeps user downloads small.
  '.bun',
  '.npm',
  '.local',
  '.config',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
];

const ROOT = '/home/user';
// Generous cap for user downloads — Vercel's 100 MB limit doesn't apply
// here, this is just to prevent runaway tarballs from OOMing the server.
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB

function bytesToNodeStream(bytes: Uint8Array): Readable {
  return Readable.from(Buffer.from(bytes));
}

interface TarHeader {
  name: string;
  type: string;
  size: number;
}

async function tarGzToZip(tarGz: Uint8Array): Promise<Uint8Array> {
  const zip = new JSZip();

  await new Promise<void>((resolve, reject) => {
    const extract = tarExtract();
    let totalBytes = 0;

    extract.on('entry', (header: TarHeader, stream: Readable, next: () => void) => {
      // tar-stream entries: 'file', 'directory', 'symlink', 'link', etc.
      if (header.type !== 'file') {
        stream.resume();
        stream.on('end', next);
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          stream.destroy();
          reject(new Error(`Project exceeds ${MAX_TOTAL_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        // tar entries from `tar -C /home/user .` are prefixed with "./"
        const name = header.name.replace(/^\.\//, '');
        if (name) zip.file(name, Buffer.concat(chunks));
        next();
      });
      stream.on('error', reject);
    });

    extract.on('finish', resolve);
    extract.on('error', reject);

    bytesToNodeStream(tarGz).pipe(createGunzip()).pipe(extract);
  });

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function POST(request: NextRequest) {
  try {
    const {
      sessionId,
      shareToken,
    }: {
      sessionId?: string;
      shareToken?: string;
    } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, isPublic: true, shareToken: true, sandboxId: true, title: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (!session.sandboxId) {
      return NextResponse.json({ error: 'No sandbox attached to this session' }, { status: 404 });
    }

    const { userId } = await auth();
    const isOwner = !!userId && session.userId === userId;
    const isCollab =
      !isOwner
      && session.isPublic
      && !!shareToken
      && shareToken === session.shareToken;

    if (!isOwner && !isCollab) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const sandbox = await getSandbox(session.sandboxId);
    if (!sandbox) {
      return NextResponse.json({ error: 'Sandbox not found or expired' }, { status: 404 });
    }

    // Build the archive inside the sandbox in a single shell command, then
    // pull it back as one read. Avoids the N round-trips of file-by-file copy.
    // `tar` is preinstalled on the Debian-slim sandbox image; `zip` is not.
    //
    // The dev server writes to disk while we're tarring, which makes tar exit 1
    // ("files differ"). The warning flags downgrade that to silent; we still
    // treat exit 2 as fatal. `|| true` keeps the SDK from throwing on exit 1.
    const tarPath = `/tmp/codevibe-${sessionId}.tar.gz`;
    const excludeArgs = TAR_EXCLUDES.map((p) => `--exclude='${p}'`).join(' ');
    await sandbox.commands.run(`rm -f ${tarPath}`, { timeoutMs: 5_000 });
    const tarCmd =
      `tar --warning=no-file-changed --warning=no-file-removed --ignore-failed-read `
      + `${excludeArgs} -czf ${tarPath} -C ${ROOT} . ; echo __TAR_EXIT__=$?`;
    let tarStderr = '';
    let tarStdout = '';
    try {
      const result = await sandbox.commands.run(tarCmd, { timeoutMs: 120_000 });
      tarStderr = result.stderr ?? '';
      tarStdout = result.stdout ?? '';
    } catch (err: unknown) {
      const e = err as { stderr?: string; stdout?: string };
      tarStderr = e?.stderr ?? '';
      tarStdout = e?.stdout ?? '';
    }
    const exitMatch = /__TAR_EXIT__=(\d+)/.exec(tarStdout);
    const tarExit = exitMatch ? Number(exitMatch[1]) : -1;
    if (tarExit !== 0 && tarExit !== 1) {
      console.error('[download-project] tar failed:', { tarExit, tarStderr });
      return NextResponse.json(
        { error: 'Failed to build archive', details: tarStderr || `tar exit ${tarExit}` },
        { status: 500 },
      );
    }

    const tarBytes = (await sandbox.files.read(tarPath, { format: 'bytes' })) as Uint8Array;
    sandbox.commands.run(`rm -f ${tarPath}`, { timeoutMs: 5_000 }).catch(() => {});

    const zipBytes = await tarGzToZip(tarBytes);

    const safeTitle = (session.title || 'codevibe-project').replace(/[^a-zA-Z0-9_.-]/g, '-');
    const filename = `${safeTitle}.zip`;

    return new NextResponse(zipBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zipBytes.byteLength),
      },
    });
  } catch (error) {
    console.error('Error building project zip:', error);
    return NextResponse.json(
      {
        error: 'Failed to download project',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
