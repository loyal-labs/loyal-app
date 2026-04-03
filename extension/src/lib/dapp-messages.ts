// Message types for dApp <-> extension communication

export interface DappConnectRequest {
	type: "DAPP_CONNECT_REQUEST";
	id: string;
	origin: string;
	favicon?: string;
}

export interface DappConnectResponse {
	type: "DAPP_CONNECT_RESPONSE";
	id: string;
	approved: boolean;
	publicKey?: string; // base58
	error?: string;
}

export interface DappSignTransactionRequest {
	type: "DAPP_SIGN_TRANSACTION_REQUEST";
	id: string;
	origin: string;
	favicon?: string;
	// base64-encoded serialized transaction
	transaction: string;
}

export interface DappSignTransactionResponse {
	type: "DAPP_SIGN_TRANSACTION_RESPONSE";
	id: string;
	approved: boolean;
	// base64-encoded signed transaction
	signedTransaction?: string;
	error?: string;
}

export interface DappSignMessageRequest {
	type: "DAPP_SIGN_MESSAGE_REQUEST";
	id: string;
	origin: string;
	favicon?: string;
	// base64-encoded message bytes
	message: string;
}

export interface DappSignMessageResponse {
	type: "DAPP_SIGN_MESSAGE_RESPONSE";
	id: string;
	approved: boolean;
	// base64-encoded signature
	signature?: string;
	error?: string;
}

export interface DappDisconnect {
	type: "DAPP_DISCONNECT";
	origin: string;
}

/** Union of all messages the background can receive from the content script */
export type DappToBackgroundMessage =
	| DappConnectRequest
	| DappSignTransactionRequest
	| DappSignMessageRequest
	| DappDisconnect;

/** Union of all responses the background sends back */
export type BackgroundToDappResponse =
	| DappConnectResponse
	| DappSignTransactionResponse
	| DappSignMessageResponse;

/** Message from popup to background with the user's decision */
export interface DappApprovalDecision {
	type: "DAPP_APPROVAL_DECISION";
	id: string;
	nonce: string;
	approved: boolean;
}
