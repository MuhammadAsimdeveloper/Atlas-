const SCHEMA_TYPES = new Set(['object','string','number','integer','boolean','array']);
const SCHEMA_KEYS = new Set([
 'type','required','properties','items','additionalProperties','enum',
 'minLength','maxLength','minimum','maximum','minItems','maxItems'
]);

function fail(message, details = {}) {
 const error = new TypeError(message);
 error.code = 'schema_validation_failed';
 Object.assign(error, details);
 throw error;
}

function assertBoundedInteger(value, label, min, max) {
 if (!Number.isSafeInteger(value) || value < min || value > max) fail(label + ' is outside safe bounds');
 return value;
}

function isPlainObject(value) {
 return value !== null &&
   typeof value === 'object' &&
   !Array.isArray(value) &&
   Object.getPrototypeOf(value) === Object.prototype &&
   Object.getOwnPropertySymbols(value).length === 0;
}

function clone(value, depth = 0, seen = new WeakSet()) {
 if (depth > 8) fail('schema nesting exceeds safe depth');
 if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
 if (typeof value === 'number') {
  if (!Number.isFinite(value)) fail('schema contains a non-finite number');
  return value;
 }
 if (Array.isArray(value)) {
  assertBoundedInteger(value.length, 'schema array length', 0, 100);
  return value.map(item => clone(item, depth + 1, seen));
 }
 if (!isPlainObject(value) || seen.has(value)) fail('schema must be finite plain JSON');
 seen.add(value);
 const result = {};
 for (const [key, child] of Object.entries(value)) {
  if (key.length > 100 || ['__proto__','constructor','prototype'].includes(key)) fail('schema contains an unsafe key');
  result[key] = clone(child, depth + 1, seen);
 }
 seen.delete(value);
 return result;
}

function normalizeSchema(schema, path = 'schema', depth = 0) {
 if (schema == null) return Object.freeze({});
 if (!isPlainObject(schema)) fail(path + ' must be a plain object');
 if (depth > 6) fail(path + ' is nested too deeply');

 const keys = Object.keys(schema);
 if (keys.length > 40 || keys.some(key => !SCHEMA_KEYS.has(key))) fail(path + ' contains unsupported keywords');

 const type = schema.type;
 if (type !== undefined && !SCHEMA_TYPES.has(type)) fail(path + '.type is unsupported');

 const out = {};
 if (type !== undefined) out.type = type;

 if (schema.required !== undefined) {
  if (!Array.isArray(schema.required) || schema.required.length > 100 || schema.required.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,99}$/.test(key))) {
   fail(path + '.required is invalid');
  }
  out.required = [...new Set(schema.required)];
 }

 if (schema.properties !== undefined) {
  if (!isPlainObject(schema.properties) || Object.keys(schema.properties).length > 100) fail(path + '.properties is invalid');
  out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [
   key, normalizeSchema(child, path + '.properties.' + key, depth + 1)
  ]));
 }

 if (schema.items !== undefined) out.items = normalizeSchema(schema.items, path + '.items', depth + 1);

 if (schema.additionalProperties !== undefined) {
  if (typeof schema.additionalProperties !== 'boolean') fail(path + '.additionalProperties must be boolean');
  out.additionalProperties = schema.additionalProperties;
 }

 for (const [key, bounds] of [
  ['minLength',[0,10000]], ['maxLength',[0,10000]], ['minItems',[0,1000]], ['maxItems',[0,1000]]
 ]) if (schema[key] !== undefined) out[key] = assertBoundedInteger(schema[key], path + '.' + key, bounds[0], bounds[1]);

 for (const key of ['minimum','maximum']) if (schema[key] !== undefined) {
  if (typeof schema[key] !== 'number' || !Number.isFinite(schema[key])) fail(path + '.' + key + ' must be finite');
  out[key] = schema[key];
 }

 if (schema.enum !== undefined) {
  if (!Array.isArray(schema.enum) || schema.enum.length < 1 || schema.enum.length > 50) fail(path + '.enum is invalid');
  out.enum = clone(schema.enum);
 }

 if (out.type === 'object') {
  if (out.properties === undefined) out.properties = {};
  if (out.required && out.required.some(key => !Object.hasOwn(out.properties, key))) fail(path + '.required references an undefined property');
 }
 if (out.type === 'array' && out.items === undefined) out.items = {};

 return Object.freeze(out);
}

function validate(value, schema, path) {
 if (!schema || Object.keys(schema).length === 0) return;

 if (schema.enum && !schema.enum.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))) {
  fail(path + ' is not an allowed value', { path });
 }

 switch (schema.type) {
  case 'object':
   if (!isPlainObject(value)) fail(path + ' must be an object', { path });
   for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(path + '.' + key + ' is required', { path:path + '.' + key });
   for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(schema.properties || {}, key)) {
     if (schema.additionalProperties === false) fail(path + '.' + key + ' is not allowed', { path:path + '.' + key });
     continue;
    }
    validate(child, schema.properties[key], path + '.' + key);
   }
   break;
  case 'string':
   if (typeof value !== 'string') fail(path + ' must be a string', { path });
   if (schema.minLength !== undefined && value.length < schema.minLength) fail(path + ' is shorter than minLength', { path });
   if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(path + ' exceeds maxLength', { path });
   break;
  case 'number':
   if (typeof value !== 'number' || !Number.isFinite(value)) fail(path + ' must be a finite number', { path });
   if (schema.minimum !== undefined && value < schema.minimum) fail(path + ' is below minimum', { path });
   if (schema.maximum !== undefined && value > schema.maximum) fail(path + ' is above maximum', { path });
   break;
  case 'integer':
   if (!Number.isInteger(value)) fail(path + ' must be an integer', { path });
   if (schema.minimum !== undefined && value < schema.minimum) fail(path + ' is below minimum', { path });
   if (schema.maximum !== undefined && value > schema.maximum) fail(path + ' is above maximum', { path });
   break;
  case 'boolean':
   if (typeof value !== 'boolean') fail(path + ' must be boolean', { path });
   break;
  case 'array':
   if (!Array.isArray(value)) fail(path + ' must be an array', { path });
   if (schema.minItems !== undefined && value.length < schema.minItems) fail(path + ' has too few items', { path });
   if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(path + ' has too many items', { path });
   if (schema.items) value.forEach((item, index) => validate(item, schema.items, path + '[' + index + ']'));
   break;
  default:
   break;
 }
}

export function normalizeActionSchemas({ inputSchema = {}, outputSchema = {} } = {}) {
 return Object.freeze({
  inputSchema:normalizeSchema(inputSchema, 'inputSchema'),
  outputSchema:normalizeSchema(outputSchema, 'outputSchema')
 });
}

export function validateJsonSchema(value, schema = {}, path = 'input') {
 const normalized = normalizeSchema(schema, 'schema');
 try {
  validate(value, normalized, path);
 } catch (error) {
  if (error?.code === 'schema_validation_failed') throw error;
  throw Object.assign(new TypeError(error?.message || 'schema validation failed'), { code:'schema_validation_failed', path });
 }
 return true;
}

export function schemaSupportsType(schema = {}, type) {
 const normalized = normalizeSchema(schema);
 return normalized.type === type || Object.keys(normalized).length === 0;
}
