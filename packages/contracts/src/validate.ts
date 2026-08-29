/**
 * Runtime validation for the HATS contracts.
 *
 * The schema files under `../schemas` are the single source of truth. Every
 * service validates on the way in (reject bad requests) and on the way out of
 * storage (catch hand-edited files) using the validators built here.
 */

import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import ajvPackage from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import ajvFormatsPackage from 'ajv-formats';
import type { AgentTemplate, ApiErrorDetail, DeployedAgent, ProjectDefinition } from './types.js';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

export const SCHEMA_FILES = {
  common:        'common.schema.json',
  agentTemplate: 'agent-template.schema.json',
  deployedAgent: 'deployed-agent.schema.json',
  project:       'project.schema.json',
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

/** Read one schema document straight off disk — used by the `/schemas` endpoints. */
export function readSchema(name: SchemaName): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, SCHEMA_FILES[name]), 'utf-8')) as Record<string, unknown>;
}

export function listSchemas(): SchemaName[] {
  return Object.keys(SCHEMA_FILES) as SchemaName[];
}

// ajv and ajv-formats are CJS with a default export; under NodeNext the default
// import is the module object, so the callable value lives on `.default`.
const Ajv2020 = ajvPackage.default;
const addFormats = ajvFormatsPackage.default;

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

// Order matters only in that every $ref target must be registered before compile.
for (const name of listSchemas()) ajv.addSchema(readSchema(name));

function compile(name: SchemaName): ValidateFunction {
  const schema = readSchema(name);
  return ajv.getSchema(schema['$id'] as string) as ValidateFunction;
}

const validators: Record<SchemaName, ValidateFunction> = {
  common:        compile('common'),
  agentTemplate: compile('agentTemplate'),
  deployedAgent: compile('deployedAgent'),
  project:       compile('project'),
};

export interface ValidationResult<T> {
  valid: boolean;
  value: T;
  errors: ApiErrorDetail[];
}

function toDetails(errors: ErrorObject[] | null | undefined): ApiErrorDetail[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message ?? 'is invalid',
  }));
}

/** Validate an unknown document against one of the contract schemas. */
export function validateAgainst<T>(name: SchemaName, doc: unknown): ValidationResult<T> {
  const validate = validators[name];
  const valid = validate(doc) as boolean;
  return { valid, value: doc as T, errors: valid ? [] : toDetails(validate.errors) };
}

export const validateAgentTemplate = (doc: unknown): ValidationResult<AgentTemplate> =>
  validateAgainst<AgentTemplate>('agentTemplate', doc);

export const validateDeployedAgent = (doc: unknown): ValidationResult<DeployedAgent> =>
  validateAgainst<DeployedAgent>('deployedAgent', doc);

export const validateProject = (doc: unknown): ValidationResult<ProjectDefinition> =>
  validateAgainst<ProjectDefinition>('project', doc);

/** Throwing wrapper for code paths where an invalid document is a programmer error. */
export function assertValid<T>(name: SchemaName, doc: unknown): T {
  const result = validateAgainst<T>(name, doc);
  if (!result.valid) {
    const summary = result.errors.map((d) => `${d.path} ${d.message}`).join('; ');
    throw new Error(`Invalid ${name} document: ${summary}`);
  }
  return result.value;
}
