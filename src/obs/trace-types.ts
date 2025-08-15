export type TraceEventType =
	| 'cli.trace.enabled'
	| 'ask.start'
	| 'ask.delta'
	| 'ask.end'
	| 'chat.turn.start'
	| 'chat.turn.delta'
	| 'chat.turn.end'
	| 'provider.request'
	| 'provider.response'
	| 'provider.error'
	| 'tool.start'
	| 'tool.end';

export interface TraceEventBase {
	t: TraceEventType;
	ts: number;
}

export type TraceEvent =
	| (TraceEventBase & { t: 'cli.trace.enabled'; file: string })
	| (TraceEventBase & { t: 'ask.start'; id: string; model: string })
	| (TraceEventBase & { t: 'ask.delta'; id: string; bytes: number })
	| (TraceEventBase & {
			t: 'ask.end';
			id: string;
			elapsedMs: number;
			tokens?: { input?: number; output?: number; total?: number };
	  })
	| (TraceEventBase & { t: 'chat.turn.start'; id: string; model: string })
	| (TraceEventBase & { t: 'chat.turn.delta'; id: string; bytes: number })
	| (TraceEventBase & {
			t: 'chat.turn.end';
			id: string;
			elapsedMs: number;
			aborted?: boolean;
	  })
	| (TraceEventBase & { t: 'provider.request'; id: string; model: string })
	| (TraceEventBase & {
			t: 'provider.response';
			id: string;
			model: string;
			finishReason?: string;
	  })
	| (TraceEventBase & {
			t: 'provider.error';
			id: string;
			code: string;
			status?: number;
			message: string;
	  })
	| (TraceEventBase & {
			t: 'tool.start' | 'tool.end';
			name: string;
			id: string;
			elapsedMs?: number;
			ok?: boolean;
	  });
