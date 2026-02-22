import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const COMMAND_ID = 'cursorAgentSidebar.close';
const CLOSE_UNIFIED_SIDEBAR_CMD = 'workbench.action.closeUnifiedSidebar';
const STATE_KEY = 'workbench.unifiedSidebar.hidden';
const SQL = `SELECT CAST(value AS TEXT) FROM ItemTable WHERE key='${STATE_KEY}';`;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeFsPath(value: string): string {
  return path.resolve(value);
}

async function resolveWorkspaceStateDb(output: vscode.OutputChannel): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    output.appendLine('[close-agent-sidebar] No workspace folders found; skipping.');
    return null;
  }

  const workspaceUriCandidates = new Set<string>();
  const workspaceFsPathCandidates = new Set<string>();

  for (const folder of workspaceFolders) {
    workspaceUriCandidates.add(trimTrailingSlashes(folder.uri.toString()));
    workspaceUriCandidates.add(trimTrailingSlashes(folder.uri.toString(true)));
    if (folder.uri.scheme === 'file') {
      workspaceFsPathCandidates.add(normalizeFsPath(folder.uri.fsPath));
    }
  }

  const workspaceStorageRoot = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'workspaceStorage',
  );

  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(workspaceStorageRoot, { withFileTypes: true });
  } catch (error) {
    output.appendLine(`[close-agent-sidebar] Failed to read workspaceStorage: ${String(error)}`);
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspaceDir = path.join(workspaceStorageRoot, entry.name);
    const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');

    let raw: string;
    try {
      raw = await fs.readFile(workspaceJsonPath, 'utf8');
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const folderUri =
      typeof parsed === 'object' && parsed !== null && 'folder' in parsed && typeof (parsed as { folder?: unknown }).folder === 'string'
        ? (parsed as { folder: string }).folder
        : null;

    if (!folderUri) {
      continue;
    }

    let matches = workspaceUriCandidates.has(trimTrailingSlashes(folderUri));

    if (!matches) {
      try {
        const folderAsUri = vscode.Uri.parse(folderUri);
        if (folderAsUri.scheme === 'file') {
          matches = workspaceFsPathCandidates.has(normalizeFsPath(folderAsUri.fsPath));
        }
      } catch {
        // Ignore malformed folder URI in workspace.json.
      }
    }

    if (!matches) {
      continue;
    }

    const stateDbPath = path.join(workspaceDir, 'state.vscdb');
    try {
      await fs.access(stateDbPath);
      output.appendLine(`[close-agent-sidebar] Using state DB: ${stateDbPath}`);
      return stateDbPath;
    } catch {
      output.appendLine(`[close-agent-sidebar] Matched workspace without state DB: ${stateDbPath}`);
      return null;
    }
  }

  output.appendLine('[close-agent-sidebar] No matching workspaceStorage entry found for current workspace.');
  return null;
}

async function queryUnifiedSidebarHidden(stateDbPath: string, output: vscode.OutputChannel): Promise<'true' | 'false' | null> {
  try {
    const result = await execFileAsync('sqlite3', [stateDbPath, SQL], {
      timeout: 3000,
      maxBuffer: 64 * 1024,
    });

    const value = String(result.stdout).trim();
    if (value === 'true' || value === 'false') {
      output.appendLine(`[close-agent-sidebar] ${STATE_KEY}=${value}`);
      return value;
    }

    output.appendLine(`[close-agent-sidebar] Unexpected DB value: "${value}"`);
    return null;
  } catch (error) {
    output.appendLine(`[close-agent-sidebar] sqlite3 query failed: ${String(error)}`);
    return null;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Close Agent Sidebar');

  const command = vscode.commands.registerCommand(COMMAND_ID, async () => {
    try {
      const stateDbPath = await resolveWorkspaceStateDb(output);
      if (!stateDbPath) {
        return;
      }

      const hidden = await queryUnifiedSidebarHidden(stateDbPath, output);
      if (hidden !== 'false') {
        output.appendLine('[close-agent-sidebar] Sidebar already hidden or state unknown; no-op.');
        return;
      }

      await vscode.commands.executeCommand(CLOSE_UNIFIED_SIDEBAR_CMD);
      output.appendLine('[close-agent-sidebar] Unified sidebar was visible; close command executed.');
    } catch (error) {
      output.appendLine(`[close-agent-sidebar] Unexpected error: ${String(error)}`);
    }
  });

  context.subscriptions.push(command, output);
}

export function deactivate(): void {}
