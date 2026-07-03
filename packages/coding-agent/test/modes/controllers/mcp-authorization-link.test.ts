import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { MCPAuthorizationLinkPrompt } from "@oh-my-pi/pi-coding-agent/modes/controllers/mcp-command-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

const OSC = "\x1b]";
const BEL = "\x07";
const FULL_AUTH_URL =
	"https://idp.example.test/authorize?response_type=code&client_id=omp-test&redirect_uri=http%3A%2F%2F127.0.0.1%3A17895%2Fcb&scope=mcp%3Aread&state=0123456789abcdef&audience=local-cli&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12&code_challenge_method=S256";
const LAUNCH_URL = "http://127.0.0.1:17895/launch?session=oauth-test";

function chunksAfter(lines: readonly string[], marker: string): string[] {
	const markerIndex = lines.indexOf(marker);
	expect(markerIndex).toBeGreaterThanOrEqual(0);
	const chunks = lines.slice(markerIndex + 1);
	expect(chunks.length).toBeGreaterThan(1);
	for (const chunk of chunks) {
		expect(chunk.startsWith(" ")).toBe(true);
	}
	return chunks.map(chunk => chunk.slice(1));
}

function expectEveryPlainLineFits(lines: readonly string[], width: number): void {
	for (const line of lines) {
		expect(line.length).toBeLessThanOrEqual(width);
	}
}

describe("MCPAuthorizationLinkPrompt", () => {
	beforeEach(async () => {
		initTheme();
		resetSettingsForTest();
		await Settings.init({ inMemory: true, cwd: process.cwd() });
		settings.override("tui.hyperlinks", "always");
	});

	afterEach(() => {
		settings.clearOverride("tui.hyperlinks");
		resetSettingsForTest();
	});

	it("renders the local launch URL and hard-wrapped full URL without losing the trailing PKCE method", () => {
		const width = 80;
		const lines = new MCPAuthorizationLinkPrompt(FULL_AUTH_URL, LAUNCH_URL).render(width);
		const plain = lines.map(line => stripVTControlCharacters(line));

		expect(plain).toContain(` Copy URL: ${LAUNCH_URL}`);
		expect(plain).toContain(" Remote session? Copy the full URL instead:");

		const chunks = chunksAfter(plain, " Remote session? Copy the full URL instead:");
		expect(chunks.join("")).toBe(FULL_AUTH_URL);
		expect(chunks.join("")).toContain("code_challenge_method=S256");
		expectEveryPlainLineFits(plain, width);
	});

	it("renders the full URL copy target when no local launch URL is available", () => {
		const lines = new MCPAuthorizationLinkPrompt(FULL_AUTH_URL).render(80);
		const plain = lines.map(line => stripVTControlCharacters(line));

		expect(plain.some(line => line.startsWith(" Copy URL: "))).toBe(false);

		const chunks = chunksAfter(plain, " Copy the full URL:");
		expect(chunks.join("")).toBe(FULL_AUTH_URL);
		expect(chunks.join("")).toContain("code_challenge_method=S256");
	});

	it("keeps the full URL reconstructable at degenerate widths by flooring the chunk size", () => {
		const renderAtDegenerateWidth = () => new MCPAuthorizationLinkPrompt(FULL_AUTH_URL).render(10);

		expect(renderAtDegenerateWidth).not.toThrow();

		const plain = renderAtDegenerateWidth().map(line => stripVTControlCharacters(line));
		const chunks = chunksAfter(plain, " Copy the full URL:");
		expect(chunks.join("")).toBe(FULL_AUTH_URL);
		expect(chunks.slice(0, -1).every(chunk => chunk.length === 16)).toBe(true);
	});

	it("uses the full authorization URL as the OSC 8 hyperlink payload", () => {
		const lines = new MCPAuthorizationLinkPrompt(FULL_AUTH_URL, LAUNCH_URL).render(80);
		const hyperlinkLine = lines.find(line => line.includes("Click here to authorize"));

		expect(hyperlinkLine).toBeDefined();
		expect(hyperlinkLine).toContain(`${OSC}8;`);
		expect(hyperlinkLine).toContain(`${OSC}8;;${BEL}`);
		expect(hyperlinkLine?.match(/\x1b\]8;[^;]*;([^\x1b\x07]+)(?:\x1b\\|\x07)/)?.[1]).toBe(FULL_AUTH_URL);
	});
});
