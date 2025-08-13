import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		include: ['src/tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
		},
	},
	resolve: {
		alias: {
			'@cli': path.resolve(__dirname, 'src/cli'),
			'@obs': path.resolve(__dirname, 'src/obs'),
			'@util': path.resolve(__dirname, 'src/util'),
			'@store': path.resolve(__dirname, 'src/store'),
			'@provider': path.resolve(__dirname, 'src/provider'),
			'@models': path.resolve(__dirname, 'src/models'),
			'@core': path.resolve(__dirname, 'src/core'),
			'@rules': path.resolve(__dirname, 'src/rules'),
			'@ingest': path.resolve(__dirname, 'src/ingest'),
			'@rag': path.resolve(__dirname, 'src/rag'),
			'@tools': path.resolve(__dirname, 'src/tools'),
			'@render': path.resolve(__dirname, 'src/render'),
			'@sessions': path.resolve(__dirname, 'src/sessions'),
		},
	},
});
