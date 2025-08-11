import os from 'node:os';
import path from 'node:path';

export const projectRoot = process.cwd();

export function getProjectWraithDir(cwd = projectRoot) {
	return path.join(cwd, '.wraith');
}

export function getUserWraithDir() {
	return path.join(os.homedir(), '.wraith');
}

export const projectWraithDir = getProjectWraithDir();
export const sessionsDir = path.join(projectWraithDir, 'sessions');
export const checkpointsDir = path.join(projectWraithDir, 'checkpoints');
export const analyticsDir = path.join(projectWraithDir, 'analytics');
export const hotIndexDir = path.join(projectWraithDir, 'hot-index');
export const coldIndexDir = path.join(projectWraithDir, 'indexes');
