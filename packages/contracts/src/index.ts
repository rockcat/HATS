/**
 * @hats/contracts — the formal interface between the HATS services.
 *
 *   Agent Template Library  ──AgentTemplate──▶  Project Designer
 *   Project Designer ──ProjectDefinition──▶ Project Server
 *   Project Server ──ProjectDefinition──▶ Team Runner
 *   Team Runner    ──Embodiment API──▶ any UI or app
 *
 * JSON Schemas live in `schemas/`, OpenAPI documents in `openapi/`.
 */

export * from './types.js';
export * from './factories.js';
export * from './validate.js';
export * from './openapi.js';
export * from './visits.js';
