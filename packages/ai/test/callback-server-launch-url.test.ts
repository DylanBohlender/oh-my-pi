import { describe, expect, it } from "bun:test";
import { OAuthCallbackFlow } from "@oh-my-pi/pi-ai/registry/oauth/callback-server";
import type { OAuthAuthInfo, OAuthCredentials } from "@oh-my-pi/pi-ai/registry/oauth/types";

class LaunchTestFlow extends OAuthCallbackFlow {
	generated?: { state: string; redirectUri: string };
	authUrl?: string;

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		this.generated = { state, redirectUri };
		this.authUrl = `https://provider.example/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=verifier-hash&code_challenge_method=S256`;
		return { url: this.authUrl, instructions: "Open the provider authorization page" };
	}

	async exchangeToken(code: string, _state: string, _redirectUri: string): Promise<OAuthCredentials> {
		return {
			access: `access-${code}`,
			refresh: "refresh-token",
			expires: 1_234_567_890,
		};
	}
}

function captureAuth(): { promise: Promise<OAuthAuthInfo>; onAuth: (info: OAuthAuthInfo) => void } {
	let onAuth!: (info: OAuthAuthInfo) => void;
	const promise = new Promise<OAuthAuthInfo>(resolve => {
		onAuth = resolve;
	});
	return { promise, onAuth };
}

describe("OAuthCallbackFlow launch URL", () => {
	it("serves a pending launch URL that redirects to the full auth URL without stealing the callback", async () => {
		const auth = captureAuth();
		const flow = new LaunchTestFlow(
			{
				onAuth: auth.onAuth,
				signal: AbortSignal.timeout(2_000),
			},
			14601,
		);

		const loginPromise = flow.login();
		const authInfo = await auth.promise;

		if (!flow.authUrl) throw new Error("generateAuthUrl was not called");
		expect(authInfo.url).toBe(flow.authUrl);
		expect(authInfo.instructions).toBe("Open the provider authorization page");
		expect(authInfo.launchUrl).toBe("http://localhost:14601/launch");

		const launchResponse = await fetch(authInfo.launchUrl!, { redirect: "manual" });
		expect(launchResponse.status).toBe(302);
		expect(launchResponse.headers.get("Location")).toBe(authInfo.url);

		const missingResponse = await fetch("http://localhost:14601/nope", { redirect: "manual" });
		expect(missingResponse.status).toBe(404);

		if (!flow.generated) throw new Error("generateAuthUrl was not called");
		const callbackResponse = await fetch(
			`http://localhost:14601/callback?code=provider-code&state=${encodeURIComponent(flow.generated.state)}`,
		);
		expect(callbackResponse.status).toBe(200);

		await expect(loginPromise).resolves.toEqual({
			access: "access-provider-code",
			refresh: "refresh-token",
			expires: 1_234_567_890,
		});
	});

	it("lets a /launch callback path win the route collision instead of advertising a launch URL", async () => {
		const auth = captureAuth();
		const flow = new LaunchTestFlow(
			{
				onAuth: auth.onAuth,
				signal: AbortSignal.timeout(2_000),
			},
			{ preferredPort: 14602, callbackPath: "/launch" },
		);

		const loginPromise = flow.login();
		const authInfo = await auth.promise;

		if (!flow.authUrl) throw new Error("generateAuthUrl was not called");
		expect(authInfo.url).toBe(flow.authUrl);
		expect(authInfo.launchUrl).toBeUndefined();
		expect(flow.generated?.redirectUri).toBe("http://localhost:14602/launch");

		if (!flow.generated) throw new Error("generateAuthUrl was not called");
		const callbackResponse = await fetch(
			`http://localhost:14602/launch?code=launch-callback-code&state=${encodeURIComponent(flow.generated.state)}`,
		);
		expect(callbackResponse.status).toBe(200);

		await expect(loginPromise).resolves.toEqual({
			access: "access-launch-callback-code",
			refresh: "refresh-token",
			expires: 1_234_567_890,
		});
	});

	it("suppresses the launch URL when the redirect never returns to the local callback server", async () => {
		const auth = captureAuth();
		const flow = new LaunchTestFlow(
			{
				onAuth: auth.onAuth,
				signal: AbortSignal.timeout(2_000),
			},
			{ preferredPort: 14603, redirectUri: "vscode://gitlab.gitlab-workflow/authentication" },
		);

		const loginPromise = flow.login();
		const authInfo = await auth.promise;

		// A custom-scheme redirect never touches the loopback server, so a
		// localhost /launch URL would misrepresent the callback endpoint.
		expect(authInfo.launchUrl).toBeUndefined();
		expect(flow.generated?.redirectUri).toBe("vscode://gitlab.gitlab-workflow/authentication");

		// The launch route stays dark for such flows.
		const launchResponse = await fetch("http://localhost:14603/launch", { redirect: "manual" });
		expect(launchResponse.status).toBe(404);

		// The local server still resolves a callback delivered to it directly.
		if (!flow.generated) throw new Error("generateAuthUrl was not called");
		const callbackResponse = await fetch(
			`http://localhost:14603/callback?code=external-code&state=${encodeURIComponent(flow.generated.state)}`,
		);
		expect(callbackResponse.status).toBe(200);

		await expect(loginPromise).resolves.toEqual({
			access: "access-external-code",
			refresh: "refresh-token",
			expires: 1_234_567_890,
		});
	});
});
