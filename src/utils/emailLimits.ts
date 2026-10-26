import { EMAIL_LIMITS } from "@/config/constants";

export function emailContentFits(parts: Array<string | null | undefined>): boolean {
	const encoder = new TextEncoder();
	return (
		parts.reduce((bytes, part) => bytes + encoder.encode(part ?? "").byteLength, 0) <=
		EMAIL_LIMITS.MAX_CONTENT_BYTES
	);
}

export async function readBoundedEmail(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array | null> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > EMAIL_LIMITS.MAX_RAW_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const raw = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		raw.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return raw;
}
