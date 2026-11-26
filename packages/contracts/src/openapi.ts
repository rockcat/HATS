/** Locating and reading the OpenAPI documents that ship with the contracts. */

import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { load as parseYaml } from 'js-yaml';

const OPENAPI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'openapi');

export const OPENAPI_FILES = {
  agentLibrary:  'agent-library.openapi.yaml',
  projectServer: 'project-server.openapi.yaml',
  embodiment:    'embodiment.openapi.yaml',
  runner:        'runner.openapi.yaml',
} as const;

export type OpenApiName = keyof typeof OPENAPI_FILES;

export function openApiPath(name: OpenApiName): string {
  return path.join(OPENAPI_DIR, OPENAPI_FILES[name]);
}

export function readOpenApiYaml(name: OpenApiName): string {
  return readFileSync(openApiPath(name), 'utf-8');
}

export function readOpenApiJson(name: OpenApiName): Record<string, unknown> {
  return parseYaml(readOpenApiYaml(name)) as Record<string, unknown>;
}
