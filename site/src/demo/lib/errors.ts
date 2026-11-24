// Stable error codes and exit codes, as in src/domain/errors.cf (D-018, D-019).
// The order is the exit-code order: exit code = index + 1, `internal` = 1.
export const ERROR_CODES = [
	'internal',
	'usage',
	'not_found',
	'conflict',
	'locked',
	'wrong_password',
	'invalid',
	'unsupported',
	'keychain',
	'io',
	'host_key',
	'auth',
	'network',
	'timeout',
	'denied',
	'approval_timeout',
	'not_sudoer',
	'sudo_password',
	'permission_denied',
	'exists',
	'not_a_directory',
	'port_in_use',
	'wrong_host_type',
	'refused',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function exitCodeFor(code: ErrorCode): number {
	return ERROR_CODES.indexOf(code) + 1;
}

/** An error the simulated CLI reports, with the real CLI's code and message, and the
 * core's message id and params when the core names it (src/domain/messages.cf). */
export class FlintError extends Error {
	readonly code: ErrorCode;
	readonly id: string;
	readonly params: string[];
	constructor(code: ErrorCode, message: string, id = '', params: string[] = []) {
		super(message);
		this.code = code;
		this.id = id;
		this.params = params;
	}
}

export function fail(code: ErrorCode, message: string): never {
	throw new FlintError(code, message);
}

/** A failure the core names: `--json` shows its id and params beside the message. */
export function failWith(code: ErrorCode, id: string, params: string[], message: string): never {
	throw new FlintError(code, message, id, params);
}
