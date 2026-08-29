/**
 * The health / schema / OpenAPI endpoints every HATS service exposes.
 * Building them once means all three services answer these identically.
 */

import { json, notFound, text } from './http.js';
import { get, type Route } from './router.js';
import { listSchemas, readSchema, type SchemaName } from '../../contracts/src/validate.js';
import { readOpenApiJson, readOpenApiYaml, type OpenApiName } from '../../contracts/src/openapi.js';

export interface MetaRouteOptions {
  /** Path prefix the routes are mounted under, e.g. `/api/v1`. */
  base: string;
  /** Which bundled OpenAPI document describes this service. */
  openApi: OpenApiName;
  /** Extra fields merged into the health payload on every call. */
  health: () => Record<string, unknown>;
}

export function metaRoutes(options: MetaRouteOptions): Route[] {
  const { base, openApi, health } = options;
  const schemaNames = new Set(listSchemas());

  return [
    get(`${base}/health`, ({ res }) => json(res, 200, { ok: true, ...health() })),

    get(`${base}/schemas`, ({ res }) => json(res, 200, { schemas: [...schemaNames] })),

    get(`${base}/schemas/:name`, ({ res, params }) => {
      const name = params['name'] as SchemaName;
      if (!schemaNames.has(name)) { notFound(res, 'Schema'); return; }
      const body = JSON.stringify(readSchema(name), null, 2);
      text(res, 200, body, 'application/schema+json; charset=utf-8');
    }),

    get(`${base}/openapi.yaml`, ({ res }) =>
      text(res, 200, readOpenApiYaml(openApi), 'application/yaml; charset=utf-8')),

    get(`${base}/openapi.json`, ({ res }) => json(res, 200, readOpenApiJson(openApi))),
  ];
}
