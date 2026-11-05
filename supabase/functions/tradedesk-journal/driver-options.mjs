// Core SQL uses pg-compatible, pre-encoded JSON parameters. postgres.js otherwise
// JSON-encodes those strings a second time after resolving the jsonb parameter OID.
export const journalJsonTypes={json:{to:114,from:[114,3802],
  serialize(value){if(typeof value==='string'){JSON.parse(value);return value;}return JSON.stringify(value);},
  parse:JSON.parse}};
