const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractVariableNames(template = "") {
  return [...new Set([...String(template).matchAll(TOKEN)].map((match) => match[1]))];
}

export function resolveTemplate(template = "", scopes = [], visiting = new Set()) {
  const names = extractVariableNames(template);
  const resolved = {};
  const conflicts = [];
  for (const name of names) {
    const candidates = scopes
      .map((scope, index) => ({
        value: scope?.values?.[name],
        priority: scope?.priority ?? index,
      }))
      .filter((candidate) => candidate.value != null && String(candidate.value).trim() !== "")
      .map((candidate) => ({ ...candidate, value: String(candidate.value) }));
    if (!candidates.length) continue;
    const best = Math.min(...candidates.map((item) => item.priority));
    const values = [...new Set(candidates.filter((item) => item.priority === best).map((item) => item.value))];
    if (values.length > 1) conflicts.push(name);
    else if (visiting.has(name)) conflicts.push(name);
    else {
      const nested = resolveTemplate(values[0], scopes, new Set([...visiting, name]));
      if (nested.conflicts.length) conflicts.push(name);
      else if (!nested.missing.length) resolved[name] = nested.value;
    }
  }
  const missing = names.filter((name) => resolved[name] == null && !conflicts.includes(name));
  return {
    value: String(template).replace(TOKEN, (token, name) => resolved[name.trim()] ?? token),
    missing,
    conflicts,
  };
}

export function graphVariableScopes(nodes = [], edges = [], nodeId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = (id) => edges.filter((edge) => edge.target === id && byId.has(edge.source) && byId.get(edge.source)?.data?.enabled !== false).map((edge) => edge.source);
  const memo = new Map();
  const resolving = new Set();
  const local = (data = {}) => ({ ...Object.fromEntries((data.fields || []).filter((field) => field.label && !["内容", "说明"].includes(field.label)).map((field) => [field.label, field.value])), ...data.variables, ...data.media?.variables });
  function scopesFor(id) {
    const scopes = [{ priority: 0, source: id, values: local(byId.get(id)?.data) }];
    const distances = new Map([[id, 0]]);
    const pending = [id];
    for (let index = 0; index < pending.length; index++) {
      const target = pending[index];
      for (const source of incoming(target)) {
        if (distances.has(source)) continue;
        const priority = distances.get(target) + 1;
        distances.set(source, priority);
        pending.push(source);
        const data = byId.get(source)?.data;
        if (["MarkdownNote", "DataTable"].includes(data?.kind)) scopes.push({ priority, source, values: outputsFor(source) });
      }
    }
    return scopes;
  }
  function outputsFor(id) {
    if (memo.has(id)) return memo.get(id);
    if (resolving.has(id)) return {};
    resolving.add(id);
    const data = byId.get(id)?.data || {};
    const values = { ...local(data), ...Object.fromEntries((data.fields || []).map((field) => [field.label || "TEXT", field.value])) };
    if (data.media?.prompt != null) values[data.fields?.[0]?.label || "提示词"] = data.media.prompt;
    const scopes = scopesFor(id);
    const outputs = Object.fromEntries(Object.entries(values).map(([name, template]) => [name, resolveTemplate(template, scopes).value]));
    resolving.delete(id);
    memo.set(id, outputs);
    return outputs;
  }
  return scopesFor(nodeId);
}
