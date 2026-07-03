import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as piUtils from "@oh-my-pi/pi-utils";

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function getExistingWslLocalPath(urlOrPath: string): string | undefined {
	if (
		process.platform !== "linux" ||
		!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) ||
		!piUtils.$which("wslview")
	) {
		return undefined;
	}

	try {
		const localPath = urlOrPath.startsWith("file://")
			? url.fileURLToPath(urlOrPath)
			: URL_SCHEME_PATTERN.test(urlOrPath)
				? undefined
				: path.resolve(urlOrPath);
		if (!localPath || !fs.existsSync(localPath)) return undefined;

		const result = Bun.spawnSync(["wslpath", "-w", localPath], { stdout: "pipe", stderr: "ignore" });
		if (result.exitCode !== 0) return undefined;

		return result.stdout.toString().trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Windows opener command. PowerShell's `Start-Process` routes through
 * ShellExecute like the previous `rundll32 url.dll,FileProtocolHandler`, but
 * handles URLs, files, and directories uniformly and reports failure through
 * its exit code (rundll32 always exits 0).
 *
 * PowerShell is resolved from %SystemRoot% because PATH is user-editable and
 * System32 is not guaranteed to be on it — seen in the wild as
 * `Bun.spawn("rundll32")` throwing "Executable not found in $PATH", which left
 * OAuth flows browserless (and pushed users onto hand-copying authorization
 * URLs that terminals truncate). `-EncodedCommand` sidesteps shell
 * metacharacter parsing entirely: OAuth URLs carry `&`, which bare
 * cmd/PowerShell command lines treat as a separator. Inside the decoded
 * script the target is a single-quoted PowerShell literal (no `$` expansion);
 * embedded single quotes are doubled.
 */
function windowsOpenCommand(urlOrPath: string): string[] {
	const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
	const absolutePowershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	const powershell = fs.existsSync(absolutePowershell) ? absolutePowershell : "powershell.exe";
	const script = `Start-Process '${urlOrPath.replaceAll("'", "''")}'`;
	return [
		powershell,
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle",
		"Hidden",
		"-EncodedCommand",
		Buffer.from(script, "utf16le").toString("base64"),
	];
}

/** Open a URL or file path in the default browser/application. Best-effort, never throws. */
export function openPath(urlOrPath: string): void {
	let cmd: string[];
	switch (process.platform) {
		case "darwin":
			cmd = ["open", urlOrPath];
			break;
		case "win32":
			cmd = windowsOpenCommand(urlOrPath);
			break;
		default: {
			const wslPath = getExistingWslLocalPath(urlOrPath);
			cmd = wslPath ? ["wslview", wslPath] : ["xdg-open", urlOrPath];
			break;
		}
	}
	try {
		const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
		void proc.exited.then(exitCode => {
			if (exitCode !== 0) {
				piUtils.logger.warn("openPath: opener exited with non-zero status", { opener: cmd[0], exitCode });
			}
		});
	} catch (error) {
		// Best-effort: browser opening is non-critical. Log so a broken opener
		// (e.g. executable not resolvable from a stripped PATH) stays diagnosable
		// instead of failing silently while the UI claims the browser opened.
		piUtils.logger.warn("openPath: failed to spawn opener", { opener: cmd[0], error: String(error) });
	}
}
