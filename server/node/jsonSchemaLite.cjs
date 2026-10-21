'use strict'
// A JSON Schema check for the subset the story schemas use (story/schema/*.schema.json): $ref to #/$defs, type (one or a list,
// "integer" included), enum, const, required, properties, additionalProperties: false, items, minLength, maxLength, pattern,
// minItems, maxItems, minimum. Anything else in a schema is ignored. Why not a library: the server has none, and these schemas
// are small and ours; tests/storyGraph.test.ts checks this against the schemas' own examples.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/** errors of `value` against `schema` ([] = valid); each is "<path>: <what>" */
function validate(schema, value, root = schema, at = '$', out = []) {
    if (schema.$ref) {
        const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref)
        const target = m && root.$defs?.[m[1]]
        if (!target) { out.push(`${at}: unknown $ref ${schema.$ref}`); return out }
        return validate(target, value, root, at, out)
    }
    if (schema.type !== undefined) {
        const want = [].concat(schema.type)
        const t = typeOf(value)
        const ok = want.some((w) => w === t || (w === 'integer' && t === 'number' && Number.isInteger(value)) || (w === 'number' && t === 'number'))
        if (!ok) { out.push(`${at}: is ${t}, wants ${want.join('|')}`); return out }
    }
    if (schema.const !== undefined && value !== schema.const) out.push(`${at}: must be ${JSON.stringify(schema.const)}`)
    if (schema.enum && !schema.enum.includes(value)) out.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`)
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && [...value].length < schema.minLength) out.push(`${at}: shorter than ${schema.minLength}`)
        if (schema.maxLength !== undefined && [...value].length > schema.maxLength) out.push(`${at}: longer than ${schema.maxLength}`)
        if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) out.push(`${at}: does not match ${schema.pattern}`)
    }
    if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) out.push(`${at}: below ${schema.minimum}`)
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${at}: fewer than ${schema.minItems} items`)
        if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${at}: more than ${schema.maxItems} items`)
        if (schema.items) value.forEach((v, i) => validate(schema.items, v, root, `${at}[${i}]`, out))
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const k of schema.required ?? []) if (!(k in value)) out.push(`${at}: missing ${k}`)
        const props = schema.properties ?? {}
        for (const [k, v] of Object.entries(value)) {
            if (props[k]) validate(props[k], v, root, `${at}.${k}`, out)
            else if (schema.additionalProperties === false) out.push(`${at}: unexpected ${k}`)
        }
    }
    return out
}

/** a sub-schema of a root (its $defs stay reachable): sub(root, 'fact') checks one fact of a lore graph */
const sub = (root, def) => ({ ...root.$defs[def], $defs: root.$defs })

module.exports = { validate, sub }
