import type { FetchImpl } from "../../types";
import type { OAuthProviderUnion } from "../registry";

export type OAuthCredentials = {
	refresh: string;
	access: string;
	expires: number;
	enterpriseUrl?: string;
	projectId?: string;
	email?: string;
	accountId?: string;
	apiEndpoint?: string;
};

export type OAuthProvider = OAuthProviderUnion;

export type OAuthProviderId = OAuthProvider | (string & {});

export type OAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
};

export type OAuthAuthInfo = {
	url: string;
	instructions?: string;
	/**
	 * Short loopback URL served by the flow's local callback server that
	 * 302-redirects to {@link url}. Long authorization URLs get clipped or
	 * hard-wrapped by terminal grids when the browser fails to open, and a
	 * copy that silently drops the trailing `code_challenge_method` parameter
	 * downgrades PKCE to `plain` (RFC 7636 §4.3), which S256-only providers
	 * reject. UIs should surface this as the copy target when present.
	 */
	launchUrl?: string;
};

export interface OAuthProviderInfo {
	id: OAuthProviderId;
	name: string;
	available: boolean;
	/**
	 * Provider id the login stores credentials under, when it differs from `id`
	 * (e.g. `openai-codex-device` ⇒ `openai-codex`). Lets callers map a login
	 * entry back to the model provider it authenticates.
	 */
	storeCredentialsAs?: string;
}

export interface OAuthController {
	onAuth?(info: OAuthAuthInfo): void;
	onProgress?(message: string): void;
	onManualCodeInput?(): Promise<string>;
	onPrompt?(prompt: OAuthPrompt): Promise<string>;
	signal?: AbortSignal;
	fetch?: FetchImpl;
}

export interface OAuthLoginCallbacks extends OAuthController {
	onAuth: (info: OAuthAuthInfo) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
}

export interface OAuthProviderInterface {
	readonly id: OAuthProviderId;
	readonly name: string;
	readonly sourceId?: string;
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials | string>;
	refreshToken?(credentials: OAuthCredentials): Promise<OAuthCredentials>;
	getApiKey?(credentials: OAuthCredentials): string;
	/** Store resulting OAuth credentials under a different provider id. */
	readonly storeCredentialsAs?: string;
}
