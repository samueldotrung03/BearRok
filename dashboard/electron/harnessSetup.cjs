// One-click set-up of a model harness on a Mac: Connect Claude, Connect ChatGPT or Connect Grok
// opens the Terminal app on a short script that installs the company's app for the command line
// when it is missing, then signs in. Signing in happens in the browser, on the company's own page;
// BearRok never sees the password. The script writes how it ended to a status file, which the page
// reads to finish connecting on its own (the backend then sends one test prompt).
//
// The page can only name one of the three harnesses. The scripts are fixed here, so nothing the
// page sends can become a command.
const { shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** The usual install folders, so a freshly installed app is found in the same window. */
const PATH_LINE = 'export PATH="$HOME/.local/bin:$HOME/.claude/local:$HOME/.grok/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"';

const STEPS = {
  claude: {
    name: 'Claude',
    body: `
if ! command -v claude >/dev/null 2>&1; then
  note "Installing Claude Code, the Claude app for the command line..."
  curl -fsSL https://claude.ai/install.sh | bash || fail "Claude Code could not be installed. Check your internet connection and press Connect Claude again."
  hash -r
fi
command -v claude >/dev/null 2>&1 || fail "Claude Code was installed but cannot be found yet. Press Connect Claude again."
if claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
  note "Claude Code is already signed in."
else
  note "Your browser will open. Sign in with your Claude account there."
  claude auth login --claudeai || fail "Sign-in did not finish. Press Connect Claude to try again."
fi`,
  },
  codex: {
    name: 'ChatGPT',
    body: `
if ! command -v codex >/dev/null 2>&1; then
  if ! command -v npm >/dev/null 2>&1; then
    note "The ChatGPT app for the command line (Codex) needs Node.js, which is not on this Mac yet."
    note "Opening the Node.js download page. Install it, then press Connect ChatGPT again."
    open "https://nodejs.org/en/download"
    fail "Install Node.js from nodejs.org, then press Connect ChatGPT again."
  fi
  note "Installing Codex, the ChatGPT app for the command line..."
  # Into the usual place, or into your home folder when that place needs an administrator.
  npm install -g @openai/codex || npm install -g --prefix "$HOME/.npm-global" @openai/codex || fail "Codex could not be installed. Check your internet connection and press Connect ChatGPT again."
  hash -r
fi
command -v codex >/dev/null 2>&1 || fail "Codex was installed but cannot be found yet. Press Connect ChatGPT again."
if codex login status >/dev/null 2>&1 && ! codex login status 2>&1 | grep -qi "not logged"; then
  note "Codex is already signed in."
else
  note "Your browser will open. Sign in with your ChatGPT account there."
  codex login || fail "Sign-in did not finish. Press Connect ChatGPT to try again."
fi`,
  },
  grok: {
    name: 'Grok',
    body: `
if ! command -v grok >/dev/null 2>&1; then
  note "Installing Grok Build, the Grok app for the command line..."
  curl -fsSL https://x.ai/cli/install.sh | bash || fail "Grok Build could not be installed. Check your internet connection and press Connect Grok again."
  hash -r
fi
command -v grok >/dev/null 2>&1 || fail "Grok Build was installed but cannot be found yet. Press Connect Grok again."
note "Your browser will open. Sign in with the account that has your Grok subscription."
grok login || fail "Sign-in did not finish. Press Connect Grok to try again."`,
  },
};

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The whole script for one harness, writing how it ended to `status`. */
function scriptFor(id, status) {
  const step = STEPS[id];
  return `#!/bin/bash
# Opened by BearRok to connect ${step.name}. It installs the ${step.name} app for the command line if
# needed and signs you in through your browser. You can close this window when it says Done.
STATUS=${shellQuote(status)}
${PATH_LINE}
note() { echo; echo "$1"; }
fail() { echo "failed: $1" > "$STATUS"; echo; echo "$1"; echo; echo "You can close this window."; exit 1; }
trap 'grep -q running "$STATUS" 2>/dev/null && echo "failed: The window was closed before set-up finished." > "$STATUS"' EXIT
clear
echo "BearRok is connecting ${step.name} on this Mac."
${step.body}
echo done > "$STATUS"
echo
echo "Done. Go back to BearRok; it finishes connecting on its own. You can close this window."
`;
}

function mount({ ipcMain, app }) {
  const dir = () => path.join(app.getPath('userData'), 'setup');
  const statusFile = (id) => path.join(dir(), `${id}.status`);
  ipcMain.handle('harness:setup', async (_event, id) => {
    if (process.platform !== 'darwin') return { ok: false, error: 'One-click set-up works on a Mac only.' };
    const step = Object.hasOwn(STEPS, id) ? STEPS[id] : null;
    if (!step) return { ok: false, error: 'Unknown model.' };
    fs.mkdirSync(dir(), { recursive: true });
    const status = statusFile(id);
    const script = path.join(dir(), `Connect ${step.name}.command`);
    fs.writeFileSync(status, 'running');
    fs.writeFileSync(script, scriptFor(id, status), { mode: 0o700 });
    const error = await shell.openPath(script);
    if (error) {
      fs.writeFileSync(status, `failed: Terminal could not be opened (${error}).`);
      return { ok: false, error: `Terminal could not be opened: ${error}` };
    }
    return { ok: true };
  });

  /** "idle", "running", "done", or "failed" with what went wrong. */
  ipcMain.handle('harness:setupStatus', (_event, id) => {
    if (!Object.hasOwn(STEPS, id)) return { state: 'idle' };
    let text;
    try {
      text = fs.readFileSync(statusFile(id), 'utf8').trim();
    } catch {
      return { state: 'idle' };
    }
    if (text === 'running') return { state: 'running' };
    if (text === 'done') return { state: 'done' };
    return { state: 'failed', error: text.replace(/^failed:\s*/, '') };
  });

  /** Forget a finished set-up, so the next one starts clean. */
  ipcMain.handle('harness:setupClear', (_event, id) => {
    if (Object.hasOwn(STEPS, id)) fs.rmSync(statusFile(id), { force: true });
  });
}

module.exports = { mount, scriptFor, STEPS };
